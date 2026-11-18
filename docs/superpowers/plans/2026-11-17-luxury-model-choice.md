# Luxury Model Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Default to the custom Luxury LoRA and allow durable, versioned model switching without changing the five-style workflow.

**Architecture:** Snapshot both Luxury choices in PostgreSQL; jobs carry optional requested profile and publish it with the image atomically. Keep existing style IDs and authenticated transport; frontend exposes model controls and derives labels from version settings.

**Tech Stack:** FastAPI, PostgreSQL, Diffusers, React/TypeScript, Kaggle CLI.

**Spec:** `docs/superpowers/specs/2026-11-17-luxury-model-choice-design.md` (scope agreed in conversation).

## Global Constraints

- Existing feature checkout; preserve unrelated `.gitignore`, `.env.example`, `docs/reqs/` and local model folder changes. Do not commit tensor files.
- Five positions remain Luxury, Japanese, Neo Classic, Attic, Cyberpunk. Custom is default only for new sessions.
- No generated rejection event on model switch; previous settings and images remain immutable.
- Owner checks, idempotency keys, lease fencing, snapshot retries and summary invalidation apply to switching.
- Public dataset contains one tensor only; no retraining or release of training images.

## Review Focus

- Switching from an accepted version, failure/retry and invalidation must preserve the other four decisions/images.
- Catalog changes and backend restarts cannot change a queued/retried model.
- Existing sessions retain their old weights and history labels.
- Duplicate, stale, concurrent, paused and cross-user requests must not enqueue unintended work.
- Both weights must be attached and hash-checked before API readiness.

### Task 1: Dataset and backend choices

**Files:** catalog/models/styles/runtime, API/service/repository/worker, migration 002, backend tests and Kaggle bundle/smoke.
**Interfaces:** `luxury_model` multipart; `PUT /api/generations/{id}/luxury-model {variant,version_id}`; optional job `luxury_variant`; variation choice metadata. Frozen profiles stored as slot options and optional job requested_profile.

- [x] Publish verified single-tensor public dataset and verify file list/hash/visibility.
- [x] Write failing tests for default/explicit selection, versioned switching without rejection, no-op, conflicts, failure/retry, lease fencing, owner isolation and legacy session snapshot preservation.
- [x] Add catalog variants with hashes and unique filenames; persist choices and requested jobs via migration; publish selected profile atomically with image.
- [x] Run backend suite against disposable PostgreSQL; build new wheel and smoke/deploy bundles with both datasets.

### Task 2: Frontend and handoff

**Files:** domain/remote/API/controller/ProposalCard/App/History/gallery and frontend tests; backend/frontend/context guides.
**Interfaces:** consume optional variant/choice metadata and version settings; add switch-model ProjectAction and API method.

- [x] Write failing tests for controls, queued/failed switch recovery, idempotent API payload, labels/history and gallery invalidation.
- [x] Implement model choice at creation/in-project, pending/error handling and per-version labels while retaining demo behavior.
- [x] Run frontend tests/build, backend contract checks and finite Kaggle adapter smoke. Update runbook with migrations and dataset/model pins.
- [x] Independent review, fix important findings with regressions and commit tested changes. Do not push.
