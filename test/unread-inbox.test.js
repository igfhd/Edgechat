import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";

import { useUnreadInbox } from "../frontend/src/composables/useUnreadInbox.js";

function createInboxHarness({ activeRoom, pageActive }) {
	const activity = [];
	const read = [];
	const apiRead = [];
	const notified = [];
	let handlers;
	const socket = {
		readyState: 1,
		close() {
			this.readyState = 3;
		},
	};
	const inbox = useUnreadInbox({
		activeRoom,
		applyConversationActivity(payload) {
			activity.push(payload);
		},
		markConversationRead(kind, roomId) {
			read.push({ kind, roomId });
		},
		roomApi: {
			async markRoomRead(kind, roomId, messageId) {
				apiRead.push({ kind, roomId, messageId });
			},
		},
		openInboxConnection(connectionHandlers) {
			handlers = connectionHandlers;
			connectionHandlers.onStatus({ status: "open", socket });
			return socket;
		},
		notifyRoom(room) {
			notified.push(room);
		},
		isPageActive: () => pageActive,
	});
	inbox.connectUnreadInbox();
	return {
		activity,
		read,
		apiRead,
		notified,
		emit(payload) {
			handlers.onMessage(JSON.stringify(payload), socket);
		},
	};
}

const messagePayload = {
	type: "room_message",
	room: { kind: "private", id: 2, name: "产品协作" },
	messageId: 18,
	createdAt: "2026-08-16T10:00:00.000Z",
	unreadCount: 3,
};

test("正在查看且页面聚焦的会话直接标记已读，不弹通知", () => {
	const harness = createInboxHarness({
		activeRoom: ref({ kind: "private", id: "2" }),
		pageActive: true,
	});
	harness.emit(messagePayload);

	assert.deepEqual(harness.read, [{ kind: "private", roomId: 2 }]);
	assert.deepEqual(harness.apiRead, [
		{ kind: "private", roomId: 2, messageId: 18 },
	]);
	assert.deepEqual(harness.activity, []);
	assert.deepEqual(harness.notified, []);
});

test("页面失焦或消息来自其他会话时保留未读并触发通知", () => {
	const hiddenActiveRoom = createInboxHarness({
		activeRoom: ref({ kind: "private", id: 2 }),
		pageActive: false,
	});
	hiddenActiveRoom.emit(messagePayload);
	assert.equal(hiddenActiveRoom.activity.length, 1);
	assert.deepEqual(hiddenActiveRoom.notified, [messagePayload.room]);
	assert.deepEqual(hiddenActiveRoom.read, []);

	const otherRoom = createInboxHarness({
		activeRoom: ref({ kind: "dm", id: 9 }),
		pageActive: true,
	});
	otherRoom.emit(messagePayload);
	assert.equal(otherRoom.activity[0].unreadCount, 3);
	assert.deepEqual(otherRoom.notified, [messagePayload.room]);
});
