ALTER TABLE user_groups ADD COLUMN allow_member_dm INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_dm IN (0, 1));
ALTER TABLE user_group_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member'));
