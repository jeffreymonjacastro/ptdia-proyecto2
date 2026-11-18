# Bedroom backend

FastAPI accepts a consented bedroom photo and queues five SDXL img2img proposals. Qwen compares each result with the original. The backend records versioned decisions, regenerates one rejected slot at a time, and renders a Spanish summary from the decision history. The text-chat and single-image prototypes remain in `poc/`.

Frontend developers can start with the [browser integration guide and API contract](FRONTEND.md).

## Run the local tests

Use Python 3.11 or newer and Docker. The suite uses real PostgreSQL, fake inference, a fake authenticator, and in-memory image storage. It resets the `bedroom` schema between tests and accepts only a loopback DSN for the `bedroom_test` database.

```sh
docker run --rm --detach --name bedroom-test-postgres \
  -e POSTGRES_PASSWORD=bedroom_test -e POSTGRES_DB=bedroom_test \
  -p 127.0.0.1:55432:5432 postgres:17
docker exec bedroom-test-postgres pg_isready -U postgres -d bedroom_test
cd backend
uv sync --extra test
BEDROOM_TEST_DSN=postgresql://postgres:bedroom_test@127.0.0.1:55432/bedroom_test \
  uv run --extra test pytest -q
docker stop bedroom-test-postgres
```

Wait for `pg_isready` to report that the database is accepting connections before running pytest.

## Set up shared persistence

Backend **0.3.0** additionally requires [migration 003](migrations/003_operational_metrics.sql) after 001/002. It persists job timing/origin/retry and bounded inference metrics. See [operational and regeneration reporting](METRICS.md) for CSV/JSON export commands and exact denominators, and the [limitations register](LIMITATIONS.md) for evidence/management of known restrictions.

The shared project already has migration 003 applied, with backend read/update privileges verified. Earlier jobs retain unknown starts/legacy origins; new measurements begin when running 0.3.0. Local release checks passed: **54 backend tests**, **92 frontend tests**, production build, and the installed wheel's `bedroom-report` JSON/CSV exports against a controlled local cohort. These test counts/fixtures are not a user study.

1. Create or select the **team-owned Supabase project** with the Data API and automatic table exposure disabled. Apply [migration 001](migrations/001_bedroom.sql) then [migration 002](migrations/002_luxury_model_choice.sql) as the project database owner. Use a separate database login for the running backend. The statements below assume a fresh project and run in `psql` as the database owner. If the role is already provisioned, run only `\password bedroom_app`. Set the password through the prompt and store it in the team's password manager.

   ```sql
   CREATE ROLE bedroom_app LOGIN;
   GRANT USAGE ON SCHEMA bedroom TO bedroom_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bedroom TO bedroom_app;
   GRANT USAGE ON ALL SEQUENCES IN SCHEMA bedroom TO bedroom_app;
   \password bedroom_app
   ```

   Copy the **Session pooler** connection settings from **Connect**. Set the user to `bedroom_app.<project-ref>`, and use `sslmode=verify-full` with the Supabase CA certificate. Provide the CA as a Kaggle secret and write it to a temporary file at notebook startup, or set `sslmode=require` for a temporary smoke environment. Keep the `bedroom` schema outside the Data API and leave the `anon` and `authenticated` roles without grants on it.

2. Create a **private** Storage bucket named `bedroom-private`. Allow JPEG, PNG, and WebP and set a file limit of at least 10 MiB. Record the database URL, the Supabase URL, the publishable key, and a dedicated server secret key for Kaggle. Grant browser access only through the FastAPI image endpoints.

3. Turn off **Allow new users to sign up**. Under **Authentication → Users → Create user**, create a distinct account for each participant with a unique password and **Auto Confirm User** enabled. The password-only demo can use placeholder addresses such as `bedroom-test-a@example.com` and `bedroom-test-b@example.com`. Share credentials with each participant through the team's secure channel. The frontend uses the Supabase URL and publishable key for sign-in and sends the resulting access token as `Authorization: Bearer <access-token>` on API calls.

4. Enable `HF_TOKEN`, `NGROK_TOKEN`, `BEDROOM_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` for the private Kaggle demo notebook. Add `BEDROOM_DATABASE_CA` if the DSN uses `verify-full`. The default permitted frontend origin is `http://localhost:5173`. Set `BEDROOM_ORIGINS` in the notebook environment for another exact origin. Use a comma-separated list for multiple origins and restart the API after changing it.

