-- WaveNova — Weigh Station v3.7: bottle cap count per weigh session (Mijily 瓶蓋回收)
-- Safe for staging and production. Constant default → metadata-only, no table rewrite.
-- Run on production BEFORE deploying the v3.7 code (new code selects cap_count).

ALTER TABLE weigh_sessions
  ADD COLUMN IF NOT EXISTS cap_count integer NOT NULL DEFAULT 0
  CONSTRAINT weigh_sessions_cap_count_nonneg CHECK (cap_count >= 0);

-- Make PostgREST pick up the new column immediately
NOTIFY pgrst, 'reload schema';

-- Verification: expect one row → cap_count | integer | 0 | NO
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'weigh_sessions' AND column_name = 'cap_count';
