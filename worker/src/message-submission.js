import { insertMessage } from "./data/messages.js";
import { isGeneralChannel } from "./data/general-channel.js";
import { canUsersDirectMessage } from "./data/user-groups.js";

export class MessageSubmissionError extends Error {
	constructor(message) {
		super(message);
		this.name = "MessageSubmissionError";
	}
}

export function createMessageSubmission({ persistMessage = insertMessage } = {}) {
	return async function submitRoomMessage(env, meta, payload) {
		try {
			if (isGeneralChannel(meta?.room) && !meta?.principal?.isAdmin && env?.DB) {
				const row = await env.DB
					.prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'general_channel_muted'")
					.first();
				if (row?.setting_value === "1") {
					throw new MessageSubmissionError("当前群聊已开启全员禁言，仅管理员可以发言");
				}
			}

			if (meta?.room?.kind === "dm" && !meta?.principal?.isAdmin && env?.DB) {
				const dmKey = String(meta.room.name || meta.room.dm_key || meta.room.dmKey || "");
				const parts = dmKey.split(":").map(Number);
				const senderUid = Number(meta.principal.userId);
				const peerUid = parts.find((id) => Number.isFinite(id) && id > 0 && id !== senderUid);
				if (peerUid) {
					const canDm = await canUsersDirectMessage(env.DB, senderUid, peerUid);
					if (!canDm) {
						throw new MessageSubmissionError("当前团队已开启私聊保护，仅支持联系组长与管理员");
					}
				}
			}

			const message = await persistMessage(env, {
				channelId: meta.room.id,
				senderId: meta.principal.userId,
				content: payload.content,
				attachment: payload.attachment,
			});
			const packetObj = { type: "message", message };
			if (payload.clientMsgId) {
				packetObj.clientMsgId = payload.clientMsgId;
			}
			return {
				message,
				packet: JSON.stringify(packetObj),
			};
		} catch (error) {
			if (error?.message === "Message content cannot be empty") {
				throw new MessageSubmissionError("消息内容不能为空");
			}
			throw error;
		}
	};
}

export const submitRoomMessage = createMessageSubmission();
