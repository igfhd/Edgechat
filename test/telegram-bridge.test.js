import assert from "node:assert/strict";
import test from "node:test";

import {
	createTelegramMapping,
	listEnabledTelegramMappingsForChannel,
	listTelegramBridgeAdminState,
	updateTelegramMapping,
} from "../worker/src/data/telegram.js";
import { insertExternalMessage, mapMessage } from "../worker/src/data/messages.js";
import {
	decryptAttachment,
	decryptMessageContent,
	decryptSecretValue,
	encryptMessageContent,
	encryptSecretValue,
} from "../worker/src/encryption.js";
import { parseTelegramMessageUpdate } from "../worker/src/integrations/telegram/parser.js";
import {
	formatTelegramMessage,
	splitTelegramFormattedMessage,
} from "../worker/src/integrations/telegram/bridge.js";
import { sendTelegramMedia, setTelegramWebhook } from "../worker/src/integrations/telegram/client.js";
import {
	importTelegramAttachment,
	loadEdgeChatAttachment,
	TELEGRAM_BRIDGE_FILE_LIMIT,
	TELEGRAM_FILE_SKIP_REASON,
} from "../worker/src/integrations/telegram/files.js";
import worker from "../worker/src/index.js";

const keyring = JSON.stringify({
	activeKeyId: "v1",
	keys: {
		v1: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString(
			"base64",
		),
	},
});

test("Telegram 文字消息转换为稳定的外部发送者模型", () => {
	assert.deepEqual(
		parseTelegramMessageUpdate({
			message: {
				message_id: 9,
				text: "hello 👋",
				chat: { id: -100123, title: "Bridge room" },
				from: { id: 42, first_name: "Alice", last_name: "Chen", is_bot: false },
			},
		}),
		{
				telegramChatId: "-100123",
				telegramChatTitle: "Bridge room",
				telegramMessageId: 9,
				sourceMessageId: "-100123:9",
				content: "hello 👋",
				attachment: null,
			sender: { id: "42", displayName: "Alice Chen", avatarUrl: "" },
		},
	);
	assert.equal(parseTelegramMessageUpdate({ message: { text: "bot", from: { is_bot: true } } }), null);
});

test("Telegram 图片、视频与普通文件保留原始元数据", () => {
	const base = {
		message_id: 10,
		caption: "说明",
		chat: { id: -100123, title: "Bridge room" },
		from: { id: 42, first_name: "Alice", is_bot: false },
	};
	const photo = parseTelegramMessageUpdate({
		message: {
			...base,
			photo: [
				{ file_id: "small", file_unique_id: "small-u", file_size: 100 },
				{ file_id: "large", file_unique_id: "large-u", file_size: 200 },
			],
		},
	});
	assert.deepEqual(photo.attachment, {
		kind: "photo",
		fileId: "large",
		fileUniqueId: "large-u",
		fileName: "photo-10.jpg",
		mimeType: "image/jpeg",
		fileSize: 200,
	});
	const video = parseTelegramMessageUpdate({
		message: {
			...base,
			video: {
				file_id: "video",
				file_unique_id: "video-u",
				file_name: "clip.mp4",
				mime_type: "video/mp4",
				file_size: 300,
			},
		},
	});
	assert.equal(video.attachment.kind, "video");
	assert.equal(video.attachment.fileName, "clip.mp4");
	const document = parseTelegramMessageUpdate({
		message: {
			...base,
			document: {
				file_id: "document",
				file_unique_id: "document-u",
				file_name: "report.pdf",
				mime_type: "application/pdf",
				file_size: 400,
			},
		},
	});
	assert.equal(document.attachment.kind, "document");
	assert.equal(document.content, "说明");
});

