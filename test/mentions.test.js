import assert from "node:assert/strict";
import test from "node:test";
import { extractMentions, isUserMentioned } from "../frontend/src/mentions.js";
import { renderMarkdown } from "../frontend/src/markdown.js";
import { useBrowserNotifications } from "../frontend/src/composables/useBrowserNotifications.js";

test("extractMentions - correctly extracts usernames and @所有人", () => {
	assert.deepEqual(extractMentions(""), []);
	assert.deepEqual(extractMentions("hello world"), []);
	assert.deepEqual(extractMentions("@alice 你好"), ["alice"]);
	assert.deepEqual(extractMentions("@alice @bob @所有人 请查收"), ["alice", "bob", "所有人"]);
	assert.deepEqual(extractMentions("收到(@charlie)以及【@david】的消息"), ["charlie", "david"]);
	assert.deepEqual(extractMentions("@admin_01-test 测试下划线与中划线"), ["admin_01-test"]);
});

test("isUserMentioned - identifies direct user mention or @all", () => {
	const user = { username: "alice", displayName: "Alice Chen" };

	assert.equal(isUserMentioned("hello @alice", user), true);
	assert.equal(isUserMentioned("hello @Alice", user), true);
	assert.equal(isUserMentioned("hello @Alice Chen", user), true); // matches @Alice username
	assert.equal(isUserMentioned("大家注意 @所有人 明天开会", user), true);
	assert.equal(isUserMentioned("hello @all please review", user), true);
	assert.equal(isUserMentioned("hello @everyone please review", user), true);
	assert.equal(isUserMentioned("hello @bob", user), false);
	assert.equal(isUserMentioned("", user), false);
	assert.equal(isUserMentioned("hello @alice", null), false);
});

test("renderMarkdown - formats mentions as styled mention pills", () => {
	const html1 = renderMarkdown("你好 @alice 早安");
	assert.match(html1, /<span class="mention-pill" data-username="alice">@alice<\/span>/);

	const htmlAll = renderMarkdown("请注意 @所有人 收到请回复");
	assert.match(htmlAll, /<span class="mention-pill mention-pill--all" data-username="所有人">@所有人<\/span>/);

	const htmlAllEn = renderMarkdown("hello @all test");
	assert.match(htmlAllEn, /<span class="mention-pill mention-pill--all" data-username="all">@all<\/span>/);
});

test("useBrowserNotifications - notifyRoom with bypassMute overrides room mute", () => {
	const notifications = [];
	class MockNotification {
		constructor(title, options) {
			this.title = title;
			this.options = options;
			notifications.push({ title, options });
		}
		close() {}
	}
	MockNotification.permission = "granted";

	const storage = new Map();
	const mockStorage = {
		getItem: (k) => storage.get(k) || null,
		setItem: (k, v) => storage.set(k, String(v)),
	};

	const manager = useBrowserNotifications({
		userId: 1,
		storage: mockStorage,
		notificationApi: MockNotification,
		browserWindow: {
			Notification: MockNotification,
			localStorage: mockStorage,
			focus: () => {},
		},
	});

	// Enable notifications
	manager.notificationsEnabled.value = true;
	manager.notificationPermission.value = "granted";

	const room = { id: 10, kind: "channel", name: "开发组" };

	// Normal notify
	assert.equal(manager.notifyRoom(room), true);
	assert.equal(notifications.length, 1);

	// Mute room
	manager.toggleRoomMuted(room);
	assert.equal(manager.isRoomMuted(room), true);

	// Regular notification is muted
	assert.equal(manager.notifyRoom(room), false);
	assert.equal(notifications.length, 1);

	// Mention notification bypasses mute
	const message = {
		sender: { displayName: "Bob" },
		content: "@alice 请看一下这个 PR",
	};
	assert.equal(manager.notifyRoom(room, message, { bypassMute: true }), true);
	assert.equal(notifications.length, 2);
	assert.match(notifications[1].title, /\[有人@了你\]/);
	assert.match(notifications[1].options.body, /Bob: @alice 请看一下这个 PR/);
});

test("mention input trigger matches @ at any position with query capture", () => {
	const regex = /@([a-zA-Z0-9_\-\u4e00-\u9fa5]*)$/;

	assert.equal(regex.exec("@")?.[1], "");
	assert.equal(regex.exec("@ali")?.[1], "ali");
	assert.equal(regex.exec("你好@张")?.[1], "张");
	assert.equal(regex.exec("大家好 @所有人")?.[1], "所有人");
	assert.equal(regex.exec("hello world"), null);
	assert.equal(regex.exec("@alice "), null); // trailing space completes mention
});

