-- Add last_active_at column to users table for online/offline presence tracking
ALTER TABLE users ADD COLUMN last_active_at TEXT;
UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE last_active_at IS NULL;
