# Frontend integration

Use the Bedroom Backend for the upload and review flow. The older text chat under `poc/khipu_front/` uses a different API contract.

## Connect and sign in

Ask the backend owner for three values: the **current ngrok origin** (without `/docs`), the **Supabase project URL**, and the **Supabase publishable key**. Configure these as frontend environment values. The backend owner also provisions the test accounts and shares their passwords privately. Database credentials, the Supabase secret key, and Kaggle secrets belong on the backend.

- Set up the browser Supabase client with the project URL and publishable key. Use `supabase.auth.signInWithPassword({ email, password })` for the pre-created accounts. Read the current session's `access_token` when calling FastAPI so a refresh takes effect. Send it as `Authorization: Bearer <access_token>` on every `/api/` request, including image requests. [Supabase sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword) · [Supabase session retrieval](https://supabase.com/docs/reference/javascript/auth-getsession)
- For calls to the ngrok backend, send `ngrok-skip-browser-warning: true`. The demo permits `http://localhost:5173` by default. If Vite chooses a different port, or you use a deployed frontend, ask the backend owner to add the exact browser origin to `BEDROOM_ORIGINS` and restart the API.
- Check `GET /health` for `200 {"status":"ready"}`. Use `/docs` to try requests and `/openapi.json` for request and response schemas. In Swagger, paste participant A's access token into **Authorize** without a `Bearer` prefix. The tunnel may change after a Kaggle restart. Update the API origin and reopen existing sessions by ID.

## Request contract

Every route below uses the `/api` prefix. In the table, `{id}` is the generation session ID. `{version_id}` identifies an immutable version and `{position}` is the style slot index from 1 through 5.

| Method and path | Input and successful response |
|---|---|
| `POST /generations` | Multipart `image`, `consent=true`, and optional `preferences` (up to 2,000 characters). Still JPEG, PNG, or WebP, up to 10 MiB and 25 MP. Returns `202 {session_id, job_id}`. |
| `GET /generations` | Returns `200` with an array of the signed-in user's sessions, newest first. Each item has `id`, `status`, `revision`, and `created_at`. |
| `GET /generations/{id}` | Returns `200` with the session, `original_image_url`, `variations`, `jobs`, and `summary`. |
| `GET /jobs/{job_id}` | Returns `200` with `id`, `session_id`, `kind`, `status`, `position`, `progress`, and `error`. |
| `GET /generations/{id}/original`, `GET /generations/{id}/versions/{version_id}/image` | Returns `200` with private image bytes. |
| `POST /generations/{id}/confirm-bedroom`, `POST /generations/{id}/retry` | Empty body. Confirm an uncertain bedroom or retry a failed initial batch, respectively. Returns `202 {session_id, job_id}`. |
| `PUT /generations/{id}/decisions/{version_id}` | JSON `{"decision":"accepted"}` or `{"decision":"rejected","reason":"Conservar el techo"}`. The optional reason can contain up to 1,000 characters. Returns `200 {session_id, version_id, decision}` for acceptance or a no-op, and `202` with the same fields plus `job_id` when regeneration is queued. |
| `POST /generations/{id}/variations/{position}/retry` | Empty body. Retries a failed regeneration for the currently rejected version at that position. Returns `202 {session_id, job_id}`. |
| `POST /generations/{id}/summary` | Empty body. Returns `202 {session_id, job_id}` while the summary is queued or running, or `200` with the saved summary object for the current revision. |
| `PATCH /generations/{id}` | JSON `{"paused":true}` or `{"paused":false}`. Available for ready, completed, or paused sessions with no active job. Returns `200 {id, status}`. |
| `DELETE /generations/{id}` | Returns `202 {session_id, status: "deleting"}`. Remove the session from history immediately. Cleanup runs in the background and its job is hidden from the client. |

Every `POST` and the decision `PUT` require an `Idempotency-Key`. Generate a UUID once per user action. Reuse it when retrying an identical request after a timeout or disconnect. Use a fresh key for a new action, including the explicit retry after a job has failed. A replay can return the original job ID even after that job finishes. Fetch the session to see its current state.

For upload, use browser `FormData` and let `fetch` set its multipart `Content-Type` and boundary.

## Render the review flow

1. **Generate.** Poll `GET /api/jobs/{job_id}` every few seconds while the job is `queued` or `running`. Treat `progress` as approximate. Stop polling on `succeeded` or `failed` and reload the session. The initial job can succeed with `needs_confirmation`; ask the user to confirm before calling `confirm-bedroom`. A session marked `rejected` needs a different photo. A session marked `failed` can use the initial retry route. The initial batch appears together once all five images are ready.
2. **Show proposals.** Use `variations` ordered by `position` and show the backend-provided `label`. Each slot has `style_id`, `current_version_id`, and a `versions` array. Match `current_version_id` to a version's `id` to render the active card. A null `decision` means pending. Use the version's `description` and `image_url`; keep `seed` as a string if displayed or stored in JavaScript.
3. **Load private images.** Resolve `original_image_url` and `image_url` against the configured API origin. Fetch each with the bearer and ngrok headers, convert the response to a Blob, and display it with `URL.createObjectURL(blob)`. Revoke object URLs when their image is replaced, the component unmounts, or the user signs out.
4. **Accept or regenerate.** Send decisions against the current version ID. When rejection queues a job, show progress and disable decision controls for that slot while its job is active. Use the job's `position` to identify the slot. The session can remain `ready` during regeneration. On success, reload and show the new pending version in the same slot. On failure, keep the rejected version visible and offer the slot retry. Other slots retain their version IDs, images, and decisions. On reload, use the session's `jobs` list to resume polling any outstanding work.
5. **Summarize.** Enable the summary action after all five current versions are accepted. If the request returns `202`, poll the summary job and reload the session. Display the Spanish text at `session.summary.summary` when `session.summary.revision === session.revision`. The summary also includes accepted and rejected version IDs and `historical_rejections` for earlier rejection events. An accepted version can also appear in the historical list if a previous rejection was reversed. A later decision or version invalidates the previous summary.

A five-style run can take several minutes on Kaggle. Let users leave and reopen the page while jobs run. On return, fetch the session and resume polling its queued or running jobs.

## Handle errors and verify the browser flow

| Response | Frontend behavior |
|---|---|
| `401` | Refresh the Supabase session or prompt for sign-in. |
| `404` | Treat the session, job, or image as unavailable. This also covers records owned by another account. |
| `409` | Inspect `detail` and reload the session before offering a new action. Common causes include stale versions, in-flight regeneration, insufficient acceptances, or reuse of an idempotency key with different input. |
| `413` or `422` | Show upload or field validation feedback. Application errors have a string `detail`; FastAPI field validation returns a list in `detail`. |
| `503`, a network error, or an ngrok interstitial | Check readiness and the current tunnel. Retry reads when the backend is reachable. Reuse the original key for a write whose outcome is unknown. |

Run the full flow from the browser with participant A: upload, see five cards, reject one, check that the other four stay unchanged, accept the five current proposals, and read the Spanish summary. Reload the page and reopen the session from history. With participant B, confirm that A's session, job, and image URLs return `404`. For the separate command-line and Kaggle-restart checks, use the [backend runbook](README.md#exercise-the-frontend-contract).
