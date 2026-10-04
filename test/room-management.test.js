import assert from "node:assert/strict";
import test from "node:test";
import { computed, ref } from "vue";

import { useRoomManagement } from "../frontend/src/composables/useRoomManagement.js";

function createHarness(overrides = {}) {
	const activeRoom = ref({
		id: 4,
		kind: "private",
		name: "Team",
		canManage: true,
		myRole: "owner",
	});
	const channels = ref([{ id: 4, name: "Team" }]);
	const users = ref([
		{ id: 1, displayName: "Alice" },
		{ id: 2, displayName: "Bob" },
	]);
	const error = ref("");
	const calls = [];
	const roomApi = {
		async createGroup(payload) {
			calls.push(["createGroup", payload]);
			return { channel: { id: 9, kind: payload.kind } };
		},
		async getChannelMembers(id) {
			calls.push(["getChannelMembers", id]);
			return {
				room: { name: "Team 2", canManage: true, myRole: "owner" },
				members: [{ id: 1, displayName: "Alice", role: "owner" }],
			};
		},
		async inviteChannelMembers(id, userIds) {
			calls.push(["inviteChannelMembers", id, userIds]);
			return { members: [{ id: 1 }, { id: 2 }] };
		},
		async removeChannelMember(id, userId) {
			calls.push(["removeChannelMember", id, userId]);
			return { members: [{ id: 1 }] };
		},
		async deleteOwnedChannel(id) {
			calls.push(["deleteOwnedChannel", id]);
		},
		async updateChannel(id, payload) {
			calls.push(["updateChannel", id, payload]);
			return {
				channel: { id, name: payload.name, avatarKey: payload.avatarKey, avatarUrl: "/avatar" },
			};
		},
		async uploadFile(file) {
			calls.push(["uploadFile", file]);
			return { file: { key: "avatars/new.png", url: "/files/avatars%2Fnew.png" } };
		},
		...overrides.roomApi,
	};
	const conversationItems = ref([
		{ id: 9, kind: "private" },
		{ id: 9, kind: "public" },
	]);
	const refreshSidebar = async () => calls.push(["refreshSidebar"]);
	const openConversation = async (item) => calls.push(["openConversation", item]);
	const management = useRoomManagement({
		activeRoom,
		channels,
		users,
		error,
		refreshSidebar,
		conversationItems,
		openConversation,
		canManageActiveRoom: computed(() => Boolean(activeRoom.value?.canManage)),
		onRoomDeleted: () => calls.push(["onRoomDeleted"]),
		returnToConversationList: () => calls.push(["returnToConversationList"]),
		roomApi,
		confirmAction: overrides.confirmAction || (() => true),
	});
	return { management, activeRoom, channels, users, error, calls };
}

test("创建群组状态和导航由 room management module 统一拥有", async () => {
	const { management, calls } = createHarness();
	await management.creation.submit();
	assert.equal(calls.length, 0);

	management.creation.open();
	management.creation.form.name = "  New team  ";
	management.creation.toggleMember(2);
	await management.creation.submit();

	assert.deepEqual(calls, [
		["createGroup", { name: "New team", kind: "private", memberUserIds: [2] }],
		["refreshSidebar"],
		["openConversation", { id: 9, kind: "private" }],
	]);
	assert.equal(management.creation.show.value, false);
	assert.deepEqual(management.creation.form, {
		name: "",
		kind: "private",
		memberUserIds: [],
	});
});

test("公开群组创建会保留类型并允许不预先邀请成员", async () => {
	const { management, calls } = createHarness();
	management.creation.open();
	management.creation.form.name = "公开讨论";
	management.creation.form.kind = "public";
	await management.creation.submit();

	assert.deepEqual(calls, [
		["createGroup", { name: "公开讨论", kind: "public", memberUserIds: [] }],
		["refreshSidebar"],
		["openConversation", { id: 9, kind: "public" }],
	]);
});

