-- Web search by the model that keeps finding no new candidate is cut to once a day. From now on, `returned` of a
-- web search by the model counts the new candidates only: pages no earlier run settled, that could be fetched and
-- that fall within the window. Rows written before this migration counted every page the source returned. News
-- search still counts the results before the settled ones are left out.

-- When the user put a topic's web search by the model back to every run: only the attempts after
-- `after_attempt_id`, the last attempt on record at that time (0 when there was none), count towards cutting it
-- again. One row per topic, replaced by the next restore. Deleted with the topic.
CREATE TABLE llm_search_resets (
  topic_id INTEGER PRIMARY KEY REFERENCES topics (id) ON DELETE CASCADE,
  after_attempt_id INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);
