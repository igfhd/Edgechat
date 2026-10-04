import { decryptMessageContent, encryptMessageContent, isE2eeMessageContent, isEncryptedMessageContent } from "../encryption.js";
import { normalizeUtcIsoString, pickAttachment, publicFileUrl } from "../utils.js";
import { fileBelongsToUser } from "./uploaded-files.js";

function toNullableNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

export function mapMessage(row, content = row.content) {
	const isExternal = row.sender_kind === "external";
	const isTelegramExternal = isExternal && row.source === "telegram";
	const isTelegramUser = isTelegramExternal && /^\d+$/.test(String(row.external_sender_id || ""));
	const isE2ee = isE2eeMessageContent(content);
	const voiceMatch = String(row.attachment_name || "").match(/^voice_(\d+)_/);
	const isVoice = Boolean(voiceMatch) || (row.attachment_name && String(row.attachment_name).startsWith("voice_"));
	const duration = voiceMatch ? Number(voiceMatch[1]) : undefined;
	const isSenderAdmin = !isExternal && Boolean(row.sender_is_admin);
	const isSenderOwner = !isExternal && Boolean(
		row.channel_kind !== "dm" &&
		row.channel_created_by &&
		Number(row.sender_id) === Number(row.channel_created_by)
	);
	const message = {
			id: Number(row.id),
			content,
			createdAt: normalizeUtcIsoString(row.created_at),
			source: row.source || "edgechat",
			sender: {
				kind: isExternal ? "external" : "local",
				id: isExternal ? String(row.external_sender_id || "") : Number(row.sender_id),
				username: isExternal ? "" : row.sender_username,
				displayName: isExternal ? row.external_sender_name : row.sender_display_name,
				avatarUrl: isExternal
					? isTelegramUser
						? `/api/integrations/telegram/avatar/${row.external_sender_id}`
						: row.external_sender_avatar_url || ""
					: row.sender_avatar_key
						? publicFileUrl(row.sender_avatar_key)
						: "",
				source: isExternal ? row.source : "edgechat",
				isAdmin: isSenderAdmin,
				isOwner: isSenderOwner,
			},
		attachment: row.attachment_key
			? {
					key: row.attachment_key,
					name: row.attachment_name,
					type: row.attachment_type,
					size: toNullableNumber(row.attachment_size) || 0,
					url: publicFileUrl(row.attachment_key),
					...(isVoice ? { isVoice: true } : {}),
					...(duration !== undefined ? { duration } : {}),
				}
			: null,
	};
	if (row.channel_id !== undefined && row.channel_id !== null && !Number.isNaN(Number(row.channel_id))) {
		message.channelId = Number(row.channel_id);
	}
	if (row.edited_at) {
		message.editedAt = normalizeUtcIsoString(row.edited_at);
	}
	if (isE2ee) {
		message.e2ee = true;
	}
	return message;
}

