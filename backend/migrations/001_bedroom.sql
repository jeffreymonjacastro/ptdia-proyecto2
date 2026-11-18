BEGIN;
CREATE SCHEMA bedroom;
REVOKE ALL ON SCHEMA bedroom FROM PUBLIC;

CREATE TABLE bedroom.sessions (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN (
        'uploading', 'generating', 'needs_confirmation', 'rejected', 'failed',
        'ready', 'paused', 'completed', 'deleting'
    )),
    original_key text NOT NULL UNIQUE,
    original_type text NOT NULL,
    original_size integer NOT NULL CHECK (original_size > 0),
    preferences text NOT NULL,
    consent_at timestamptz NOT NULL DEFAULT now(),
    bedroom_confirmed boolean NOT NULL DEFAULT false,
    revision integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_owner_history ON bedroom.sessions (owner_id, created_at DESC);

CREATE TABLE bedroom.slots (
    session_id uuid NOT NULL REFERENCES bedroom.sessions ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
    profile jsonb NOT NULL,
    current_version_id uuid,
    PRIMARY KEY (session_id, position),
    UNIQUE (session_id, profile)
);

CREATE TABLE bedroom.versions (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL,
    position smallint NOT NULL,
    number integer NOT NULL CHECK (number >= 1),
    object_key text NOT NULL UNIQUE,
    size_bytes integer NOT NULL CHECK (size_bytes > 0),
    prompt text NOT NULL,
    seed bigint NOT NULL,
    settings jsonb NOT NULL,
    provenance jsonb NOT NULL,
    description text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (session_id, position) REFERENCES bedroom.slots ON DELETE CASCADE,
    UNIQUE (session_id, position, number),
    UNIQUE (session_id, position, id)
);
ALTER TABLE bedroom.slots ADD FOREIGN KEY (session_id, position, current_version_id)
    REFERENCES bedroom.versions (session_id, position, id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE bedroom.decisions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version_id uuid NOT NULL REFERENCES bedroom.versions ON DELETE CASCADE,
    decision text NOT NULL CHECK (decision IN ('accepted', 'rejected')),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decisions_by_version ON bedroom.decisions (version_id, id DESC);

CREATE TABLE bedroom.summaries (
    session_id uuid NOT NULL REFERENCES bedroom.sessions ON DELETE CASCADE,
    revision integer NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, revision)
);

CREATE TABLE bedroom.jobs (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES bedroom.sessions ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('initial', 'regenerate', 'summary', 'delete')),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    position smallint,
    target_version_id uuid REFERENCES bedroom.versions,
    history_revision integer,
    feedback text,
    error text,
    progress smallint NOT NULL DEFAULT 0,
    attempts integer NOT NULL DEFAULT 0,
    lease_token uuid,
    lease_until timestamptz,
    available_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim ON bedroom.jobs (available_at, created_at) WHERE status IN ('queued', 'running');
CREATE INDEX jobs_by_session ON bedroom.jobs (session_id, created_at DESC);

CREATE TABLE bedroom.requests (
    owner_id uuid NOT NULL,
    key text NOT NULL,
    fingerprint text NOT NULL,
    session_id uuid NOT NULL REFERENCES bedroom.sessions ON DELETE CASCADE,
    response jsonb NOT NULL,
    status_code smallint NOT NULL,
    PRIMARY KEY (owner_id, key)
);

CREATE TABLE bedroom.staged_objects (
    object_key text PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES bedroom.sessions ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES bedroom.jobs ON DELETE CASCADE,
    lease_token uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staged_objects_by_session ON bedroom.staged_objects (session_id);

-- Keep the recheck independent of session deletion. A timed-out PUT can
-- complete after the first delete has already reached Storage.
CREATE TABLE bedroom.storage_cleanup (
    object_key text PRIMARY KEY,
    check_after timestamptz NOT NULL DEFAULT (now() + interval '2 minutes')
);
CREATE INDEX storage_cleanup_due ON bedroom.storage_cleanup (check_after);

COMMIT;
