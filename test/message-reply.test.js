import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

const contextMenu = readFileSync(
	new URL("../frontend/src/components/chat/MessageContextMenu.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

import { renderMarkdown } from "../frontend/src/markdown.js";

const markdownContent = readFileSync(
	new URL("../frontend/src/components/chat/MarkdownContent.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

test("MessageContextMenu provides reply and download action buttons", () => {
	assert.match(contextMenu, /canReply:\s*\{\s*type:\s*Boolean/);
	assert.match(contextMenu, /canDownload:\s*\{\s*type:\s*Boolean/);
	assert.match(contextMenu, /emit\('reply'\)/);
	assert.match(contextMenu, /emit\('download'\)/);
	assert.match(contextMenu, /message-context-menu__item--reply/);
	assert.match(contextMenu, /message-context-menu__item--download/);
});

test("Markdown renders jumpable reply quote links", () => {
	const rendered = renderMarkdown("> [↩ @Alice](#msg-42): hello world\n\nmy reply");
	assert.match(rendered, /class="md-blockquote md-blockquote--reply"/);
	assert.match(rendered, /class="md-link md-reply-link"/);
	assert.match(rendered, /href="#msg-42"/);
	assert.match(rendered, /data-msg-id="42"/);
});

test("MarkdownContent emits jump-to-message on reply link click", () => {
	assert.match(markdownContent, /const emit = defineEmits\(\['jump-to-message'\]\)/);
	assert.match(markdownContent, /emit\('jump-to-message', Number\(msgId\)\)/);
});

test("ChatPage provides composer reply bar, quote formatting and jump-to-message positioning", () => {
	assert.match(chatPage, /v-if="replyingToMessage"\s+class="composer-reply-bar"/);
	assert.match(chatPage, /@reply="startReplyMessage"/);
	assert.match(chatPage, /@download="downloadAttachment"/);
	assert.match(chatPage, /async function downloadAttachment\(\)/);
	assert.match(chatPage, /const quoteBlock = `> \[↩ @\$\{author\}\]\(#msg-\$\{rep\.id\}\): \$\{excerpt\}\\n`/);
	assert.match(chatPage, /function scrollToMessage\(targetId\)/);
	assert.match(chatPage, /:id="`msg-\$\{msg\.id\}`"/);
	assert.match(chatPage, /'message-row--highlighted': highlightedMsgId === Number\(msg\.id\)/);
	assert.match(chatPage, /@jump-to-message="scrollToMessage"/);
	assert.match(chatPage, /cancelReplyMessage/);
});
