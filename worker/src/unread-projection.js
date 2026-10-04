import { countUnreadMessages, listRoomMemberIds, listRoomMembersUnreadCounts } from "./data/unread.js";
import { notifyUserInbox } from "./do-bridge.js";

function logProjectionFailure(message, data) {
	console.warn(JSON.stringify({ message, ...data }));
}

export function createUnreadProjection({
	countUnread = countUnreadMessages,
	listMemberIds = listRoomMemberIds,
	listMembersUnread = listRoomMembersUnreadCounts,
	notifyInbox = notifyUserInbox,
	logFailure = logProjectionFailure,
} = {}) {
	async function notifyRecipient(env, room, message, userId, unreadCount) {
		try {
			await notifyInbox(env, userId, {
				type: "room_message",
				room: {
					id: Number(room.id),
					kind: room.kind,
					name: room.name,
				},
				messageId: Number(message.id),
				createdAt: message.createdAt,
				unreadCount,
			});
		} catch (error) {
			logFailure("unread recipient projection failed", {
				roomId: Number(room.id),
				userId: Number(userId),
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return async function projectUnreadMessage(env, { room, senderId, message }) {
		try {
			// If defaults are used, perform a single batched aggregation query on D1
			if (countUnread === countUnreadMessages && listMemberIds === listRoomMemberIds) {
				const membersUnread = await listMembersUnread(env.DB, room.id, senderId);
				await Promise.all(
					membersUnread.map(({ userId, unreadCount }) =>
						notifyRecipient(env, room, message, userId, unreadCount),
					),
				);
				return;
			}

			const memberIds = await listMemberIds(env.DB, room.id);
			const recipientIds = memberIds.filter(
				(userId) => Number(userId) !== Number(senderId),
			);
			await Promise.all(
				recipientIds.map(async (userId) => {
					try {
						const unreadCount = await countUnread(env.DB, {
							channelId: room.id,
							userId,
						});
						await notifyRecipient(env, room, message, userId, unreadCount);
					} catch (error) {
						logFailure("unread recipient projection failed", {
							roomId: Number(room.id),
							userId: Number(userId),
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}),
			);
		} catch (error) {
			logFailure("unread projection failed", {
				roomId: Number(room.id),
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};
}

export const projectUnreadMessage = createUnreadProjection();
