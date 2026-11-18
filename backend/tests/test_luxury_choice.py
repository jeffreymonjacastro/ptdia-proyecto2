from psycopg.types.json import Jsonb

from test_workflow import sprint, generate, session, decide, key, photo


def switch(client, sid, vid, variant, name="switch"):
    return client.put(f"/api/generations/{sid}/luxury-model", json={"variant": variant, "version_id": vid}, headers=key(name))


def test_custom_default_and_explicit_pretrained(sprint):
    client, worker, *_ = sprint
    sid = generate(sprint)
    detail = session(client, sid)
    luxury = detail["variations"][0]
    assert luxury["luxury_variant"] == "custom"
    assert luxury["versions"][0]["settings"]["weights"] == "Luxury_UTEC_r8_step300.safetensors"
    assert {choice["id"] for choice in luxury["luxury_variants"]} == {"custom", "pretrained"}
    response = client.post("/api/generations", files={"image": ("bedroom.png", photo(), "image/png")}, data={"consent": "true", "luxury_model": "pretrained"}, headers=key("external"))
    assert response.status_code == 202
    worker.run_once()
    assert session(client, response.json()["session_id"])["variations"][0]["luxury_variant"] == "pretrained"


def test_switch_versions_only_luxury_without_inventing_rejection(sprint):
    client, worker, _, _, _ = sprint
    sid = generate(sprint)
    before = session(client, sid)
    old = before["variations"][0]["current_version_id"]
    assert decide(client, sid, old, "accepted").status_code == 200
    response = switch(client, sid, old, "pretrained")
    assert response.status_code == 202
    assert switch(client, sid, old, "pretrained").json() == response.json()
    assert switch(client, sid, old, "custom").status_code == 409
    assert switch(client, sid, old, "pretrained", "conflict").status_code == 409
    assert session(client, sid)["variations"][0]["luxury_variant"] == "custom"
    worker.run_once()
    after = session(client, sid)
    slot = after["variations"][0]
    assert slot["current_version_id"] != old
    assert slot["luxury_variant"] == "pretrained"
    assert slot["versions"][-1]["decision"] is None
    assert slot["versions"][0]["decision"] == "accepted"
    assert len(slot["versions"][0]["decisions"]) == 1
    assert after["variations"][1:] == before["variations"][1:]
    assert switch(client, sid, old, "custom", "stale").status_code == 409
    assert switch(client, sid, slot["current_version_id"], "pretrained", "same").status_code == 200


def test_failed_switch_retries_pinned_profile_and_keeps_old_decision(sprint):
    client, worker, store, _, repo = sprint
    sid = generate(sprint)
    old = session(client, sid)["variations"][0]["current_version_id"]
    decide(client, sid, old, "accepted")
    response = switch(client, sid, old, "pretrained")
    store.fail_after = 1
    worker.run_once()
    assert client.get(f'/api/jobs/{response.json()["job_id"]}').json()["status"] == "failed"
    assert session(client, sid)["variations"][0]["current_version_id"] == old
    with repo.transaction() as conn:
        conn.execute("UPDATE bedroom.slots SET profile_options = '{}' WHERE session_id = %s", (sid,))
    store.fail_after = None
    response = client.post(f"/api/generations/{sid}/variations/1/retry", headers=key("retry-switch"))
    assert response.status_code == 202
    worker.run_once()
    slot = session(client, sid)["variations"][0]
    assert slot["luxury_variant"] == "pretrained"
    assert slot["versions"][-1]["settings"]["weights"] == "Luxury.safetensors"
    assert slot["versions"][0]["decision"] == "accepted"


def test_switch_owner_paused_and_legacy_profile(sprint):
    client, worker, _, _, repo = sprint
    sid = generate(sprint)
    old = session(client, sid)["variations"][0]["current_version_id"]
    with repo.transaction() as conn:
        external = conn.execute("SELECT profile_options->'pretrained' AS profile FROM bedroom.slots WHERE session_id = %s AND position = 1", (sid,)).fetchone()["profile"]
        external.pop("variant")
        external["steps"] = 17
        conn.execute("UPDATE bedroom.slots SET profile = %s, profile_options = '{}' WHERE session_id = %s AND position = 1", (Jsonb(external), sid))
        conn.execute("UPDATE bedroom.versions SET settings = %s WHERE id = %s", (Jsonb(external), old))
    assert switch(client, sid, old, "custom", "other-owner").status_code == 202
    worker.run_once()
    new = session(client, sid)["variations"][0]["current_version_id"]
    back = switch(client, sid, new, "pretrained", "back")
    assert back.status_code == 202
    assert client.get(f'/api/jobs/{back.json()["job_id"]}').json()["luxury_variant"] == "pretrained"
    worker.run_once()
    assert session(client, sid)["variations"][0]["versions"][-1]["settings"]["steps"] == 17
    new = session(client, sid)["variations"][0]["current_version_id"]
    client.headers["Authorization"] = "Bearer bob"
    assert switch(client, sid, new, "custom", "bob").status_code == 404
    client.headers["Authorization"] = "Bearer alice"
    client.patch(f"/api/generations/{sid}", json={"paused": True})
    assert switch(client, sid, new, "custom", "paused").status_code == 409


def test_failed_switch_cannot_republish_old_summary(sprint):
    client, worker, store, _, _ = sprint
    sid = generate(sprint)
    for slot in session(client, sid)["variations"]:
        decide(client, sid, slot["current_version_id"], "accepted")
    assert client.post(f"/api/generations/{sid}/summary", headers=key("summary")).status_code == 202
    worker.run_once()
    old = session(client, sid)["variations"][0]["current_version_id"]
    assert session(client, sid)["summary"]
    switch(client, sid, old, "pretrained")
    assert session(client, sid)["summary"] is None
    assert client.post(f"/api/generations/{sid}/summary", headers=key("queued-switch")).status_code == 409
    store.fail_after = 1
    worker.run_once()
    assert client.post(f"/api/generations/{sid}/summary", headers=key("after-switch")).status_code == 409


def test_lost_switch_lease_does_not_publish_profile_or_version(sprint):
    client, worker, _, models, repo = sprint
    sid = generate(sprint)
    old = session(client, sid)["variations"][0]["current_version_id"]
    response = switch(client, sid, old, "pretrained")
    render = models.render
    def interrupted(*args):
        with repo.transaction() as conn:
            conn.execute("UPDATE bedroom.jobs SET lease_until = now() - interval '1 minute' WHERE id = %s", (response.json()["job_id"],))
        return render(*args)
    models.render = interrupted
    worker.run_once()
    slot = session(client, sid)["variations"][0]
    assert slot["current_version_id"] == old and slot["luxury_variant"] == "custom"
    assert len(slot["versions"]) == 1


def test_legacy_upload_key_replays_only_when_model_omitted(sprint):
    from hashlib import sha256
    from bedroom_backend.service import fingerprint
    from test_workflow import submit
    client, _, _, _, repo = sprint
    response = submit(client)
    with repo.transaction() as conn:
        conn.execute("UPDATE bedroom.requests SET fingerprint = %s WHERE key = 'upload'", (fingerprint("upload", [sha256(photo()).hexdigest(), "Nogal"]),))
    assert submit(client).json() == response.json()
    explicit = client.post("/api/generations", files={"image": ("bedroom.png", photo(), "image/png")}, data={"consent":"true","preferences":"Nogal","luxury_model":"pretrained"}, headers=key("upload"))
    assert explicit.status_code == 409
