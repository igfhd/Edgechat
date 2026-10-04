ALTER TABLE telegram_mappings
  ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'both'
  CHECK (sync_mode IN ('both', 'to_telegram', 'from_telegram'));
