BEGIN;
ALTER TABLE bedroom.slots ADD COLUMN profile_options jsonb NOT NULL DEFAULT '{}';
ALTER TABLE bedroom.jobs ADD COLUMN requested_profile jsonb;
COMMIT;
