import csv
from io import StringIO
import json
from pathlib import Path
from datetime import datetime, timezone

import pytest

from test_workflow import sprint, generate, session, decide, key, submit, photo
from bedroom_backend.reporting import collect_report, write_report, parse_bound
from bedroom_backend.runtime import check_lora_inputs


def values(report, section="overall", dimension="all"):
    return {row["metric"]: row for row in report["rows"] if row["section"] == section and row["dimension"] == dimension}


def test_jobs_record_timings_origins_and_separate_retry_from_user_rejection(sprint):
    client, worker, store, _, repo = sprint
    sid = generate(sprint)
    old = session(client, sid)["variations"][0]["current_version_id"]
    response = decide(client, sid, old, "rejected", "PRIVATE_FEEDBACK")
    assert decide(client, sid, old, "rejected", "PRIVATE_FEEDBACK").json() == response.json()
    store.fail_after = 1
    worker.run_once()
    store.fail_after = None
    retry = client.post(f"/api/generations/{sid}/variations/1/retry", headers=key("retry"))
    assert retry.status_code == 202
    assert client.post(f"/api/generations/{sid}/variations/1/retry", headers=key("retry")).json() == retry.json()
    worker.run_once()
    new = session(client, sid)["variations"][0]["current_version_id"]
    assert client.put(f"/api/generations/{sid}/luxury-model", json={"variant":"pretrained","version_id":new}, headers=key("switch")).status_code == 202
    worker.run_once()
    with repo.transaction() as conn:
        jobs = conn.execute("SELECT * FROM bedroom.jobs ORDER BY created_at").fetchall()
    assert [job["origin"] for job in jobs] == ["upload", "rejection", "regeneration_retry", "model_switch"]
    assert jobs[2]["retry_of"] == jobs[1]["id"]
    assert all(job["finished_at"] >= job["started_at"] >= job["created_at"] for job in jobs)
    report = collect_report(repo)
    stats = values(report)
    assert stats["user_regeneration_requests"]["value"] == 1
    assert stats["technical_retry_jobs"]["value"] == 1
    assert stats["model_switch_jobs"]["value"] == 1
    assert stats["mean_user_regenerations_per_session"] == {"section":"overall","dimension":"all","metric":"mean_user_regenerations_per_session","value":1.0,"sample_size":1,"unit":"requests/session"}
    encoded = json.dumps(report)
    assert "PRIVATE_FEEDBACK" not in encoded and sid not in encoded
    custom = [row for row in report["rows"] if row["section"] == "model_review" and row["dimension"].startswith("luxury/custom/") and row["metric"] == "user_regeneration_requests"]
    assert len(custom) == 1 and custom[0]["value"] == 1


def test_zero_event_sessions_and_participants_are_included_in_denominators(sprint):
    client, worker, _, _, repo = sprint
    first = generate(sprint)
    old = session(client, first)["variations"][0]["current_version_id"]
    decide(client, first, old, "rejected", "Conservar cama")
    worker.run_once()
    assert submit(client, "alice-second").status_code == 202
    worker.run_once()
    client.headers["Authorization"] = "Bearer bob"
    assert submit(client, "bob-first").status_code == 202
    worker.run_once()
    stats = values(collect_report(repo))
    assert stats["sessions"]["value"] == 3
    assert stats["participants"]["value"] == 2
    assert stats["mean_user_regenerations_per_session"]["value"] == pytest.approx(1 / 3, abs=1e-6)
    assert stats["mean_user_regenerations_per_participant"]["value"] == 0.5
    assert stats["sessions_with_regeneration_rate"]["sample_size"] == 3
    assert stats["sessions_with_regeneration_rate"]["value"] == pytest.approx(1 / 3, abs=1e-6)


