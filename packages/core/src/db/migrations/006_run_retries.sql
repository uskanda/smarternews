-- Retries of failed runs. A retry is a run of its own: it keeps the trigger `schedule`, has no slot, and
-- points at the scheduled run it retries.

-- Which retry this run is. 0 for a run that is not a retry.
ALTER TABLE runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
-- The scheduled run this one retries, however many retries came between. NULL for a run that is not a retry.
ALTER TABLE runs ADD COLUMN retry_of INTEGER REFERENCES runs (id) ON DELETE SET NULL;
-- When the retry of this failed run is due. NULL when none is planned, and once the retry was queued.
ALTER TABLE runs ADD COLUMN retry_at TEXT;
-- Why this failed run is not retried. NULL while a retry is planned, and for a run that did not fail.
ALTER TABLE runs ADD COLUMN retry_skipped TEXT CHECK (retry_skipped IN ('limit', 'superseded', 'disabled', 'manual'));
CREATE INDEX runs_retry_at ON runs (retry_at) WHERE retry_at IS NOT NULL;
