CREATE INDEX IF NOT EXISTS idx_messages_channel_active
  ON messages(channel_id, id DESC, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_channels_active_kind
  ON channels(kind, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_groups_active
  ON user_groups(id)
  WHERE deleted_at IS NULL;
