-- Model costs: what each call used and cost, and which allowance stopped a run.

-- Token counts and web searches as the provider reported them, and the cost the server worked out from its unit
-- prices, in US dollars. All are empty for adapters that report no usage, and for a call that ended without an
-- answer (a time-out or an abort).
ALTER TABLE llm_calls ADD COLUMN input_tokens INTEGER;
ALTER TABLE llm_calls ADD COLUMN output_tokens INTEGER;
ALTER TABLE llm_calls ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE llm_calls ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE llm_calls ADD COLUMN web_searches INTEGER;
ALTER TABLE llm_calls ADD COLUMN cost_usd REAL;
-- 1 for a call to a provider that costs money. Such a call without a cost is one whose cost is unknown.
ALTER TABLE llm_calls ADD COLUMN billable INTEGER NOT NULL DEFAULT 0;

-- The allowance a run stopped by limit ran into. Empty for every other run, and for runs stopped before this.
ALTER TABLE runs ADD COLUMN stopped_by TEXT CHECK (stopped_by IN ('run', 'day', 'budget'));
