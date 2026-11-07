-- Which of the program's reasons rejected a candidate. NULL for the candidates the judge rejected, whose reason
-- comes from the model, and for those that are pending or accepted. The stats of a topic count rejections by it.
ALTER TABLE candidates ADD COLUMN reason_code TEXT
  CHECK (reason_code IN ('no-date', 'below-minimum', 'over-limit', 'event-outside-window', 'event-no-date'));

-- The candidates kept so far carry the program's reasons only as text, in Japanese or in English. These are the
-- texts of `pipeline/reasons.ts`, which a test holds this file to.
UPDATE candidates SET reason_code = 'no-date'
 WHERE status = 'rejected' AND reason IN ('公開日時が不明', 'publication time unknown');
UPDATE candidates SET reason_code = 'below-minimum'
 WHERE status = 'rejected' AND reason IN ('重要度が基準未満', 'importance below the category minimum');
UPDATE candidates SET reason_code = 'over-limit'
 WHERE status = 'rejected' AND reason IN ('件数上限', 'over the article limit of the run');
UPDATE candidates SET reason_code = 'event-outside-window'
 WHERE status = 'rejected' AND reason IN ('開催日が対象期間の外', 'event date outside the window');
UPDATE candidates SET reason_code = 'event-no-date'
 WHERE status = 'rejected' AND reason IN ('開催日を確認できない', 'event date could not be confirmed');

-- The stats of a topic count its candidates of the last 30 days.
CREATE INDEX candidates_category_created ON candidates (category_id, created_at);