test("EdgeChat 出站消息使用粗体用户名、紧邻正文的换行和 HTML 转义", () => {
	assert.equal(
		formatTelegramMessage('Alice & Bob', '<hello> "world"'),
		'<b>Alice &amp; Bob:</b>\n&lt;hello&gt; &quot;world&quot;',
	);
	const chunks = splitTelegramFormattedMessage("Alice", `${"a".repeat(4081)}👋b`, 4096);
	assert.equal(chunks.length, 2);
	assert.equal(Array.from(chunks[0]).length <= 4096, true);
	assert.equal(chunks[0].endsWith("👋"), true);
	assert.equal(chunks[1], "<b>Alice:</b>\nb");
});

test("Telegram 媒体上传按类型构造 multipart 请求", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return Response.json({ ok: true, result: { message_id: 1 } });
	};
	try {
		await sendTelegramMedia("123:token", {
			chatId: "-1001",
			kind: "video",
			bytes: Uint8Array.from([1, 2, 3]),
			filename: "clip.mp4",
			contentType: "video/mp4",
			caption: "<b>Alice:</b>\nhello",
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.match(captured.url, /\/sendVideo$/);
	assert.equal(captured.init.method, "POST");
	assert.equal(captured.init.headers, undefined);
	assert.equal(captured.init.body.get("chat_id"), "-1001");
	assert.equal(captured.init.body.get("parse_mode"), "HTML");
	assert.equal(captured.init.body.get("caption"), "<b>Alice:</b>\nhello");
	assert.equal(captured.init.body.get("video").name, "clip.mp4");
});

test("Telegram 入站附件下载后加密写入 R2，超限时不下载", async () => {
	const originalFetch = globalThis.fetch;
	const writes = [];
	let fetchCount = 0;
	globalThis.fetch = async (url) => {
		fetchCount += 1;
		if (String(url).includes("/getFile")) {
			return Response.json({ ok: true, result: { file_path: "documents/a.bin", file_size: 4 } });
		}
		return new Response(Uint8Array.from([1, 2, 3, 4]), {
			headers: { "content-length": "4" },
		});
	};
	const env = {
		EDGECHAT_ENCRYPTION_KEYRING: keyring,
		FILES: {
			async put(key, value, options) {
				writes.push({ key, value, options });
			},
		},
	};
	let imported;
	try {
		imported = await importTelegramAttachment(env, {
			botToken: "123:token",
			telegramChatId: "-1001",
			telegramMessageId: 9,
			attachment: {
				fileId: "file-id",
				fileName: "a.bin",
				mimeType: "application/octet-stream",
				fileSize: 4,
			},
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(fetchCount, 2);
	assert.match(imported.attachment.key, /^telegram\/-1001\/9-[0-9a-f-]+\.bin$/);
	assert.equal(writes.length, 1);
	assert.deepEqual(
		(await decryptAttachment(env, writes[0].value, writes[0].key)).bytes,
		Uint8Array.from([1, 2, 3, 4]),
	);
	const oversized = await importTelegramAttachment(env, {
		botToken: "123:token",
		telegramChatId: "-1001",
		telegramMessageId: 10,
		attachment: { fileId: "large", fileSize: TELEGRAM_BRIDGE_FILE_LIMIT + 1 },
	});
	assert.deepEqual(oversized, {
		attachment: null,
		skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE,
	});

	const withoutStorage = await importTelegramAttachment({}, {
		botToken: "123:token",
		telegramChatId: "-1001",
		telegramMessageId: 11,
		attachment: { fileId: "file-id", fileSize: 4 },
	});
	assert.deepEqual(withoutStorage, {
		attachment: null,
		skipReason: TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE,
	});
	assert.deepEqual(
		await loadEdgeChatAttachment({}, { key: "missing.bin", size: 4 }),
		{
			file: null,
			skipReason: TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE,
		},
	);
});

test("可信 Telegram 外部消息可以直接引用 Bridge 创建的 R2 附件", async () => {
	let insertBinds;
	const env = {
		EDGECHAT_ENCRYPTION_KEYRING: keyring,
		DB: {
			prepare(sql) {
				if (sql.includes("uploaded_files")) {
					throw new Error("外部附件不应伪造本地上传归属");
				}
				return {
					bind(...binds) {
						return {
							async run() {
								insertBinds = binds;
								return { meta: { last_row_id: 5 } };
							},
							async all() {
								return {
									results: [{
										id: 5,
										channel_id: 7,
										content: insertBinds[2],
										attachment_key: "telegram/-1001/9-a.bin",
										attachment_name: "a.bin",
										attachment_type: "application/octet-stream",
										attachment_size: 4,
										sender_kind: "external",
										external_sender_id: "42",
										external_sender_name: "Alice",
										source: "telegram",
										source_message_id: "-1001:9",
										created_at: "now",
									}],
								};
							},
						};
					},
				};
			},
		},
	};
	const result = await insertExternalMessage(env, {
		channelId: 7,
		content: "caption",
		attachment: {
			key: "telegram/-1001/9-a.bin",
			name: "a.bin",
			type: "application/octet-stream",
			size: 4,
		},
		externalSender: { id: "42", displayName: "Alice", avatarUrl: "" },
		source: "telegram",
		sourceMessageId: "-1001:9",
		sourceAttachmentId: "file-id",
		sourceAttachmentUniqueId: "unique-id",
	});

	assert.equal(result.created, true);
	assert.equal(result.message.attachment.key, "telegram/-1001/9-a.bin");
	assert.equal(insertBinds[13], "file-id");
	assert.equal(insertBinds[14], "unique-id");
});

test("Bot Token 与 Webhook Secret 使用用途绑定的服务端密文", async () => {
	const env = { EDGECHAT_ENCRYPTION_KEYRING: keyring };
	const encrypted = await encryptSecretValue(env, "123:token", "telegram:bot-token");
	assert.equal(encrypted.includes("123:token"), false);
	assert.equal(await decryptSecretValue(env, encrypted, "telegram:bot-token"), "123:token");
	await assert.rejects(
		decryptSecretValue(env, encrypted, "telegram:webhook-secret"),
		/Encrypted secret authentication failed/,
	);
});

test("外部消息密文绑定来源和外部用户 ID", async () => {
	const env = { EDGECHAT_ENCRYPTION_KEYRING: keyring };
	const encrypted = await encryptMessageContent(env, "telegram message", {
		channelId: 7,
		senderId: 0,
		senderContext: "telegram:42",
	});
	assert.match(encrypted, /^edgechat:enc:v2:/);
	assert.equal(
		await decryptMessageContent(env, encrypted, {
			channelId: 7,
			senderId: 0,
			senderContext: "telegram:42",
		}),
		"telegram message",
	);
	await assert.rejects(
		decryptMessageContent(env, encrypted, {
			channelId: 7,
			senderId: 0,
			senderContext: "telegram:99",
		}),
		/Encrypted message authentication failed/,
	);
});

test("消息 projection 保留 Telegram 来源而不伪造 EdgeChat 账号", () => {
	assert.deepEqual(
		mapMessage({
			id: 12,
			content: "hello",
			created_at: "now",
			sender_kind: "external",
			external_sender_id: "42",
			external_sender_name: "Alice",
			external_sender_avatar_url: null,
			source: "telegram",
		}),
		{
			id: 12,
			content: "hello",
			createdAt: "now",
			source: "telegram",
			sender: {
				kind: "external",
				id: "42",
				username: "",
				displayName: "Alice",
					avatarUrl: "/api/integrations/telegram/avatar/42",
				source: "telegram",
				isAdmin: false,
				isOwner: false,
			},
			attachment: null,
		},
	);
});

test("Telegram webhook 公开接收而后台配置仍要求登录", async () => {
	const env = {
		DB: {
			prepare() {
				return {
					bind() {
						return this;
					},
					async all() {
						return { results: [] };
					},
				};
			},
		},
		SESSIONS: {
			async get() {
				return null;
			},
		},
	};
	const webhookResponse = await worker.fetch(
		new Request("https://example.com/api/integrations/telegram/webhook", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}),
		env,
		{},
	);
	const adminResponse = await worker.fetch(
		new Request("https://example.com/api/admin/telegram"),
		env,
		{},
	);

	assert.equal(webhookResponse.status, 503);
	assert.deepEqual(await webhookResponse.json(), { error: "Telegram Bridge 未配置" });
	assert.equal(adminResponse.status, 401);
	assert.deepEqual(await adminResponse.json(), { error: "请先登录" });
});

test("Telegram 群组映射支持自定义同步方向（both, to_telegram, from_telegram）", async () => {
	let executedSql = "";
	let executedBinds = [];
	const mockDb = {
		prepare(sql) {
			executedSql = sql;
			return {
				bind(...binds) {
					executedBinds = binds;
					return this;
				},
				async all() {
					if (sql.includes("FROM channels")) {
						return { results: [{ id: 1 }] };
					}
					return { results: [] };
				},
				async run() {
					return { meta: { last_row_id: 10, changes: 1 } };
				},
			};
		},
	};

	// 创建带 syncMode 的映射
	const id = await createTelegramMapping(mockDb, {
		channelId: 1,
		telegramChatId: "-100999",
		telegramChatTitle: "Test Group",
		syncMode: "to_telegram",
		createdBy: 42,
	});
	assert.equal(id, 10);
	assert.match(executedSql, /sync_mode/);
	assert.deepEqual(executedBinds, [1, "-100999", "Test Group", "to_telegram", 42]);

	// 更新 syncMode
	const updated = await updateTelegramMapping(mockDb, 10, { syncMode: "from_telegram" });
	assert.equal(updated, true);
	assert.match(executedSql, /sync_mode = \?/);
	assert.deepEqual(executedBinds, ["from_telegram", 10]);

	// 出站 listEnabledTelegramMappingsForChannel 仅包含 both 与 to_telegram
	let listSql = "";
	const queryDb = {
		prepare(sql) {
			listSql = sql;
			return {
				bind() {
					return this;
				},
				async all() {
					return {
						results: [
							{
								id: 1,
								channel_id: 1,
								channel_name: "general",
								telegram_chat_id: "-1001",
								telegram_chat_title: "TG 1",
								sync_mode: "to_telegram",
								enabled: 1,
								created_at: "2026-09-07",
								updated_at: "2026-09-07",
							},
						],
					};
				},
			};
		},
	};
	const mappings = await listEnabledTelegramMappingsForChannel(queryDb, 1);
	assert.match(listSql, /sync_mode IN \('both', 'to_telegram'\)/);
	assert.equal(mappings[0].syncMode, "to_telegram");
});

test("Telegram Webhook 入站时遵循 sync_mode 权限控制（to_telegram 模式下忽略入站消息）", async () => {
	const botTokenCiphertext = await encryptSecretValue(
		{ EDGECHAT_ENCRYPTION_KEYRING: keyring },
		"123:token",
		"telegram:bot-token",
	);
	const webhookSecretCiphertext = await encryptSecretValue(
		{ EDGECHAT_ENCRYPTION_KEYRING: keyring },
		"secret-123",
		"telegram:webhook-secret",
	);

	const makeEnv = (syncMode) => ({
		EDGECHAT_ENCRYPTION_KEYRING: keyring,
		DB: {
			prepare(sql) {
				return {
					bind() {
						return this;
					},
					async all() {
						if (sql.includes("FROM telegram_bridge_config")) {
							return {
								results: [
									{
										bot_token_ciphertext: botTokenCiphertext,
										webhook_secret_ciphertext: webhookSecretCiphertext,
										bot_username: "test_bot",
										webhook_url: "https://example.com/webhook",
									},
								],
							};
						}
						if (sql.includes("FROM telegram_mappings")) {
							return {
								results: [
									{
										id: 1,
										channel_id: 1,
										channel_name: "general",
										channel_kind: "public",
										telegram_chat_id: "-1001",
										telegram_chat_title: "TG 1",
										sync_mode: syncMode,
										enabled: 1,
										created_at: "2026-09-07",
										updated_at: "2026-09-07",
									},
								],
							};
						}
						// getMessageBySource 去重查询：模拟消息已存在，让 ingestTelegramMessage
						// 在重复检查处短路（return { ok: true, created: false }），
						// 避免后续调用测试环境不可用的 Durable Object。
						if (sql.includes("source_message_id")) {
							return {
								results: [
									{
										id: 99,
										channel_id: 1,
										content: "already-exists",
										created_at: "2026-09-07",
										sender_kind: "external",
										external_sender_id: "42",
										external_sender_name: "User",
										external_sender_avatar_url: null,
										source: "telegram",
										source_message_id: "-1001:101",
										attachment_key: null,
										attachment_name: null,
										attachment_type: null,
										attachment_size: null,
									},
								],
							};
						}
						return { results: [] };
					},
				};
			},
		},
	});


	// to_telegram 模式应忽略入站消息
	const reqToTelegram = new Request("https://example.com/api/integrations/telegram/webhook", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Telegram-Bot-Api-Secret-Token": "secret-123",
		},
		body: JSON.stringify({
			message: {
				message_id: 100,
				chat: { id: -1001, title: "TG 1" },
				from: { id: 42, first_name: "User" },
				text: "Hello",
			},
		}),
	});
	const resToTelegram = await worker.fetch(reqToTelegram, makeEnv("to_telegram"), {});
	assert.equal(resToTelegram.status, 200);
	const jsonToTelegram = await resToTelegram.json();
	assert.equal(jsonToTelegram.ignored, true);
	assert.equal(jsonToTelegram.reason, "sync_mode_disallows_inbound");

	// from_telegram 模式：入站消息应被接受（不被忽略）
	const makeWebhookReq = () => new Request("https://example.com/api/integrations/telegram/webhook", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Telegram-Bot-Api-Secret-Token": "secret-123",
		},
		body: JSON.stringify({
			message: {
				message_id: 101,
				chat: { id: -1001, title: "TG 1" },
				from: { id: 42, first_name: "User" },
				text: "Hello from Telegram",
			},
		}),
	});
	const resFromTelegram = await worker.fetch(makeWebhookReq(), makeEnv("from_telegram"), {});
	assert.equal(resFromTelegram.status, 200);
	const jsonFromTelegram = await resFromTelegram.json();
	assert.equal(jsonFromTelegram.ignored, undefined, "from_telegram 模式入站消息不应被忽略");
	assert.equal(jsonFromTelegram.ok, true);

	// both 模式：入站消息同样应被接受（不被忽略）
	const resBoth = await worker.fetch(makeWebhookReq(), makeEnv("both"), {});
	assert.equal(resBoth.status, 200);
	const jsonBoth = await resBoth.json();
	assert.equal(jsonBoth.ignored, undefined, "both 模式入站消息不应被忽略");
	assert.equal(jsonBoth.ok, true);
});

