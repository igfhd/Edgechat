import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexHtml = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const attachmentStyles = readFileSync(
	new URL("../frontend/src/styles/chat-attachments.css", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const mobileDrawer = readFileSync(
	new URL("../frontend/src/components/chat/MobileNavigationDrawer.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

function getStyleRule(source, selector) {
	const marker = `${selector} {`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `聊天页缺少样式规则：${selector}`);
	const end = source.indexOf("}", start + marker.length);
	assert.notEqual(end, -1, `聊天页样式规则未闭合：${selector}`);
	return source.slice(start, end + 1);
}

test("聊天界面使用原始控件尺寸铺满整个视口", () => {
	const layout = getStyleRule(chatPage, ".chat-layout");
	assert.match(layout, /width:\s*100%;/);
	assert.match(layout, /height:\s*var\(--chat-viewport-height,\s*100dvh\);/);
	assert.match(layout, /position:\s*fixed;/);
	assert.match(layout, /top:\s*var\(--chat-viewport-offset-top,\s*0px\);/);
	assert.match(layout, /overflow:\s*hidden;/);
	assert.match(indexHtml, /interactive-widget=resizes-content/);
	assert.doesNotMatch(chatPage, /--chat-interface-scale/);
	assert.doesNotMatch(chatPage, /zoom\s*:/);
	assert.doesNotMatch(chatPage, /width:\s*80%;/);
	assert.doesNotMatch(chatPage, /height:\s*80vh;/);
});

test("移动端附件预览不会挤出发送按钮", () => {
	assert.match(chatPage, /\.composer-attachment\s*{[^}]*min-width:\s*0;/s);
	assert.match(chatPage, /\.composer-row\s*{[^}]*min-width:\s*0;/s);
	assert.match(chatPage, /\.composer-send\s*{[^}]*flex-shrink:\s*0;/s);
	assert.match(attachmentStyles, /\.pending-attachment\s*{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
	assert.match(attachmentStyles, /\.pending-attachment__name\s*{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/s);
});

test("移动端前台滚动区允许纵向触摸滑动", () => {
	assert.match(chatPage, /\.sidebar-list\s*{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
	assert.match(chatPage, /\.chat-messages\s*{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
	assert.match(mobileDrawer, /\.mobile-navigation-drawer\s*{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
});

test("移动端聊天页只显示会话列表或当前聊天中的一个视图", () => {
	assert.match(chatPage, /'chat-layout--mobile-list': isMobileViewport && mobileView === 'list'/);
	assert.match(chatPage, /'chat-layout--mobile-chat': isMobileViewport && mobileView === 'chat'/);
	assert.match(
		chatPage,
		/\.chat-layout--mobile-list \.chat-main,\s*\.chat-layout--mobile-chat \.left-sidebar\s*{\s*display:\s*none;/s,
	);
	assert.match(chatPage, /class="chat-header__back"/);
	assert.match(chatPage, /@click="returnToMobileConversationList"/);
});

test("移动端主要图标按钮保留四十四像素触控区域", () => {
	assert.match(chatPage, /\.mobile-menu-action\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
	assert.match(chatPage, /\.chat-header__back\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
	assert.match(chatPage, /\.chat-header__button\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
	assert.match(chatPage, /\.composer-btn,\s*\.composer-send\s*{\s*width:\s*44px;\s*height:\s*44px;/s);
	assert.match(chatPage, /font-size:\s*16px;/);
});

test("聊天侧栏跟随全屏根节点且不污染后台根节点", () => {
	for (const selector of [
		".left-sidebar",
		".right-sidebar",
		".room-management-sidebar",
	]) {
		assert.match(getStyleRule(chatPage, selector), /height:\s*100%;/);
	}

	assert.doesNotMatch(chatPage, /(?:html|body|#app|\.admin-page)\s*{[^}]*zoom:/s);
});

test("桌面端管理后台入口在图标下方显示文字", () => {
	assert.match(chatPage, /class="right-sidebar-action right-sidebar-action--admin tooltip"/);
	assert.match(chatPage, /<span class="right-sidebar-action__label">管理后台<\/span>/);
	assert.match(chatPage, /\.right-sidebar-action--admin\s*{[^}]*flex-direction:\s*column;/s);
	assert.match(chatPage, /\.right-sidebar-action__label\s*{[^}]*font-size:\s*10px;/s);
});

test("顶部操作栏移除 GitHub 仓库入口以防误触并保持按钮尺寸稳定", () => {
	const githubLink = chatPage.indexOf('href="https://github.com/aozorae/Edgechat"');
	assert.equal(githubLink, -1);

	const headerAction = getStyleRule(chatPage, ".header-action");
	assert.match(headerAction, /flex:\s*0 0 36px;/);
	assert.match(headerAction, /width:\s*36px;/);
	assert.match(headerAction, /height:\s*36px;/);
});

test("聊天顶部操作按钮支持横向自适应滑动并在中窄屏隐藏文字", () => {
	assert.match(chatPage, /\.chat-header__actions\s*\{[^}]*overflow-x:\s*auto;/s);
	assert.match(chatPage, /\.chat-header__actions\s*\{[^}]*touch-action:\s*pan-x;/s);
	assert.match(chatPage, /@media\s*\(max-width:\s*1280px\)/);
});