test("成员加载、邀请和移除通过同一 module 接口更新状态", async () => {
	const { management, activeRoom, calls } = createHarness();
	await management.members.toggle();
	assert.equal(management.members.show.value, true);
	assert.equal(activeRoom.value.name, "Team 2");
	assert.equal(activeRoom.value.memberCount, 1);

	management.members.inviteUserId.value = "2";
	await management.members.invite();
	assert.equal(activeRoom.value.memberCount, 2);
	assert.equal(management.members.inviteUserId.value, "");
	await management.members.remove({ id: 2, displayName: "Bob" });
	assert.equal(activeRoom.value.memberCount, 1);
	assert.deepEqual(calls.filter(([name]) => name !== "refreshSidebar"), [
		["getChannelMembers", 4],
		["inviteChannelMembers", 4, [2]],
		["removeChannelMember", 4, 2],
	]);
});

test("群设置保存与头像上传同步 active room 和频道 projection", async () => {
	const { management, activeRoom, channels, calls } = createHarness();
	management.settings.open();
	management.settings.form.name = "  Renamed  ";
	const file = { name: "avatar.png" };
	const event = { target: { files: [file], value: "selected" } };
	await management.settings.uploadAvatar(event);
	await management.settings.save();

	assert.deepEqual(calls.filter(([name]) => name !== "refreshSidebar"), [
		["uploadFile", file],
		["updateChannel", 4, { name: "Renamed", avatarKey: "avatars/new.png" }],
	]);
	assert.equal(event.target.value, "");
	assert.equal(activeRoom.value.name, "Renamed");
	assert.equal(channels.value[0].avatarUrl, "/avatar");
	assert.equal(management.settings.show.value, false);
});

test("删除群组统一清理管理状态并通知页面 adapter", async () => {
	const { management, activeRoom, calls } = createHarness();
	await management.members.toggle();
	await management.deleteGroup();

	assert.equal(activeRoom.value, null);
	assert.equal(management.members.show.value, false);
	assert.deepEqual(calls.slice(-4), [
		["deleteOwnedChannel", 4],
		["onRoomDeleted"],
		["returnToConversationList"],
		["refreshSidebar"],
	]);
});

test("general 管理动作不会发出移除成员或删除群组请求", async () => {
	const { management, activeRoom, calls } = createHarness();
	activeRoom.value.isGeneral = true;

	await management.members.remove({ id: 2, displayName: "Bob" });
	await management.deleteGroup();

	assert.equal(calls.length, 0);
	assert.notEqual(activeRoom.value, null);
});

test("点击左侧会话或切换会话时自动隐藏右侧群成员列表", async () => {
	const { management } = createHarness();
	await management.members.toggle();
	assert.equal(management.members.show.value, true);

	// 模拟执行 closeMemberPanel
	management.members.close();
	assert.equal(management.members.show.value, false);

	// 验证 ChatPage 模板与函数绑定
	const { readFileSync } = await import("node:fs");
	const chatPageContent = readFileSync(new URL("../frontend/src/pages/ChatPage.vue", import.meta.url), "utf8");
	assert.match(chatPageContent, /handleChatMainClick/);
	assert.match(chatPageContent, /handleSidebarClick/);
	assert.match(chatPageContent, /@click="handleChatMainClick"/);
	assert.match(chatPageContent, /@click="handleSidebarClick"/);
});

test("MemberPanel 移除私聊入口以防跨组私信骚扰并保障展示简洁", async () => {
	const { readFileSync } = await import("node:fs");
	const memberPanelContent = readFileSync(new URL("../frontend/src/components/chat/MemberPanel.vue", import.meta.url), "utf8");
	assert.doesNotMatch(memberPanelContent, /canDirectMessage/);
	assert.doesNotMatch(memberPanelContent, /open-dm/);
	assert.match(memberPanelContent, /member-empty-hint/);
	assert.match(memberPanelContent, /member-btn--transfer/);
});
