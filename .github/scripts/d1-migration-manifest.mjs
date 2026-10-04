export const D1_MIGRATIONS = [
  {
    id: "2026-04-05-private-groups",
    file: "worker/migrations/2026-04-05-private-groups.sql",
    artifacts: ["column:channel_members.role", "column:channel_members.invited_by"],
  },
  {
    id: "2026-04-09-registration-invites",
    file: "worker/migrations/2026-04-09-registration-invites.sql",
    artifacts: ["column:users.registration_invite_id", "table:registration_invites"],
  },
  {
    id: "2026-04-09-site-settings",
    file: "worker/migrations/2026-04-09-site-settings.sql",
    artifacts: ["table:site_settings"],
  },
  {
    id: "2026-04-12-channel-avatar",
    file: "worker/migrations/2026-04-12-channel-avatar.sql",
    artifacts: ["column:channels.avatar_key"],
  },
  {
    id: "2026-04-18-admin-session-version",
    file: "worker/migrations/2026-04-18-admin-session-version.sql",
    artifacts: ["column:users.is_admin", "column:users.session_version"],
  },
  {
    id: "2026-04-19-gc-maintenance",
    file: "worker/migrations/2026-04-19-gc-maintenance.sql",
    artifacts: ["table:pending_r2_delete"],
  },
  {
    id: "2026-07-02-message-read-badges",
    file: "worker/migrations/2026-07-02-message-read-badges.sql",
    artifacts: ["table:message_reads"],
  },
  {
    id: "2026-07-09-uploaded-files",
    file: "worker/migrations/2026-07-09-uploaded-files.sql",
    artifacts: ["table:uploaded_files", "index:idx_uploaded_files_owner"],
  },
  {
    id: "2026-07-28-general-channel",
    file: "worker/migrations/2026-07-28-general-channel.sql",
    artifacts: [
      "trigger:add_new_user_to_general",
      "trigger:prevent_general_member_removal",
      "trigger:protect_general_channel",
    ],
    rerunnable: true,
  },
  {
    id: "2026-07-29-registration-invite-usage",
    file: "worker/migrations/2026-07-29-registration-invite-usage.sql",
    artifacts: [
      "column:registration_invites.max_uses",
      "column:registration_invites.used_count",
      "table:registration_invite_uses",
      "trigger:validate_registration_invite_use",
      "trigger:consume_registration_invite_use",
      "index:idx_registration_invite_uses_invite",
      "index:idx_registration_invites_usage",
    ],
  },
  {
    id: "2026-08-12-telegram-bridge",
    file: "worker/migrations/2026-08-12-telegram-bridge.sql",
    artifacts: [
      "column:messages.sender_kind",
      "column:messages.external_sender_id",
      "column:messages.external_sender_name",
      "column:messages.external_sender_avatar_url",
      "column:messages.source",
      "column:messages.source_message_id",
      "table:telegram_bridge_config",
      "table:telegram_mappings",
      "index:idx_messages_external_source",
      "index:idx_telegram_mappings_channel",
    ],
  },
  {
    id: "2026-08-12-telegram-files",
    file: "worker/migrations/2026-08-12-telegram-files.sql",
    artifacts: [
      "column:messages.source_attachment_id",
      "column:messages.source_attachment_unique_id",
    ],
  },
  {
    id: "2026-08-17-e2ee-keys",
    file: "worker/migrations/2026-08-17-e2ee-keys.sql",
    artifacts: [
      "table:user_identity_keys",
      "table:user_encrypted_key_backups",
    ],
  },
  {
    id: "2026-08-18-user-last-active",
    file: "worker/migrations/2026-08-18-user-last-active.sql",
    artifacts: [
      "column:users.last_active_at",
    ],
  },
  {
    id: "2026-08-19-cleanup-settings",
    file: "worker/migrations/2026-08-19-cleanup-settings.sql",
    artifacts: [],
    rerunnable: true,
  },
  {
    id: "2026-08-19-message-edited-at",
    file: "worker/migrations/2026-08-19-message-edited-at.sql",
    artifacts: [
      "column:messages.edited_at",
    ],
  },
  {
    id: "2026-08-20-cloud-drive",
    file: "worker/migrations/2026-08-20-cloud-drive.sql",
    artifacts: [
      "table:drive_files",
      "table:drive_shares",
      "table:drive_app_passwords",
      "table:drive_user_credentials",
      "index:idx_drive_files_user_parent",
      "index:idx_drive_files_user_folder",
      "index:idx_drive_files_storage_key",
      "index:idx_drive_shares_file",
      "index:idx_drive_shares_user",
      "index:idx_drive_app_passwords_user",
    ],
  },
  {
    id: "2026-08-20-user-ban-expiry",
    file: "worker/migrations/2026-08-20-user-ban-expiry.sql",
    artifacts: [
      "column:users.disabled_until",
    ],
  },
  {
    id: "2026-08-22-drive-member-sharing",
    file: "worker/migrations/2026-08-22-drive-member-sharing.sql",
    artifacts: [
      "table:drive_member_shares",
      "index:idx_drive_member_shares_target",
      "index:idx_drive_member_shares_file",
      "index:idx_drive_member_shares_owner",
    ],
  },
  {
    id: "2026-08-23-announcements",
    file: "worker/migrations/2026-08-23-announcements.sql",
    artifacts: [
      "table:announcements",
      "index:idx_announcements_active",
    ],
  },
  {
    id: "2026-08-24-user-groups",
    file: "worker/migrations/2026-08-24-user-groups.sql",
    artifacts: [
      "table:user_groups",
      "table:user_group_members",
      "index:idx_user_group_members_user",
      "index:idx_user_group_members_group",
    ],
  },
  {
    id: "2026-08-30-invite-group",
    file: "worker/migrations/2026-08-30-invite-group.sql",
    artifacts: [
      "column:registration_invites.group_id",
    ],
  },
  {
    id: "2026-09-03-group-leader-dm-policy",
    file: "worker/migrations/2026-09-03-group-leader-dm-policy.sql",
    artifacts: [
      "column:user_groups.allow_member_dm",
      "column:user_group_members.role",
    ],
    rerunnable: true,
  },
  {
    id: "2026-09-03-performance-indexes",
    file: "worker/migrations/2026-09-03-performance-indexes.sql",
    artifacts: [
      "column:channels.pinned_message_id",
      "table:message_reactions",
      "index:idx_channel_members_user",
      "index:idx_messages_attachment_key",
      "index:idx_messages_created_at",
      "index:idx_users_avatar_key",
      "index:idx_channels_avatar_key",
      "index:idx_message_reactions_msg",
      "index:idx_drive_files_user_status",
    ],
    rerunnable: true,
  },
  {
    id: "2026-09-07-telegram-mapping-direction",
    file: "worker/migrations/2026-09-07-telegram-mapping-direction.sql",
    artifacts: [
      "column:telegram_mappings.sync_mode",
    ],
  },
  {
    id: "2026-09-08-read-optimization-indexes",
    file: "worker/migrations/2026-09-08-read-optimization-indexes.sql",
    artifacts: [
      "index:idx_messages_channel_active",
      "index:idx_channels_active_kind",
      "index:idx_user_groups_active",
    ],
    rerunnable: true,
  },
];
