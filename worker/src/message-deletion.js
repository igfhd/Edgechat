import { getMessageById, softDeleteMessage, hardDeleteMessage } from "./data/messages.js";
import { authorizeRoom, getChannelMembership } from "./room-access.js";
import { getSiteSettings } from "./data/site-settings.js";

export const MESSAGE_RECALL_WINDOW_MS = 5 * 60 * 1000; // 5 分钟撤回窗口

export class MessageDeletionError extends Error {
	constructor(message) {
		super(message);
		this.name = "MessageDeletionError";
	}
}

export function createMessageDeletion({
	persistDeletion = null,
	findMessage = getMessageById,
} = {}) {
	return async function deleteRoomMessage(env, meta, payload) {
		const messageId = Number(payload?.messageId);
		if (!Number.isInteger(messageId) || messageId <= 0) {
			throw new MessageDeletionError("消息不存在");
		}

		const access = await authorizeRoom(
			env.DB,
			meta.principal,
			meta.room.kind,
			meta.room.id,
		);
		if (!access.ok) {
			throw new MessageDeletionError("无权删除该消息");
		}

		const target = await findMessage(env, messageId);
		if (!target || Number(target.channelId || meta.room.id) !== Number(meta.room.id)) {
			throw new MessageDeletionError("消息不存在或已被删除");
		}

		// 允许：1. 发送者本人撤回/删除；2. 全局管理员；3. 群主（群聊中）
		const isSender = target.sender?.kind === "local" && Number(target.sender?.id) === Number(meta.principal.userId);
		const isAdmin = Boolean(meta.principal.isAdmin);
		let isOwner = false;
		if (!isSender && !isAdmin && meta.room.kind !== "dm") {
			const membership = await getChannelMembership(env.DB, meta.room.id, meta.principal.userId);
			isOwner = membership?.role === "owner";
		}

		if (!isSender && !isAdmin && !isOwner) {
			throw new MessageDeletionError("无权删除该消息");
		}

		let deleted = false;
		if (persistDeletion) {
			deleted = await persistDeletion(env.DB, {
				channelId: meta.room.id,
				messageId,
			});
		} else {
			const settings = await getSiteSettings(env.DB, env).catch(() => ({}));
			if (settings?.deletionPolicy === "immediate_purge") {
				deleted = await hardDeleteMessage(env.DB, {
					channelId: meta.room.id,
					messageId,
				});
				if (deleted && target?.attachment?.key && env?.FILES) {
					env.FILES.delete(target.attachment.key).catch(() => {});
				}
			} else {
				deleted = await softDeleteMessage(env.DB, {
					channelId: meta.room.id,
					messageId,
				});
			}
		}

		if (!deleted) {
			throw new MessageDeletionError("消息不存在或已被删除");
		}

		return {
			messageId,
			packet: JSON.stringify({
				type: "message_deleted",
				messageId,
				senderId: target.sender?.id,
				senderDisplayName: target.sender?.displayName || target.sender?.username || "",
				recalledBy: Number(meta.principal.userId),
				isAdminDelete: !isSender && (isAdmin || isOwner),
			}),
		};
	};
}

export const deleteRoomMessage = createMessageDeletion();