def test_stage_samples_are_sanitized_bounded_and_durable(sprint):
    client, worker, _, models, repo = sprint
    render = models.render
    models.metric_sink = None
    def measured(original, profile, prompt, seed):
        models.metric_sink({"stage":"generation","seconds":-1,"peak_bytes":10})
        for _ in range(70):
            models.metric_sink({"stage":"generation","style":profile["id"],"variant":profile.get("variant"),"lora_sha256":profile["sha256"],"seconds":1.25,"peak_bytes":2048,"prompt":"PRIVATE_PROMPT","reason":"PRIVATE_REASON"})
        return render(original, profile, prompt, seed)
    models.render = measured
    generate(sprint)
    with repo.transaction() as conn:
        job = conn.execute("SELECT metrics, metrics_truncated FROM bedroom.jobs").fetchone()
    assert len(job["metrics"]) == 64 and job["metrics_truncated"] is True
    assert all(metric["seconds"] == 1.25 for metric in job["metrics"])
    assert "PRIVATE_" not in json.dumps(job)
    report = collect_report(repo)
    assert values(report)["jobs_with_truncated_metrics"]["value"] == 1
    assert any(row["metric"] == "median_seconds" and row["value"] == 1.25 and row["sample_size"] == 64 for row in report["rows"])
    assert getattr(models, "metric_sink", None) is None


def test_empty_cohort_and_csv_have_explicit_counts_and_no_fabricated_rates(sprint):
    *_, repo = sprint
    report = collect_report(repo)
    stats = values(report)
    assert stats["sessions"]["value"] == 0
    assert stats["mean_user_regenerations_per_session"]["value"] is None
    output = StringIO()
    write_report(report, output, "csv")
    rows = list(csv.DictReader(StringIO(output.getvalue())))
    assert {"section","dimension","metric","value","sample_size","unit"} == set(rows[0])
    assert next(row for row in rows if row["metric"] == "mean_user_regenerations_per_session")["value"] == ""


def test_lease_recovery_does_not_reset_first_start_or_publish_stale_measurements(sprint):
    client, worker, _, _, repo = sprint
    sid = generate(sprint)
    old = session(client, sid)["variations"][0]["current_version_id"]
    decide(client, sid, old, "rejected", "Conservar cama")
    first = repo.claim()
    with repo.transaction() as conn:
        conn.execute("UPDATE bedroom.jobs SET lease_until = now() - interval '1 minute' WHERE id = %s", (first["id"],))
    second = repo.claim()
    assert second["started_at"] == first["started_at"] and second["attempts"] == 2
    with repo.transaction() as conn:
        repo.close_job(conn, first, metrics=[{"stage":"generation","seconds":999,"peak_bytes":1}])
        row = conn.execute("SELECT status, metrics FROM bedroom.jobs WHERE id = %s", (first["id"],)).fetchone()
    assert row["status"] == "running" and row["metrics"] == []
    assert values(collect_report(repo))["worker_lease_recoveries"]["value"] == 1


def test_cohort_bounds_are_timezone_aware_and_filter_sessions(sprint):
    *_, repo = sprint
    assert parse_bound("2026-11-18T00:00:00-05:00") == datetime(2026,11,18,5,tzinfo=timezone.utc)
    with pytest.raises(ValueError): parse_bound("2026-11-18T12:30:00")
    generate(sprint)
    assert values(collect_report(repo, since=datetime(2100,1,1,tzinfo=timezone.utc)))["sessions"]["value"] == 0
    with pytest.raises(ValueError): collect_report(repo, since=parse_bound("2026-11-19"), until=parse_bound("2026-11-18"))


def test_input_preflight_checks_missing_custom_weight_before_gpu_load(tmp_path, monkeypatch):
    content = {"active":["luxury","japanese","neo-classic","attic","cyberpunk"],"profiles":[]}
    from bedroom_backend.catalog import load_catalog
    for profile in load_catalog():
        profile = {**profile,"variants":{},"sha256":None}
        content["profiles"].append(profile)
        if profile["id"] != "luxury": (tmp_path/profile["weights"]).write_bytes(b"test")
    catalog = tmp_path/"styles.json"
    catalog.write_text(json.dumps(content))
    monkeypatch.setenv("BEDROOM_CATALOG",str(catalog))
    monkeypatch.setenv("BEDROOM_LORA_ROOT",str(tmp_path))
    with pytest.raises(RuntimeError,match="Luxury_UTEC.*Add Input"):
        check_lora_inputs()
    (tmp_path/"Luxury_UTEC_r8_step300.safetensors").write_bytes(b"test")
    assert check_lora_inputs() == 5


