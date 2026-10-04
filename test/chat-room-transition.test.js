import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";

import { useChatRoom } from "../frontend/src/composables/useChatRoom.js";

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createSocket(params, handlers) {
	return {
		params,
		handlers,
		readyState: 1,
		close() {
			this.readyState = 3;
		},
		send() {},
		emitMessage(message) {
			handlers.onMessage(JSON.stringify(message), this);
		},
	};
}

test("快速切换房间时丢弃旧历史响应和旧连接消息", async () => {
	const activeRoom = ref({ id: 1, kind: "public" });
	const requests = new Map();
	const sockets = [];
	const room = useChatRoom({
		activeRoom,
		session: ref({ userId: 7 }),
		error: ref(""),
		roomApi: {
			getMessages(_kind, roomId) {
				const request = deferred();
				requests.set(roomId, request);
				return request.promise;
			},
			async markRoomRead() {},
		},
		openRoomConnection(params) {
			const handlers = {
				onStatus: params.onStatus,
				onMessage: params.onMessage,
			};
			const socket = createSocket(params, handlers);
			sockets.push(socket);
			handlers.onStatus({ status: "open", socket });
			return socket;
		},
	});

	const firstActivation = room.activateRoom();
	activeRoom.value = { id: 2, kind: "private" };
	sockets[0].emitMessage({ type: "message", message: { id: 98, content: "stale before watcher" } });
	const secondActivation = room.activateRoom();
	sockets[0].emitMessage({ type: "message", message: { id: 99, content: "stale socket" } });
	requests.get(1).resolve({ messages: [{ id: 1, content: "stale history" }] });
	requests.get(2).resolve({ messages: [{ id: 2, content: "current history" }] });

	assert.equal(await firstActivation, false);
	assert.equal(await secondActivation, true);
	assert.deepEqual(room.messages.value, [{ id: 2, content: "current history" }]);
});

test("已读/未读状态管理与 WebSocket room_read 实时同步", async () => {
	const activeRoom = ref({ id: 1, kind: "dm" });
	const sockets = [];
	const room = useChatRoom({
		activeRoom,
		session: ref({ userId: 7 }),
		error: ref(""),
		roomApi: {
			async getMessages() {
				return {
					messages: [
						{ id: 10, content: "hello" },
						{ id: 20, content: "world" },
					],
					maxPeerReadMessageId: 10,
					myLastReadMessageId: 20,
				};
			},
			async markRoomRead() {},
		},
		openRoomConnection(params) {
			const handlers = {
				onStatus: params.onStatus,
				onMessage: params.onMessage,
			};
			const socket = createSocket(params, handlers);
			sockets.push(socket);
			handlers.onStatus({ status: "open", socket });
			return socket;
		},
	});

	await room.activateRoom();
	assert.equal(room.isMessageRead({ id: 10 }), true);
	assert.equal(room.isMessageRead({ id: 20 }), false);

	// 收到对方的实时已读广播
	sockets[0].emitMessage({
		type: "room_read",
		roomId: 1,
		userId: 8,
		lastReadMessageId: 20,
	});

	assert.equal(room.isMessageRead({ id: 20 }), true);
});

