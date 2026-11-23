import { randomUUID } from 'node:crypto';
import { BangError } from '../store.ts';
import type { BangStore } from '../store.ts';
import type { workspacePaths } from '../workspace.ts';
import {
  applyMerge, contextFor, currentBoard, publishBoard, readBoard, saveRevision, updateEpistemic, validateRelationship,
} from './board.ts';
import { invalidOutput, parseDelta, parseMerge, safeId, validateHint, validateLandmark, validateSources } from './contract.ts';
import type { Episode, SessionDelta, SessionGraph } from './contract.ts';
import { configuredProvider } from './provider.ts';
import type { ReasoningProvider } from './provider.ts';

type Topic = ReturnType<BangStore['findTopic']>;
type Paths = ReturnType<typeof workspacePaths>;
type SourceSession = Pick<Episode, 'sourceTool' | 'sessionId'>;
type ScheduledSession = SourceSession & { topicId: string };
type Job = {
  id: string;
  topic_id: string;
  session_id: string;
  harness: string | null;
  stage: 'pass1_session' | 'pass2_merge';
  episode_ids: string;
  payload_json: string | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  next_retry_at: string | null;
  error_code: string | null;
  error_detail: string | null;
};
type JobResult = {
  id: string;
  sessionId: string;
  sourceTool: string | null;
  stage: Job['stage'];
  attempts: number;
  status: Job['status'];
  episodeIds: string[];
  revision: number | null;
  nextRetryAt: string | null;
  error: { code: string; message: string | null } | null;
};
type SubgraphRow = { subgraph_json: string; last_episode_id: string | null };
const now = () => new Date().toISOString();
const scheduleIntervalMs = 1_000;
const turnsPerBatch = 5;
const idlePeriodMs = 90_000;
const retryDelaysMs = [15_000, 30_000];
const emptyGraph: SessionGraph = { landmarks: [], relationships: [], epistemic_hints: [] };
const episodeIds = (job: Job) => JSON.parse(job.episode_ids) as string[];

function activeEpisodes(episodes: Episode[]) {
  const replaced = new Set(episodes.map((episode) => episode.replacesEpisodeId));
  return episodes.filter(({ id }) => !replaced.has(id));
}

function sourcesIn(session: SessionGraph) {
  return new Set([...session.landmarks, ...session.relationships, ...session.epistemic_hints]
    .flatMap(({ source_episodes }) => source_episodes));
}

function updateItems<T>(previous: T[], changes: T[], removed: string[], key: (item: T) => string) {
  const result = new Map(previous.map((item) => [key(item), item]));
  for (const id of removed) {
    if (!result.delete(id)) invalidOutput('Pass 1 removed an unknown session item');
  }
  const changed = new Set(removed);
  for (const item of changes) {
    const id = key(item);
    safeId(id);
    if (changed.has(id)) invalidOutput('Pass 1 returned conflicting updates for a session item');
    changed.add(id);
    result.set(id, item);
  }
  return [...result.values()];
}

function applyDelta(previous: SessionGraph, delta: SessionDelta, allowed: ReadonlyMap<string, Episode>) {
  for (const landmark of delta.landmarks) {
    validateLandmark(landmark);
    validateSources(landmark, allowed);
  }
  for (const hint of delta.epistemic_hints) validateHint(hint, allowed);
  const landmarks = updateItems(previous.landmarks, delta.landmarks, delta.remove_landmarks, ({ id }) => id);
  const nodes = new Map(landmarks.map((node) => [node.id, node]));
  const relationships = updateItems(previous.relationships, delta.relationships, delta.remove_relationships, ({ id }) => id);
  for (const edge of relationships) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) invalidOutput('Pass 1 relationship references an unknown session landmark');
    validateSources(edge, allowed);
    validateRelationship(edge, from.kind, to.kind);
  }
  const epistemic_hints = updateItems(previous.epistemic_hints.filter((hint) => nodes.has(hint.node_id)),
    delta.epistemic_hints, [], ({ node_id }) => node_id);
  if (epistemic_hints.some((hint) => !nodes.has(hint.node_id))) {
    invalidOutput('Pass 1 epistemic hint references an unknown session landmark');
  }
  return { landmarks, relationships, epistemic_hints };
}

export class ReasoningEngine {
  private store: BangStore;
  private paths: Paths;
  private abort = new AbortController();
  private active = new Map<string, { id: string; task: Promise<JobResult> }>();
  private scheduler?: ReturnType<typeof setInterval>;

  constructor(store: BangStore, paths: Paths) {
    this.store = store;
    this.paths = paths;
  }

  start() {
    this.scheduler = setInterval(() => {
      try {
        this.schedule();
      } catch (error) {
        console.error('Unable to schedule automatic reasoning', error);
      }
    }, scheduleIntervalMs).unref();
  }