test("Telegram 频道帖子（channel_post）支持无 from 及带 author_signature 的外部消息转换", () => {
	// 1. 无 author_signature 的标准频道文字帖子
	const standardPost = parseTelegramMessageUpdate({
		channel_post: {
			message_id: 88,
			text: "📢 频道广播通知",
			chat: { id: -100998877, title: "Official Channel", type: "channel" },
		},
	});
	assert.deepEqual(standardPost, {
		telegramChatId: "-100998877",
		telegramChatTitle: "Official Channel",
		telegramMessageId: 88,
		sourceMessageId: "-100998877:88",
		content: "📢 频道广播通知",
		attachment: null,
		sender: { id: "-100998877", displayName: "Official Channel", avatarUrl: "" },
	});

	// 2. 带有 author_signature 管理员署名的频道帖子
	const signedPost = parseTelegramMessageUpdate({
		channel_post: {
			message_id: 89,
			text: "管理员发布的内容",
			author_signature: "Alice",
			chat: { id: -100998877, title: "Official Channel", type: "channel" },
		},
	});
	assert.equal(signedPost.sender.displayName, "Official Channel (Alice)");

	// 3. 频道带图片附件帖子
	const mediaPost = parseTelegramMessageUpdate({
		channel_post: {
			message_id: 90,
			caption: "图片说明",
			chat: { id: -100998877, title: "Official Channel", type: "channel" },
			photo: [{ file_id: "p1", file_unique_id: "u1", file_size: 50 }],
		},
	});
	assert.equal(mediaPost.content, "图片说明");
	assert.equal(mediaPost.attachment.kind, "photo");
});

