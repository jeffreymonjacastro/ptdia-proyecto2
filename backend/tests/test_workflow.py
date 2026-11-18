from io import BytesIO
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

from fastapi.testclient import TestClient
from PIL import Image
import psycopg
import pytest

from bedroom_backend.api import create_app
from bedroom_backend.catalog import load_catalog
from bedroom_backend.repository import Repository
from bedroom_backend.worker import Worker


def photo():
    stream = BytesIO()
    Image.new("RGB", (32, 32)).save(stream, "PNG")
    return stream.getvalue()


class Store:
    def __init__(self):
        self.files = {}
        self.fail_after = None

    def put(self, key, data, media_type):
        if self.fail_after is not None:
            self.fail_after -= 1
            if self.fail_after == 0:
                raise OSError("storage unavailable")
        self.files[key] = (data, media_type)

    def get(self, key):
        return self.files[key]

    def delete(self, key):
        self.files.pop(key, None)

    def ready(self):
        return True


class Models:
    room = "bedroom"
    invalid_summary = False
    before_summary = None

    def classify(self, original):
        return self.room

    def render(self, original, profile, prompt, seed):
        return photo()

    def describe(self, original, generated):
        return "Se observa una cama."

    def summarize(self, entries):
        if self.before_summary:
            self.before_summary()
        if self.invalid_summary:
            return [{"version_id": "inventado", "excerpt": "Motivo inventado"}]
        return [{"version_id": item["version_id"], "excerpt": "una cama"} for item in entries]

    def provenance(self):
        return {"base_revision": "test-sdxl", "vision_revision": "test-qwen"}


@pytest.fixture
def sprint():
    dsn = os.getenv("BEDROOM_TEST_DSN")
    if not dsn:
        pytest.skip("Set BEDROOM_TEST_DSN to the disposable local PostgreSQL database")
    target = urlparse(dsn)
    if target.hostname not in {"localhost", "127.0.0.1", "::1"} or target.path != "/bedroom_test":
        pytest.fail("BEDROOM_TEST_DSN must point to the local bedroom_test database")
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS bedroom CASCADE")
        for migration in sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql")):
            conn.execute(migration.read_text())
    with Repository(dsn) as repo:
        store = Store()
        models = Models()
        identities = {"alice": UUID(int=1), "bob": UUID(int=2)}
        worker = Worker(repo, store, models)
        app = create_app(repo, store, identities.get, load_catalog(), lambda: True)
        with TestClient(app, headers={"Authorization": "Bearer alice"}) as client:
            yield client, worker, store, models, repo


def key(value):
    return {"Idempotency-Key": value}


def submit(client, name="upload", *, consent="true", image=None, preferences="Nogal"):
    return client.post(
        "/api/generations",
        files={"image": ("dormitorio.png", photo() if image is None else image, "image/png")},
        data={"consent": consent, "preferences": preferences},
        headers=key(name),
    )


def session(client, sid):
    return client.get(f"/api/generations/{sid}").json()


def decide(client, sid, vid, decision, reason=None, name=None):
    return client.put(f"/api/generations/{sid}/decisions/{vid}",
                      json={"decision": decision, "reason": reason},
                      headers=key(name or f"{decision}-{vid}"))


def generate(sprint):
    client, worker, *_ = sprint
    response = submit(client)
    assert response.status_code == 202, response.text
    sid = response.json()["session_id"]
    assert worker.run_once()
    assert session(client, sid)["status"] == "ready"
    return sid


def test_lifecycle_and_restart(sprint):
    client, worker, store, models, repo = sprint
    sid = generate(sprint)
    initial = session(client, sid)["variations"]
    assert [item["label"] for item in initial] == ["Luxury UTEC", "Japanese", "Neo Classic", "Attic", "Cyberpunk"]
    old = initial[3]["current_version_id"]
    reject = decide(client, sid, old, "rejected", "Conservar el techo")
    assert reject.status_code == 202
    assert worker.run_once()
    new = session(client, sid)["variations"]
    assert new[:3] == initial[:3] and new[4] == initial[4]
    assert new[3]["current_version_id"] != old
    assert new[3]["versions"][1]["decision"] is None
    assert new[3]["versions"][1]["seed"].isdigit()
    assert new[3]["versions"][1]["seed"] != new[3]["versions"][0]["seed"]
    assert "Conservar el techo" in new[3]["versions"][1]["prompt"]
    assert decide(client, sid, old, "rejected", "Conservar el techo").json() == reject.json()
    assert decide(client, sid, old, "accepted").status_code == 409
    for variation in new:
        assert decide(client, sid, variation["current_version_id"], "accepted").status_code == 200
    request = client.post(f"/api/generations/{sid}/summary", headers=key("summary"))
    assert request.status_code == 202
    with Repository(os.environ["BEDROOM_TEST_DSN"]) as reopened:
        assert Worker(reopened, store, models).run_once()
    result = session(client, sid)
    assert result["status"] == "completed"
    assert result["summary"]["revision"] == result["revision"]
    assert result["summary"]["rejected_version_ids"] == [old]
    assert len(result["summary"]["accepted_version_ids"]) == 5
    assert "Conservar el techo" in result["summary"]["summary"]
    assert client.post(f"/api/generations/{sid}/summary", headers=key("summary2")).status_code == 200


