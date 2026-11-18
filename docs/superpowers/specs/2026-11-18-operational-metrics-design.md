# Operational metrics and regeneration statistics

Scope agreed in conversation: persistent job timings, a lightweight admin CSV/JSON operational report, user-regeneration statistics and documented limitations/management. Keep the existing API/frontend workflow. The notebook's saved v6 metadata was remotely verified to include both datasets; add explicit input/hash preflight and instructions so an older editor draft fails clearly before loading models.

## Approach

Extend private PostgreSQL jobs with origin, retry parent, first start, terminal finish and a bounded array of successful inference-stage timing/VRAM samples. Reuse current model measurements through an optional worker collector. A read-only CLI reports aggregate statistics without exporting identities, photos, prompts or reasons. Alternatives: a frontend dashboard adds unnecessary scope; smoke-only files cannot track actual testing sessions.

Keep user rejections, explicit technical retry jobs, Luxury switches and lease recovery attempts separate. Report average and median rejection requests per retained session and participant; percentage of sessions with rejections; distinct rejected versions; first-decision acceptance and rejection rates by style/model; jobs by status/origin/error; queue/processing/turnaround timing and successful inference timing/peak memory. Include every denominator/sample count; empty rates are null. Model/variant breakdowns use immutable version settings, not a slot's latest model.

Filter cohorts by session creation timestamp using optional UTC --since/--until bounds; activity/status is observed at report generation. Include zero-rejection sessions/participants. Deleted sessions and their metrics are excluded by cascade; legacy jobs have unknown origin/timings rather than invented values. Completion timestamps and final-attempt stage samples are not retroactively fabricated. Processing wall time includes lease-recovery gaps; stage samples cover successful calls in the final owned attempt, not total GPU utilization. At most 64 samples are stored per job, with explicit truncation reporting.

The report has no browser endpoint. Operators use BEDROOM_DATABASE_URL in a secure shell or Kaggle environment. Neither worker nor model output should fail solely due to malformed/overflowing optional metric samples; existing lease fencing still governs job publication. Repeated user/API requests must not double-count idempotent decisions or retry jobs. Maintain a limitations register tied to evidence, mitigations and remaining restrictions.
