BEGIN;
ALTER TABLE bedroom.jobs
    ADD COLUMN origin text NOT NULL DEFAULT 'legacy' CHECK (origin IN (
        'legacy', 'upload', 'confirmation', 'initial_retry', 'rejection',
        'regeneration_retry', 'model_switch', 'summary', 'delete'
    )),
    ADD COLUMN retry_of uuid REFERENCES bedroom.jobs ON DELETE SET NULL,
    ADD COLUMN started_at timestamptz,
    ADD COLUMN finished_at timestamptz,
    ADD COLUMN metrics jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(metrics) = 'array' AND jsonb_array_length(metrics) <= 64),
    ADD COLUMN metrics_truncated boolean NOT NULL DEFAULT false;
COMMIT;
