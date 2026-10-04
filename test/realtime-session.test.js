import assert from "node:assert/strict";
import test from "node:test";

import {
	createRealtimeSession,
	parseRealtimeFrame,
} from "../frontend/src/realtime-session.js";

function createSocketHarness() {
	const sockets = [];
	function openConnection(params, handlers) {
		const socket = {
			params,
			handlers,
			readyState: 0,
			closeCalls: 0,
			sent: [],
			close() {
				this.closeCalls += 1;
				this.readyState = 3;
			},
			send(data) {
				this.sent.push(data);
			},
			emitStatus(event) {
				if (event.status === "open") {
					this.readyState = 1;
				}
				if (event.status === "closed") {
					this.readyState = 3;
				}
				this.handlers.onStatus(event);
			},
			emitMessage(payload) {
				this.handlers.onMessage(payload, this);
			},
		};
		sockets.push(socket);
		return socket;
	}

	return { openConnection, sockets };
}

test("同一 key 在连接建立前重复 connect 只创建一条连接", () => {
	const harness = createSocketHarness();
	const session = createRealtimeSession({ openConnection: harness.openConnection });

	session.connect("room:1", { roomId: 1 });
	session.connect("room:1", { roomId: 1 });

	assert.equal(harness.sockets.length, 1);
	assert.equal(harness.sockets[0].closeCalls, 0);
});

test("切换 key 会关闭尚未建立的旧连接并丢弃旧事件", () => {
	const harness = createSocketHarness();
	const messages = [];
	const session = createRealtimeSession({
		openConnection: harness.openConnection,
		onMessage(payload) {
			messages.push(payload);
		},
	});

	session.connect("room:1", { roomId: 1 });
	const oldSocket = harness.sockets[0];
	session.connect("room:2", { roomId: 2 });
	const currentSocket = harness.sockets[1];

	assert.equal(oldSocket.closeCalls, 1);
	oldSocket.emitStatus({ status: "open" });
	oldSocket.emitMessage(JSON.stringify({ id: "stale" }));
	currentSocket.emitStatus({ status: "open" });
	currentSocket.emitMessage(JSON.stringify({ id: "current" }));

	assert.deepEqual(messages, [{ id: "current" }]);
	assert.equal(session.isOpenFor("room:2"), true);
});

test("协议解析集中处理 JSON、文本与二进制帧", () => {
	assert.deepEqual(parseRealtimeFrame('{"type":"message","id":1}'), {
		type: "message",
		id: 1,
	});
	assert.deepEqual(parseRealtimeFrame("plain text"), {
		type: "system",
		message: "plain text",
	});
	const bytes = new TextEncoder().encode('{"type":"pong"}');
	assert.deepEqual(parseRealtimeFrame(bytes.buffer), { type: "pong" });
	assert.deepEqual(parseRealtimeFrame(bytes.subarray(0)), { type: "pong" });
});

test("同步 open/message 回调不会因 transport 初始化时序丢失", () => {
	const messages = [];
	const statuses = [];
	const session = createRealtimeSession({
		openConnection(_params, handlers) {
			const socket = {
				readyState: 1,
				close() {},
				send() {},
			};
			handlers.onStatus({ status: "open", socket });
			handlers.onMessage('{"type":"ready"}', socket);
			return socket;
		},
		onStatus(event) {
			statuses.push(event.status);
		},
		onMessage(message) {
			messages.push(message);
		},
	});

	session.connect("room:1");
	assert.deepEqual(statuses, ["connecting", "open"]);
	assert.deepEqual(messages, [{ type: "ready" }]);
	assert.equal(session.isOpenFor("room:1"), true);
});

test("send 只向当前已打开连接发送", () => {
	const harness = createSocketHarness();
	const session = createRealtimeSession({ openConnection: harness.openConnection });
	session.connect("room:1");
	assert.equal(session.send("before-open", "room:1"), false);
	harness.sockets[0].emitStatus({ status: "open" });
	assert.equal(session.send("hello", "room:1"), true);
	assert.deepEqual(harness.sockets[0].sent, ["hello"]);
});

