import logging
import secrets
from threading import Event, Thread
from uuid import uuid4

from psycopg.types.json import Jsonb

from .catalog import effective_prompt
from .repository import all_rows
from .summary import InvalidSummary, render_summary

logger = logging.getLogger(__name__)


class JobFailure(Exception):
    pass


class LeaseLost(Exception):
    pass


class Worker:
    def __init__(self, repo, store, models):
        self.repo = repo
        self.store = store
        self.models = models

    def serve(self, stop):
        while not stop.is_set():
            try:
                busy = self.run_once()
            except Exception as error:
                logger.error("Worker loop failed (%s)", type(error).__name__)
                busy = False
            if not busy:
                stop.wait(2)

    def run_once(self, *, only_delete=False):
        with self.repo.worker_lock() as locked:
            if not locked:
                return False
            self.clean_staged()
            self.expire_uploads()
            job = self.repo.claim(only_delete=only_delete)
            if job is None:
                return False
            stop = Event()
            thread = Thread(target=self.keep_lease, args=(job, stop), daemon=True)
            thread.start()
            try:
                self.process(job)
            except LeaseLost:
                logger.info("Job %s lost its lease or its session was deleted", job["id"])
            except JobFailure as error:
                self.fail(job, str(error))
            except Exception as error:
                logger.error("Job %s failed (%s)", job["id"], type(error).__name__)
                self.fail(job, "processing_failed")
            finally:
                stop.set()
                thread.join()
                self.clean_staged()
            return True

    def keep_lease(self, job, stop):
        while not stop.wait(20):
            try:
                if not self.repo.heartbeat(job):
                    return
            except Exception as error:
                logger.warning("Lease renewal failed for %s (%s)", job["id"], type(error).__name__)

    def require_lease(self, conn, job):
        session = self.repo.lock_job(conn, job)
        if session is None:
            raise LeaseLost
        return session

    def process(self, job):
        if job["kind"] == "delete":
            self.delete(job)
        elif job["kind"] == "summary":
            self.summarize(job)
        else:
            self.generate(job)

    def fail(self, job, code):
        with self.repo.transaction() as conn:
            session = self.repo.lock_job(conn, job)
            if not session:
                return
            if job["kind"] == "delete":
                conn.execute("""
                    UPDATE bedroom.jobs SET status = 'queued', error = %s, lease_until = NULL,
                        lease_token = NULL, available_at = now() + interval '30 seconds' WHERE id = %s
                """, (code, job["id"]))
                return
            if job["kind"] == "initial":
                conn.execute("UPDATE bedroom.sessions SET status = 'failed' WHERE id = %s", (session["id"],))
            self.repo.close_job(conn, job, "failed", code)

    def generate(self, job):
        with self.repo.transaction() as conn:
            session = self.require_lease(conn, job)
            slots = all_rows(conn, """
                SELECT s.*, v.number, v.seed FROM bedroom.slots s
                LEFT JOIN bedroom.versions v ON v.id = s.current_version_id
                WHERE s.session_id = %s AND (%s::smallint IS NULL OR s.position = %s)
                ORDER BY s.position
            """, (session["id"], job["position"], job["position"]))
        initial = job["kind"] == "initial"
        if initial and len(slots) != 5:
            raise JobFailure("invalid_style_catalog")
        if not initial and (len(slots) != 1 or slots[0]["current_version_id"] != job["target_version_id"]):
            raise JobFailure("stale_version")
        try:
            original, _ = self.store.get(session["original_key"])
        except Exception as error:
            raise JobFailure("storage_unavailable") from error

        if initial and not session["bedroom_confirmed"]:
            classification = self.models.classify(original)
            if classification not in {"bedroom", "other", "uncertain"}:
                raise JobFailure("invalid_classification")
            with self.repo.transaction() as conn:
                self.require_lease(conn, job)
                if classification == "bedroom":
                    conn.execute("UPDATE bedroom.sessions SET bedroom_confirmed = true WHERE id = %s", (session["id"],))
                else:
                    status = "rejected" if classification == "other" else "needs_confirmation"
                    conn.execute("UPDATE bedroom.sessions SET status = %s WHERE id = %s", (status, session["id"]))
                    self.repo.close_job(conn, job, "failed" if classification == "other" else "succeeded",
                                        "not_a_bedroom" if classification == "other" else None)
                    return

        results = []
        for slot in slots:
            result = self.render(job, session, slot, original)
            results.append(result)
            with self.repo.transaction() as conn:
                self.require_lease(conn, job)
                conn.execute("UPDATE bedroom.jobs SET progress = %s WHERE id = %s",
                             (len(results) * 90 // len(slots), job["id"]))
        with self.repo.transaction() as conn:
            self.require_lease(conn, job)
            for result in results:
                self.repo.insert_version(conn, session["id"], result)
            conn.execute("UPDATE bedroom.sessions SET status = 'ready', revision = revision + 1 WHERE id = %s",
                         (session["id"],))
            self.repo.close_job(conn, job)

    def render(self, job, session, slot, original):
        profile = slot["profile"]
        seed = secrets.randbits(63)
        if seed == slot["seed"]:
            seed ^= 1
        prompt = effective_prompt(profile, session["preferences"], job["feedback"])
        image = self.models.render(original, profile, prompt, seed)
        description = self.models.describe(original, image).strip()
        if not description:
            raise JobFailure("empty_description")
        version_id = uuid4()
        key = f'{session["owner_id"]}/{session["id"]}/versions/{version_id}.png'
        with self.repo.transaction() as conn:
            self.require_lease(conn, job)
            self.repo.stage(conn, job, key)
        try:
            self.store.put(key, image, "image/png")
        except Exception as error:
            raise JobFailure("storage_unavailable") from error
        return {
            "id": version_id, "position": slot["position"], "number": (slot["number"] or 0) + 1,
            "key": key, "size": len(image), "prompt": prompt, "seed": seed,
            "settings": profile, "provenance": self.models.provenance(), "description": description,
        }

    def summarize(self, job):
        with self.repo.transaction() as conn:
            session = self.require_lease(conn, job)
            if session["revision"] != job["history_revision"]:
                raise JobFailure("stale_history")
            versions = self.repo.snapshot_versions(conn, session["id"])
            rejections = all_rows(conn, """
                SELECT d.id, v.id AS version_id, v.number, d.reason,
                    s.profile->>'label' AS label, d.created_at
                FROM bedroom.decisions d JOIN bedroom.versions v ON v.id = d.version_id
                JOIN bedroom.slots s USING (session_id, position)
                WHERE v.session_id = %s AND d.decision = 'rejected' ORDER BY d.id
            """, (session["id"],))
        entries = [{
            "version_id": str(row["id"]), "label": row["label"], "number": row["number"],
            "decision": row["decision"], "reason": row["reason"], "description": row["description"],
            "decision_id": row["decision_id"],
        } for row in versions if (row["current"] and row["decision"] == "accepted")
            or (not row["current"] and row["decision"] == "rejected")]
        if sum(entry["decision"] == "accepted" for entry in entries) != 5:
            raise JobFailure("stale_history")

        for attempt in range(2):
            try:
                result = render_summary(entries, self.models.summarize(entries), rejections)
                break
            except InvalidSummary as error:
                if attempt == 1:
                    raise JobFailure("invalid_summary") from error

        with self.repo.transaction() as conn:
            session = self.require_lease(conn, job)
            if session["revision"] != job["history_revision"]:
                raise JobFailure("stale_history")
            result["revision"] = session["revision"]
            conn.execute("INSERT INTO bedroom.summaries (session_id, revision, result) VALUES (%s, %s, %s)",
                         (session["id"], session["revision"], Jsonb(result)))
            conn.execute("UPDATE bedroom.sessions SET status = 'completed' WHERE id = %s", (session["id"],))
            self.repo.close_job(conn, job)

    def clean_staged(self):
        with self.repo.transaction() as conn:
            rows = all_rows(conn, """
                SELECT s.object_key FROM bedroom.staged_objects s JOIN bedroom.jobs j ON j.id = s.job_id
                WHERE j.status <> 'running' OR j.lease_token IS DISTINCT FROM s.lease_token OR j.lease_until <= now()
            """)
        for row in rows:
            key = row["object_key"]
            try:
                self.store.delete(key)
            except Exception as error:
                logger.warning("Staged image cleanup failed (%s)", type(error).__name__)
                continue
            with self.repo.transaction() as conn:
                conn.execute("""
                    INSERT INTO bedroom.storage_cleanup (object_key) VALUES (%s) ON CONFLICT DO NOTHING
                """, (key,))
                conn.execute("DELETE FROM bedroom.staged_objects WHERE object_key = %s", (key,))

        with self.repo.transaction() as conn:
            due = all_rows(conn, """
                SELECT object_key FROM bedroom.storage_cleanup WHERE check_after <= now() ORDER BY check_after LIMIT 100
            """)
        for row in due:
            key = row["object_key"]
            try:
                self.store.delete(key)
            except Exception as error:
                logger.warning("Deferred image cleanup failed (%s)", type(error).__name__)
                with self.repo.transaction() as conn:
                    conn.execute("""
                        UPDATE bedroom.storage_cleanup SET check_after = now() + interval '30 seconds'
                        WHERE object_key = %s
                    """, (key,))
                continue
            with self.repo.transaction() as conn:
                conn.execute("DELETE FROM bedroom.storage_cleanup WHERE object_key = %s", (key,))

    def expire_uploads(self):
        with self.repo.transaction() as conn:
            rows = all_rows(conn, """
                UPDATE bedroom.sessions SET status = 'deleting'
                WHERE status = 'uploading' AND created_at < now() - interval '1 hour' RETURNING id
            """)
            for row in rows:
                self.repo.enqueue(conn, row["id"], "delete")

    def delete(self, job):
        with self.repo.transaction() as conn:
            session = self.require_lease(conn, job)
            objects = all_rows(conn, """
                SELECT object_key FROM bedroom.versions WHERE session_id = %s
                UNION ALL SELECT object_key FROM bedroom.staged_objects WHERE session_id = %s
            """, (session["id"], session["id"]))
        for key in [session["original_key"], *(row["object_key"] for row in objects)]:
            self.store.delete(key)
        with self.repo.transaction() as conn:
            self.require_lease(conn, job)
            conn.execute("""
                INSERT INTO bedroom.storage_cleanup (object_key)
                SELECT object_key FROM bedroom.staged_objects WHERE session_id = %s ON CONFLICT DO NOTHING
            """, (session["id"],))
            # Delete jobs first to clear their foreign keys to image versions.
            conn.execute("DELETE FROM bedroom.jobs WHERE session_id = %s", (session["id"],))
            conn.execute("DELETE FROM bedroom.sessions WHERE id = %s", (session["id"],))
