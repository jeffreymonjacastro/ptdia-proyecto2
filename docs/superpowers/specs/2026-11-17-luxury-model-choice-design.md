# Luxury model choice

Agreed scope: publish a public Kaggle dataset containing only the custom tensor from `pesos_aporte_fabryzzio`; retain the original external dataset. New sessions default to the custom Luxury LoRA. Users can choose the pretrained alternative at creation and switch between both within a project. Exactly five style slots remain; other four proposals and all history are preserved. Switching generates a new pending Luxury version, invalidates summary/gallery and does not fabricate a rejection.

## Approach

Keep style ID `luxury`, with `custom` / `pretrained` model variants, separate profile settings and labels. Reuse durable regeneration jobs with an optional requested-profile snapshot, ownership/idempotency/lease checks and private image handling. Alternatives considered: a session-only flag (does not allow agreed in-project switching), a sixth style (violates five slots), or a new generation service (unnecessary).

API choices: multipart `luxury_model=custom|pretrained` defaults to custom. `PUT /api/generations/{id}/luxury-model` accepts `{variant, version_id}` and Idempotency-Key, returning 202 with a job or 200 for the current variant. Stale version, paused session or active session job gives 409. Profile choices are snapshotted per session; existing sessions preserve their current saved settings and acquire missing choices on first explicit switch. Jobs pin requested settings so catalog changes and restarts cannot alter retries.

Switching keeps the previous version/profile current until successful atomic publication. Failure keeps the old image/decision visible and exposes a retry for the same requested model. New version starts pending. UI shows two named choices only on Luxury, disables them during jobs/pauses, identifies each historical image with its saved label, and reuses polling, errors and gallery invalidation.

Dataset: `badexample/plania-p2-luxury-utec-sdxl-lora`, single file `Luxury_UTEC_r8_step300.safetensors`, SHA-256 `aad41fa2c1ab8a7b044a9e3acebb8651f562baa658f72262a99d242e4b5cc05b`. License/credit/model provenance belong in the dataset description; no photos or other folder contents are uploaded. Both datasets attach to smoke/demo notebooks. A finite two-T4 smoke checks all styles plus both Luxury adapters and isolation. No retraining.
