import assert from "node:assert/strict";
import test from "node:test";

import {
	listAdminChannels,
	listChannelMembers,
	listVisibleChannels,
} from "../worker/src/data/channels.js";
import { listAdminDms, listUserDms } from "../worker/src/data/dm-queries.js";
import { listMessages, mapMessage } from "../worker/src/data/messages.js";
import { getSiteSettings } from "../worker/src/data/site-settings.js";
import { countUnreadMessages, listRoomMemberIds } from "../worker/src/data/unread.js";
import { listAdminUsers } from "../worker/src/data/users.js";

function createQueryDb(results) {
	const capture = { sql: "", binds: [] };
	return {
		capture,
		db: {
			prepare(sql) {
				capture.sql = sql;
				return {
					bind(...binds) {
						capture.binds = binds;
						return this;
					},
					async all() {
						return { results };
					},
				};
			},
		},
	};
}

test("可见频道查询保持七个数值身份绑定与既有 projection", async () => {
	const { db, capture } = createQueryDb([
			{
				id: "9",
				name: "General",
				description: "",
				avatar_key: "avatars/a b.png",
				kind: "public",
				is_general: 1,
				owner_display_name: "Owner",
			is_member: 1,
			my_role: "member",
			can_manage: 0,
			member_count: "3",
			last_message_at: null,
			unread_count: "2",
		},
	]);

	const channels = await listVisibleChannels(db, "7");

	assert.deepEqual(capture.binds, [7, 7, 7, 7, 7, 7, 7]);
	assert.deepEqual(channels[0], {
		id: 9,
			name: "General",
			description: "",
			avatarKey: "avatars/a b.png",
		avatarUrl: "/files/avatars%2Fa%20b.png",
		kind: "public",
		isGeneral: true,
		isMuted: false,
		createdBy: null,
		ownerDisplayName: "Owner",
		isMember: true,
		myRole: "member",
		canManage: false,
		memberCount: 3,
		lastMessageAt: null,
		unreadCount: 2,
	});
	assert.match(capture.sql, /CASE WHEN c\.name = 'general' THEN 0 ELSE 1 END/);
});

	test("overview 频道 projection 不额外暴露头像字段", async () => {
		const { db, capture } = createQueryDb([
			{
				id: 1,
				name: "General",
				description: "",
				avatar_key: "secret-key",
				kind: "public",
				is_general: 1,
			created_at: "2026-07-23",
			owner_display_name: null,
			member_count: 2,
			message_count: 4,
		},
	]);

	const [channel] = await listAdminChannels(db, { includeAvatar: false });
	assert.equal("avatarKey" in channel, false);
	assert.equal("avatarUrl" in channel, false);
	assert.equal(channel.ownerDisplayName, "未知");
	assert.equal(channel.isGeneral, true);
	assert.match(capture.sql, /CASE WHEN c\.name = 'general' THEN 0 ELSE 1 END/);
});

test("DM 查询保持四个数值身份绑定", async () => {
	const { db, capture } = createQueryDb([]);
	await listUserDms(db, "12");
	assert.deepEqual(capture.binds, [12, 12, 12, 12]);
});

test("后台 DM projection 保持参与者、计数与时间字段", async () => {
	const { db } = createQueryDb([
		{
			id: "8",
			dm_key: "2:9",
			participants: "Alice / Bob",
			created_at: "2026-07-23",
			message_count: "4",
		},
	]);
	assert.deepEqual(await listAdminDms(db), [
		{
			id: 8,
			name: "2:9",
			participants: "Alice / Bob",
			createdAt: "2026-07-23",
			messageCount: 4,
		},
	]);
});

test("后台用户与频道成员 projection 保持稳定字段", async () => {
	const adminUsers = createQueryDb([
		{
			id: "2",
			username: "alice",
			display_name: "Alice",
			avatar_key: "a.png",
			is_disabled: "1",
			disabled_until: null,
			created_at: "2026-07-23",
			last_active_at: "2026-07-23 10:00:00",
		},
	]);
	assert.deepEqual((await listAdminUsers(adminUsers.db))[0], {
		id: 2,
		username: "alice",
		displayName: "Alice",
		avatarUrl: "/files/a.png",
		isAdmin: false,
		isDisabled: true,
		isPermanentlyDisabled: true,
		disabledUntil: null,
		createdAt: "2026-07-23",
		lastActiveAt: "2026-07-23T10:00:00Z",
	});

	const members = createQueryDb([
		{
			user_id: "2",
			username: "alice",
			display_name: "Alice",
			avatar_key: null,
			role: "owner",
			joined_at: "2026-07-23",
			last_active_at: "2026-07-23 10:00:00",
		},
	]);
	assert.deepEqual((await listChannelMembers(members.db, "6"))[0], {
		id: 2,
		username: "alice",
		displayName: "Alice",
		avatarUrl: "",
		role: "owner",
		isAdmin: false,
		joinedAt: "2026-07-23",
		lastActiveAt: "2026-07-23T10:00:00Z",
	});
	assert.deepEqual(members.capture.binds, [6]);
});

