ALTER TABLE registration_invites ADD COLUMN group_id INTEGER REFERENCES user_groups(id) ON DELETE SET NULL;
