ALTER TABLE channels ADD COLUMN pinned_message_id INTEGER DEFAULT NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reaction TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, user_id, reaction),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_channel_members_user
  ON channel_members(user_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_messages_attachment_key
  ON messages(attachment_key)
  WHERE attachment_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_created_at
  ON messages(created_at);

CREATE INDEX IF NOT EXISTS idx_users_avatar_key
  ON users(avatar_key)
  WHERE avatar_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channels_avatar_key
  ON channels(avatar_key)
  WHERE avatar_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reactions_msg
  ON message_reactions(message_id);

CREATE INDEX IF NOT EXISTS idx_drive_files_user_status
  ON drive_files(user_id, status, deleted_at, is_folder);
