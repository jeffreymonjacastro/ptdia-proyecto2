from hashlib import sha256
import json
from uuid import uuid4

from fastapi.encoders import jsonable_encoder
from psycopg.types.json import Jsonb

from .repository import all_rows, one
from .catalog import selected_profile, luxury_variant


class Problem(Exception):
    def __init__(self, status, code):
        self.status = status
        self.code = code


def visible(conn, owner, session_id, *, lock=False):
    sql = """
        SELECT * FROM bedroom.sessions WHERE id = %s AND owner_id = %s
        AND status NOT IN ('deleting', 'uploading')
    """
    row = one(conn, sql + (" FOR UPDATE" if lock else ""), (session_id, owner))
    if row is None:
        raise Problem(404, "not_found")
    return row


def job_response(session_id, job_id):
    return {"session_id": str(session_id), "job_id": str(job_id)}


def fingerprint(operation, payload):
    return sha256(json.dumps([operation, payload], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def locked_request(conn, owner, key, request_hash, legacy_hash=None):
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{owner}:{key}",))
    row = one(conn, "SELECT * FROM bedroom.requests WHERE owner_id = %s AND key = %s", (owner, key))
    if row and row["fingerprint"] not in {request_hash, legacy_hash}:
        raise Problem(409, "idempotency_conflict")
    return row


def record_request(conn, owner, key, request_hash, session_id, status, result):
    conn.execute("""
        INSERT INTO bedroom.requests (owner_id, key, fingerprint, session_id, status_code, response)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (owner, key, request_hash, session_id, status, Jsonb(jsonable_encoder(result))))


class Sessions:
    def __init__(self, repo, store, catalog):
        self.repo = repo
        self.store = store
        self.catalog = catalog

    def submit(self, owner, key, data, media_type, preferences, luxury_model=None):
        image_hash = sha256(data).hexdigest()
        request_hash = fingerprint("upload", [image_hash, preferences, luxury_model or "custom"])
        legacy_hash = fingerprint("upload", [image_hash, preferences]) if luxury_model is None else None
        with self.repo.transaction() as conn:
            previous = locked_request(conn, owner, key, request_hash, legacy_hash)
            if previous:
                result = previous["response"]
                session_id = previous["session_id"]
            else:
                session_id = uuid4()
                result = job_response(session_id, uuid4())
                conn.execute("""
                    INSERT INTO bedroom.sessions
                        (id, owner_id, status, original_key, original_type, original_size, preferences)
                    VALUES (%s, %s, 'uploading', %s, %s, %s, %s)
                """, (session_id, owner, f"{owner}/{session_id}/original", media_type, len(data), preferences))
                for position, style in enumerate(self.catalog, 1):
                    options = style.get("variants", {}) if style["id"] == "luxury" else {}
                    profile = options.get(luxury_model or "custom", selected_profile(style))
                    conn.execute("INSERT INTO bedroom.slots (session_id, position, profile, profile_options) VALUES (%s, %s, %s, %s)",
                                 (session_id, position, Jsonb(profile), Jsonb(options)))
                record_request(conn, owner, key, request_hash, session_id, 202, result)

        # Reserve the object key before writing to Storage so an interrupted upload can be
        # retried under the same key or removed by the worker.
        with self.repo.transaction() as conn:
            session = one(conn, "SELECT * FROM bedroom.sessions WHERE id = %s FOR UPDATE", (session_id,))
            if not session or session["status"] == "deleting":
                raise Problem(404, "not_found")
            if session["status"] == "uploading":
                try:
                    self.store.put(session["original_key"], data, media_type)
                except Exception as error:
                    raise Problem(503, "storage_unavailable") from error
                conn.execute("UPDATE bedroom.sessions SET status = 'generating' WHERE id = %s", (session_id,))
                conn.execute("INSERT INTO bedroom.jobs (id, session_id, kind) VALUES (%s, %s, 'initial')",
                             (result["job_id"], session_id))
        return 202, result

    def list(self, owner):
        with self.repo.transaction() as conn:
            return all_rows(conn, """
                SELECT id, status, revision, created_at FROM bedroom.sessions WHERE owner_id = %s
                    AND status NOT IN ('deleting', 'uploading') ORDER BY created_at DESC, id
            """, (owner,))

    def detail(self, owner, session_id):
        with self.repo.transaction() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            row = visible(conn, owner, session_id)
            slots = all_rows(conn, "SELECT * FROM bedroom.slots WHERE session_id = %s ORDER BY position", (session_id,))
            versions = self.repo.snapshot_versions(conn, session_id)
            events = all_rows(conn, """
                SELECT d.version_id, d.decision, d.reason, d.created_at
                FROM bedroom.decisions d JOIN bedroom.versions v ON v.id = d.version_id
                WHERE v.session_id = %s ORDER BY d.id
            """, (session_id,))
            history = {version["id"]: [] for version in versions}
            for event in events:
                history[event["version_id"]].append(event)
            variations = [{
                "position": slot["position"], "style_id": slot["profile"]["id"], "label": slot["profile"]["label"],
                "current_version_id": slot["current_version_id"],
                "luxury_variant": luxury_variant(slot["profile"]) if slot["profile"]["id"] == "luxury" else None,
                "luxury_variants": [{"id": name, "label": profile["label"]} for name, profile in self.choices(slot).items()] if slot["profile"]["id"] == "luxury" else [],
                "versions": [self.public_version(version, history[version["id"]])
                             for version in versions if version["position"] == slot["position"]],
            } for slot in slots]
            return {
                "id": row["id"], "status": row["status"], "revision": row["revision"],
                "preferences": row["preferences"], "created_at": row["created_at"],
                "original_image_url": f"/api/generations/{session_id}/original",
                "variations": variations, "summary": self.repo.current_summary(conn, row),
                "jobs": all_rows(conn, """
                    SELECT id, kind, status, position, progress, error, requested_profile->>'variant' AS luxury_variant FROM bedroom.jobs
                    WHERE session_id = %s ORDER BY created_at DESC, id
                """, (session_id,)),
            }

    @staticmethod
    def public_version(version, history):
        public = {field: version[field] for field in (
            "id", "number", "prompt", "description", "decision", "reason",
            "settings", "provenance", "created_at", "size_bytes"
        )}
        public["seed"] = str(version["seed"])
        public["image_url"] = f'/api/generations/{version["session_id"]}/versions/{version["id"]}/image'
        public["decisions"] = history
        return public

    def get_job(self, owner, job_id):
        with self.repo.transaction() as conn:
            row = one(conn, """
                SELECT j.id, j.session_id, j.kind, j.status, j.position, j.progress, j.error, j.requested_profile->>'variant' AS luxury_variant
                FROM bedroom.jobs j JOIN bedroom.sessions s ON s.id = j.session_id
                WHERE j.id = %s AND s.owner_id = %s AND s.status NOT IN ('deleting', 'uploading')
            """, (job_id, owner))
            if row is None:
                raise Problem(404, "not_found")
            return row

    def image(self, owner, session_id, version_id=None):
        with self.repo.transaction() as conn:
            row = visible(conn, owner, session_id)
            object_key = row["original_key"]
            if version_id:
                version = one(conn, "SELECT object_key FROM bedroom.versions WHERE id = %s AND session_id = %s",
                              (version_id, session_id))
                if version is None:
                    raise Problem(404, "not_found")
                object_key = version["object_key"]
            try:
                return self.store.get(object_key)
            except Exception as error:
                raise Problem(503, "storage_unavailable") from error

    def change(self, owner, key, session_id, action, payload, handler):
        request_hash = fingerprint(action, [str(session_id), payload])
        with self.repo.transaction() as conn:
            previous = locked_request(conn, owner, key, request_hash)
            row = visible(conn, owner, session_id, lock=True)
            if previous:
                return previous["status_code"], previous["response"]
            status, result = handler(conn, row)
            record_request(conn, owner, key, request_hash, session_id, status, result)
            return status, result

    def initial(self, conn, row, confirm):
        required = "needs_confirmation" if confirm else "failed"
        if row["status"] != required:
            raise Problem(409, "invalid_session_state")
        session_id = row["id"]
        conn.execute("UPDATE bedroom.sessions SET status = 'generating', bedroom_confirmed = %s WHERE id = %s",
                     (confirm or row["bedroom_confirmed"], session_id))
        return 202, job_response(session_id, self.repo.enqueue(conn, session_id, "initial"))

    @staticmethod
    def pending(conn, session_id, kind=None, position=None):
        return one(conn, """
            SELECT id FROM bedroom.jobs WHERE session_id = %s AND status IN ('queued', 'running')
              AND (%s::text IS NULL OR kind = %s) AND (%s::smallint IS NULL OR position = %s)
            ORDER BY created_at LIMIT 1
        """, (session_id, kind, kind, position, position))

    def pause(self, owner, session_id, paused):
        with self.repo.transaction() as conn:
            row = visible(conn, owner, session_id, lock=True)
            if row["status"] not in {"ready", "paused", "completed"} or self.pending(conn, session_id):
                raise Problem(409, "invalid_session_state")
            if paused:
                status = "paused"
            else:
                status = "completed" if self.repo.current_summary(conn, row) else "ready"
            conn.execute("UPDATE bedroom.sessions SET status = %s WHERE id = %s", (status, session_id))
            return {"id": session_id, "status": status}

    def choices(self, slot):
        if slot["profile"]["id"] != "luxury":
            return {}
        if slot.get("profile_options"):
            return slot["profile_options"]
        catalog = next((p for p in self.catalog if p["id"] == "luxury"), {})
        # Legacy sessions retain their original saved parameters when choices are first frozen.
        variant = luxury_variant(slot["profile"])
        return {**catalog.get("variants", {}), variant: {**selected_profile(slot["profile"]), "variant": variant}}

    def switch_luxury(self, conn, row, version_id, variant):
        sid = row["id"]
        slot = one(conn, "SELECT * FROM bedroom.slots WHERE session_id = %s AND profile->>'id' = 'luxury'", (sid,))
        if not slot or slot["current_version_id"] != version_id or row["status"] not in {"ready", "completed"} or self.pending(conn, sid):
            raise Problem(409, "stale_version_or_invalid_state")
        choices = self.choices(slot)
        if variant not in choices:
            raise Problem(422, "luxury_model_unavailable")
        if luxury_variant(slot["profile"]) == variant:
            return 200, {"session_id": str(sid), "version_id": str(version_id), "variant": variant}
        conn.execute("UPDATE bedroom.slots SET profile_options = %s WHERE session_id = %s AND position = %s", (Jsonb(choices), sid, slot["position"]))
        conn.execute("UPDATE bedroom.sessions SET status = 'ready', revision = revision + 1 WHERE id = %s", (sid,))
        job_id = self.repo.enqueue(conn, sid, "regenerate", position=slot["position"], version_id=version_id, requested_profile=choices[variant])
        return 202, job_response(sid, job_id)

    def decide(self, conn, row, version_id, decision, reason):
        session_id = row["id"]
        version = one(conn, """
            SELECT s.position, d.decision, d.reason FROM bedroom.slots s
            LEFT JOIN LATERAL (
                SELECT decision, reason FROM bedroom.decisions WHERE version_id = %s ORDER BY id DESC LIMIT 1
            ) d ON true
            WHERE s.session_id = %s AND s.current_version_id = %s
        """, (version_id, session_id, version_id))
        if not version or row["status"] not in {"ready", "completed"}:
            raise Problem(409, "stale_version_or_invalid_state")
        position = version["position"]
        if self.pending(conn, session_id, "regenerate", position):
            raise Problem(409, "regeneration_in_progress")
        result = {"session_id": str(session_id), "version_id": str(version_id), "decision": decision}
        if version["decision"] == decision and version["reason"] == reason:
            return 200, result

        conn.execute("INSERT INTO bedroom.decisions (version_id, decision, reason) VALUES (%s, %s, %s)",
                     (version_id, decision, reason))
        conn.execute("UPDATE bedroom.sessions SET status = 'ready', revision = revision + 1 WHERE id = %s", (session_id,))
        if decision == "rejected":
            job_id = self.repo.enqueue(conn, session_id, "regenerate", position=position,
                                       version_id=version_id, feedback=reason)
            return 202, {**result, "job_id": str(job_id)}
        return 200, result

    def retry_slot(self, conn, row, position):
        session_id = row["id"]
        if row["status"] != "ready" or self.pending(conn, session_id, "regenerate", position):
            raise Problem(409, "invalid_session_state")
        latest = one(conn, """
            SELECT j.*, d.decision, d.reason FROM bedroom.slots s
            JOIN LATERAL (
                SELECT * FROM bedroom.jobs WHERE session_id = s.session_id AND kind = 'regenerate'
                    AND position = s.position AND target_version_id = s.current_version_id
                ORDER BY created_at DESC, id DESC LIMIT 1
            ) j ON true
            LEFT JOIN LATERAL (
                SELECT decision, reason FROM bedroom.decisions WHERE version_id = s.current_version_id ORDER BY id DESC LIMIT 1
            ) d ON true
            WHERE s.session_id = %s AND s.position = %s
        """, (session_id, position))
        if not latest or latest["status"] != "failed" or (latest["decision"] != "rejected" and not latest["requested_profile"]):
            raise Problem(409, "no_failed_regeneration")
        job_id = self.repo.enqueue(conn, session_id, "regenerate", position=position,
                                   version_id=latest["target_version_id"], feedback=latest["feedback"], requested_profile=latest["requested_profile"])
        return 202, job_response(session_id, job_id)

    def summarize(self, conn, row):
        session_id = row["id"]
        if row["status"] not in {"ready", "completed"}:
            raise Problem(409, "invalid_session_state")
        unfinished_switch = one(conn, """
            SELECT j.id FROM bedroom.slots s JOIN LATERAL (
                SELECT id, status, requested_profile FROM bedroom.jobs
                WHERE session_id = s.session_id AND target_version_id = s.current_version_id AND kind = 'regenerate'
                ORDER BY created_at DESC, id DESC LIMIT 1
            ) j ON true
            WHERE s.session_id = %s AND j.status IN ('queued', 'running', 'failed') AND j.requested_profile IS NOT NULL LIMIT 1
        """, (session_id,))
        if unfinished_switch:
            raise Problem(409, "luxury_switch_incomplete")
        stored = self.repo.current_summary(conn, row)
        if stored:
            return 200, stored
        entries = self.repo.snapshot_versions(conn, session_id)
        if sum(item["current"] and item["decision"] == "accepted" for item in entries) != 5:
            raise Problem(409, "five_acceptances_required")
        pending = one(conn, """
            SELECT id FROM bedroom.jobs WHERE session_id = %s AND kind = 'summary'
                AND history_revision = %s AND status IN ('queued', 'running') LIMIT 1
        """, (session_id, row["revision"]))
        job_id = pending["id"] if pending else self.repo.enqueue(conn, session_id, "summary", revision=row["revision"])
        return 202, job_response(session_id, job_id)

    def delete(self, owner, session_id):
        with self.repo.transaction() as conn:
            row = one(conn, """
                SELECT id, status FROM bedroom.sessions WHERE id = %s AND owner_id = %s
                    AND status <> 'uploading' FOR UPDATE
            """, (session_id, owner))
            if not row:
                raise Problem(404, "not_found")
            if row["status"] != "deleting":
                conn.execute("UPDATE bedroom.sessions SET status = 'deleting' WHERE id = %s", (session_id,))
                self.repo.enqueue(conn, session_id, "delete")
        return {"session_id": str(session_id), "status": "deleting"}
