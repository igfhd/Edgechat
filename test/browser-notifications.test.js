import assert from "node:assert/strict";
import test from "node:test";

import {
	browserNotificationRoomKey,
	useBrowserNotifications,
} from "../frontend/src/composables/useBrowserNotifications.js";

function createStorage() {
	const values = new Map();
	return {
		getItem(key) {
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			values.set(key, value);
		},
	};
}

function createNotificationApi() {
	const notifications = [];
	class FakeNotification {
		static permission = "default";

		static async requestPermission() {
			FakeNotification.permission = "granted";
			return FakeNotification.permission;
		}

		constructor(title, options) {
			this.title = title;
			this.options = options;
			this.closed = false;
			notifications.push(this);
		}

		close() {
			this.closed = true;
		}
	}
	return { NotificationApi: FakeNotification, notifications };
}

test("浏览器通知需由用户授权开启，并按账号持久化", async () => {
	const storage = createStorage();
	const { NotificationApi } = createNotificationApi();
	const notifications = useBrowserNotifications({
		userId: 7,
		notificationApi: NotificationApi,
		storage,
		browserWindow: {},
	});

	assert.equal(notifications.notificationsEnabled.value, false);
	assert.equal(notifications.notificationActionLabel.value, "开启通知");
	await notifications.toggleNotifications();
	assert.equal(notifications.notificationsEnabled.value, true);
	assert.match(storage.getItem("edgechat:browser-notifications:7"), /"enabled":true/);

	const restored = useBrowserNotifications({
		userId: 7,
		notificationApi: NotificationApi,
		storage,
		browserWindow: {},
	});
	assert.equal(restored.notificationsEnabled.value, true);
	const otherAccount = useBrowserNotifications({
		userId: 8,
		notificationApi: NotificationApi,
		storage,
		browserWindow: {},
	});
	assert.equal(otherAccount.notificationsEnabled.value, false);

	NotificationApi.permission = "denied";
	restored.syncNotificationPermission();
	assert.equal(restored.notificationsEnabled.value, false);
	assert.equal(restored.notificationActionLabel.value, "浏览器已阻止通知");
});

test("会话免打扰阻止通知，取消后通知可聚合并打开会话", async () => {
	const storage = createStorage();
	const { NotificationApi, notifications: shown } = createNotificationApi();
	let focused = 0;
	let openedRoom = null;
	const browserWindow = { focus: () => focused++ };
	const notifications = useBrowserNotifications({
		userId: 9,
		notificationApi: NotificationApi,
		storage,
		browserWindow,
		onOpenRoom(room) {
			openedRoom = room;
		},
	});
	const room = { kind: "dm", id: "12", name: "Alice" };

	await notifications.toggleNotifications();
	assert.equal(browserNotificationRoomKey(room), "dm:12");
	notifications.toggleRoomMuted(room);
	assert.equal(notifications.isRoomMuted(room), true);
	assert.equal(notifications.notifyRoom(room), false);

	notifications.toggleRoomMuted(room);
	assert.equal(notifications.notifyRoom(room), true);
	assert.equal(shown.length, 1);
	assert.equal(shown[0].title, "Alice");
	assert.deepEqual(shown[0].options, {
		body: "收到一条新私信",
		tag: "edgechat:dm:12",
		renotify: true,
	});
	shown[0].onclick();
	assert.equal(focused, 1);
	assert.equal(openedRoom, room);
	assert.equal(shown[0].closed, true);

	NotificationApi.permission = "granted";
	const groupRoom = { kind: "public", id: 3, name: "产品协作" };
	assert.equal(notifications.notifyRoom(groupRoom), true);
	assert.equal(shown[1].options.body, "收到一条新群聊消息");
});

test("浏览器拒绝通知权限时开关保持禁用", async () => {
	const { NotificationApi } = createNotificationApi();
	NotificationApi.permission = "denied";
	const notifications = useBrowserNotifications({
		notificationApi: NotificationApi,
		storage: createStorage(),
		browserWindow: {},
	});

	assert.equal(notifications.notificationToggleDisabled.value, true);
	assert.equal(notifications.notificationActionLabel.value, "浏览器已阻止通知");
	await notifications.toggleNotifications();
	assert.equal(notifications.notificationsEnabled.value, false);
});
