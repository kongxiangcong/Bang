import type { RouteContext } from '../../core/src/server.ts';
import { BangError, BangStore, requiredString } from '../../core/src/store.ts';
import {
  bindingBoundary, completeLines, consumeRow, locateTranscript, openTranscript, parseRow, readChunk, transcriptMeta,
} from './codex-transcript.ts';
import type { ActiveTurn } from './codex-transcript.ts';
import { filterCodexExchange } from './codex-filter.ts';

type Cursor = {
  adapter_key: string;
  session_id: string;
  topic_id: string;
  enabled: number;
  file_signature: string;
  capture_from_offset: number;
  byte_offset: number;
  line_buffer: string;
  last_turn_id: string | null;
  active_turn_json: string | null;
};

const harness = 'codex';
const prefix = harness + ':';
const parseSessionId = (value: unknown) => {
  const id = requiredString(value, 'sessionId');
  if (!/^[\w-]+$/.test(id)) throw new BangError('invalid_session_id', 'Invalid Codex session ID');
  return id;
};

function summary(cursor: Cursor) {
  return {
    sessionId: cursor.session_id,
    topicId: cursor.topic_id,
    enabled: cursor.enabled === 1,
    lastTurnId: cursor.last_turn_id,
    byteOffset: cursor.byte_offset,
  };
}

function fileMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT' ||
    (error instanceof BangError && error.code === 'codex_transcript_not_found');
}

class CodexWatcher {
  private queue = Promise.resolve();
  private readonly store: BangStore;
  private readonly project: string;

  constructor(store: BangStore, project: string) {
    this.store = store;
    this.project = project;
  }

  run<T>(operation: () => Promise<T>) {
    const next = this.queue.then(operation);
    this.queue = next.then(() => {}, () => {});
    return next;
  }

  wait() {
    return this.queue;
  }

  private cursor(session: string) {
    return this.store.db.prepare('SELECT * FROM adapter_cursors WHERE harness = ? AND session_id = ?')
      .get(harness, session) as Cursor | undefined;
  }

