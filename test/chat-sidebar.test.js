import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { useChatSidebar } from "../frontend/src/composables/useChatSidebar.js";

const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

test("ChatPage provides enhanced styles for active, pinned and muted sidebar items", () => {
	assert.match(chatPage, /class="sidebar-item"/);
	assert.match(chatPage, /sidebar-item--active/);
	assert.match(chatPage, /sidebar-item--pinned/);
	assert.match(chatPage, /sidebar-unread-badge--muted/);
	assert.match(chatPage, /\.sidebar-item--active::before/);
});

test("general 在私信和其他群组之前永久置顶", () => {
	const sidebar = useChatSidebar({
		applyActiveChannel() {},
		selectDm() {},
	});
	const newer = "2026-07-28T12:00:00.000Z";
	const older = "2026-07-01T12:00:00.000Z";

	sidebar.channels.value = [
		{
			id: 1,
			name: "general",
			kind: "public",
			isGeneral: true,
			isMember: true,
			lastMessageAt: older,
		},
		{
			id: 2,
			name: "Team",
			kind: "private",
			isGeneral: false,
			isMember: true,
			lastMessageAt: newer,
		},
		{
			id: 4,
			name: "公开讨论",
			kind: "public",
			isGeneral: false,
			isMember: false,
			memberCount: 3,
			lastMessageAt: newer,
		},
	];
	sidebar.dms.value = [
		{
			id: 3,
			kind: "dm",
			otherUser: { username: "alice", displayName: "Alice", avatarUrl: "" },
			lastMessageAt: newer,
		},
	];

	assert.deepEqual(
		sidebar.conversationItems.value.map((item) => item.key),
		["public:1", "dm:3", "private:2"],
	);
	assert.deepEqual(
		sidebar.groupConversations.value.map((item) => item.key),
		["public:1", "private:2"],
	);
	assert.deepEqual(
		sidebar.dmConversations.value.map((item) => item.key),
		["dm:3"],
	);
	assert.equal(sidebar.conversationItems.value[0].subtitle, "全员群组");
	assert.deepEqual(
		sidebar.publicGroupItems.value.map((item) => item.key),
		["public:4"],
	);
	assert.equal(sidebar.publicGroupItems.value[0].subtitle, "3 位成员");
});

test("未加入公开群确认加入后才进入普通会话列表", async () => {
	const calls = [];
	const sidebar = useChatSidebar({
		applyActiveChannel() {},
		selectDm() {},
		sidebarApi: {
			async joinChannel(channelId) {
				calls.push(["joinChannel", channelId]);
			},
			async markRoomRead() {},
			async bootstrap() {
				return { channels: [], dms: [], users: [] };
			},
		},
	});
	const channel = {
		id: 8,
		name: "开发交流",
		kind: "public",
		isGeneral: false,
		isMember: false,
		memberCount: 5,
	};
	sidebar.channels.value = [channel];

	assert.equal(sidebar.conversationItems.value.length, 0);
	assert.equal(sidebar.publicGroupItems.value.length, 1);
	await sidebar.joinPublicChannel(channel);

	assert.deepEqual(calls, [["joinChannel", 8]]);
	assert.equal(channel.isMember, true);
	assert.equal(channel.myRole, "member");
	assert.equal(channel.memberCount, 6);
	assert.equal(sidebar.publicGroupItems.value.length, 0);
	assert.deepEqual(
		sidebar.conversationItems.value.map((item) => item.key),
		["public:8"],
	);
});

test("ChatPage provides conversation search bar with dynamic filtering and clear action", () => {
	assert.match(chatPage, /class="sidebar-search-wrap"/);
	assert.match(chatPage, /class="sidebar-search-box"/);
	assert.match(chatPage, /class="sidebar-search-input"/);
	assert.match(chatPage, /v-model="conversationSearchText"/);
	assert.match(chatPage, /@keydown\.esc="clearConversationSearch"/);
	assert.match(chatPage, /class="sidebar-search-clear"/);
	assert.match(chatPage, /class="sidebar-search-empty"/);
	assert.match(chatPage, /function clearConversationSearch/);
	assert.match(chatPage, /function matchesConversation/);
});