test("新连接打开后才关闭仍在服务的旧连接", () => {
	const harness = createSocketHarness();
	const session = createRealtimeSession({ openConnection: harness.openConnection });

	session.connect("room:1");
	const oldSocket = harness.sockets[0];
	oldSocket.emitStatus({ status: "open" });
	session.connect("room:2");
	const currentSocket = harness.sockets[1];

	assert.equal(oldSocket.closeCalls, 0);
	currentSocket.emitStatus({ status: "open" });
	assert.equal(oldSocket.closeCalls, 1);
});

test("策略关闭码不重连，网络关闭会重连", async () => {
	const harness = createSocketHarness();
	const session = createRealtimeSession({
		openConnection: harness.openConnection,
		reconnectDelays: [0],
	});

	session.connect("room:1");
	harness.sockets[0].emitStatus({ status: "open" });
	harness.sockets[0].emitStatus({ status: "closed", code: 4403 });
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(harness.sockets.length, 1);

	session.connect("room:1");
	harness.sockets[1].emitStatus({ status: "open" });
	harness.sockets[1].emitStatus({ status: "closed", code: 1006 });
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(harness.sockets.length, 3);
});

test("disconnect 会取消待执行的重连", async () => {
	const harness = createSocketHarness();
	const session = createRealtimeSession({
		openConnection: harness.openConnection,
		reconnectDelays: [5],
	});

	session.connect("room:1");
	harness.sockets[0].emitStatus({ status: "open" });
	harness.sockets[0].emitStatus({ status: "closed", code: 1006 });
	session.disconnect();
	await new Promise((resolve) => setTimeout(resolve, 15));

	assert.equal(harness.sockets.length, 1);
	assert.equal(session.isOpenFor("room:1"), false);
});

function createAsyncSocketHarness() {
	const pending = [];
	function openConnection(params, handlers) {
		let resolveSocket;
		const promise = new Promise((resolve) => {
			resolveSocket = resolve;
		});
		pending.push({ params, handlers, resolve: resolveSocket });
		return promise;
	}

	function settle(index, status = "open") {
		const entry = pending[index];
		const socket = {
			entry,
			readyState: status === "open" ? 1 : 0,
			closeCalls: 0,
			sent: [],
			close() {
				this.closeCalls += 1;
				this.readyState = 3;
			},
			send(data) {
				this.sent.push(data);
			},
		};
		entry.handlers.onStatus({ status, socket });
		entry.resolve(socket);
		return socket;
	}

	return { openConnection, pending, settle };
}

test("异步 openConnection(ticket 先取后连)落地后正常进入 open", async () => {
	const harness = createAsyncSocketHarness();
	const statuses = [];
	const session = createRealtimeSession({
		openConnection: harness.openConnection,
		onStatus(event) {
			statuses.push(event.status);
		},
	});

	session.connect("room:1");
	assert.deepEqual(statuses, ["connecting"]);
	assert.equal(session.isOpenFor("room:1"), false);

	const socket = harness.settle(0);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(statuses.includes("open"), true);
	assert.equal(session.isOpenFor("room:1"), true);
	assert.equal(socket.closeCalls, 0);
});

test("异步 openConnection 落地前切换 key 会关闭过期连接", async () => {
	const harness = createAsyncSocketHarness();
	const session = createRealtimeSession({
		openConnection: harness.openConnection,
	});

	session.connect("room:1");
	session.connect("room:2");
	assert.equal(harness.pending.length, 2);

	const stale = harness.settle(0);
	const current = harness.settle(1);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(stale.closeCalls, 1);
	assert.equal(current.closeCalls, 0);
	assert.equal(session.isOpenFor("room:2"), true);
	assert.equal(session.isOpenFor("room:1"), false);
});

test("异步 openConnection 失败时进入 closed 并允许重连", async () => {
	let rejectOpen;
	const session = createRealtimeSession({
		openConnection() {
			return new Promise((_resolve, reject) => {
				rejectOpen = reject;
			});
		},
		reconnectDelays: [0],
	});

	session.connect("room:1");
	rejectOpen(new Error("ticket 获取失败"));
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(session.isOpenFor("room:1"), false);
});
