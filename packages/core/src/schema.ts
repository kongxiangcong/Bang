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
    last_turn_id TEXT,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS session_subgraphs (
    topic_id TEXT NOT NULL REFERENCES topics(id),
    session_id TEXT NOT NULL,
    subgraph_json TEXT NOT NULL,
    last_episode_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(topic_id, session_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    session_id TEXT NOT NULL,
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