def test_legacy_jobs_do_not_invent_timing_samples(sprint):
    *_, repo = sprint
    generate(sprint)
    with repo.transaction() as conn:
        conn.execute("UPDATE bedroom.jobs SET origin = 'legacy', started_at = NULL, finished_at = NULL")
    report = collect_report(repo)
    stats = values(report)
    assert stats["legacy_origin_jobs"]["value"] == 1
    assert stats["jobs_missing_terminal_timing"]["value"] == 1
    assert values(report,"job_turnaround")["mean_seconds"]["value"] is None


def test_reclaiming_pre_upgrade_job_keeps_unknown_first_start(sprint):
    client, worker, _, _, repo = sprint
    sid = generate(sprint)
    old = session(client, sid)["variations"][0]["current_version_id"]
    decide(client, sid, old, "rejected", "Conservar cama")
    claimed = repo.claim()
    with repo.transaction() as conn:
        conn.execute("UPDATE bedroom.jobs SET started_at = NULL, lease_until = now() - interval '1 minute' WHERE id = %s", (claimed["id"],))
    recovered = repo.claim()
    assert recovered["attempts"] == 2 and recovered["started_at"] is None
    worker.process(recovered)
    assert values(collect_report(repo))["jobs_missing_terminal_timing"]["value"] == 1


@pytest.mark.parametrize("readonly", [False, True])
def test_optional_metrics_do_not_require_writable_model_attributes(sprint, readonly):
    _, worker, _, models, _ = sprint
    class SlottedModel:
        __slots__ = ('delegate',)
        def __init__(self, delegate): self.delegate = delegate
        def __getattr__(self, name): return getattr(self.delegate, name)
    class ReadOnlyModel(SlottedModel):
        __slots__ = ()
        @property
        def metric_sink(self): return None
    worker.models = (ReadOnlyModel if readonly else SlottedModel)(models)
    assert session(sprint[0], generate(sprint))["status"] == "ready"


def test_bad_metrics_and_observer_errors_cannot_break_inference_recording():
    from bedroom_backend.metrics import sanitize_metric
    from bedroom_backend.models import KaggleModels
    assert sanitize_metric({"stage": [], "seconds": 1, "peak_bytes": 1}) is None
    assert sanitize_metric({"stage": "generation", "seconds": float('nan'), "peak_bytes": 1}) is None
    assert sanitize_metric({"stage": "generation", "seconds": True, "peak_bytes": 1}) is None
    assert sanitize_metric({"stage":"generation","seconds":1,"peak_bytes":1,"variant":[]}) == {"stage":"generation","seconds":1,"peak_bytes":1}
    model = object.__new__(KaggleModels)
    model.metrics = []
    def unavailable(_metric): raise OSError('unavailable')
    model.metric_sink = unavailable
    model.record_metric({"stage":"generation","seconds":1,"peak_bytes":1})
    assert len(model.metrics) == 1


def test_weight_preflight_rejects_wrong_hash_and_duplicate_names(tmp_path):
    from hashlib import sha256
    from bedroom_backend.models import resolve_weight
    profile = {"id":"luxury","weights":"Custom.safetensors","sha256":sha256(b'correct').hexdigest()}
    (tmp_path/profile["weights"]).write_bytes(b'wrong')
    with pytest.raises(RuntimeError,match='hash mismatch'): resolve_weight(tmp_path,profile)
    (tmp_path/profile["weights"]).write_bytes(b'correct')
    assert resolve_weight(tmp_path,profile)[1] == profile["sha256"]
    (tmp_path/'duplicate').mkdir()
    (tmp_path/'duplicate'/profile["weights"]).write_bytes(b'correct')
    with pytest.raises(RuntimeError,match='Expected one'): resolve_weight(tmp_path,profile)
