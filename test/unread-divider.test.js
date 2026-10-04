import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

const activeRoomModule = readFileSync(
	new URL("../frontend/src/composables/useActiveRoom.js", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

test("useActiveRoom preserves unreadCount in activeRoom state", () => {
	assert.match(activeRoomModule, /unreadCount:\s*Number\(channel\.unreadCount \|\| 0\)/);
	assert.match(activeRoomModule, /unreadCount:\s*Number\(dm\.unreadCount \|\| 0\)/);
});

test("ChatPage defines unread-messages-divider and computes firstUnreadMessageId", () => {
	assert.match(chatPage, /const firstUnreadMessageId = ref\(null\)/);
	assert.match(chatPage, /class="unread-messages-divider"/);
	assert.match(chatPage, /<span class="unread-messages-divider__text">未读消息<\/span>/);
	assert.match(chatPage, /firstUnreadMessageId\.value = targetId \|\| messages\.value\[0\]\.id/);
});

test("ChatPage provides styling for Telegram-like unread divider", () => {
	assert.match(chatPage, /\.unread-messages-divider\s*\{/);
	assert.match(chatPage, /\.unread-messages-divider__line\s*\{/);
	assert.match(chatPage, /\.unread-messages-divider__badge\s*\{/);
	assert.match(chatPage, /\.unread-messages-divider__text\s*\{/);
});