test("setTelegramWebhook 注册 channel_post 更新", async () => {
	const originalFetch = globalThis.fetch;
	let capturedBody = null;
	globalThis.fetch = async (url, init) => {
		capturedBody = JSON.parse(init.body);
		return Response.json({ ok: true, result: true });
	};
	try {
		await setTelegramWebhook("123:token", {
			url: "https://example.com/webhook",
			secretToken: "secret-token",
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.deepEqual(capturedBody.allowed_updates, ["message", "channel_post"]);
});

test("Telegram 频道消息映射头像不会对负数/非纯数字 ID 生成请求 URL", () => {
	const channelMsg = mapMessage({
		id: 200,
		content: "频道消息",
		created_at: "2026-09-07T12:00:00.000Z",
		sender_kind: "external",
		external_sender_id: "-100998877",
		external_sender_name: "Official Channel",
		external_sender_avatar_url: null,
		source: "telegram",
	});
	assert.equal(channelMsg.sender.avatarUrl, "");
});

test("Telegram 映射管理接口支持 channel 类型并拒绝 private 类型", async () => {
	const botTokenCiphertext = await encryptSecretValue(
		{ EDGECHAT_ENCRYPTION_KEYRING: keyring },
		"123:token",
		"telegram:bot-token",
	);
	const webhookSecretCiphertext = await encryptSecretValue(
		{ EDGECHAT_ENCRYPTION_KEYRING: keyring },
		"secret-123",
		"telegram:webhook-secret",
	);

	const makeAdminEnv = (chatType) => ({
		EDGECHAT_ENCRYPTION_KEYRING: keyring,
		ADMIN_USERNAMES: "admin",
		SESSIONS: {
			async get() {
				return JSON.stringify({ userId: 1, username: "admin", isAdmin: true, sessionVersion: 0 });
			},
			async put() {},
			async delete() {},
		},
		DB: {
			prepare(sql) {
				return {
					bind() {
						return this;
					},
					async all() {
						if (sql.includes("FROM users")) {
							return {
								results: [
									{
										username: "admin",
										is_disabled: 0,
										deleted_at: null,
										session_version: 0,
										is_admin: 1,
									},
								],
							};
						}
						if (sql.includes("FROM telegram_bridge_config")) {
							return {
								results: [
									{
										bot_token_ciphertext: botTokenCiphertext,
										webhook_secret_ciphertext: webhookSecretCiphertext,
										bot_username: "test_bot",
										webhook_url: "https://example.com/webhook",
									},
								],
							};
						}
						if (sql.includes("FROM channels")) {
							return { results: [{ id: 1, name: "general" }] };
						}
						return { results: [] };
					},
					async run() {
						return { meta: { last_row_id: 1, changes: 1 } };
					},
				};
			},
		},
	});

	const originalFetch = globalThis.fetch;
	try {
		// 1. 测试 channel 类型允许绑定
		globalThis.fetch = async (url) => {
			if (String(url).includes("/getChat")) {
				return Response.json({
					ok: true,
					result: { id: -100998877, type: "channel", title: "My Channel" },
				});
			}
			return Response.json({ ok: true });
		};
		const channelReq = new Request("https://example.com/api/admin/telegram/mappings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer token",
			},
			body: JSON.stringify({ channelId: 1, telegramChatId: "-100998877" }),
		});
		const channelRes = await worker.fetch(channelReq, makeAdminEnv("channel"), {});
		const channelJson = await channelRes.json();
		assert.equal(channelJson.error, undefined);
		assert.equal(channelRes.status, 200);

		// 2. 测试 private 类型拒绝绑定
		globalThis.fetch = async (url) => {
			if (String(url).includes("/getChat")) {
				return Response.json({
					ok: true,
					result: { id: -100998877, type: "private", first_name: "Tom" },
				});
			}
			return Response.json({ ok: true });
		};
		const privateReq = new Request("https://example.com/api/admin/telegram/mappings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer token",
			},
			body: JSON.stringify({ channelId: 1, telegramChatId: "-100998877" }),
		});
		const privateRes = await worker.fetch(privateReq, makeAdminEnv("private"), {});
		assert.equal(privateRes.status, 400);
		const privateJson = await privateRes.json();
		assert.match(privateJson.error, /目标必须是 Telegram 群组、超级群组或频道/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("createTelegramMapping 在缺失 sync_mode 列时自动降级写入旧格式字段", async () => {
	const executedSqls = [];
	const mockDb = {
		prepare(sql) {
			return {
				bind(...binds) {
					return {
						async all() {
							if (sql.includes("FROM channels")) {
								return { results: [{ id: 1 }] };
							}
							return { results: [] };
						},
						async run() {
							executedSqls.push(sql);
							if (sql.includes("sync_mode")) {
								throw new Error("no such column: sync_mode");
							}
							return { meta: { last_row_id: 123 } };
						},
					};
				},
			};
		},
	};

	const id = await createTelegramMapping(mockDb, {
		channelId: 1,
		telegramChatId: "-10012345",
		telegramChatTitle: "Legacy Channel",
		syncMode: "both",
		createdBy: 1,
	});

	assert.equal(id, 123);
	assert.equal(executedSqls.length, 2);
	assert.match(executedSqls[0], /sync_mode/);
	assert.doesNotMatch(executedSqls[1], /sync_mode/);
});

test("listTelegramBridgeAdminState 在缺失 sync_mode 列时降级读出全部已有映射", async () => {
	let executedSqls = [];
	const mockEnv = {
		DB: {
			prepare(sql) {
				return {
					bind() {
						return this;
					},
					async all() {
						executedSqls.push(sql);
						if (sql.includes("FROM telegram_bridge_config")) {
							return { results: [{ bot_username: "bot", webhook_url: "url", updated_at: "now" }] };
						}
						if (sql.includes("FROM channels")) {
							return { results: [{ id: 1, name: "general" }] };
						}
						if (sql.includes("FROM telegram_mappings")) {
							// 第一次查询带 tm.sync_mode，模拟抛出无此列错误
							if (sql.includes("tm.sync_mode")) {
								throw new Error("no such column: tm.sync_mode");
							}
							// 第二次降级查询带 'both' AS sync_mode，成功返回
							return {
								results: [
									{
										id: 1,
										channel_id: 1,
										channel_name: "general",
										telegram_chat_id: "-1001",
										telegram_chat_title: "TG 1",
										sync_mode: "both",
										enabled: 1,
										created_at: "2026-09-07",
										updated_at: "2026-09-07",
									},
								],
							};
						}
						return { results: [] };
					},
				};
			},
		},
	};

	const state = await listTelegramBridgeAdminState(mockEnv);
	assert.equal(state.mappings.length, 1);
	assert.equal(state.mappings[0].telegramChatId, "-1001");
	assert.equal(state.mappings[0].syncMode, "both");
	assert.equal(executedSqls.filter((s) => s.includes("FROM telegram_mappings")).length, 2);
});




