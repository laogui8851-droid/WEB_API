ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS assigned_to BIGINT;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS assigned_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

UPDATE invite_codes
SET assigned_name = ''
WHERE assigned_name IS NULL;

UPDATE invite_codes
SET note = ''
WHERE note IS NULL;