PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  avatar_key TEXT,
  registration_invite_id INTEGER UNIQUE,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  disabled_until TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  session_version INTEGER NOT NULL DEFAULT 0,
  last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  avatar_key TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('public', 'private', 'dm')),
  dm_key TEXT UNIQUE,
  created_by INTEGER,
  pinned_message_id INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  invited_by INTEGER,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

INSERT OR IGNORE INTO channels (name, description, kind, created_by)
VALUES ('general', '', 'public', NULL);

-- schema 可能会重复执行，幂等回填可顺手修复历史账号缺失的 general 成员关系。
INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
SELECT c.id, u.id, 'member', NULL
FROM channels c
CROSS JOIN users u
WHERE c.name = 'general'
  AND c.kind = 'public'
  AND c.deleted_at IS NULL
  AND u.deleted_at IS NULL;

-- 从数据库入口覆盖所有未来的建号路径，防止新入口忘记同步系统群成员关系。
CREATE TRIGGER IF NOT EXISTS add_new_user_to_general
AFTER INSERT ON users
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
  SELECT id, NEW.id, 'member', NULL
  FROM channels
  WHERE name = 'general'
    AND kind = 'public'
    AND deleted_at IS NULL;
END;

-- general 必须永久保留全部成员，数据库层兜底阻止任何遗漏的删除路径破坏不变量。
CREATE TRIGGER IF NOT EXISTS prevent_general_member_removal
BEFORE DELETE ON channel_members
WHEN EXISTS (
  SELECT 1
  FROM channels
  WHERE id = OLD.channel_id
    AND name = 'general'
)
BEGIN
  SELECT RAISE(ABORT, 'GENERAL_MEMBERSHIP_REQUIRED');
END;

-- 名称、公开属性和存活状态共同标识系统群，禁止绕过 API 改名、转私有或软删除。
CREATE TRIGGER IF NOT EXISTS protect_general_channel
BEFORE UPDATE OF name, kind, deleted_at ON channels
WHEN OLD.name = 'general'
  AND (
    NEW.name != 'general'
    OR NEW.kind != 'public'
    OR NEW.deleted_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'GENERAL_CHANNEL_REQUIRED');
