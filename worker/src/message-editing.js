import { getMessageById, updateMessageContent } from "./data/messages.js";
import { authorizeRoom } from "./room-access.js";

export const MESSAGE_EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 分钟

export class MessageEditingError extends Error {
	constructor(message) {
		super(message);
		this.name = "MessageEditingError";
	}
}

export function createMessageEditing({
	persistEdit = updateMessageContent,
	findMessage = getMessageById,
	editWindowMs = MESSAGE_EDIT_WINDOW_MS,
	now = () => Date.now(),
} = {}) {
	return async function editRoomMessage(env, meta, payload) {
		const messageId = Number(payload?.messageId);
		const content = String(payload?.content || "").trim();

		if (!Number.isInteger(messageId) || messageId <= 0) {
			throw new MessageEditingError("消息不存在");
		}
		if (!content) {
			throw new MessageEditingError("消息内容不能为空");
		}

		const access = await authorizeRoom(
			env.DB,
			meta.principal,
			meta.room.kind,
			meta.room.id,
		);
		if (!access.ok) {
			throw new MessageEditingError("无权编辑该消息");
		}

		const target = await findMessage(env, messageId);
		if (!target || Number(target.channelId || meta.room.id) !== Number(meta.room.id)) {
			throw new MessageEditingError("消息不存在或已被删除");
		}

		// 只有消息发送者本人才能编辑该消息
		const isSender = target.sender?.kind === "local" && Number(target.sender?.id) === Number(meta.principal.userId);
		if (!isSender) {
			throw new MessageEditingError("只能编辑自己发送的消息");
		}

		// 发送时间超过 5 分钟限制则拒绝编辑
		if (target.createdAt) {
			const createdAtMs = new Date(target.createdAt).getTime();
			if (Number.isFinite(createdAtMs) && now() - createdAtMs > editWindowMs) {
				throw new MessageEditingError("发送超过 5 分钟的消息无法编辑");
			}
		}

		const updated = await persistEdit(env, {
			channelId: meta.room.id,
			messageId,
			senderId: meta.principal.userId,
			content,
		});
		if (!updated) {
			throw new MessageEditingError("消息编辑失败或已被删除");
		}

		return {
			message: updated,
			packet: JSON.stringify({ type: "message_edited", message: updated }),
		};
	};
}

export const editRoomMessage = createMessageEditing();