test("消息查询保持倒序 SQL、绑定顺序与升序 projection", async () => {
	const { db, capture } = createQueryDb([
		{
			id: "5",
			content: "new",
			created_at: "later",
			sender_id: 2,
			sender_username: "alice",
			sender_display_name: "Alice",
		},
		{
			id: "4",
			content: "old",
			created_at: "earlier",
			sender_id: 2,
			sender_username: "alice",
			sender_display_name: "Alice",
		},
	]);
	const messages = await listMessages({ DB: db }, "3", "9", "20");
	assert.deepEqual(capture.binds, [3, 9, 20]);
	assert.match(capture.sql, /ORDER BY m\.id DESC LIMIT \?/);
	assert.deepEqual(messages.map((message) => message.id), [4, 5]);
});

test("未读查询绑定稳定，成员 projection 排除禁用和删除用户", async () => {
	const unread = createQueryDb([{ unread_count: "7" }]);
	assert.equal(await countUnreadMessages(unread.db, { channelId: "3", userId: "2" }), 7);
	assert.deepEqual(unread.capture.binds, [3, 2, 3, 2]);

	const members = createQueryDb([{ user_id: "2" }, { user_id: "invalid" }]);
	assert.deepEqual(await listRoomMemberIds(members.db, "3"), [2]);
	assert.deepEqual(members.capture.binds, [3]);
	assert.match(members.capture.sql, /JOIN users u ON u\.id = cm\.user_id/);
	assert.match(members.capture.sql, /u\.is_disabled = 0/);
});

test("站点设置 projection 使用稳定默认值", async () => {
	const configured = createQueryDb([
		{ setting_key: "site_name", setting_value: "CFChat" },
		{ setting_key: "site_icon_url", setting_value: "/icon.png" },
		{ setting_key: "message_retention_days", setting_value: "15" },
		{ setting_key: "auto_cleanup_enabled", setting_value: "1" },
	]);
	assert.deepEqual(await getSiteSettings(configured.db), {
		siteName: "CFChat",
		siteIconUrl: "/icon.png",
		generalChannelHidden: false,
		generalChannelMuted: false,
		messageRetentionDays: 15,
		autoCleanupEnabled: true,
		deletionPolicy: "daily_reset_purge",
		uploadRestrictionMode: "none",
		uploadAllowedTypes: "image/*, video/*, audio/*, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, zip, 7z, tar, gz",
		uploadBlockedTypes: "exe, bat, cmd, sh, php",
		uploadMaxFileSizeMb: 20,
		callsEnabled: false,
		callsAppId: "",
		callsAppSecretConfigured: false,
		callsAppSource: "none",
		storageType: "r2",
		storageAccountId: "",
		storageBucketName: "edgechat-files",
		storageAccessKeyId: "",
		storageSecretAccessKeyConfigured: false,
		storageEndpoint: "",
		storageRegion: "auto",
		storagePublicDomain: "",
		storageSource: "binding",
		gdriveClientId: "",
		gdriveClientSecretConfigured: false,
		gdriveRefreshTokenConfigured: false,
		gdriveFolderId: ""
	});
	const defaults = createQueryDb([]);
	assert.deepEqual(await getSiteSettings(defaults.db), {
		siteName: "Edgechat",
		siteIconUrl: "",
		generalChannelHidden: false,
		generalChannelMuted: false,
		messageRetentionDays: 7,
		autoCleanupEnabled: true,
		deletionPolicy: "daily_reset_purge",
		uploadRestrictionMode: "none",
		uploadAllowedTypes: "image/*, video/*, audio/*, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, zip, 7z, tar, gz",
		uploadBlockedTypes: "exe, bat, cmd, sh, php",
		uploadMaxFileSizeMb: 20,
		callsEnabled: false,
		callsAppId: "",
		callsAppSecretConfigured: false,
		callsAppSource: "none",
		storageType: "r2",
		storageAccountId: "",
		storageBucketName: "edgechat-files",
		storageAccessKeyId: "",
		storageSecretAccessKeyConfigured: false,
		storageEndpoint: "",
		storageRegion: "auto",
		storagePublicDomain: "",
		storageSource: "binding",
		gdriveClientId: "",
		gdriveClientSecretConfigured: false,
		gdriveRefreshTokenConfigured: false,
		gdriveFolderId: ""
	});
});

