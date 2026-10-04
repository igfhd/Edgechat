import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

test("ChatPage defines isScrolledUp state and scroll-to-bottom button", () => {
	assert.match(chatPage, /const isScrolledUp = ref\(false\)/);
	assert.match(chatPage, /function handleMessagesScroll\(\)/);
	assert.match(chatPage, /function scrollToUnreadOrBottom\(\)/);
	assert.match(chatPage, /class="chat-scroll-bottom-btn"/);
	assert.match(chatPage, /@click="scrollToUnreadOrBottom"/);
});

test("ChatPage shows unread badge on scroll-to-bottom button when unread messages exist", () => {
	assert.match(chatPage, /const unreadCountBadge = computed\(/);
	assert.match(chatPage, /class="chat-scroll-bottom-badge"/);
	assert.match(chatPage, /unreadCountBadge > 99 \? '99\+' : unreadCountBadge/);
});

test("ChatPage clears firstUnreadMessageId when user reaches the bottom", () => {
	assert.match(chatPage, /firstUnreadMessageId\.value\s*&&\s*distanceFromBottom\s*<=\s*30/);
});

test("ChatPage provides styles for scroll-to-bottom floating button and transitions", () => {
	assert.match(chatPage, /\.chat-messages-wrapper\s*\{/);
	assert.match(chatPage, /\.chat-scroll-bottom-btn\s*\{/);
	assert.match(chatPage, /\.chat-scroll-bottom-badge\s*\{/);
	assert.match(chatPage, /\.fab-fade-enter-active/);
});