  async close() {
    clearInterval(this.scheduler);
    this.abort.abort();
    await Promise.allSettled([...this.active.values()].map(({ task }) => task));
  }

  private schedule() {
    const time = Date.now();
    const idleBefore = new Date(time - idlePeriodMs).toISOString();
    const ready = this.store.db.prepare(`
      SELECT episode.topic_id AS topicId, episode.session_id AS sessionId, episode.harness AS sourceTool
      FROM episodes AS episode
      JOIN topics AS topic ON topic.id = episode.topic_id AND topic.status = 'active'
      LEFT JOIN session_subgraphs AS session ON session.topic_id = episode.topic_id
        AND session.session_id = episode.session_id AND session.harness = episode.harness
      LEFT JOIN episodes AS watermark ON watermark.id = session.last_episode_id
      WHERE episode.ingest_index > COALESCE(watermark.ingest_index, 0)
      GROUP BY episode.topic_id, episode.session_id, episode.harness
      HAVING (COUNT(CASE WHEN episode.replaces_episode_id IS NULL THEN 1 END) >= ? OR MAX(episode.recorded_at) <= ?)
        AND NOT EXISTS (
          SELECT 1 FROM jobs WHERE topic_id = episode.topic_id AND session_id = episode.session_id
            AND harness = episode.harness AND status != 'done'
        )
      UNION
      SELECT job.topic_id, job.session_id, job.harness FROM jobs AS job
      JOIN topics AS topic ON topic.id = job.topic_id AND topic.status = 'active'
      WHERE job.harness IS NOT NULL AND (
        job.status IN ('pending', 'running') OR (job.status = 'failed' AND job.next_retry_at <= ?)
      )
    `).all(turnsPerBatch, idleBefore, new Date(time).toISOString()) as ScheduledSession[];
    if (!ready.length) return;
    let provider: ReasoningProvider;
    try {
      provider = configuredProvider(this.paths.config);
    } catch {
      // Leave saved Episodes available while the user configures the model.
      return;
    }
    for (const session of ready) {
      this.syncSession(this.store.findTopic(session.topicId), session, provider, true);
    }
  }

  jobs(topicId: string) {
    return (this.store.db.prepare('SELECT * FROM jobs WHERE topic_id = ? ORDER BY rowid').all(topicId) as Job[])
      .map((job) => this.jobResult(job));
  }

  private jobResult(job: Job): JobResult {
    const revision = this.store.db.prepare('SELECT revision FROM topic_revisions WHERE trigger_job_id = ?')
      .get(job.id) as { revision: number } | undefined;
    return {
      id: job.id, sessionId: job.session_id, sourceTool: job.harness, stage: job.stage, status: job.status, attempts: job.attempts,
      episodeIds: episodeIds(job), revision: revision?.revision ?? null, nextRetryAt: job.next_retry_at,
      error: job.error_code ? { code: job.error_code, message: job.error_detail } : null,
    };
  }

  private getJob(id: string) {
    return this.store.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job;
  }

  private subgraph(topicId: string, sessionId: string, sourceTool: string) {
    return this.store.db.prepare(`
      SELECT subgraph_json, last_episode_id FROM session_subgraphs WHERE topic_id = ? AND session_id = ? AND harness = ?
    `).get(topicId, sessionId, sourceTool) as SubgraphRow | undefined;
  }

  private startJob(topicId: string, { sessionId, sourceTool }: SourceSession) {
    return this.store.transaction(() => {
      const previous = this.store.db.prepare(`
        SELECT * FROM jobs WHERE topic_id = ? AND session_id = ? AND harness = ? AND status != 'done' ORDER BY rowid LIMIT 1
      `).get(topicId, sessionId, sourceTool) as Job | undefined;
      if (previous) {
        this.store.db.prepare(`
          UPDATE jobs SET status = 'running', attempts = attempts + 1, error_code = NULL,
            error_detail = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?
        `).run(now(), previous.id);
        return this.getJob(previous.id);
      }
      const episodes = this.store.listEpisodes(topicId, sessionId, sourceTool);
      const watermark = this.subgraph(topicId, sessionId, sourceTool)?.last_episode_id;
      const remaining = episodes.slice(watermark ? episodes.findIndex((episode) => episode.id === watermark) + 1 : 0);
      if (!remaining.length) return;
      const id = randomUUID();
      const time = now();
      this.store.db.prepare(`
        INSERT INTO jobs (id, topic_id, session_id, harness, stage, episode_ids, status, attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pass1_session', ?, 'running', 1, ?, ?)
      `).run(id, topicId, sessionId, sourceTool, JSON.stringify(remaining.map(({ id }) => id)), time, time);
      return this.getJob(id);
    });
  }

