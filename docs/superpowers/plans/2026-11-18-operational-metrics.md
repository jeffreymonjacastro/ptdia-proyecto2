# Operational Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Persist operational measurements and export defensible regeneration/reliability statistics for shared testing.

**Architecture:** Add compatible columns to private jobs, collect sanitized inference measurements with the owning worker lease, and aggregate a read-only report into JSON or long-form CSV. Add notebook dataset preflight before model loading.

**Tech Stack:** Python/FastAPI/PostgreSQL, existing Kaggle launcher, stdlib JSON/CSV/statistics, pytest.

**Spec:** `docs/superpowers/specs/2026-11-18-operational-metrics-design.md`.

## Global Constraints

- Existing feature checkout; leave unrelated local files and safetensors unstaged.
- No photos/prompts/reasons/identifiers in exported reports; no public statistics endpoint.
- Keep model switches, user rejections, technical retry jobs and lease recoveries distinct.
- Preserve idempotency, ownership, job fencing and deletion semantics.
- Document cohort/window/denominator, legacy/missing samples and deletion bias; no inferred quality claims.

## Review Focus

- Zero-event sessions/participants and empty cohorts must have correct denominators.
- Switching models and changing a rejection reason must not misattribute historical statistics.
- Failed/reclaimed/legacy jobs must not fabricate timings or count technical retries as user rejection.
- Invalid or excessive optional stage samples must not break GPU jobs or expose private text.
- Notebook inputs must fail with a clear message before GPU models load when custom weights are absent.

### Task 1: Instrumentation, report and preflight

**Files:** create migration003, metrics/report module, tests, limitations/register and guides; modify repository/service/worker/models/runtime, bundle builder and package entrypoints/version.
**Interfaces:** jobs origin/retry_of/started_at/finished_at/metrics/metrics_truncated; optional model metric_sink; `bedroom-report --since --until --format json|csv --output`; `check_lora_inputs()`.

- [x] Write failing tests for job timing/origins, idempotency/retry/switch distinctions, report aggregates/cohorts/privacy/empty data, metric sanitation and missing/corrupt input preflight.
- [x] Implement additive migration, worker/model collection, read-only statistics and CSV/JSON exports; add dataset preflight and explicit notebook instructions.
- [x] Run backend PostgreSQL tests, frontend regression suite/build and wheel/CLI export checks.
- [x] Review independently, fix important findings with RED→GREEN regressions, update limitations/runbook and apply compatible shared migration.
- [x] Save updated private demo without a GPU run, verify downloaded inputs, and commit the tested feature.