export async function externalSenderExists(db, source, senderId) {
	const { results } = await db
		.prepare(
			`SELECT 1 AS found
			 FROM messages
			 WHERE sender_kind = 'external'
			   AND source = ?
			   AND external_sender_id = ?
			   AND deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(String(source), String(senderId))
		.all();
	return Boolean(results[0]);
}

async function mapDecryptedMessage(env, row) {
	try {
		const content = await decryptMessageContent(env, row.content, {
			channelId: row.channel_id,
			senderId: row.sender_id ?? 0,
			senderContext:
				row.sender_kind === "external"
					? `${row.source}:${row.external_sender_id}`
					: "",
		});
		return mapMessage(row, content);
	} catch (error) {
		console.warn(`[mapDecryptedMessage] Message ${row.id} decryption failed:`, error?.message || error);
		const isEnc = isEncryptedMessageContent(row.content);
		return mapMessage(row, isEnc ? "[加密消息无法解密]" : (row.content || ""));
	}
}

const MESSAGE_SELECT = `SELECT
  m.id, m.channel_id, m.content, m.attachment_key, m.attachment_name, m.attachment_type,
  m.attachment_size, m.sender_kind, m.external_sender_id, m.external_sender_name,
	  m.external_sender_avatar_url, m.source, m.source_message_id,
	  m.source_attachment_id, m.source_attachment_unique_id, m.created_at, m.edited_at,
  u.id AS sender_id, u.username AS sender_username,
  u.display_name AS sender_display_name, u.avatar_key AS sender_avatar_key,
  u.is_admin AS sender_is_admin,
  c.created_by AS channel_created_by, c.kind AS channel_kind
 FROM messages m
 LEFT JOIN users u ON u.id = m.sender_id
 LEFT JOIN channels c ON c.id = m.channel_id`;

export async function listMessages(env, roomId, before = null, limit = 30) {
	const filters = ["m.channel_id = ?", "m.deleted_at IS NULL"];
	const binds = [Number(roomId)];
	if (before) {
		filters.push("m.id < ?");
		binds.push(Number(before));
	}
	const { results } = await env.DB
		.prepare(`${MESSAGE_SELECT} WHERE ${filters.join(" AND ")} ORDER BY m.id DESC LIMIT ?`)
		.bind(...binds, Number(limit))
		.all();
	return (await Promise.all(results.map((row) => mapDecryptedMessage(env, row)))).reverse();
}

export async function getMessageById(env, messageId) {
	const { results } = await env.DB
		.prepare(`${MESSAGE_SELECT} WHERE m.id = ? AND m.deleted_at IS NULL LIMIT 1`)
		.bind(Number(messageId))
		.all();
	return results[0] ? mapDecryptedMessage(env, results[0]) : null;
}

export async function getMessageBySource(env, source, sourceMessageId) {
	const { results } = await env.DB
		.prepare(
			`${MESSAGE_SELECT}
			 WHERE m.source = ? AND m.source_message_id = ?
			 LIMIT 1`,
		)
		.bind(String(source), String(sourceMessageId))
		.all();
	return results[0] ? mapDecryptedMessage(env, results[0]) : null;
}

export async function softDeleteMessage(db, { channelId, messageId }) {
	const result = await db
		.prepare(
			`UPDATE messages
			 SET deleted_at = CURRENT_TIMESTAMP
			 WHERE id = ?
			   AND channel_id = ?
			   AND deleted_at IS NULL`,
		)
		.bind(Number(messageId), Number(channelId))
		.run();
	return Number(result.meta?.changes || 0) > 0;
}

export async function hardDeleteMessage(db, { channelId, messageId }) {
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS pending_r2_delete (
				object_key TEXT PRIMARY KEY,
				retry_count INTEGER NOT NULL DEFAULT 0,
				next_retry_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				last_error TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`,
		)
		.run()
		.catch(() => {});

	await db
		.prepare(`DELETE FROM message_reactions WHERE message_id = ?`)
		.bind(Number(messageId))
		.run()
		.catch(() => {});

	const [, result] = await db.batch([
		db.prepare(
			`INSERT OR IGNORE INTO pending_r2_delete (object_key)
			 SELECT attachment_key FROM messages
			 WHERE id = ? AND channel_id = ? AND attachment_key IS NOT NULL AND attachment_key != ''`,
		).bind(Number(messageId), Number(channelId)),
		db.prepare(
			`DELETE FROM messages
			 WHERE id = ? AND channel_id = ?`,
		).bind(Number(messageId), Number(channelId)),
	]);
	return Number(result.meta?.changes || 0) > 0;
}