  private async pass1(topic: Topic, job: Job, sourceTool: string, provider: ReasoningProvider) {
    const stored = this.subgraph(topic.id, job.session_id, sourceTool);
    const prior = stored ? JSON.parse(stored.subgraph_json) as SessionGraph : emptyGraph;
    const sessionEpisodes = this.store.listEpisodes(topic.id, job.session_id, sourceTool);
    const inputIds = new Set(episodeIds(job));
    const active = activeEpisodes(sessionEpisodes);
    const activeIds = new Set(active.map(({ id }) => id));
    const newEpisodes = active.filter(({ id }) => inputIds.has(id));
    const priorIds = sourcesIn(prior);
    const allowed = new Map(active.filter(({ id }) => priorIds.has(id) || inputIds.has(id)).map((item) => [item.id, item]));
    const sourced = ({ source_episodes }: { source_episodes: string[] }) => source_episodes.every((id) => activeIds.has(id));
    const landmarks = prior.landmarks.filter(sourced);
    const nodeIds = new Set(landmarks.map(({ id }) => id));
    const previous = {
      landmarks,
      relationships: prior.relationships.filter((edge) => sourced(edge) && nodeIds.has(edge.from) && nodeIds.has(edge.to)),
      epistemic_hints: prior.epistemic_hints.filter((hint) => sourced(hint) && nodeIds.has(hint.node_id)),
    };
    const delta = parseDelta(await provider.complete('pass1', { previous, episodes: newEpisodes }, this.abort.signal));
    this.abort.signal.throwIfAborted();
    const updated = applyDelta(previous, delta, allowed);
    const changed = JSON.stringify(updated) !== JSON.stringify(prior);
    this.store.transaction(() => {
      this.store.db.prepare(`
        INSERT INTO session_subgraphs (topic_id, session_id, harness, subgraph_json, last_episode_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (topic_id, harness, session_id) DO UPDATE SET subgraph_json = excluded.subgraph_json,
          last_episode_id = excluded.last_episode_id, updated_at = excluded.updated_at
      `).run(topic.id, job.session_id, sourceTool, JSON.stringify(updated), episodeIds(job).at(-1)!, now());
      this.store.db.prepare(`
        UPDATE jobs SET stage = ?, payload_json = ?, episode_ids = ?, status = ?, updated_at = ? WHERE id = ?
      `).run(changed ? 'pass2_merge' : 'pass1_session', changed ? JSON.stringify(delta) : null,
        job.episode_ids, changed ? 'running' : 'done', now(), job.id);
    });
    return this.getJob(job.id);
  }

