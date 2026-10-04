import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";

import { useConversationCreation } from "../frontend/src/composables/useConversationCreation.js";

function createHarness(overrides = {}) {
	const users = ref([
		{ id: 1, username: "alice", displayName: "Alice" },
		{ id: 2, username: "bob", displayName: "Bob" },
		{ id: 3, username: "carol", displayName: "Carol" },
	]);
	const dms = ref([
		{ id: 12, kind: "dm", otherUser: { id: 2, username: "bob", displayName: "Bob" } },
	]);
	const error = ref("");
	const conversationItems = ref([{ id: 21, kind: "dm", source: { id: 21, kind: "dm" } }]);
	const calls = [];
	const conversationApi = {
		async openDm(userId) {
			calls.push(["openDm", userId]);
			return { dm: { id: 21, kind: "dm", otherUser: users.value[0] } };
		},
		...overrides.conversationApi,
	};
	const creation = useConversationCreation({
		users,
		dms,
		error,
		conversationItems,
		refreshSidebar: async () => calls.push(["refreshSidebar"]),
		openConversation: async (item) => calls.push(["openConversation", item]),
		openGroupDialog: () => calls.push(["openGroupDialog"]),
		conversationApi,
	});

	return { creation, users, error, calls, conversationItems };
}

test("添加人员入口同时保留新私聊和创建群聊动作", () => {
	const { creation, users, calls } = createHarness();
	assert.deepEqual(
		creation.usersWithoutDm.value.map((user) => user.id),
		[1, 3],
	);

	creation.open();
	assert.equal(creation.show.value, true);
	creation.startGroupCreation();
	assert.equal(creation.show.value, false);
	assert.deepEqual(calls, [["openGroupDialog"]]);

	users.value.push({ id: 4, username: "dave", displayName: "Dave" });
	assert.deepEqual(
		creation.usersWithoutDm.value.map((user) => user.id),
		[1, 3, 4],
	);
});

test("发起新私聊后刷新侧栏并自动打开对应会话", async () => {
	const { creation, users, calls } = createHarness();
	creation.open();
	await creation.openDm(users.value[0]);

	assert.deepEqual(calls, [
		["openDm", 1],
		["refreshSidebar"],
		["openConversation", { id: 21, kind: "dm", source: { id: 21, kind: "dm" } }],
	]);
	assert.equal(creation.show.value, false);
	assert.equal(creation.openingDmUserId.value, null);
});

test("私聊创建失败时保留弹窗并向用户显示错误", async () => {
	const { creation, users, error, calls } = createHarness({
		conversationApi: {
			async openDm(userId) {
				calls.push(["openDm", userId]);
				throw new Error("暂时无法发起对话");
			},
		},
	});
	creation.open();
	await creation.openDm(users.value[2]);

	assert.equal(creation.show.value, true);
	assert.equal(creation.openingDmUserId.value, null);
	assert.equal(error.value, "暂时无法发起对话");
	assert.deepEqual(calls, [["openDm", 3]]);
});