  async bind(input: Record<string, unknown>) {
    const topic = this.store.findTopic(requiredString(input.topicId, 'topicId'));
    if (topic.status === 'archived') throw new BangError('topic_archived', 'Topic is archived', 409);
    const session = parseSessionId(input.sessionId);
    const supplied = input.transcript === undefined ? undefined : requiredString(input.transcript, 'transcript');
    const turnId = input.turnId === undefined ? undefined : requiredString(input.turnId, 'turnId');
    const prior = this.cursor(session);
    if (prior?.enabled && prior.topic_id !== topic.id) {
      throw new BangError('codex_already_bound', 'Unbind this Codex session before selecting another topic', 409);
    }
    const path = await locateTranscript(session, supplied ?? (prior?.enabled ? prior.adapter_key.slice(prefix.length) : undefined));
    const file = await openTranscript(path);
    try {
      const meta = await transcriptMeta(file, this.project, session);
      if (!meta || (prior?.enabled && prior.file_signature !== meta.signature)) {
        throw new BangError('codex_session_excluded', 'Codex transcript is outside the project or is not a primary session', 409);
      }
      if (prior?.enabled) return { status: 'bound', ...summary(prior) };
      const { active, lineOffset } = await bindingBoundary(file, meta.offset);
      if (turnId !== undefined && turnId !== active?.id) {
        throw new BangError('codex_turn_not_active', 'The supplied Codex turn is not active in this transcript', 409);
      }
      const boundary = (turnId !== undefined || input.includeActive === true) && active ? active.offset : lineOffset;
      this.store.transaction(() => {
        if (prior) this.store.db.prepare('DELETE FROM adapter_cursors WHERE adapter_key = ?').run(prior.adapter_key);
        this.store.db.prepare(`
          INSERT INTO adapter_cursors (adapter_key, harness, session_id, topic_id, file_signature,
            capture_from_offset, byte_offset, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(prefix + path, harness, session, topic.id, meta.signature, boundary, boundary, new Date().toISOString());
      });
      return { status: 'bound', ...summary(this.cursor(session)!) };
    } finally {
      await file.close();
    }
  }

  async unbind(value: unknown) {
    const cursor = this.cursor(parseSessionId(value));
    if (!cursor) throw new BangError('codex_binding_not_found', 'Codex session is not bound', 404);
    if (cursor.enabled) {
      await this.follow(cursor).catch((error) => {
        if (!fileMissing(error)) throw error;
      });
      this.store.db.prepare(`
        UPDATE adapter_cursors SET enabled = 0, active_turn_json = NULL, line_buffer = '', updated_at = ?
        WHERE harness = ? AND session_id = ?
      `).run(new Date().toISOString(), harness, cursor.session_id);
    }
    return { status: 'unbound', ...summary(this.cursor(cursor.session_id)!) };
  }

  bindings() {
    const rows = this.store.db.prepare('SELECT * FROM adapter_cursors WHERE harness = ? ORDER BY session_id')
      .all(harness) as Cursor[];
    return rows.map(summary);
  }

  async poll() {
    const cursors = this.store.db.prepare(`
      SELECT adapter_cursors.* FROM adapter_cursors JOIN topics ON topics.id = adapter_cursors.topic_id
      WHERE harness = ? AND enabled = 1 AND topics.status = 'active'
    `).all(harness) as Cursor[];
    for (const cursor of cursors) {
      try {
        await this.follow(cursor);
      } catch (error) {
        if (!fileMissing(error)) console.error('Could not read a bound Codex transcript', (error as NodeJS.ErrnoException).code);
      }
    }
  }

  private async follow(cursor: Cursor) {
    let file = await openTranscript(cursor.adapter_key.slice(prefix.length)).catch((error) => {
      if (!fileMissing(error)) throw error;
    });
    let relocatedKey: string | undefined;
    if (!file) {
      const path = await locateTranscript(cursor.session_id);
      file = await openTranscript(path);
      relocatedKey = prefix + path;
    }
    try {
      const { size } = await file.stat();
      if (size < cursor.byte_offset || (size === cursor.byte_offset && !relocatedKey)) return;
      const meta = await transcriptMeta(file, this.project, cursor.session_id);
      if (!meta || meta.signature !== cursor.file_signature) return;
      if (relocatedKey) {
        this.store.db.prepare('UPDATE adapter_cursors SET adapter_key = ? WHERE adapter_key = ?')
          .run(relocatedKey, cursor.adapter_key);
        cursor.adapter_key = relocatedKey;
      }
      let offset = cursor.byte_offset;
      let pending = Buffer.from(cursor.line_buffer, 'base64');
      let active: ActiveTurn | undefined = cursor.active_turn_json ? JSON.parse(cursor.active_turn_json) : undefined;
      let lastTurnId = cursor.last_turn_id;
      while (offset < size) {
        const chunk = await readChunk(file, offset, size - offset);
        if (chunk.length === 0) break;
        let lineOffset = offset - pending.length;
        const bytes = Buffer.concat([pending, chunk]);
        for (const line of completeLines(bytes, lineOffset)) {
          lineOffset = line.next;
          const result = consumeRow(active, parseRow(line.bytes));
          active = result.active;
          if (result.ended) lastTurnId = result.ended;
          const turn = result.complete;
          const exchange = turn && filterCodexExchange(turn.user, turn.assistant, turn.bangOperation);
          if (turn && exchange) {
            try {
              this.store.recordEpisode({
                topicId: cursor.topic_id, sourceTool: harness, sessionId: cursor.session_id, turnId: turn.id,
                messages: [
                  { role: 'user', content: exchange.user, timestamp: turn.at },
                  { role: 'assistant', content: exchange.assistant, timestamp: turn.assistantAt },
                ],
              });
            } catch (error) {
              if (!(error instanceof BangError && (error.code === 'episode_conflict' || error.code === 'topic_archived'))) {
                throw error;
              }
            }
          }
        }
        offset += chunk.length;
        pending = bytes.subarray(bytes.length - (offset - lineOffset));
        // Episode identity makes a replay idempotent if the process dies before this checkpoint.
        this.store.db.prepare(`
          UPDATE adapter_cursors SET byte_offset = ?, line_buffer = ?, active_turn_json = ?, last_turn_id = ?, updated_at = ?
          WHERE adapter_key = ?
        `).run(offset, pending.toString('base64'), active ? JSON.stringify(active) : null, lastTurnId,
          new Date().toISOString(), cursor.adapter_key);
      }
    } finally {
      await file.close();
    }
  }
}

export function codexCapture() {
  let watcher: CodexWatcher | undefined;

  return {
    onStart({ store, paths }: Pick<RouteContext, 'store' | 'paths'>) {
      const runtime = new CodexWatcher(store, paths.root);
      watcher = runtime;
      let active = true;
      let timer: NodeJS.Timeout;
      function schedule() {
        if (active) timer = setTimeout(poll, 200);
      }
      function poll() {
        void runtime.run(() => runtime.poll()).catch(() => {
          console.error('Could not update the Codex capture cursor');
        }).finally(schedule);
      }
      poll();
      return () => {
        active = false;
        clearTimeout(timer);
        return runtime.wait();
      };
    },
    async route({ request, url, parts, body, json }: RouteContext) {
      if (!watcher) return false;
      const runtime = watcher;
      if (url.pathname === '/api/codex/bindings') {
        if (request.method === 'GET') {
          json({ bindings: runtime.bindings() });
          return true;
        }
        if (request.method === 'POST') {
          const input = await body();
          json(await runtime.run(() => runtime.bind(input)));
          return true;
        }
      }
      if (request.method === 'DELETE' && parts.length === 4 &&
          parts[0] === 'api' && parts[1] === 'codex' && parts[2] === 'bindings') {
        json(await runtime.run(() => runtime.unbind(parts[3])));
        return true;
      }
      return false;
    },
  };
}
