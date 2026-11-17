from contextlib import contextmanager
from uuid import uuid4

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool


def one(conn, query, params=()):
    return conn.execute(query, params).fetchone()


def all_rows(conn, query, params=()):
    return conn.execute(query, params).fetchall()


class Repository:
    def __init__(self, dsn):
        self.pool = ConnectionPool(dsn, min_size=1, max_size=8, open=False,
                                   timeout=5, kwargs={"row_factory": dict_row})

    def __enter__(self):
        self.pool.open(wait=True, timeout=10)
        return self

    def __exit__(self, *exc):
        self.pool.close()

    @contextmanager
    def transaction(self):
        with self.pool.connection() as conn:
            yield conn

    @contextmanager
    def worker_lock(self):
        with self.pool.connection() as conn:
            acquired = one(conn, "SELECT pg_try_advisory_lock(1732145630, 1) AS locked")["locked"]
            conn.commit()
            try:
                yield acquired
            finally:
                if acquired and not conn.closed:
                    conn.rollback()
                    conn.execute("SELECT pg_advisory_unlock(1732145630, 1)")
                    conn.commit()

    def ready(self):
        with self.transaction() as conn:
            one(conn, "SELECT id FROM bedroom.sessions LIMIT 1")
        return True

    def claim(self, *, only_delete=False):
        with self.transaction() as conn:
            return one(conn, """
                WITH candidate AS (
                    SELECT j.id FROM bedroom.jobs j
                    JOIN bedroom.sessions s ON s.id = j.session_id
                    WHERE ((j.status = 'queued' AND j.available_at <= now())
                        OR (j.status = 'running' AND j.lease_until <= now()))
                      AND (s.status <> 'deleting' OR j.kind = 'delete')
                      AND (NOT %s OR j.kind = 'delete')
                    ORDER BY (j.kind = 'delete') DESC, j.created_at, j.id
                    FOR UPDATE OF j SKIP LOCKED LIMIT 1
                )
                UPDATE bedroom.jobs j SET status = 'running', attempts = attempts + 1,
                    progress = 0, lease_token = %s, lease_until = now() + interval '2 minutes'
                FROM candidate WHERE j.id = candidate.id RETURNING j.*
            """, (only_delete, uuid4()))

    def heartbeat(self, job):
        with self.transaction() as conn:
            return bool(one(conn, """
                UPDATE bedroom.jobs SET lease_until = now() + interval '2 minutes'
                WHERE id = %s AND lease_token = %s AND status = 'running' AND lease_until > now()
                RETURNING id
            """, (job["id"], job["lease_token"])))

    @staticmethod
    def enqueue(conn, session_id, kind, *, position=None, version_id=None, revision=None, feedback=None):
        job_id = uuid4()
        conn.execute("""
            INSERT INTO bedroom.jobs (id, session_id, kind, position, target_version_id, history_revision, feedback)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (job_id, session_id, kind, position, version_id, revision, feedback))
        return job_id

    @staticmethod
    def lock_job(conn, job):
        session = one(conn, "SELECT * FROM bedroom.sessions WHERE id = %s FOR UPDATE", (job["session_id"],))
        lease = one(conn, """
            SELECT id FROM bedroom.jobs WHERE id = %s AND lease_token = %s
                AND status = 'running' AND lease_until > clock_timestamp() FOR UPDATE
        """, (job["id"], job["lease_token"]))
        if lease and session and (session["status"] != "deleting" or job["kind"] == "delete"):
            return session
        return None

    @staticmethod
    def close_job(conn, job, status="succeeded", error=None):
        conn.execute("""
            UPDATE bedroom.jobs SET status = %s, error = %s,
                lease_until = NULL, lease_token = NULL,
                progress = CASE WHEN %s = 'succeeded' THEN 100 ELSE progress END
            WHERE id = %s AND lease_token = %s
        """, (status, error, status, job["id"], job["lease_token"]))

    @staticmethod
    def snapshot_versions(conn, session_id):
        return all_rows(conn, """
            SELECT v.*, d.decision, d.reason, d.id AS decision_id,
                v.id = s.current_version_id AS current, s.profile->>'label' AS label
            FROM bedroom.versions v JOIN bedroom.slots s USING (session_id, position)
            LEFT JOIN LATERAL (
                SELECT id, decision, reason FROM bedroom.decisions WHERE version_id = v.id ORDER BY id DESC LIMIT 1
            ) d ON true
            WHERE v.session_id = %s ORDER BY v.position, v.number
        """, (session_id,))

    @staticmethod
    def current_summary(conn, session):
        row = one(conn, "SELECT result FROM bedroom.summaries WHERE session_id = %s AND revision = %s",
                  (session["id"], session["revision"]))
        return row["result"] if row else None

    @staticmethod
    def stage(conn, job, object_key):
        conn.execute("""
            INSERT INTO bedroom.staged_objects (object_key, session_id, job_id, lease_token)
            VALUES (%s, %s, %s, %s)
        """, (object_key, job["session_id"], job["id"], job["lease_token"]))

    @staticmethod
    def insert_version(conn, session_id, result):
        conn.execute("""
            INSERT INTO bedroom.versions
                (id, session_id, position, number, object_key, size_bytes, prompt, seed, settings, provenance, description)
            VALUES (%(id)s, %(session_id)s, %(position)s, %(number)s, %(key)s, %(size)s,
                %(prompt)s, %(seed)s, %(settings)s, %(provenance)s, %(description)s)
        """, {**result, "session_id": session_id,
              "settings": Jsonb(result["settings"]), "provenance": Jsonb(result["provenance"])})
        conn.execute("UPDATE bedroom.slots SET current_version_id = %s WHERE session_id = %s AND position = %s",
                     (result["id"], session_id, result["position"]))
        conn.execute("DELETE FROM bedroom.staged_objects WHERE object_key = %s", (result["key"],))
