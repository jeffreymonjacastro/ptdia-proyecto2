"""Read-only aggregate reporting for the operator; never export session/user text."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import json
import os
import re
from statistics import fmean, median
import sys

from .metrics import sanitize_metric
from .repository import Repository, all_rows

FIELDS = ("section", "dimension", "metric", "value", "sample_size", "unit")


def parse_bound(value):
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        if len(value) != 10:
            raise ValueError("Include a timezone in timestamps; date-only bounds mean midnight UTC.")
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def model_dimension(settings):
    style = settings.get("id", "unknown")
    if not isinstance(style, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", style):
        style = "unknown"
    variant = settings.get("variant")
    if style == "luxury" and variant not in ("custom", "pretrained"):
        variant = "custom" if settings.get("weights") == "Luxury_UTEC_r8_step300.safetensors" else "pretrained"
    if variant not in ("custom", "pretrained"):
        variant = "standard"
    digest = settings.get("sha256", "")
    digest = digest if isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest) else "unrecorded"
    return f"{style}/{variant}/{digest}"


def collect_report(repo, *, since=None, until=None):
    for bound in (since, until):
        if bound is not None and bound.utcoffset() is None:
            raise ValueError("Cohort bounds require a timezone.")
    if since and until and since >= until:
        raise ValueError("--since must be earlier than --until (exclusive).")
    with repo.transaction() as conn:
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        sessions = all_rows(conn, """
            SELECT id, owner_id, status FROM bedroom.sessions
            WHERE status NOT IN ('uploading', 'deleting')
              AND (%s::timestamptz IS NULL OR created_at >= %s)
              AND (%s::timestamptz IS NULL OR created_at < %s)
        """, (since, since, until, until))
        ids = [row["id"] for row in sessions]
        jobs = all_rows(conn, """
            SELECT session_id, kind, status, origin, attempts, error, created_at,
                   started_at, finished_at, metrics, metrics_truncated
            FROM bedroom.jobs WHERE session_id = ANY(%s::uuid[])
        """, (ids,))
        versions = all_rows(conn, "SELECT id, session_id, settings FROM bedroom.versions WHERE session_id = ANY(%s::uuid[])", (ids,))
        decisions = all_rows(conn, """
            SELECT d.id, d.version_id, d.decision, v.session_id
            FROM bedroom.decisions d JOIN bedroom.versions v ON v.id = d.version_id
            WHERE v.session_id = ANY(%s::uuid[]) ORDER BY d.id
        """, (ids,))

    rows = []
    def emit(metric, value, n, unit="count", *, section="overall", dimension="all"):
        rows.append(dict(section=section, dimension=dimension, metric=metric,
                         value=round(value, 6) if isinstance(value, float) else value,
                         sample_size=n, unit=unit))
    def ratio(metric, numerator, denominator, *, section="overall", dimension="all"):
        emit(metric, numerator / denominator if denominator else None, denominator, "fraction", section=section, dimension=dimension)
    def distribution(values, *, section, dimension, unit):
        for name, function in (("mean", fmean), ("median", median), ("min", min), ("max", max)):
            emit(f"{name}_seconds", function(values) if values else None, len(values), unit, section=section, dimension=dimension)

    session_count = len(sessions)
    participants = {row["owner_id"] for row in sessions}
    owner_by_session = {row["id"]: row["owner_id"] for row in sessions}
    rejections = [row for row in decisions if row["decision"] == "rejected"]
    session_rejections = Counter(row["session_id"] for row in rejections)
    participant_rejections = Counter(owner_by_session[row["session_id"]] for row in rejections)
    per_session = [session_rejections[row["id"]] for row in sessions]
    per_participant = [participant_rejections[owner] for owner in participants]
    emit("sessions", session_count, session_count)
    emit("participants", len(participants), len(participants))
    emit("user_regeneration_requests", len(rejections), len(decisions))
    emit("distinct_rejected_versions", len({row["version_id"] for row in rejections}), len(versions))
    for unit, values in (("session", per_session), ("participant", per_participant)):
        for name, function in (("mean", fmean), ("median", median), ("min", min), ("max", max)):
            emit(f"{name}_user_regenerations_per_{unit}", function(values) if values else None, len(values), f"requests/{unit}")
    ratio("sessions_with_regeneration_rate", len(session_rejections), session_count)

    origins = Counter(row["origin"] for row in jobs)
    technical_retries = origins["initial_retry"] + origins["regeneration_retry"]
    emit("technical_retry_jobs", technical_retries, len(jobs))
    emit("mean_technical_retries_per_session", technical_retries / session_count if session_count else None, session_count, "jobs/session")
    emit("model_switch_jobs", origins["model_switch"], len(jobs))
    emit("worker_lease_recoveries", sum(max(row["attempts"] - 1, 0) for row in jobs), len(jobs))
    emit("legacy_origin_jobs", origins["legacy"], len(jobs))
    emit("jobs_with_truncated_metrics", sum(row["metrics_truncated"] for row in jobs), len(jobs))
    expected_rejections = sum(row["status"] == "failed" and row["error"] == "not_a_bedroom" for row in jobs)
    technical_failures = sum(row["status"] == "failed" and row["error"] != "not_a_bedroom" for row in jobs)
    successes = sum(row["status"] == "succeeded" for row in jobs)
    emit("expected_input_rejections", expected_rejections, len(jobs))
    ratio("technical_job_failure_rate", technical_failures, technical_failures + successes)
    for section, field in (("session_status", "status"),):
        for label, count in sorted(Counter(row[field] for row in sessions).items()):
            emit("count", count, session_count, section=section, dimension=label)
    for section, field in (("job_status", "status"), ("job_origin", "origin"), ("job_kind", "kind")):
        for label, count in sorted(Counter(row[field] for row in jobs).items()):
            emit("count", count, len(jobs), section=section, dimension=label)
    errors = Counter(row["error"] if isinstance(row["error"], str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", row["error"]) else "other" for row in jobs if row["error"])
    for code, count in sorted(errors.items()):
        emit("count", count, sum(errors.values()), section="job_error", dimension=code)

    first_reviews = {}
    for decision in decisions:
        first_reviews.setdefault(decision["version_id"], decision)
    reviewed_by_model = defaultdict(list)
    rejection_by_model = Counter()
    model_by_version = {row["id"]: model_dimension(row["settings"]) for row in versions}
    for vid, decision in first_reviews.items():
        reviewed_by_model[model_by_version[vid]].append(decision)
    for decision in rejections:
        rejection_by_model[model_by_version[decision["version_id"]]] += 1
    ratio("first_review_acceptance_rate", sum(row["decision"] == "accepted" for row in first_reviews.values()), len(first_reviews))
    for model in sorted(set(model_by_version.values())):
        reviews = reviewed_by_model[model]
        emit("reviewed_versions", len(reviews), len(reviews), section="model_review", dimension=model)
        emit("user_regeneration_requests", rejection_by_model[model], len(reviews), section="model_review", dimension=model)
        ratio("first_review_acceptance_rate", sum(row["decision"] == "accepted" for row in reviews), len(reviews), section="model_review", dimension=model)
        ratio("first_review_rejection_rate", sum(row["decision"] == "rejected" for row in reviews), len(reviews), section="model_review", dimension=model)

    for kind in ("all", *sorted({row["kind"] for row in jobs})):
        selected = jobs if kind == "all" else [row for row in jobs if row["kind"] == kind]
        for name, start, end in (("queue_wait", "created_at", "started_at"), ("processing_wall", "started_at", "finished_at"), ("turnaround", "created_at", "finished_at")):
            durations = [(row[end] - row[start]).total_seconds() for row in selected if row[start] is not None and row[end] is not None and row[end] >= row[start]]
            distribution(durations, section=f"job_{name}", dimension=kind, unit="seconds")
    emit("jobs_missing_terminal_timing", sum(row["status"] in {"succeeded", "failed"} and (row["started_at"] is None or row["finished_at"] is None) for row in jobs), successes + technical_failures + expected_rejections)

    stage_groups = defaultdict(list)
    for job in jobs:
        for raw in job["metrics"]:
            metric = sanitize_metric(raw)
            if metric:
                dimension = metric["stage"]
                if metric.get("style"):
                    dimension += "/" + metric["style"] + "/" + metric.get("variant", "standard") + "/" + metric.get("lora_sha256", "unrecorded")
                if metric.get("settings"):
                    dimension += "/" + json.dumps(metric["settings"], sort_keys=True, separators=(",", ":"))
                stage_groups[dimension].append(metric)
    for dimension, samples in sorted(stage_groups.items()):
        distribution([sample["seconds"] for sample in samples], section="inference_stage", dimension=dimension, unit="seconds")
        emit("max_peak_bytes", max(sample["peak_bytes"] for sample in samples), len(samples), "bytes", section="inference_stage", dimension=dimension)

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cohort": {"since_inclusive": since.isoformat() if since else None, "until_exclusive": until.isoformat() if until else None,
                   "definition":"Retained visible sessions created within these bounds; activity/status observed at report generation."},
        "definitions": {
            "user_regeneration_requests":"Recorded rejection decision events, including later reason changes; idempotent replays add no events.",
            "participants":"Distinct owner accounts with at least one cohort session, not independently verified people; identities are not exported.",
            "first_review_rates":"First recorded decision per distinct image version; undecided versions excluded. User preference is not objective image quality.",
            "sample_size":"Denominator for averages/rates, eligible observations for counts. Null means no eligible observations.",
            "technical_retries":"Explicit initial_retry/regeneration_retry jobs; excludes model switches and lease recovery.",
            "processing_wall":"First claim to terminal finish, including any lease-recovery gaps; not GPU-only time.",
            "inference_stage":"Successful measured calls in the final owned attempt; failed/interrupted calls may have no sample. Compare like settings.",
            "coverage":"Deleted/uploading/deleting sessions excluded; legacy origins/timings not reconstructed; terminal samples bounded to 64 per job. Counts are retained-data evidence, not lifetime traffic."
        },
        "rows": rows,
    }


def write_report(report, stream, format):
    if format == "json":
        json.dump(report, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    elif format == "csv":
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        for key, value in {"generated_at":report["generated_at"], **report["cohort"]}.items():
            writer.writerow(dict(section="metadata", dimension="cohort", metric=key, value=value, sample_size="", unit=""))
        for key, definition in report["definitions"].items():
            writer.writerow(dict(section="definition", dimension="all", metric=key, value=definition, sample_size="", unit=""))
        writer.writerows(report["rows"])
    else:
        raise ValueError("Format must be json or csv")


def main():
    parser = argparse.ArgumentParser(description="Export aggregate operational metrics without user identifiers, photos or feedback.")
    parser.add_argument("--since", help="Session creation bound, inclusive; ISO timestamp with timezone or UTC date.")
    parser.add_argument("--until", help="Session creation bound, exclusive; ISO timestamp with timezone or UTC date.")
    parser.add_argument("--format", choices=("json", "csv"), default="json")
    parser.add_argument("--output", help="Output file; default stdout. Keep research reports in secure team storage.")
    args = parser.parse_args()
    try:
        since, until = parse_bound(args.since), parse_bound(args.until)
        if since and until and since >= until:
            raise ValueError("--since must precede --until")
    except ValueError as error:
        parser.error(str(error))
    try:
        with Repository(os.environ["BEDROOM_DATABASE_URL"]) as repo:
            report = collect_report(repo, since=since, until=until)
    except Exception as error:
        parser.exit(1, f"Report could not be read ({type(error).__name__}). Check database access and migration 003.\n")
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="") as stream:
            write_report(report, stream, args.format)
    else:
        write_report(report, sys.stdout, args.format)


if __name__ == "__main__":
    main()
