import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateReasoningSessions, schema } from './schema.ts';

export class BangError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type TopicRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: 'active' | 'archived';
  is_current: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type EpisodeRow = {
  id: string;
  topic_id: string;
  harness: string;
  session_id: string;
  source_turn_id: string;
  turn_index: number;
  ingest_index: number;
  messages_json: string;
  content_hash: string;
  source_ref: string | null;
  revision_id: string | null;
  replaces_episode_id: string | null;
  occurred_at: string;
  recorded_at: string;
};

export type EpisodeMessage = { role: 'user' | 'assistant'; timestamp: string; content: string };

export type EpisodeInput = {
  topicId?: unknown;
  sourceTool?: unknown;
  sessionId?: unknown;
  turnId?: unknown;
  messages?: unknown;
  sourceRef?: unknown;
  revisionId?: unknown;
  replacesEpisodeId?: unknown;
};

function episodeFromRow(row: EpisodeRow) {
  return {
    id: row.id,
    topicId: row.topic_id,
    sourceTool: row.harness,
    sessionId: row.session_id,
    turnId: row.source_turn_id,
    turnIndex: row.turn_index,
    ingestIndex: row.ingest_index,
    messages: JSON.parse(row.messages_json) as EpisodeMessage[],
    sourceRef: row.source_ref,
    revisionId: row.revision_id,
    replacesEpisodeId: row.replaces_episode_id,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  };
}

function episodeMessages(value: unknown): [EpisodeMessage, EpisodeMessage] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new BangError('invalid_messages', 'Expected the user message and assistant reply');
  }
  function parse(value: unknown, role: EpisodeMessage['role']): EpisodeMessage {
    const message = value as Partial<EpisodeMessage> | null;
    if (message?.role !== role || typeof message.content !== 'string') {
      throw new BangError('invalid_messages', `Expected the ${role} message with text content`);
    }
    const timestamp = requiredString(message.timestamp, 'timestamp');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
        !Number.isFinite(Date.parse(timestamp))) {
      throw new BangError('invalid_timestamp', 'Use an ISO 8601 timestamp with a timezone');
    }
    return { role, timestamp, content: message.content };
  }
  return [parse(value[0], 'user'), parse(value[1], 'assistant')];
}

export function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BangError('invalid_input', `${field} must be a nonempty string`);
  }
  return value;
}

