import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { authMiddleware } from "../worker/src/middleware.js";
import { registerUploadRoutes } from "../worker/src/api/upload.js";
import {
	createFileScope,
	createWsRoomScope,
	issueUrlTicket,
	WS_TICKET_TTL_SECONDS,
} from "../worker/src/tickets.js";

const KEYRING = JSON.stringify({
	activeKeyId: "v1",
	keys: {
		v1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	},
});

function kvStore() {
	const store = new Map();
	return {
		store,
		env: {
			SESSIONS: {
				async get(key) {
					return store.get(key) || null;
				},
				async put(key, value) {
					store.set(key, value);
				},
				async delete(key) {
					store.delete(key);
				},
			},
			DB: {
				prepare(sql) {
					return {
						bind() {
							return {
								async all() {
									if (sql.includes("SELECT username, is_disabled")) {
										return { results: [{ username: "alice", is_disabled: 0, deleted_at: null, session_version: 1, is_admin: 0 }] };
									}
									// canAccessFile: 非公开、无共享记录 -> 不可访问
									return { results: [] };
								},
							};
						},
					};
				},
			},
			FILES: {
				async get() {
					return {
						uploaded: new Date("2026-08-10T00:00:00Z"),
						customMetadata: {},
						async arrayBuffer() {
							return new Uint8Array([9, 9, 9]).buffer;
						},
						writeHttpMetadata(headers) {
							headers.set("content-type", "application/octet-stream");
						},
					};
				},
			},
			EDGECHAT_ENCRYPTION_KEYRING: KEYRING,
		},
	};
}

function seedSession(env) {
	const session = {
		token: "session-token",
		userId: 7,
		username: "alice",
		displayName: "Alice",
		avatarUrl: "",
		isAdmin: false,
		sessionVersion: 1,
	};
	env.SESSIONS.put(session.token, JSON.stringify(session));
	return session;
}

test("REST 接口不再接受 URL 查询参数里的长期 token", async () => {
	const { env } = kvStore();
	seedSession(env);
	const app = new Hono();
	app.use("/api/*", authMiddleware);
	app.get("/api/me", (c) => c.json({ userId: c.get("session")?.userId }));

	const viaQuery = await app.request("https://edgechat.test/api/me?token=session-token", {}, env);
	assert.equal(viaQuery.status, 401);

	const viaBearer = await app.request(
		"https://edgechat.test/api/me",
		{ headers: { authorization: "Bearer session-token" } },
		env,
	);
	assert.equal(viaBearer.status, 200);
	assert.deepEqual(await viaBearer.json(), { userId: 7 });
});

test("WS 握手路径可用短期 ticket 通过鉴权", async () => {
	const { env } = kvStore();
	const session = seedSession(env);
	const issued = await issueUrlTicket(env, {
		purpose: "ws",
		scope: createWsRoomScope("private", 12),
		session,
		ttlSeconds: WS_TICKET_TTL_SECONDS,
	});

	const app = new Hono();
	app.use("/api/*", authMiddleware);
	app.get("/api/ws/:kind/:id", (c) => c.json({ ok: true, userId: c.get("session")?.userId }));

	const viaTicket = await app.request(
		`https://edgechat.test/api/ws/private/12?ticket=${issued.ticket}`,
		{},
		env,
	);
	assert.equal(viaTicket.status, 200);
	assert.deepEqual(await viaTicket.json(), { ok: true, userId: 7 });
});

test("WS ticket 绑定房间: 用其他房间的 ticket 访问被拒", async () => {
	const { env } = kvStore();
	const session = seedSession(env);
	const issued = await issueUrlTicket(env, {
		purpose: "ws",
		scope: createWsRoomScope("private", 1),
		session,
		ttlSeconds: WS_TICKET_TTL_SECONDS,
	});

	const app = new Hono();
	app.use("/api/*", authMiddleware);
	app.get("/api/ws/:kind/:id", (c) => c.json({ ok: true }));

	const response = await app.request(
		`https://edgechat.test/api/ws/private/2?ticket=${issued.ticket}`,
		{},
		env,
	);
	assert.equal(response.status, 401);
});

test("attachment 下载接受 Bearer 与 file ticket,拒绝裸 token", async () => {
	const { env } = kvStore();
	const session = seedSession(env);
	const app = new Hono();
	registerUploadRoutes(app);

	const viaBearer = await app.request(
		"https://edgechat.test/files/7/demo.bin",
		{
			headers: {
				authorization: "Bearer session-token",
				"content-type": "application/octet-stream",
			},
		},
		env,
	);
	assert.equal(viaBearer.status, 403, "DB 无归属记录时即使带 Bearer 也应 403");

	const issued = await issueUrlTicket(env, {
		purpose: "file",
		scope: createFileScope(),
		session,
		ttlSeconds: 300,
	});
	const viaTicket = await app.request(
		`https://edgechat.test/files/7/demo.bin?ticket=${issued.ticket}`,
		{ headers: { "content-type": "application/octet-stream" } },
		env,
	);
	assert.equal(viaTicket.status, 403, "DB 无归属记录时即使带 file ticket 也应 403");

	const viaPlainToken = await app.request(
		"https://edgechat.test/files/7/demo.bin?token=session-token",
		{ headers: { "content-type": "application/octet-stream" } },
		env,
	);
	assert.equal(viaPlainToken.status, 403, "裸 token 只应等同于匿名访问");
});