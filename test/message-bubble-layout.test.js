import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const avatarComponent = readFileSync(
	new URL("../frontend/src/components/ui/Avatar.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

function getStyleRule(selector) {
	const marker = `${selector} {`;
	const start = chatPage.indexOf(marker);
	assert.notEqual(start, -1, `聊天页缺少样式规则：${selector}`);
	const end = chatPage.indexOf("}", start + marker.length);
	assert.notEqual(end, -1, `聊天页样式规则未闭合：${selector}`);
	return chatPage.slice(start, end + 1);
}

test("短文本消息与已编辑消息为右下角时间戳预留末行空间", () => {
	assert.match(
		chatPage,
		/'message-bubble--with-attachment': msg\.attachment/,
	);
	assert.match(
		chatPage,
		/'message-bubble--edited': Boolean\(msg\.editedAt\)/,
	);

	const bubble = getStyleRule(".message-bubble");
	assert.match(bubble, /padding:\s*6px 10px 7px;/);

	const attachmentBubble = getStyleRule(
		".message-bubble--with-attachment,\n.message-bubble--with-card",
	);
	assert.match(attachmentBubble, /padding-bottom:\s*22px;/);

	const time = getStyleRule(".message-time");
	assert.match(time, /position:\s*absolute;/);
	assert.match(time, /white-space:\s*nowrap;/);

	const reserve = getStyleRule(
		".message-bubble:not(.message-bubble--with-attachment) p:last-child::after,\n.message-bubble:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,\n.message-bubble:not(.message-bubble--with-attachment) .markdown-body::after",
	);
	assert.match(reserve, /display:\s*inline-block;/);
	assert.match(reserve, /width:\s*3\.5em;/);

	const editedReserve = getStyleRule(
		".message-bubble--edited:not(.message-bubble--with-attachment) p:last-child::after,\n.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,\n.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body::after",
	);
	assert.match(editedReserve, /width:\s*5\.5em;/);

	const e2eeEditedOwnReserve = getStyleRule(
		".message-row--own .message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) p:last-child::after,\n.message-row--own .message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,\n.message-row--own .message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body::after",
	);
	assert.match(e2eeEditedOwnReserve, /width:\s*7\.2em;/);
});

test("非本人消息在气泡前显示圆形发送者头像", () => {
	assert.match(chatPage, /<UiAvatar\s+v-if="!isOwnMessage\(msg\)"/);
	assert.match(chatPage, /:src="getSenderAvatar\(msg\)"/);
	assert.match(chatPage, /:fallback="msg\.sender\?\.displayName"/);

	const row = getStyleRule(".message-row");
	assert.match(row, /align-items:\s*flex-end;/);
	assert.match(row, /gap:\s*8px;/);

	const avatar = getStyleRule(".message-avatar");
	assert.match(avatar, /width:\s*34px;/);
	assert.match(avatar, /height:\s*34px;/);
	assert.match(avatar, /border-radius:\s*50%;/);
});

test("远程头像加载失败时显示姓名缩写", () => {
	assert.match(avatarComponent, /const showImage = computed/);
	assert.match(avatarComponent, /failedSrc\.value !== props\.src/);
	assert.match(avatarComponent, /@error="handleImageError"/);
});