test("消息 projection 保持附件和发送者字段", () => {
	assert.deepEqual(
		mapMessage({
			id: "5",
			content: "hello",
			created_at: "2026-07-23",
			sender_id: "2",
			sender_username: "alice",
			sender_display_name: "Alice",
			sender_avatar_key: "avatar.png",
			attachment_key: "files/a b.txt",
			attachment_name: "a b.txt",
			attachment_type: "text/plain",
				attachment_size: "10",
				source_attachment_id: null,
				source_attachment_unique_id: null,
		}),
			{
				id: 5,
				content: "hello",
				createdAt: "2026-07-23",
				source: "edgechat",
				sender: {
					kind: "local",
					id: 2,
					username: "alice",
					displayName: "Alice",
					avatarUrl: "/files/avatar.png",
					source: "edgechat",
					isAdmin: false,
					isOwner: false,
				},
			attachment: {
				key: "files/a b.txt",
				name: "a b.txt",
				type: "text/plain",
				size: 10,
				url: "/files/files%2Fa%20b.txt",
			},
		},
	);
});

test("消息与频道成员 projection 正确识别群主与管理员身份", async () => {
	// 1. 群主 (创建者且非 DM)
	const ownerMsg = mapMessage({
		id: 1,
		content: "hello from owner",
		created_at: "2026-07-23",
		sender_id: 2,
		sender_username: "alice",
		sender_display_name: "Alice",
		sender_is_admin: 0,
		channel_kind: "public",
		channel_created_by: 2,
	});
	assert.equal(ownerMsg.sender.isOwner, true);
	assert.equal(ownerMsg.sender.isAdmin, false);

	// 2. 超级管理员 (非群主)
	const adminMsg = mapMessage({
		id: 2,
		content: "hello from admin",
		created_at: "2026-07-23",
		sender_id: 3,
		sender_username: "bob",
		sender_display_name: "Bob",
		sender_is_admin: 1,
		channel_kind: "public",
		channel_created_by: 2,
	});
	assert.equal(adminMsg.sender.isOwner, false);
	assert.equal(adminMsg.sender.isAdmin, true);

	// 3. 既是群主又是管理员
	const ownerAdminMsg = mapMessage({
		id: 3,
		content: "hello from owner & admin",
		created_at: "2026-07-23",
		sender_id: 2,
		sender_username: "alice",
		sender_display_name: "Alice",
		sender_is_admin: 1,
		channel_kind: "private",
		channel_created_by: 2,
	});
	assert.equal(ownerAdminMsg.sender.isOwner, true);
	assert.equal(ownerAdminMsg.sender.isAdmin, true);

	// 4. DM 私聊不显示群主
	const dmMsg = mapMessage({
		id: 4,
		content: "hello in dm",
		created_at: "2026-07-23",
		sender_id: 2,
		sender_username: "alice",
		sender_display_name: "Alice",
		sender_is_admin: 0,
		channel_kind: "dm",
		channel_created_by: 2,
	});
	assert.equal(dmMsg.sender.isOwner, false);
	assert.equal(dmMsg.sender.isAdmin, false);

	// 5. 外部发送者（如 Telegram）不识别群主与管理员
	const externalMsg = mapMessage({
		id: 5,
		content: "hello from telegram",
		created_at: "2026-07-23",
		sender_kind: "external",
		source: "telegram",
		external_sender_id: "12345",
		external_sender_name: "TG User",
		sender_is_admin: 1,
		channel_kind: "public",
		channel_created_by: 12345,
	});
	assert.equal(externalMsg.sender.isOwner, false);
	assert.equal(externalMsg.sender.isAdmin, false);

	// 6. listChannelMembers 正确映射 isAdmin
	const adminMembersDb = createQueryDb([
		{
			user_id: "1",
			username: "superadmin",
			display_name: "Admin",
			avatar_key: null,
			role: "member",
			joined_at: "2026-07-23",
			last_active_at: "2026-07-23 10:00:00",
			is_admin: 1,
		},
	]);
	const [adminMember] = await listChannelMembers(adminMembersDb.db, "6");
	assert.equal(adminMember.isAdmin, true);
});
