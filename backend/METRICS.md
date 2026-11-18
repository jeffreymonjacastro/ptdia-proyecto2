# Operational and regeneration metrics

Backend **0.3.0** stores job origin, retry parent, first start, terminal finish and up to 64 sanitized successful inference-stage samples in the private PostgreSQL job record. These measurements survive Kaggle restarts. Repeated idempotent requests do not create extra decisions/jobs. No frontend dashboard or browser-facing metrics endpoint is introduced.

Apply [migration 003](migrations/003_operational_metrics.sql) once after 001/002 before starting 0.3.0. Existing records keep `legacy` origins and unknown timings. A running pre-upgrade job's unknown first start stays unknown after recovery. Model math and generation parameters are unchanged.

## Export a report

Run from a trusted operator shell with `BEDROOM_DATABASE_URL` already configured. The command only reads the database in a repeatable-read, read-only transaction. It does not contact object storage or run inference.

```sh
bedroom-report --format json --output /tmp/bedroom-metrics.json
bedroom-report --format csv --output /tmp/bedroom-metrics.csv
```

To select sessions created on November 18 in Lima:

```sh
bedroom-report --since '2026-11-18T00:00:00-05:00' \
  --until '2026-11-19T00:00:00-05:00' \
  --format csv --output /tmp/bedroom-metrics-2026-11-18.csv
```

Bounds select a **session-creation cohort**, with inclusive `since` and exclusive `until`. Activity and current statuses for those sessions are observed when the report is generated; this is not an event-time daily traffic report. Date-only bounds mean midnight UTC; timestamps require an explicit timezone. Keep the backend/model configuration fixed during a study and record its tested revisions alongside the export.

Inside Kaggle, after the setup/secrets cell has run, wait for GPU jobs to finish, stop/interrupt the busy API cell, then run `!bedroom-report --format csv --output /kaggle/working/bedroom-metrics.csv` in a new code cell. Download the file through the notebook's Output panel before ending the session. A separate trusted operator terminal can export while the API is running. The report itself does not need GPU models. JSON and CSV include cohort definitions and metric definitions. CSV uses `section,dimension,metric,value,sample_size,unit`, suitable for filtering/pivot tables. Fractions range from 0 to 1; missing averages/rates are null in JSON and blank in CSV.

## Count the different actions separately

| Statistic | Definition |
|---|---|
| `user_regeneration_requests` | Recorded rejection decision events. A later change to the rejection reason is another request; an idempotent replay is not. |
| `distinct_rejected_versions` | Different image versions with at least one rejection. This distinguishes repeated requests concerning the same image. |
| Mean/median/min/max regenerations per session | Rejection-event counts across **all** cohort sessions, including zero-event sessions. |
| Mean/median/min/max regenerations per participant | Rejection-event counts per distinct owner account with a cohort session, including accounts with zero rejections. This is an account count, not independently verified human participation. |
| `sessions_with_regeneration_rate` | Sessions with at least one rejection divided by all cohort sessions. |
| `technical_retry_jobs` | Explicit initial-batch or regeneration retry jobs, linked to their prior job; excludes model switches and lease recovery. |
| `model_switch_jobs` | Explicit Luxury model switches, without synthetic rejection decisions. |
| `worker_lease_recoveries` | Sum of `max(attempts - 1, 0)`: interrupted/expired job claims, not user requests. |
| First-review acceptance/rejection | First recorded decision per distinct image version. Undecided images are excluded. Repeated decisions do not inflate this denominator. |

Model review rows use each version's saved style/variant/hash, so switching Luxury does not relabel earlier feedback. These rates describe user preference in the observed sample; they do not establish aesthetic quality or room-geometry correctness. Use one account per actual study participant and keep a separate participation record if claiming a ten-person evaluation.

## Monitor function and performance

- Counts by session status, job kind, job origin and job status; terminal error-code breakdown.
- Technical job failure rate: failed jobs excluding expected `not_a_bedroom` input rejection, divided by succeeded jobs plus technical failures. Nonterminal jobs are shown separately and excluded from that rate.
- Job queue wait: first claim minus job creation. Processing wall time: terminal finish minus first claim. Turnaround: terminal finish minus creation. Report mean/median/min/max and sample counts overall and per job kind. Upload transfer time and time spent reviewing proposals are not included.
- Successful inference-stage duration and maximum **PyTorch allocated** bytes. Generation groups preserve style, variant, hash and inference settings so different presets can be distinguished. Bytes can be divided by `1024**3` for GiB. Peak allocated memory is not total device utilization.
- Coverage: legacy-origin jobs, terminal jobs missing timing and jobs whose stage samples were truncated.

First-start and finish use database timestamps. Processing wall time includes gaps during lease recovery. Successful stage samples are from the final owned worker attempt; failed/interrupted calls can have no sample. This is not a measurement of total GPU consumption. Missing samples are excluded from timing calculations, not filled with zero. No percentile or statistical significance claim is made for small samples.

## Evidence and limitations

Use the [limitations register](LIMITATIONS.md) together with exports in the report/PPT: identify the limitation, show measurements/observations, explain the implemented management, and retain its residual restriction.

Reports omit owner/session/version IDs, emails, photographs, prompts, descriptions and feedback reasons. They cover retained visible records only. Deleted sessions and their metrics disappear; uploading/deleting sessions are excluded. Exports therefore have deletion and cohort-selection bias and are not lifetime traffic totals. Historical job origins and missing pre-upgrade timings cannot be reconstructed reliably. Some system failures before a session/job is persisted are outside this report.

Local validation uses controlled fixture accounts and fake inference; those exported counts are **not user-study results**. Real GPU timing evidence remains in [the measured smoke report](kaggle/luxury_choice_smoke_evidence.json). Collect operational exports during actual shared testing before drawing conclusions about reliability, acceptance or regeneration behavior.