export async function updateMessageContent(env, { channelId, messageId, senderId, content }) {
	const cleanContent = String(content || "").trim();
	if (!cleanContent) {
		throw new Error("Message content cannot be empty");
	}
	const storedContent = await encryptMessageContent(env, cleanContent, {
		channelId: Number(channelId),
		senderId: Number(senderId) ?? 0,
		senderContext: "",
	});
	const result = await env.DB
		.prepare(
			`UPDATE messages
			 SET content = ?, edited_at = CURRENT_TIMESTAMP
			 WHERE id = ?
			   AND channel_id = ?
			   AND sender_id = ?
			   AND deleted_at IS NULL`,
		)
		.bind(storedContent, Number(messageId), Number(channelId), Number(senderId))
		.run();
	if (Number(result.meta?.changes || 0) === 0) {
		return null;
	}
	return getMessageById(env, messageId);
}

async function persistMessage(env, {
	channelId,
	senderId = null,
	externalSender = null,
	content,
	attachment = null,
	source = "edgechat",
	sourceMessageId = null,
	sourceAttachmentId = null,
	sourceAttachmentUniqueId = null,
}) {
	const isExternal = externalSender !== null;
	const normalizedSenderId = isExternal ? null : Number(senderId);
	const hasAttachment = attachment !== undefined && attachment !== null;
	// 外部附件只能从已验证的内部 Bridge 入口进入；本地客户端仍必须通过上传归属校验。
	const cleanAttachment = pickAttachment(
		attachment,
		isExternal ? {} : { ownerUserId: normalizedSenderId },
	);
	const cleanContent = String(content || "").trim();
	if (hasAttachment && !cleanAttachment) {
		throw new Error("Invalid attachment");
	}
	if (
		!isExternal &&
		cleanAttachment &&
		!(await fileBelongsToUser(env.DB, cleanAttachment.key, normalizedSenderId))
	) {
		throw new Error("Attachment is not available");
	}
	if (!cleanContent && !cleanAttachment) {
		throw new Error("Message content cannot be empty");
	}
	const externalId = isExternal ? String(externalSender.id || "").trim() : "";
	const externalName = isExternal ? String(externalSender.displayName || "").trim() : "";
	if (isExternal && (!externalId || !externalName || !sourceMessageId)) {
		throw new Error("External sender is incomplete");
	}

	const storedContent = await encryptMessageContent(env, cleanContent, {
		channelId,
		senderId: normalizedSenderId ?? 0,
		senderContext: isExternal ? `${source}:${externalId}` : "",
	});
	try {
		const result = await env.DB
			.prepare(
				`INSERT INTO messages (
				   channel_id, sender_id, content, attachment_key, attachment_name,
				   attachment_type, attachment_size, sender_kind, external_sender_id,
				   external_sender_name, external_sender_avatar_url, source, source_message_id,
				   source_attachment_id, source_attachment_unique_id
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				Number(channelId),
				normalizedSenderId,
				storedContent,
				cleanAttachment?.key || null,
				cleanAttachment?.name || null,
				cleanAttachment?.type || null,
				cleanAttachment?.size || null,
				isExternal ? "external" : "local",
				isExternal ? externalId : null,
				isExternal ? externalName : null,
				isExternal ? String(externalSender.avatarUrl || "") : null,
					String(source || "edgechat"),
					sourceMessageId ? String(sourceMessageId) : null,
					sourceAttachmentId ? String(sourceAttachmentId) : null,
					sourceAttachmentUniqueId ? String(sourceAttachmentUniqueId) : null,
			)
			.run();
		return { message: await getMessageById(env, result.meta.last_row_id), created: true };
	} catch (error) {
		if (sourceMessageId && String(error?.message || error).includes("UNIQUE")) {
			const existing = await getMessageBySource(env, source, sourceMessageId);
			if (existing) {
				return { message: existing, created: false };
			}
		}
		throw error;
	}
}

export async function insertMessage(env, { channelId, senderId, content, attachment }) {
	const result = await persistMessage(env, {
		channelId,
		senderId,
		content,
		attachment,
	});
	return result.message;
}

export function insertExternalMessage(env, payload) {
	return persistMessage(env, payload);
}
