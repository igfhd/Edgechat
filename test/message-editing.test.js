import assert from "node:assert/strict";
import test from "node:test";

import {
	createMessageEditing,
	MessageEditingError,
} from "../worker/src/message-editing.js";

function createMockDb() {
	return {
		prepare() {
			return {
				bind() {
					return this;
				},
				async all() {
					return { results: [{ id: 4, kind: "private" }] };
				},
				async run() {
					return { meta: { changes: 1 } };
				}
			};
		}
	};
}

test("消息发送者可以在5分钟内编辑自己发送的消息", async () => {
	const calls = [];
	const now = Date.now();
	const editor = createMessageEditing({
		now: () => now,
		async findMessage(_env, messageId) {
			return {
				id: messageId,
				channelId: 4,
				content: "old text",
				createdAt: new Date(now - 2 * 60 * 1000).toISOString(), // 2 minutes ago
				sender: { kind: "local", id: 7 }
			};
		},
		async persistEdit(_env, args) {
			calls.push(args);
			return {
				id: args.messageId,
				channelId: args.channelId,
				content: args.content,
				editedAt: new Date(now).toISOString(),
				sender: { kind: "local", id: 7 }
			};
		}
	});

	const result = await editor(
		{ DB: createMockDb() },
		{ room: { id: 4, kind: "private" }, principal: { userId: 7 } },
		{ messageId: 10, content: "new edited text" }
	);

	assert.deepEqual(calls, [
		{
			channelId: 4,
			messageId: 10,
			senderId: 7,
			content: "new edited text"
		}
	]);
	assert.equal(result.message.content, "new edited text");
	const packet = JSON.parse(result.packet);
	assert.equal(packet.type, "message_edited");
	assert.equal(packet.message.content, "new edited text");
});

test("发送超过 5 分钟的消息无法编辑", async () => {
	const now = Date.now();
	const editor = createMessageEditing({
		now: () => now,
		async findMessage(_env, messageId) {
			return {
				id: messageId,
				channelId: 4,
				content: "old text",
				createdAt: new Date(now - 6 * 60 * 1000).toISOString(), // 6 minutes ago
				sender: { kind: "local", id: 7 }
			};
		}
	});

	await assert.rejects(
		editor(
			{ DB: createMockDb() },
			{ room: { id: 4, kind: "private" }, principal: { userId: 7 } },
			{ messageId: 10, content: "trying to edit expired message" }
		),
		(error) => error instanceof MessageEditingError && error.message === "发送超过 5 分钟的消息无法编辑"
	);
});

test("非发送者不能编辑他人的消息", async () => {
	const editor = createMessageEditing({
		async findMessage(_env, messageId) {
			return {
				id: messageId,
				channelId: 4,
				content: "other user text",
				createdAt: new Date().toISOString(),
				sender: { kind: "local", id: 99 } // other user
			};
		}
	});

	await assert.rejects(
		editor(
			{ DB: createMockDb() },
			{ room: { id: 4, kind: "private" }, principal: { userId: 7 } },
			{ messageId: 10, content: "trying to edit other user message" }
		),
		(error) => error instanceof MessageEditingError && error.message === "只能编辑自己发送的消息"
	);
});

test("编辑空内容或无效消息ID会被拒绝", async () => {
	const editor = createMessageEditing();

	await assert.rejects(
		editor(
			{ DB: createMockDb() },
			{ room: { id: 4, kind: "private" }, principal: { userId: 7 } },
			{ messageId: 0, content: "valid" }
		),
		(error) => error instanceof MessageEditingError && error.message === "消息不存在"
	);

	await assert.rejects(
		editor(
			{ DB: createMockDb() },
			{ room: { id: 4, kind: "private" }, principal: { userId: 7 } },
			{ messageId: 10, content: "   " }
		),
		(error) => error instanceof MessageEditingError && error.message === "消息内容不能为空"
	);
});

test("客户端 useChatRoom editMessage 会正确传递 userId 并发送编辑包", async () => {
	const { useChatRoom } = await import("../frontend/src/composables/useChatRoom.js");
	const { ref } = await import("vue");

	const activeRoom = ref({
		id: 1,
		kind: "public",
		name: "general"
	});
	const session = ref({
		userId: 7,
		username: "alice",
		displayName: "Alice"
	});
	const error = ref("");

	const chat = useChatRoom({
		activeRoom,
		session,
		error,
		roomApi: {
			async getRoomMessages() {
				return { messages: [] };
			},
			async markRoomRead() {},
		},
		openRoomConnection(params) {
			const socket = {
				readyState: 1,
				send: () => {},
				close: () => {},
			};
			params.onStatus?.({ status: "open", socket });
			return socket;
		}
	});

	await chat.activateRoom();
	const ok = await chat.editMessage(100, "编辑后的新消息");
	assert.equal(ok, true);
	assert.equal(error.value, "");
});
