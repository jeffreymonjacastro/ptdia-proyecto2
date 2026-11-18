# Approved Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five approved images after the unchanged summary, including previews and downloads.

**Architecture:** A focused gallery uses current versions and validates summary revision/IDs. Downloads use the existing authenticated Blob loader; browser ZIP assembly preserves image bytes and does not require backend changes.

**Tech Stack:** React, TypeScript, existing ImageContext, fflate, Node/tsx and Happy DOM.

**Spec:** `docs/superpowers/specs/2026-11-17-approved-gallery-design.md` (approved conversation scope).

## Global Constraints

- Work in the existing `feat/frontend-dormitorios` original checkout; do not change backend, secrets or the user's untracked `.env.example`.
- Preserve summary text and show exactly five current approved versions, excluding rejections.
- Downloads retain saved bytes, authenticated transport and actual MIME extensions.
- Demo previews are explicitly examples; downloadable generated files are available in API mode.

## Review Focus

- Rejected, generating, missing and stale versions cannot appear as a final gallery.
- Paused completed selection retains its valid gallery.
- Failed image/ZIP requests save nothing partial and remain retryable.
- Account/project switches and invalidation abort pending downloads, without late saves.
- PNG/JPEG/WebP filenames match downloaded bytes; ZIP contains exactly the current five.

### Task 1: Approved gallery, downloads and integration

**Files:** create `frontend/src/ApprovedGallery.tsx`, `frontend/src/downloads.ts`, `frontend/src/downloads.test.ts`; modify `App.tsx`, `ui.test.tsx`, `style.css`, package/lock and frontend/context documentation.

**Interfaces:** consumes `Project`, `currentVersion`, `ImageContext` and existing preview callback; produces `ApprovedGallery({project, connected, onPreview})`, `approvedVersions(project)`, `imageFilename(style, number, mime)`, `buildImageZip(images)` and `saveDownload(blob, filename)`.

- [x] Write UI regressions for gallery after summary, five labels/previews, invalidation/new acceptance/new summary, paused state, stale revision/IDs and demo download limitations. Write download tests for MIME names, ZIP byte preservation, error/retry and cancellation.
- [x] Run new tests before implementation and confirm missing-gallery/helper failures.
- [x] Implement helpers, gallery component and scoped responsive CSS. Add pinned fflate dependency; integrate below summary and reuse preview dialog. Cancel downloads on unmount/change and revoke temporary URLs.
- [x] Run `npm test` and `npm run build`; expect all tests/build to pass. Inspect the rendered desktop/mobile gallery with local fixture data if tooling permits.
- [x] Update context/README, review the diff and request independent review. Fix important findings with regressions.
- [x] Commit the tested feature separately; leave push to the user.