References for setup are the [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres), [Auth user creation](https://supabase.com/docs/reference/python/auth-admin-createuser), and [Storage access models](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Package and run on Kaggle

The current launcher explicitly checks all six adapter filenames/hashes before loading GPU models. Both datasets must appear under Inputs. The saved version 6 metadata was remotely verified to list both datasets; if an older editor draft shows only the original, use **Add Input** to attach `badexample/plania-p2-luxury-utec-sdxl-lora` and restart the session. The backend scans mounted files under `/kaggle/input`; it does not download the LoRA as part of a code cell.

**Latest saved demo: version 8, backend 0.3.1**, including the summary selection correction described below. Its downloaded embedded wheel matches the GPU-tested package byte for byte, and both LoRA datasets are attached. Reload the latest saved [private demo notebook](https://www.kaggle.com/code/badexample/ptdia-bedroom-backend-demo), stop the old session, select T4 ×2 and run the three code cells. The preflight prints `Verified 6 LoRA input files and hashes.`; `/openapi.json` must report `info.version: 0.3.1`. Existing editor drafts may require Add Input/restart even when the saved version is configured correctly. No new secrets or migrations are needed beyond 001–003. Export measurements from a separate trusted shell, or interrupt the API cell after jobs finish and use a new notebook cell.

Build from the repository root. Use an untracked scratch output folder and replace the owner with the Kaggle account running the notebook. Use Kaggle CLI 2.2.5 or newer for `--no-run`.

```sh
uv build --wheel backend --out-dir /tmp/bedroom-wheel
QWEN_REVISION=851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a
python backend/kaggle/build_bundle.py demo \
  --wheel /tmp/bedroom-wheel/bedroom_backend-0.3.1-py3-none-any.whl \
  --slug YOUR_KAGGLE_OWNER/ptdia-bedroom-backend-demo \
  --revision "$QWEN_REVISION" --output /tmp/bedroom-demo
kaggle kernels push -p /tmp/bedroom-demo --no-run
```

Open the resulting private notebook in Kaggle and select **T4 ×2** with Internet enabled. Confirm access to the LoRA dataset from the notebook. Run the setup, Supabase connection check, and launcher cells in order. Use the current ngrok URL printed by the launcher. Confirm `GET /health` returns `200` with `{"status":"ready"}`. The API exposes `/docs` and `/openapi.json`. Use `ngrok-skip-browser-warning: true` on API requests if needed.

For a finite model smoke run, use `build_bundle.py smoke` and provide `--smoke-photo PATH` with a local JPEG. The verification fixture is [Hotel-suite-bedroom.jpg by Derek Jensen](https://commons.wikimedia.org/wiki/File:Hotel-suite-bedroom.jpg), released into the public domain. Use a separate private smoke slug, submit with `kaggle kernels push -p /tmp/bedroom-smoke --accelerator NvidiaTeslaT4 --timeout 3600`, and download the outputs with `kaggle kernels output OWNER/SLUG -p /tmp/bedroom-results`. Check `bedroom-smoke/smoke.json` for the application status as well as Kaggle's job status. The report includes model revisions, LoRA hashes, per-stage elapsed time, peak allocated GPU memory, and image sizes.

## Exercise the frontend contract

Use the [frontend integration guide](FRONTEND.md) for the full endpoint and state contract. To verify the deployed backend independently of the browser UI, leave the Kaggle **Launch the API** cell running. From your local terminal, change to `backend/` and run the verifier with the current ngrok origin, Supabase URL, and publishable key.

```sh
uv run python kaggle/verify_demo.py \
  --api "$NGROK_URL" \
  --supabase-url "$SUPABASE_URL" \
  --publishable-key "$SUPABASE_PUBLISHABLE_KEY" \
  --photo /path/to/authorized-bedroom.jpg \
  --check-isolation
```

The verifier prompts for participant A's credentials, generates five proposals, regenerates one, checks the other four images, and verifies the Spanish summary. It polls quietly while the GPU jobs run. With `--check-isolation`, it then prompts for participant B's credentials and checks that B gets `404` for A's session, job, and both original and generated images. Save the session ID from `Verified completed session …`.

Restart Kaggle, rerun all three cells, and update `NGROK_URL` to the URL printed by the launcher. Repeat the local command with `--session SESSION_ID` in place of `--photo …`. Use the same account A and keep `--check-isolation` to repeat the ownership checks. The saved Spanish text is accessible through `GET /api/generations/{session_id}` at `summary.summary`.

The deployed verifier completed the authenticated flow, retrieved the completed session and summary after a Kaggle restart, and passed the two-account isolation check.

Measure a representative session including at least one regeneration before opening shared testing. Use the actual image bytes and the planned number of testers to check the project's Storage and egress budget.

## Summary selection correction in 0.3.1

A real ten-version session reproduced `invalid_summary` on Qwen: it concatenated two separate visual observations into one excerpt. The renderer intentionally requires each excerpt to be contained within a single saved visual passage, so this output failed grounding even though both sentences appeared elsewhere in the description. Automatic retries repeated the failure.

Qwen now selects one numbered observation per version, or null. The server validates exact per-batch version sets, strict integer/null selections and bounds, then copies that saved passage, capped at 300 characters. Final literal-grounding and history-revision checks still apply. Decisions and reasons still come directly from saved records. The public summary response is unchanged. Worker warnings include only the job ID, attempt and a safe diagnostic code such as `ungrounded_excerpt`, `version_mismatch`, `invalid_selection` or `invalid_json`; they do not log descriptions, feedback or raw model output.

The private GPU diagnostic reproduced the old failure in version 2 and passed the same ten-version input with backend 0.3.1 in version 3. All ten IDs and excerpts validated. Aggregate evidence is in [summary_selection_evidence.json](kaggle/summary_selection_evidence.json); private inputs/responses are not committed. Local checks passed 66 backend tests against disposable PostgreSQL, 92 frontend tests and the frontend production build.

After activating 0.3.1, reopen the existing failed project and choose **Reintentar resumen**. Keep its accepted versions and history; no new upload or regeneration is required. Existing saved summaries are unchanged.

While a job is active, the current frontend polls after each completed cycle plus 2.5 seconds: one `GET /api/jobs/{id}` per active job and one `GET /api/generations/{id}`. These requests read progress and stop when no jobs remain active; they do not enqueue generation or Qwen work. The session response already includes jobs, so consolidating these reads is a future optimization, not a cause of this validation failure.

## Earlier summary excerpt correction in 0.1.1

The model receives literal visual passages with introductions, Markdown headings, and list numbering removed. The renderer validates excerpts against the same passages. If a description contains only introductory text, the summary includes its recorded decision and reason without a visual claim. Saved summaries keep their existing text. Create a new session after updating the demo to verify the corrected selection.

The local suite passes 34 backend tests, including 15 focused summary regressions. A [private two-T4 Qwen regression](https://www.kaggle.com/code/badexample/ptdia-bedroom-summary-regression) selected the lighting and ceiling observations from descriptions containing the reported preamble, preserved the rejection reason, and omitted the visual claim for a description consisting only of that preamble.

To activate a new wheel in Kaggle, save the updated private notebook, stop the previous API cell, and start a fresh notebook session with T4 ×2. Run the three cells in order. Check that `/openapi.json` reports `info.version` as `0.3.1` and update the frontend's API origin if the tunnel changed. An existing failed summary can be retried without recreating its project.

## Post-grading purge

Stop the demo notebook and use the same database URL, Supabase URL, private bucket, and server secret key in a secure local environment. From `backend/`, run `uv run bedroom-purge` for a dry run, then `uv run bedroom-purge --apply` to remove all sprint sessions and their objects. Check that the command reports zero remaining sessions and that the private bucket is empty. If Storage was temporarily unavailable, retry after two minutes to allow deferred Storage rechecks to run. Remove the temporary demo Auth accounts from the Supabase dashboard after the purge.

## Luxury UTEC and the original Luxury model

Backend **0.2.0** defaults new sessions to the custom Luxury UTEC LoRA while retaining the original external Luxury adapter as a choice. The five style IDs/positions do not change. Select `luxury_model=pretrained` in the upload multipart, or use the versioned [model-switch endpoint](FRONTEND.md#luxury-model-choice-backend-020) in an existing session. The frontend exposes this choice when creating a project and on its Luxury card.

The public [custom-weight dataset](https://www.kaggle.com/datasets/badexample/plania-p2-luxury-utec-sdxl-lora) contains exactly `Luxury_UTEC_r8_step300.safetensors`, 46,615,272 bytes, SHA-256 `aad41fa2c1ab8a7b044a9e3acebb8651f562baa658f72262a99d242e4b5cc05b`. It was checked against the local handoff and published with Fabryzzio's training provenance and CreativeML Open RAIL++-M license text in the description. Training photos and other handoff files are not included. [Artifact manifest](kaggle/custom_lora.json).

**Upgrade an existing database:** apply [migration 002](migrations/002_luxury_model_choice.sql) once as the database owner before launching 0.2.0. It adds two JSON fields, preserving sessions, versions, permissions and private-schema exposure. Fresh installations apply **001 then 002**. Readiness/preflight checks require both migrations. The migration was applied to the shared `Interior Design AI` project and the backend role's access was verified.

Attach **both** the existing `jeffreyamc/plania-p2-jjs-luxury-bedroom-xl` dataset and `badexample/plania-p2-luxury-utec-sdxl-lora` to Kaggle. The bundle builder attaches both by default; repeat `--lora-dataset owner/slug` for each when overriding its inputs. Both Luxury hashes are checked before readiness. Keep the original dataset for existing sessions and the pretrained choice.

Custom settings start at trigger `luxbedstyle`, scale 0.8, strength 0.75, guidance 7.5, 25 steps and the recorded negative prompt. The production image padding remains unchanged; these settings do not establish superiority over SDXL base or guaranteed room-geometry preservation. No retraining is performed by this integration.

Switch jobs pin their requested profile; their published image and active profile change atomically after lease validation. Until successful, the old version/decision remain visible. Rejections, model switching, summaries and retries use the original photo. On failure, retry the same requested profile even after catalog changes or notebook restart. Historic versions and summaries read labels from saved version settings.

**Verified release:** [Luxury-choice smoke v1](https://www.kaggle.com/code/badexample/plania-bedroom-luxury-choice-smoke) completed on two T4s in 591.0 seconds, including initialization, five styles, pretrained/custom Luxury checks, regeneration, comparisons and Spanish summary. The custom hash and original hash matched the catalog, with one active adapter per generation. Custom Luxury generation took 18.8–21.2 s at 25 steps (9.0 GiB peak allocated); original Luxury took 32.8 s at 35 steps (9.41 GiB). The different step counts mean these are runtime measurements of the presets, not a controlled adapter-speed comparison. [Compact evidence](kaggle/luxury_choice_smoke_evidence.json).

The initial Luxury-choice delivery saved the [private demo notebook](https://www.kaggle.com/code/badexample/ptdia-bedroom-backend-demo) as **version 6**, with backend **0.2.0** and both datasets. Reporting was introduced in version 7/backend 0.3.0; the current package is 0.3.1 as described above. New projects default to Luxury UTEC; verify the selector switches only Luxury and shows a pending V2 before accepting it and requesting the new summary.

Local release checks: 41 backend tests with disposable PostgreSQL, 92 frontend tests, production build, old frontend fixture validation against SessionDetail, and browser→FastAPI→worker→PostgreSQL model-switch flow with controlled Auth/inference. The GPU smoke uses the identical final inference/catalog files; later service/UI review fixes were verified locally. A live authenticated Supabase/Kaggle API restart flow remains the operator's next demo check.

## Configure a future style

Copy [the default style catalog](src/bedroom_backend/styles.json) to a separate JSON file and point `BEDROOM_CATALOG` to it. Add the custom profile with its SDXL-compatible weights, trigger phrase, version or SHA-256, and inference parameters. If you copy an existing profile, replace or remove its SHA-256. Put its ID in one of the five positions of `active`. Keep any old adapters available while existing sessions can still regenerate against their saved settings. The API continues to return five variations.

## GPU smoke evidence

The [private Kaggle smoke run, version 4](https://www.kaggle.com/code/badexample/plania-bedroom-backend-smoke) completed on two Tesla T4s. It classified the fixture as a bedroom, produced all five styles with one active adapter per pass, regenerated Attic, and produced a grounded summary with five acceptances and the recorded Attic rejection. The model pins and adapter hashes are recorded in the code and catalog. The run used the model implementation delivered in branch commit `b7e710d`.

| Stage | Measured latency | Peak allocated GPU memory |
|---|---:|---:|
| SDXL per proposal, including adapter switch | 29.6–35.1 s | 9.41 GiB |
| Qwen comparison per proposal | 20.1–22.4 s | 8.78 GiB |
| Qwen decision summary | 48.7 s | 9.49 GiB |
| Cold smoke run, including model initialization and regeneration | 533.0 s | |

The five proposals and one regeneration totaled 5,180,265 bytes. With the resized JPEG fixture, this run represents about 5.23 MB of private image data before any additional versions. It used Kaggle's PyTorch 2.11.0+cu130 with Transformers 5.20.2, Diffusers 0.42.1, PEFT 0.21.2, and Accelerate 1.15.0. Model smoke output is separate from the end-to-end Supabase and ngrok demo checks above.
