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
