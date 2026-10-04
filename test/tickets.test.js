import assert from "node:assert/strict";
import test from "node:test";

import {
	createFileScope,
	createWsInboxScope,
	createWsRoomScope,
	FILE_TICKET_TTL_SECONDS,
	issueUrlTicket,
	resolveUrlTicket,
	WS_TICKET_TTL_SECONDS,
} from "../worker/src/tickets.js";

function createEnvHarness() {
	const store = new Map();
	return {
		env: {
			SESSIONS: {
				async get(key) {
					return store.get(key) || null;
				},
				async put(key, value, opts) {
					store.set(key, value);
					if (opts?.expirationTtl !== undefined) {
						store.set(`${key}#ttl`, opts.expirationTtl);
					}
				},
				async delete(key) {
					store.delete(key);
					store.delete(`${key}#ttl`);
				},
			},
			DB: {
				prepare() {
					return {
						bind() {
							return {
								async all() {
									return { results: [{ username: "alice", is_disabled: 0, deleted_at: null, session_version: 1, is_admin: 0 }] };
								},
							};
						},
					};
				},
			},
		},
		store,
	};
}

function createSessionToken(env, userId = 1) {
	const session = {
		token: "session-token",
		userId,
		username: "alice",
		displayName: "Alice",
		avatarUrl: "",
		isAdmin: false,
		sessionVersion: 1,
	};
	env.SESSIONS.put(session.token, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 7 });
	return session;
}

test("scope 构造器产出用途绑定的确定字符串", () => {
	assert.equal(createWsRoomScope("private", 12), "ws:room:private:12");
	assert.equal(createWsRoomScope("public", "7"), "ws:room:public:7");
	assert.equal(createWsInboxScope(), "ws:inbox");
	assert.equal(createFileScope(), "file");
});

test("issue + resolve 完整往返返回活会话", async () => {
	const { env } = createEnvHarness();
	const session = createSessionToken(env);

	const issued = await issueUrlTicket(env, {
		purpose: "ws",
		scope: createWsRoomScope("private", 12),
		session,
		ttlSeconds: WS_TICKET_TTL_SECONDS,
	});

	assert.ok(issued.ticket && issued.ticket.length > 20);
	assert.equal(issued.expiresIn, WS_TICKET_TTL_SECONDS);
	assert.match(issued.ticket, /^[A-Za-z0-9_-]+$/);

	const resolved = await resolveUrlTicket(env, issued.ticket, {
		purpose: "ws",
		scope: createWsRoomScope("private", 12),
	});
	assert.equal(resolved.ok, true);
	assert.equal(resolved.session.userId, 1);
});

test("scope 不匹配时拒绝并删除 ticket", async () => {
	const { env, store } = createEnvHarness();
	const session = createSessionToken(env);

	const issued = await issueUrlTicket(env, {
		purpose: "ws",
		scope: createWsRoomScope("private", 12),
		session,
		ttlSeconds: WS_TICKET_TTL_SECONDS,
	});

	const resolved = await resolveUrlTicket(env, issued.ticket, {
		purpose: "ws",
		scope: createWsRoomScope("private", 999),
	});
	assert.equal(resolved, null);
	assert.equal(store.has(`ticket:ws:${issued.ticket}`), false);
});

test("purpose 不匹配(拿 ws ticket 当 file)时拒绝", async () => {
	const { env } = createEnvHarness();
	const session = createSessionToken(env);

	const issued = await issueUrlTicket(env, {
		purpose: "ws",
		scope: createWsRoomScope("dm", 3),
		session,
		ttlSeconds: WS_TICKET_TTL_SECONDS,
	});

	const resolved = await resolveUrlTicket(env, issued.ticket, {
		purpose: "file",
		scope: createFileScope(),
	});
	assert.equal(resolved, null);
});

test("会话失效(被注销)后 ticket 立即失效", async () => {
	const { env, store } = createEnvHarness();
	const session = createSessionToken(env);

	const issued = await issueUrlTicket(env, {
		purpose: "file",
		scope: createFileScope(),
		session,
		ttlSeconds: FILE_TICKET_TTL_SECONDS,
	});
	store.delete("session-token");

	const resolved = await resolveUrlTicket(env, issued.ticket, {
		purpose: "file",
		scope: createFileScope(),
	});
	assert.equal(resolved, null);
	assert.equal(store.has(`ticket:file:${issued.ticket}`), false);
});

test("未知或空 ticket 直接返回 null", async () => {
	const { env } = createEnvHarness();
	assert.equal(
		await resolveUrlTicket(env, "", { purpose: "file", scope: createFileScope() }),
		null,
	);
	assert.equal(
		await resolveUrlTicket(env, "not-exist", { purpose: "file", scope: createFileScope() }),
		null,
	);
});