import assert from "node:assert/strict";
import test from "node:test";

import { softDeleteMessage } from "../worker/src/data/messages.js";
import {
	createMessageDeletion,
	MessageDeletionError,
} from "../worker/src/message-deletion.js";

function createMutationDb(changes = 1) {
	const capture = { sql: "", binds: [] };
	return {
		capture,
		db: {
			prepare(sql) {
				capture.sql = sql;
				return {
					bind(...binds) {
						capture.binds = binds;
						return this;
					},
					async run() {
						return { meta: { changes } };
					},
					async all() {
						return { results: [{ id: 4, kind: "private" }] };
					}
				};
			},
		},
	};
}

test("消息软删除限定消息与房间，并保留记录供后续清理", async () => {
	const { db, capture } = createMutationDb();

	assert.equal(await softDeleteMessage(db, { channelId: "4", messageId: "9" }), true);
	assert.deepEqual(capture.binds, [9, 4]);
	assert.match(capture.sql, /SET deleted_at = CURRENT_TIMESTAMP/);
	assert.match(capture.sql, /AND deleted_at IS NULL/);
});

test("发送者本人可以删除自己发送的消息（全局删除）", async () => {
	const calls = [];
	const remove = createMessageDeletion({
		async findMessage(_env, messageId) {
			return {
				id: messageId,
				channelId: 4,
				createdAt: new Date().toISOString(),
				sender: { kind: "local", id: 7, displayName: "Alice" }
			};
		},
		async persistDeletion(db, args) {
			calls.push({ type: "persist", db, args });
			return true;
		},
	});
	const { db } = createMutationDb();
	const result = await remove(
		{ DB: db },
		{ room: { id: 4, kind: "private" }, principal: { userId: 7 } },
		{ messageId: "9" },
	);

	assert.deepEqual(calls, [
		{ type: "persist", db, args: { channelId: 4, messageId: 9 } },
	]);
	const packet = JSON.parse(result.packet);
	assert.equal(packet.type, "message_deleted");
	assert.equal(packet.messageId, 9);
	assert.equal(packet.senderDisplayName, "Alice");
	assert.equal(packet.isAdminDelete, false);
});

test("普通用户可以删除自己发送的超过5分钟的历史消息（无时间限制，全局删除）", async () => {
	const calls = [];
	const remove = createMessageDeletion({
		async findMessage(_env, messageId) {
			return {
				id: messageId,
				channelId: 4,
				createdAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
				sender: { kind: "local", id: 7, displayName: "Alice" }
			};
		},
		async persistDeletion(db, args) {
			calls.push({ type: "persist", db, args });
			return true;
		},
	});
	const { db } = createMutationDb();
	const result = await remove(
		{ DB: db },
		{ room: { id: 4, kind: "private" }, principal: { userId: 7, isAdmin: false } },
		{ messageId: "9" },
	);
	assert.deepEqual(calls, [
		{ type: "persist", db, args: { channelId: 4, messageId: 9 } },
	]);
	const packet = JSON.parse(result.packet);
	assert.equal(packet.type, "message_deleted");
	assert.equal(packet.messageId, 9);
	assert.equal(packet.isAdminDelete, false);
});

test("系统管理员与群主可以删除超过5分钟的历史消息", async () => {
	const remove = createMessageDeletion({
		async findMessage(_env, messageId) {
			return {
				id: messageId,
				channelId: 4,
				createdAt: new Date(Date.now() - 100 * 60 * 1000).toISOString(),
				sender: { kind: "local", id: 99 } // other user
			};
		},
		async persistDeletion() {
			return true;
		},
	});
	const { db } = createMutationDb();
	// Admin
	const adminResult = await remove(
		{ DB: db },
		{ room: { id: 4, kind: "private" }, principal: { userId: 1, isAdmin: true } },
		{ messageId: 9 },
	);
	const packet = JSON.parse(adminResult.packet);
	assert.equal(packet.type, "message_deleted");
	assert.equal(packet.messageId, 9);
	assert.equal(packet.isAdminDelete, true);
});

test("普通成员无权删除他人发送的消息", async () => {
	const remove = createMessageDeletion({
		async findMessage(_env, messageId) {
			return {
				id: messageId,
				channelId: 4,
				sender: { kind: "local", id: 99 } // other user
			};
		},
		async persistDeletion() {
			return true;
		},
	});
	// Mock DB where principal (userId: 7) is NOT owner
	const db = {
		prepare(sql) {
			return {
				bind() {
					return this;
				},
				async all() {
					if (sql.includes("channel_members")) {
						return { results: [{ role: "member" }] };
					}
					return { results: [{ id: 4, kind: "private" }] };
				}
			};
		}
	};

	await assert.rejects(
		remove(
			{ DB: db },
			{ room: { id: 4, kind: "private" }, principal: { userId: 7, isAdmin: false } },
			{ messageId: 9 },
		),
		(error) => error instanceof MessageDeletionError && error.message === "无权删除该消息",
	);
});
