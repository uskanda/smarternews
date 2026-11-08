-- What a model call was made for, beyond its task. NULL for the uses that came before this column: runs,
-- summaries, translations, proposals of selectors and digests, which the task tells apart. 'trial' for a call of
-- a topic trial, which uses the interpret and judge tasks of runs and has an allowance of its own.
ALTER TABLE llm_calls ADD COLUMN purpose TEXT CHECK (purpose IN ('trial'));