function topicFromRow(row: TopicRow) {
  return {
    id: row.id, slug: row.slug, title: row.title, name: row.title, description: row.description,
    status: row.status, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class BangStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      this.transaction(() => {
        const state = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
        if (state.user_version === 0) {
          this.db.exec(schema + 'PRAGMA user_version = 3;');
          return;
        }
        if (state.user_version === 1) this.db.exec('ALTER TABLE adapter_cursors ADD COLUMN active_turn_json TEXT;');
        if (state.user_version === 1 || state.user_version === 2) {
          this.db.exec(migrateReasoningSessions + 'PRAGMA user_version = 3;');
        } else if (state.user_version !== 3) {
          throw new Error(`Unsupported Bang database version ${state.user_version}`);
        }
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    this.db.close();
  }

  listTopics() {
    const rows = this.db.prepare('SELECT * FROM topics ORDER BY rowid').all() as TopicRow[];
    return {
      topics: rows.map(topicFromRow),
      activeTopicId: rows.find((row) => row.is_current === 1)?.id ?? null,
    };
  }

  findTopic(idOrSlug: string) {
    const row = this.db.prepare('SELECT * FROM topics WHERE id = ? OR slug = ?')
      .get(idOrSlug, idOrSlug) as TopicRow | undefined;
    if (!row) throw new BangError('topic_not_found', 'Topic does not exist', 404);
    return topicFromRow(row);
  }

  createTopic(input: { name?: unknown; slug?: unknown; title?: unknown; description?: unknown }) {
    const title = requiredString(input.title ?? input.name ?? input.slug, 'title').trim();
    const slug = input.slug === undefined
      ? title.normalize('NFKC').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '')
      : requiredString(input.slug, 'slug');
    if (!/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}_-]{0,79}$/u.test(slug)) {
      throw new BangError('invalid_slug', 'Slug must contain 1–80 letters, digits, hyphens or underscores');
    }
    const description = input.description ?? '';
    if (typeof description !== 'string') throw new BangError('invalid_input', 'description must be a string');
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM topics WHERE slug = ?').get(slug)) {
        throw new BangError('topic_exists', 'Topic slug already exists', 409);
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      this.db.exec('UPDATE topics SET is_current = 0 WHERE is_current = 1');
      this.db.prepare(`
        INSERT INTO topics (id, slug, title, description, is_current, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(id, slug, title, description, now, now);
      return this.findTopic(id);
    });
  }

  switchTopic(idOrSlug: string) {
    return this.transaction(() => {
      const topic = this.findTopic(idOrSlug);
      if (topic.status === 'archived') throw new BangError('topic_archived', 'Topic is archived', 409);
      this.db.exec('UPDATE topics SET is_current = 0 WHERE is_current = 1');
      this.db.prepare('UPDATE topics SET is_current = 1 WHERE id = ?').run(topic.id);
      return topic;
    });
  }

  archiveTopic(idOrSlug: string) {
    return this.transaction(() => {
      const topic = this.findTopic(idOrSlug);
      if (topic.status === 'archived') return topic;
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE topics SET status = 'archived', is_current = 0, archived_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, topic.id);
      this.db.exec(`
        UPDATE topics SET is_current = 1
        WHERE id = (SELECT id FROM topics WHERE status = 'active' ORDER BY rowid DESC LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM topics WHERE is_current = 1)
      `);
      return this.findTopic(topic.id);
    });
  }

  listEpisodes(idOrSlug: string, sessionId?: string, sourceTool?: string) {
    const topic = this.findTopic(idOrSlug);
    const rows = sessionId === undefined
      ? this.db.prepare('SELECT * FROM episodes WHERE topic_id = ? ORDER BY ingest_index').all(topic.id)
      : sourceTool === undefined
        ? this.db.prepare('SELECT * FROM episodes WHERE topic_id = ? AND session_id = ? ORDER BY ingest_index')
          .all(topic.id, sessionId)
        : this.db.prepare(`
            SELECT * FROM episodes WHERE topic_id = ? AND session_id = ? AND harness = ? ORDER BY ingest_index
          `).all(topic.id, sessionId, sourceTool);
    return (rows as EpisodeRow[]).map(episodeFromRow);
  }

  getEpisode(idOrSlug: string, episodeId: string) {
    const topic = this.findTopic(idOrSlug);
    const row = this.db.prepare('SELECT * FROM episodes WHERE topic_id = ? AND id = ?')
      .get(topic.id, episodeId) as EpisodeRow | undefined;
    if (!row) throw new BangError('episode_not_found', 'Episode does not exist in this topic', 404);
    return episodeFromRow(row);
  }

  recordEpisode(input: EpisodeInput) {
    const sourceTool = requiredString(input.sourceTool, 'sourceTool');
    const sessionId = requiredString(input.sessionId, 'sessionId');
    const turnId = requiredString(input.turnId, 'turnId');
    const sourceRef = input.sourceRef === undefined ? null : requiredString(input.sourceRef, 'sourceRef');
    const revisionId = input.revisionId === undefined ? null : requiredString(input.revisionId, 'revisionId');
    const replacesEpisodeId = input.replacesEpisodeId === undefined
      ? null
      : requiredString(input.replacesEpisodeId, 'replacesEpisodeId');
    const messages = episodeMessages(input.messages);
    const [user, assistant] = messages;
    const contentHash = createHash('sha256').update(JSON.stringify([user.content, assistant.content])).digest('hex');

    return this.transaction(() => {
      const topic = this.episodeTopic(input.topicId);
      const identity = [topic.id, sourceTool, sessionId, turnId] as const;
      const turnRows = this.db.prepare(`
        SELECT * FROM episodes WHERE topic_id = ? AND harness = ? AND session_id = ? AND source_turn_id = ?
      `).all(...identity) as EpisodeRow[];
      const existing = turnRows.find((row) => row.replaces_episode_id === replacesEpisodeId);
      if (existing && existing.content_hash === contentHash &&
          (revisionId === null || existing.revision_id === null || revisionId === existing.revision_id)) {
        return { status: 'duplicate' as const, episode: episodeFromRow(existing) };
      }
      if (existing || (revisionId !== null && turnRows.some((row) => row.revision_id === revisionId))) {
        throw new BangError('episode_conflict', 'This Episode version exists with different content or revision information', 409);
      }
      const previous = turnRows.find((row) => row.id === replacesEpisodeId);
      if (replacesEpisodeId !== null && !previous) {
        throw new BangError('invalid_episode_predecessor', 'The prior Episode must belong to the same source turn', 409);
      }
      if (topic.status === 'archived') {
        throw new BangError('topic_archived', 'Topic is archived', 409);
      }
      const turnIndex = previous?.turn_index ?? (this.db.prepare(`
        SELECT COALESCE(MAX(turn_index), 0) + 1 AS next FROM episodes
        WHERE topic_id = ? AND harness = ? AND session_id = ?
      `).get(topic.id, sourceTool, sessionId) as { next: number }).next;
      const { next: ingestIndex } = this.db.prepare(`
        SELECT COALESCE(MAX(ingest_index), 0) + 1 AS next FROM episodes WHERE topic_id = ?
      `).get(topic.id) as { next: number };
      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO episodes (id, topic_id, harness, session_id, source_turn_id, turn_index, ingest_index,
          user_text, assistant_text, messages_json, content_hash, source_ref, revision_id, replaces_episode_id,
          occurred_at, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ...identity, turnIndex, ingestIndex, user.content, assistant.content, JSON.stringify(messages),
        contentHash, sourceRef, revisionId, replacesEpisodeId, user.timestamp, new Date().toISOString());
      return { status: 'recorded' as const, episode: this.getEpisode(topic.id, id) };
    });
  }

  private episodeTopic(idOrSlug: unknown) {
    if (idOrSlug !== undefined) return this.findTopic(requiredString(idOrSlug, 'topicId'));
    const available = this.listTopics().topics.filter((topic) => topic.status === 'active');
    if (available.length === 1) return available[0];
    throw new BangError('topic_selection_required', 'Specify a topic for this Episode', 409);
  }
}