END;

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  sender_id INTEGER,
  content TEXT NOT NULL DEFAULT '',
  attachment_key TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size INTEGER,
  sender_kind TEXT NOT NULL DEFAULT 'local' CHECK (sender_kind IN ('local', 'external')),
  external_sender_id TEXT,
  external_sender_name TEXT,
  external_sender_avatar_url TEXT,
  source TEXT NOT NULL DEFAULT 'edgechat',
  source_message_id TEXT,
  source_attachment_id TEXT,
  source_attachment_unique_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,
  CHECK (
    (sender_kind = 'local' AND sender_id IS NOT NULL)
    OR (sender_kind = 'external' AND sender_id IS NULL)
  ),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS message_reads (
  channel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registration_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  group_id INTEGER,
  created_by INTEGER,
  consumed_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (consumed_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS registration_invite_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_id INTEGER NOT NULL,
  user_id INTEGER,
  used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (invite_id, user_id),
  FOREIGN KEY (invite_id) REFERENCES registration_invites(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 校验和计数必须留在数据库事务内，防止并发注册同时消耗最后一次额度。
CREATE TRIGGER IF NOT EXISTS validate_registration_invite_use
BEFORE INSERT ON registration_invite_uses
BEGIN
  SELECT CASE
    WHEN NEW.user_id IS NULL THEN RAISE(ABORT, 'REGISTRATION_INVITE_USER_REQUIRED')
    WHEN NOT EXISTS (
      SELECT 1
      FROM registration_invites
      WHERE id = NEW.invite_id
        AND deleted_at IS NULL
        AND used_count < max_uses
    ) THEN RAISE(ABORT, 'REGISTRATION_INVITE_UNAVAILABLE')
  END;
END;

CREATE TRIGGER IF NOT EXISTS consume_registration_invite_use
AFTER INSERT ON registration_invite_uses
BEGIN
  UPDATE registration_invites
  SET used_count = used_count + 1,
      consumed_by_user_id = NEW.user_id,
      consumed_at = CASE
        WHEN used_count + 1 >= max_uses THEN CURRENT_TIMESTAMP
        ELSE NULL
      END
  WHERE id = NEW.invite_id;
END;

CREATE TABLE IF NOT EXISTS uploaded_files (
  object_key TEXT PRIMARY KEY,
  owner_user_id INTEGER NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pending_r2_delete (
  object_key TEXT PRIMARY KEY,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_bridge_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bot_token_ciphertext TEXT NOT NULL,
  webhook_secret_ciphertext TEXT NOT NULL,
  bot_username TEXT NOT NULL DEFAULT '',
  webhook_url TEXT NOT NULL DEFAULT '',
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS telegram_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL UNIQUE,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  telegram_chat_title TEXT NOT NULL DEFAULT '',
  sync_mode TEXT NOT NULL DEFAULT 'both' CHECK (sync_mode IN ('both', 'to_telegram', 'from_telegram')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_identity_keys (
  user_id INTEGER PRIMARY KEY,
  public_key TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_encrypted_key_backups (
  user_id INTEGER PRIMARY KEY,
  encrypted_private_key TEXT NOT NULL,
  backup_salt TEXT NOT NULL,
  backup_iv TEXT NOT NULL DEFAULT '',
  key_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO site_settings (setting_key, setting_value)
VALUES ('site_name', 'Edgechat');

INSERT OR IGNORE INTO site_settings (setting_key, setting_value)
VALUES ('site_icon_url', '');

INSERT OR IGNORE INTO site_settings (setting_key, setting_value)
VALUES ('message_retention_days', '7');

INSERT OR IGNORE INTO site_settings (setting_key, setting_value)
VALUES ('auto_cleanup_enabled', '1');

CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messages(channel_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_channel_active
  ON messages(channel_id, id DESC, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender_created
  ON messages(sender_id, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_source
  ON messages(source, source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reads_user
  ON message_reads(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_channels_kind
  ON channels(kind, id DESC);

CREATE INDEX IF NOT EXISTS idx_channels_active_kind
  ON channels(kind, id DESC)
  WHERE deleted_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users(username);

CREATE INDEX IF NOT EXISTS idx_registration_invites_active
  ON registration_invites(created_at DESC, deleted_at, consumed_at);

CREATE INDEX IF NOT EXISTS idx_registration_invites_usage
  ON registration_invites(deleted_at, used_count, max_uses, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registration_invite_uses_invite
  ON registration_invite_uses(invite_id, used_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_r2_delete_next_retry
  ON pending_r2_delete(next_retry_at, retry_count);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_owner
  ON uploaded_files(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_mappings_channel
  ON telegram_mappings(channel_id, enabled, id);

CREATE TABLE IF NOT EXISTS drive_files (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  is_folder INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  hash TEXT,
  storage_key TEXT,
  backend TEXT NOT NULL DEFAULT 'r2',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES drive_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drive_files_user_parent ON drive_files(user_id, parent_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_drive_files_user_folder ON drive_files(user_id, is_folder);
CREATE INDEX IF NOT EXISTS idx_drive_files_storage_key ON drive_files(storage_key);
CREATE INDEX IF NOT EXISTS idx_drive_files_user_status ON drive_files(user_id, status, deleted_at, is_folder);

CREATE TABLE IF NOT EXISTS drive_shares (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at TEXT,
  password_hash TEXT,
  password_salt TEXT,
  permission TEXT NOT NULL DEFAULT 'view',
  max_file_size INTEGER,
  max_total_bytes INTEGER,
  allow_subfolders INTEGER NOT NULL DEFAULT 0,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES drive_files(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drive_shares_file ON drive_shares(file_id);
CREATE INDEX IF NOT EXISTS idx_drive_shares_user ON drive_shares(user_id);

CREATE TABLE IF NOT EXISTS drive_app_passwords (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drive_app_passwords_user ON drive_app_passwords(user_id);

CREATE TABLE IF NOT EXISTS drive_user_credentials (
  user_id INTEGER PRIMARY KEY,
  storage_type TEXT NOT NULL DEFAULT 'r2',
  encrypted_config TEXT NOT NULL,
  iv TEXT NOT NULL,
  storage_quota_bytes INTEGER NOT NULL DEFAULT 10737418240,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drive_member_shares (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'user',
  target_id INTEGER NOT NULL,
  permission TEXT NOT NULL DEFAULT 'read',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES drive_files(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drive_member_shares_target ON drive_member_shares(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_drive_member_shares_file ON drive_member_shares(file_id);
CREATE INDEX IF NOT EXISTS idx_drive_member_shares_owner ON drive_member_shares(owner_id);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  creator_id INTEGER NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON announcements(is_active, is_pinned, priority DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS user_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  allow_member_dm INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_dm IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_groups_active
  ON user_groups(id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS user_group_members (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_group_members_user ON user_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_user_group_members_group ON user_group_members(group_id);

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

CREATE INDEX IF NOT EXISTS idx_message_reactions_msg
  ON message_reactions(message_id);