def test_upload_is_idempotent_and_owner_only(sprint):
    client, worker, _, _, _ = sprint
    a = submit(client)
    assert a.status_code == 202
    assert submit(client).json() == a.json()
    assert submit(client, preferences="Otra").status_code == 409
    sid, jid = a.json()["session_id"], a.json()["job_id"]
    assert worker.run_once()
    detail = session(client, sid)
    image = detail["variations"][0]["versions"][0]["image_url"]
    assert client.get(image).headers["content-type"] == "image/png"
    other = {"Authorization": "Bearer bob"}
    assert client.get("/api/generations", headers=other).json() == []
    for url in (f"/api/generations/{sid}", f"/api/jobs/{jid}", image, detail["original_image_url"]):
        assert client.get(url, headers=other).status_code == 404
    assert client.delete(f"/api/generations/{sid}", headers=other).status_code == 404


def test_incomplete_batch_is_not_published_and_can_retry(sprint):
    client, worker, store, *_ = sprint
    sid = submit(client).json()["session_id"]
    store.fail_after = 3
    assert worker.run_once()
    assert session(client, sid)["status"] == "failed"
    assert all(not slot["versions"] for slot in session(client, sid)["variations"])
    assert len(store.files) == 1
    assert client.post(f"/api/generations/{sid}/retry", headers=key("retry")).status_code == 202
    assert worker.run_once()
    assert session(client, sid)["status"] == "ready"


@pytest.mark.parametrize("classification,status", [("other", "rejected"), ("uncertain", "needs_confirmation")])
def test_classification(sprint, classification, status):
    client, worker, _, models, _ = sprint
    models.room = classification
    sid = submit(client).json()["session_id"]
    worker.run_once()
    assert session(client, sid)["status"] == status
    assert all(not slot["versions"] for slot in session(client, sid)["variations"])
    if classification == "uncertain":
        response = client.post(f"/api/generations/{sid}/confirm-bedroom", headers=key("confirm"))
        assert response.status_code == 202
        worker.run_once()
        assert session(client, sid)["status"] == "ready"


def test_rejects_invalid_input(sprint):
    client, *_ = sprint
    assert submit(client, consent="false").status_code == 422
    assert submit(client, image=b"not an image").status_code == 422
    assert submit(client, image=b"x" * (11 * 1024 * 1024)).status_code == 413
    assert client.get("/api/generations").json() == []


def test_failed_regeneration_and_pause(sprint):
    client, worker, store, *_ = sprint
    sid = generate(sprint)
    original = session(client, sid)["variations"][0]["current_version_id"]
    assert client.patch(f"/api/generations/{sid}", json={"paused": True}).status_code == 200
    assert decide(client, sid, original, "rejected", name="paused").status_code == 409
    assert client.patch(f"/api/generations/{sid}", json={"paused": False}).status_code == 200
    assert decide(client, sid, original, "rejected").status_code == 202
    assert decide(client, sid, original, "accepted").status_code == 409
    store.fail_after = 1
    worker.run_once()
    assert session(client, sid)["variations"][0]["current_version_id"] == original
    assert client.post(f"/api/generations/{sid}/variations/1/retry", headers=key("retry")).status_code == 202
    worker.run_once()
    assert session(client, sid)["variations"][0]["current_version_id"] != original


def test_expired_lease_is_recovered_and_cannot_publish(sprint):
    client, worker, _, _, repo = sprint
    sid = submit(client).json()["session_id"]
    expired = repo.claim()
    with repo.transaction() as conn:
        conn.execute("UPDATE bedroom.jobs SET lease_until = now() - interval '1 second' WHERE id = %s", (expired["id"],))
    assert worker.run_once()
    assert not repo.heartbeat(expired)
    assert session(client, sid)["status"] == "ready"


