const sessionSubgraphs = `
  CREATE TABLE IF NOT EXISTS session_subgraphs (
    topic_id TEXT NOT NULL REFERENCES topics(id),
    session_id TEXT NOT NULL,
    harness TEXT NOT NULL,
    subgraph_json TEXT NOT NULL,
    last_episode_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(topic_id, harness, session_id)
  ) STRICT;
`;

export const schema = `
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS topic_current ON topics(is_current) WHERE is_current = 1;

  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    harness TEXT NOT NULL,
    session_id TEXT NOT NULL,
    source_turn_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    ingest_index INTEGER NOT NULL,
    user_text TEXT NOT NULL,
    assistant_text TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source_ref TEXT,
    revision_id TEXT,
    replaces_episode_id TEXT REFERENCES episodes(id),
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE (topic_id, ingest_index),
    UNIQUE (topic_id, harness, session_id, source_turn_id, revision_id)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS episode_original
    ON episodes(topic_id, harness, session_id, source_turn_id) WHERE replaces_episode_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS episode_successor
    ON episodes(replaces_episode_id) WHERE replaces_episode_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS episode_session ON episodes(topic_id, session_id, ingest_index);

  CREATE TABLE IF NOT EXISTS adapter_cursors (
    adapter_key TEXT PRIMARY KEY,
    harness TEXT NOT NULL,
    session_id TEXT NOT NULL,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    enabled INTEGER NOT NULL DEFAULT 1,
    file_signature TEXT,
    capture_from_offset INTEGER NOT NULL,
    byte_offset INTEGER NOT NULL,
    line_buffer TEXT NOT NULL DEFAULT '',
    active_turn_json TEXT,
    last_turn_id TEXT,
    stopped_at INTEGER,
    stop_pending INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  ) STRICT;
  ${sessionSubgraphs}
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    session_id TEXT NOT NULL,
    harness TEXT,
    stage TEXT NOT NULL,
    episode_ids TEXT NOT NULL,
    payload_json TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    error_code TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS topic_revisions (
    topic_id TEXT NOT NULL REFERENCES topics(id),
    revision INTEGER NOT NULL,
    trigger_job_id TEXT,
    author TEXT NOT NULL,
    summary TEXT NOT NULL,
    knowledge_json TEXT NOT NULL,
    epistemic_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(topic_id, revision)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS topic_layouts (
    topic_id TEXT PRIMARY KEY REFERENCES topics(id),
    layout_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`;

export const migrateReasoningSessions = `
  ALTER TABLE session_subgraphs RENAME TO legacy_session_subgraphs;
  ${sessionSubgraphs}
  INSERT INTO session_subgraphs (topic_id, session_id, harness, subgraph_json, last_episode_id, updated_at)
  SELECT legacy.topic_id, legacy.session_id, watermark.harness, legacy.subgraph_json,
    legacy.last_episode_id, legacy.updated_at
  FROM legacy_session_subgraphs AS legacy
  JOIN episodes AS watermark ON watermark.id = legacy.last_episode_id
  WHERE NOT EXISTS (
    SELECT 1 FROM episodes AS earlier
    WHERE earlier.topic_id = legacy.topic_id AND earlier.session_id = legacy.session_id
      AND earlier.ingest_index <= watermark.ingest_index AND earlier.harness != watermark.harness
  );
  DELETE FROM legacy_session_subgraphs AS legacy WHERE EXISTS (
    SELECT 1 FROM session_subgraphs AS migrated
    WHERE migrated.topic_id = legacy.topic_id AND migrated.session_id = legacy.session_id
  );

  ALTER TABLE jobs ADD COLUMN harness TEXT;
  UPDATE jobs SET harness = (
    SELECT CASE WHEN COUNT(DISTINCT episodes.harness) = 1 THEN MIN(episodes.harness) END
    FROM json_each(jobs.episode_ids) AS input JOIN episodes ON episodes.id = input.value
  );
  UPDATE jobs SET harness = NULL, status = 'failed', error_code = 'source_session_replay',
    error_detail = 'This legacy job used a combined session. Sync replays its sources separately.'
  WHERE status != 'done' AND (harness IS NULL OR EXISTS (
    SELECT 1 FROM legacy_session_subgraphs AS legacy
    WHERE legacy.topic_id = jobs.topic_id AND legacy.session_id = jobs.session_id
  ));
`;

export const migrateCaptureStop = `
  ALTER TABLE adapter_cursors ADD COLUMN stopped_at INTEGER;
  ALTER TABLE adapter_cursors ADD COLUMN stop_pending INTEGER NOT NULL DEFAULT 0;
`;