test("ChatPage differentiates group chats and private chats with distinct styles, badges and avatar shapes", () => {
	// Class distinction
	assert.match(chatPage, /'sidebar-item--group':\s*true/);
	assert.match(chatPage, /'sidebar-item--dm':\s*true/);
	assert.match(chatPage, /'sidebar-item--general':\s*item\.isGeneral/);

	// Avatar squircle vs circular distinction
	assert.match(chatPage, /\.sidebar-item--group :deep\(\.ui-avatar\)[\s\S]*?border-radius:\s*11px !important;/);
	assert.match(chatPage, /\.sidebar-item--dm :deep\(\.ui-avatar\)[\s\S]*?border-radius:\s*50% !important;/);

	// Avatar badge overlay
	assert.match(chatPage, /sidebar-avatar-badge/);
	assert.match(chatPage, /sidebar-avatar-badge--group/);
	assert.match(chatPage, /sidebar-avatar-badge--general/);

	// Tags next to title
	assert.match(chatPage, /sidebar-tag--group/);
	assert.match(chatPage, /sidebar-tag--general/);
	assert.match(chatPage, /sidebar-tag--dm/);

	// Indigo accent for group active/hover, emerald for DM
	assert.match(chatPage, /\.sidebar-item--group\.sidebar-item--active[\s\S]*?background: #6366f1/);
	assert.match(chatPage, /\.sidebar-item--dm:hover/);
});

test("ChatPage automatically expands sections and subgroups during search when matching conversations exist", () => {
	assert.match(chatPage, /isGroupSectionEffectiveExpanded/);
	assert.match(chatPage, /isDmSectionEffectiveExpanded/);
	assert.match(chatPage, /isDmGroupEffectiveExpanded/);
	assert.match(chatPage, /filteredGroupConversations/);
	assert.match(chatPage, /filteredDmConversations/);
	assert.match(chatPage, /filteredGroupedDmSections/);
});

test("ChatPage visually distinguishes public groups and private groups with distinct icons, badges, tags and color accents", () => {
	// Import Globe and Lock icons
	assert.match(chatPage, /import\s*\{[^}]*\bGlobe\b[^}]*\}\s*from\s*'@lucide\/vue'/);
	assert.match(chatPage, /import\s*\{[^}]*\bLock\b[^}]*\}\s*from\s*'@lucide\/vue'/);

	// Class distinction on group buttons
	assert.match(chatPage, /'sidebar-item--public':\s*!item\.isGeneral && item\.kind === 'public'/);
	assert.match(chatPage, /'sidebar-item--private':\s*!item\.isGeneral && item\.kind === 'private'/);

	// Avatar badge distinctions
	assert.match(chatPage, /'sidebar-avatar-badge--public':\s*!item\.isGeneral && item\.kind === 'public'/);
	assert.match(chatPage, /'sidebar-avatar-badge--private':\s*!item\.isGeneral && item\.kind === 'private'/);
	assert.match(chatPage, /\.sidebar-avatar-badge--public\s*\{\s*background:\s*#0284c7;/);
	assert.match(chatPage, /\.sidebar-avatar-badge--private\s*\{\s*background:\s*#6366f1;/);

	// Title tag distinctions
	assert.match(chatPage, /sidebar-tag--public/);
	assert.match(chatPage, /sidebar-tag--private/);
	assert.match(chatPage, /\.sidebar-tag--public\s*\{[\s\S]*?color:\s*#0369a1;/);
	assert.match(chatPage, /\.sidebar-tag--private\s*\{[\s\S]*?color:\s*#4338ca;/);

	// Distinct active accents: sky blue for public (#0284c7), indigo for private (#6366f1)
	assert.match(chatPage, /\.sidebar-item--public\.sidebar-item--active::before\s*\{\s*background:\s*#0284c7;/);
	assert.match(chatPage, /\.sidebar-item--private\.sidebar-item--active::before\s*\{\s*background:\s*#6366f1;/);

	// Search keyword matching includes public and private
	assert.match(chatPage, /公开群/);
	assert.match(chatPage, /私密群/);
});

test("ChatPage defaults group chat section to collapsed state", () => {
	assert.match(
		chatPage,
		/const isGroupSectionExpanded = ref\(localStorage\.getItem\('edgechat_group_section_expanded'\) === 'true'\)/,
	);
});