  private async pass2(topic: Topic, job: Job, sourceTool: string, provider: ReasoningProvider) {
    const stored = this.subgraph(topic.id, job.session_id, sourceTool)!;
    let session = JSON.parse(stored.subgraph_json) as SessionGraph;
    const sessionEpisodes = this.store.listEpisodes(topic.id, job.session_id, sourceTool);
    const activeIds = new Set(activeEpisodes(sessionEpisodes).map(({ id }) => id));
    if ([...sourcesIn(session)].some((id) => !activeIds.has(id))) {
      // A pending merge can outlive its sources. Refresh the local graph and include the revisions
      // before retrying, keeping the original job until the refresh succeeds.
      const attempted = new Set(episodeIds(job));
      const watermark = sessionEpisodes.findIndex(({ id }) => id === stored.last_episode_id);
      const inputs = sessionEpisodes.filter(({ id }, index) => attempted.has(id) || index > watermark);
      job = await this.pass1(topic, { ...job, episode_ids: JSON.stringify(inputs.map(({ id }) => id)) }, sourceTool, provider);
      session = JSON.parse(this.subgraph(topic.id, job.session_id, sourceTool)!.subgraph_json) as SessionGraph;
    }
    const changes = JSON.parse(job.payload_json!) as SessionDelta;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const base = readBoard(this.store, topic.id);
      const context = contextFor(base, session);
      const sourceIds = sourcesIn(session);
      for (const item of [...context.focused.nodes, ...context.focused.edges, ...context.focused.epistemic]) {
        for (const id of item.source_episodes) sourceIds.add(id);
      }
      const providedSources = activeEpisodes(this.store.listEpisodes(topic.id)).filter(({ id }) => sourceIds.has(id));
      const merge = parseMerge(await provider.complete('pass2', {
        session, changes, ...context,
        episode_sources: providedSources.map(({ id, occurredAt, sourceTool, sessionId, turnId }) => ({ id, occurredAt, sourceTool, sessionId, turnId })),
      }, this.abort.signal));
      this.abort.signal.throwIfAborted();
      const committed = this.store.transaction(() => {
        const current = readBoard(this.store, topic.id);
        if (current.revision !== base.revision) return false;
        if (this.store.findTopic(topic.id).status === 'archived') {
          throw new BangError('topic_archived', 'Topic is archived', 409);
        }
        const currentIds = new Set(activeEpisodes(this.store.listEpisodes(topic.id)).map(({ id }) => id));
        const allowed = new Map(providedSources.filter(({ id }) => currentIds.has(id)).map((episode) => [episode.id, episode]));
        const time = now();
        const next = applyMerge(current, merge, allowed, time);
        if (next.revision !== current.revision) saveRevision(this.store, next, job.id, merge.summary, time);
        this.store.db.prepare(`
          UPDATE jobs SET status = 'done', payload_json = NULL, updated_at = ? WHERE id = ?
        `).run(time, job.id);
        return true;
      });
      if (committed) return;
    }
    throw new BangError('board_changed', 'Topic changed during merge. Sync again to use the latest revision', 409);
  }

  private async run(topic: Topic, session: SourceSession, initialJob: Job, provider?: ReasoningProvider) {
    let job = initialJob;
    try {
      provider ??= configuredProvider(this.paths.config);
      if (job.stage === 'pass1_session') job = await this.pass1(topic, job, session.sourceTool, provider);
      if (job.stage === 'pass2_merge') await this.pass2(topic, job, session.sourceTool, provider);
    } catch (error) {
      if (this.abort.signal.aborted) {
        this.store.db.prepare("UPDATE jobs SET status = 'pending', updated_at = ? WHERE id = ?").run(now(), job.id);
        return this.jobResult(this.getJob(job.id));
      }
      const failure = error instanceof BangError ? error : new BangError('reasoning_failed', 'Unable to process the session', 500);
      const delay = retryDelaysMs[job.attempts - 1];
      const retryAt = delay !== undefined && failure.code !== 'topic_archived'
        ? new Date(Date.now() + delay).toISOString()
        : null;
      this.store.db.prepare(`
        UPDATE jobs SET status = 'failed', next_retry_at = ?, error_code = ?, error_detail = ?, updated_at = ? WHERE id = ?
      `).run(retryAt, failure.code, failure.message, now(), job.id);
    }
    return this.jobResult(this.getJob(job.id));
  }

  private syncSession(topic: Topic, session: SourceSession, provider?: ReasoningProvider, publish = false) {
    const key = JSON.stringify([topic.id, session.sourceTool, session.sessionId]);
    const active = this.active.get(key);
    if (active) return active;
    const initial = this.startJob(topic.id, session);
    if (!initial) return;
    const task = this.run(topic, session, initial, provider).then((job) => {
      if (publish && job.status === 'done') {
        const board = readBoard(this.store, topic.id);
        if (board.revision > 0) this.export(topic, board);
      }
      return job;
    }).finally(() => this.active.delete(key));
    const queued = { id: initial.id, task };
    this.active.set(key, queued);
    if (publish) void task.catch((error) => console.error('Background reasoning failed', error));
    return queued;
  }

  private topicSessions(topic: Topic, sessionId?: string) {
    if (topic.status === 'archived') throw new BangError('topic_archived', 'Topic is archived', 409);
    if (this.abort.signal.aborted) throw new BangError('service_stopping', 'Service is stopping', 503);
    const sessions = new Map<string, SourceSession>();
    for (const { sourceTool, sessionId: nativeId } of this.store.listEpisodes(topic.id, sessionId)) {
      sessions.set(JSON.stringify([sourceTool, nativeId]), { sourceTool, sessionId: nativeId });
    }
    return [...sessions.values()];
  }

  enqueue(topic: Topic, sessionId?: string) {
    const jobs = this.topicSessions(topic, sessionId).flatMap((session) => {
      const queued = this.syncSession(topic, session, undefined, true);
      return queued ? [this.jobResult(this.getJob(queued.id))] : [];
    });
    return { topicId: topic.id, jobs };
  }

  async sync(topic: Topic, sessionId?: string) {
    const completed = await Promise.all(this.topicSessions(topic, sessionId)
      .map((session) => this.syncSession(topic, session)?.task));
    const board = readBoard(this.store, topic.id);
    if (board.revision > 0) this.export(topic, board);
    return { topicId: topic.id, revision: board.revision, jobs: completed.filter((job) => job !== undefined) };
  }

  updateEpistemic(topic: Topic, input: Record<string, unknown>) {
    if (topic.status === 'archived') throw new BangError('topic_archived', 'Topic is archived', 409);
    const result = updateEpistemic(this.store, topic.id, input);
    this.export(topic, result.board);
    return { status: result.status, revision: result.board.revision, state: result.state };
  }

  export(topic: Topic, board = readBoard(this.store, topic.id)) {
    try {
      return publishBoard(this.paths.directory, topic.slug, currentBoard(this.store, board));
    } catch {
      throw new BangError('export_failed', 'Topic state is stored in SQLite. Retry bang export to refresh the snapshots', 500);
    }
  }
}