def test_delete_is_immediate_and_cleans_all_objects(sprint):
    client, worker, store, _, _ = sprint
    sid = generate(sprint)
    assert len(store.files) == 6
    deletion = client.delete(f"/api/generations/{sid}")
    assert deletion.status_code == 202
    assert client.get(f"/api/generations/{sid}").status_code == 404
    worker.run_once()
    assert not store.files
    assert client.get("/api/generations").json() == []


def test_invalid_summary_and_stale_summary(sprint):
    client, worker, _, models, _ = sprint
    sid = generate(sprint)
    versions = [item["current_version_id"] for item in session(client, sid)["variations"]]
    assert client.post(f"/api/generations/{sid}/summary", headers=key("early")).status_code == 409
    for vid in versions:
        assert decide(client, sid, vid, "accepted").status_code == 200
    models.invalid_summary = True
    first = client.post(f"/api/generations/{sid}/summary", headers=key("first")).json()["job_id"]
    worker.run_once()
    assert client.get(f"/api/jobs/{first}").json()["error"] == "invalid_summary"
    assert session(client, sid)["summary"] is None
    models.invalid_summary = False
    models.before_summary = lambda: decide(client, sid, versions[0], "rejected")
    second = client.post(f"/api/generations/{sid}/summary", headers=key("second")).json()["job_id"]
    worker.run_once()
    assert client.get(f"/api/jobs/{second}").json()["error"] == "stale_history"
    assert session(client, sid)["summary"] is None


def test_purge_dry_run_preserves_history_then_removes_all_sessions(sprint):
    from bedroom_backend.admin import purge

    client, _, store, _, repo = sprint
    sid = generate(sprint)
    assert purge(repo, store, apply=False) == (1, 1)
    assert session(client, sid)["status"] == "ready"
    assert purge(repo, store, apply=True) == (1, 0)
    assert not store.files
    assert client.get("/api/generations").json() == []


def test_concurrent_upload_replay_enqueues_only_one_job(sprint):
    from concurrent.futures import ThreadPoolExecutor

    client, worker, store, _, _ = sprint
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: submit(client), range(2)))
    assert [response.status_code for response in responses] == [202, 202]
    assert responses[0].json() == responses[1].json()
    assert len(store.files) == 1
    assert worker.run_once()
    assert not worker.run_once()


def test_rejects_oversized_stream_without_content_length(sprint):
    client, *_ = sprint

    def body():
        yield b"--test\r\nContent-Disposition: form-data; name=\"image\"; filename=\"x.png\"\r\n\r\n"
        for _ in range(12):
            yield b"x" * (1024 * 1024)
        yield b"\r\n--test--\r\n"

    response = client.post("/api/generations", content=body(), headers={
        "Content-Type": "multipart/form-data; boundary=test", **key("stream"),
    })
    assert response.status_code == 413
    assert client.get("/api/generations").json() == []


def test_cleanup_catches_late_storage_write_after_session_deleted(sprint):
    client, worker, store, _, repo = sprint
    sid = submit(client).json()["session_id"]
    job = repo.claim()
    late_key = f"staged/{sid}/late.png"
    with repo.transaction() as conn:
        repo.stage(conn, job, late_key)
        conn.execute("UPDATE bedroom.jobs SET lease_until = now() - interval '1 second' WHERE id = %s", (job["id"],))
    assert client.delete(f"/api/generations/{sid}").status_code == 202
    assert worker.run_once()
    assert client.get(f"/api/generations/{sid}").status_code == 404
    assert not store.files
    store.put(late_key, photo(), "image/png")
    with repo.transaction() as conn:
        conn.execute("UPDATE bedroom.storage_cleanup SET check_after = now()")
    worker.run_once()
    assert late_key not in store.files


def test_summary_keeps_prior_rejections_when_same_version_is_later_accepted(sprint):
    client, worker, store, _, _ = sprint
    sid = generate(sprint)
    versions = [slot["current_version_id"] for slot in session(client, sid)["variations"]]
    assert decide(client, sid, versions[0], "rejected", "Conservar el techo").status_code == 202
    store.fail_after = 1
    worker.run_once()
    assert decide(client, sid, versions[0], "rejected", "Preferimos la luz anterior", name="reject-again").status_code == 202
    store.fail_after = 1
    worker.run_once()
    for vid in versions:
        assert decide(client, sid, vid, "accepted").status_code == 200
    client.post(f"/api/generations/{sid}/summary", headers=key("summary"))
    worker.run_once()
    summary = session(client, sid)["summary"]
    assert versions[0] in summary["accepted_version_ids"]
    assert versions[0] not in summary["rejected_version_ids"]
    assert [item["reason"] for item in summary["historical_rejections"]] == [
        "Conservar el techo", "Preferimos la luz anterior",
    ]
    assert "Preferimos la luz anterior" in summary["summary"]
