-- 站内成员/群组网盘协同分享授权表
CREATE TABLE IF NOT EXISTS drive_member_shares (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'user', -- 'user' | 'room'
  target_id INTEGER NOT NULL,               -- 接收方 user_id 或 channel_id
  permission TEXT NOT NULL DEFAULT 'read',  -- 'read' (只读下载), 'write' (读写协同/上传), 'admin' (完全管理)
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES drive_files(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drive_member_shares_target ON drive_member_shares(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_drive_member_shares_file ON drive_member_shares(file_id);
CREATE INDEX IF NOT EXISTS idx_drive_member_shares_owner ON drive_member_shares(owner_id);
