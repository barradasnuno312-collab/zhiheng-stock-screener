-- Application-owned research records; payloads follow shared/api.interface.ts.
-- No provider credentials or access codes belong in these tables.
CREATE TABLE IF NOT EXISTS zh_objects (
  id uuid PRIMARY KEY,
  kind varchar(32) NOT NULL,
  owner_id varchar(128) NOT NULL,
  ref_id uuid,
  revision integer,
  payload jsonb NOT NULL,
  created_ms bigint NOT NULL,
  updated_ms bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS zh_objects_owner_kind ON zh_objects (owner_id, kind, created_ms DESC);
CREATE INDEX IF NOT EXISTS zh_objects_ref ON zh_objects (ref_id);
CREATE UNIQUE INDEX IF NOT EXISTS zh_version_unique ON zh_objects (kind, ref_id, revision);

CREATE TABLE IF NOT EXISTS zh_sessions (
  token_hash varchar(64) PRIMARY KEY,
  owner_id varchar(128) NOT NULL,
  expires_ms bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS zh_limits (
  id varchar(200) PRIMARY KEY,
  used integer NOT NULL DEFAULT 0,
  expires_ms bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS zh_jobs (
  id uuid PRIMARY KEY,
  kind varchar(32) NOT NULL,
  owner_id varchar(128) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL,
  result jsonb,
  progress integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  created_ms bigint NOT NULL,
  updated_ms bigint NOT NULL,
  lease_until_ms bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS zh_jobs_status ON zh_jobs (status, created_ms);
CREATE TABLE IF NOT EXISTS zh_locks (
  id varchar(100) PRIMARY KEY,
  holder varchar(100) NOT NULL,
  expires_ms bigint NOT NULL
);
