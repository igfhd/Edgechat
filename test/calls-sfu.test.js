import assert from "node:assert/strict";
import test from "node:test";

import {
	getCallsServerSecret,
	getSiteSettings,
	updateSiteSettings,
} from "../worker/src/data/site-settings.js";

function createMockDb(initialRows = []) {
	const data = new Map(initialRows.map((r) => [r.setting_key, r.setting_value]));
	return {
		prepare(sql) {
			return {
				bind(...params) {
					return {
						async all() {
							const results = Array.from(data.entries()).map(([k, v]) => ({
								setting_key: k,
								setting_value: v,
							}));
							return { results };
						},
						async run() {
							return { success: true };
						},
						_params: params,
						_sql: sql,
					};
				},
				async all() {
					const results = Array.from(data.entries()).map(([k, v]) => ({
						setting_key: k,
						setting_value: v,
					}));
					return { results };
				},
			};
		},
		async batch(statements) {
			for (const stmt of statements) {
				const params = stmt._params || [];
				if (stmt._sql.includes("site_settings")) {
					const key = stmt._sql.match(/'([a-z_]+)'/)?.[1];
					if (key && params[0] !== undefined) {
						data.set(key, String(params[0]));
					}
				}
			}
			return [];
		},
	};
}

test("Calls settings: fallback to environment variables when DB is unconfigured", async () => {
	const db = createMockDb();
	const env = {
		CALLS_APP_ID: "env-app-id-123",
		CALLS_APP_SECRET: "env-app-secret-456",
	};

	const settings = await getSiteSettings(db, env);
	assert.equal(settings.callsEnabled, true);
	assert.equal(settings.callsAppId, "env-app-id-123");
	assert.equal(settings.callsAppSecretConfigured, true);
	assert.equal(settings.callsAppSource, "environment");

	const serverSecret = await getCallsServerSecret(db, env);
	assert.equal(serverSecret.enabled, true);
	assert.equal(serverSecret.appId, "env-app-id-123");
	assert.equal(serverSecret.appSecret, "env-app-secret-456");
});

test("Calls settings: database overrides environment configuration", async () => {
	const db = createMockDb();
	const env = {
		CALLS_APP_ID: "env-app-id-123",
		CALLS_APP_SECRET: "env-app-secret-456",
	};

	await updateSiteSettings(
		db,
		{
			callsEnabled: true,
			callsAppId: "custom-db-app-id-789",
			callsAppSecret: "custom-db-secret-000",
		},
		env,
	);

	const settings = await getSiteSettings(db, env);
	assert.equal(settings.callsEnabled, true);
	assert.equal(settings.callsAppId, "custom-db-app-id-789");
	assert.equal(settings.callsAppSecretConfigured, true);
	assert.equal(settings.callsAppSource, "database");

	const serverSecret = await getCallsServerSecret(db, env);
	assert.equal(serverSecret.enabled, true);
	assert.equal(serverSecret.appId, "custom-db-app-id-789");
	assert.equal(serverSecret.appSecret, "custom-db-secret-000");
});

test("Calls settings: can disable calls even when credentials exist", async () => {
	const db = createMockDb();
	const env = {
		CALLS_APP_ID: "env-app-id-123",
		CALLS_APP_SECRET: "env-app-secret-456",
	};

	await updateSiteSettings(
		db,
		{
			callsEnabled: false,
		},
		env,
	);

	const settings = await getSiteSettings(db, env);
	assert.equal(settings.callsEnabled, false);

	const serverSecret = await getCallsServerSecret(db, env);
	assert.equal(serverSecret.enabled, false);
});

test("useAudioCall: incoming signal handling for ringing, reject and group joins", async () => {
	const { useAudioCall } = await import("../frontend/src/composables/useAudioCall.js");
	const signalsSent = [];
	const call = useAudioCall({
		sendSignal(sig) {
			signalsSent.push(sig);
		}
	});

	assert.equal(call.callStatus.value, "idle");

	// 1. Receive incoming DM call invite
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "invite",
		callType: "dm",
		senderId: 42,
		displayName: "Alice",
		avatarUrl: "https://example.com/alice.png",
		sessionId: "sess-alice",
		trackName: "track-alice"
	});

	assert.equal(call.callStatus.value, "ringing");
	assert.equal(call.targetUser.value.id, 42);
	assert.equal(call.targetUser.value.displayName, "Alice");

	// The same invite can arrive from both the room socket and UserInbox.
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "invite",
		callType: "dm",
		senderId: 42,
		sessionId: "sess-alice",
		trackName: "track-alice"
	});
	assert.equal(call.callStatus.value, "ringing");
	assert.equal(signalsSent.length, 0);

	// 2. Reject incoming call
	call.rejectCall();
	assert.equal(call.callStatus.value, "idle");
	assert.equal(signalsSent.length, 1);
	assert.equal(signalsSent[0].action, "reject");
	assert.equal(signalsSent[0].targetUserId, 42);

	// 3. Receive group participant join while in group meeting
	call.callType.value = "group";
	call.callStatus.value = "connected";
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "join",
		callType: "group",
		senderId: 99,
		displayName: "Bob",
		sessionId: "sess-bob",
		trackName: "track-bob"
	});

	assert.equal(call.groupParticipants.value.length, 1);
	assert.equal(call.groupParticipants.value[0].displayName, "Bob");

	// 4. Remote participant leaves
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "leave",
		callType: "group",
		senderId: 99
	});

	assert.equal(call.groupParticipants.value.length, 0);

	// 5. Receiving track_published from existing participants
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "track_published",
		callType: "group",
		senderId: 100,
		displayName: "Charlie",
		sessionId: "sess-charlie",
		trackName: "track-charlie"
	});

	assert.equal(call.groupParticipants.value.length, 1);
	assert.equal(call.groupParticipants.value[0].displayName, "Charlie");

	// 6. Speaking state synchronization in group
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "speaking_state",
		callType: "group",
		senderId: 100,
		isSpeaking: true
	});

	assert.equal(call.groupParticipants.value[0].isSpeaking, true);

	// 7. Speaking state synchronization in DM
	call.callType.value = "dm";
	call.targetUser.value = { id: 77, displayName: "Diana" };
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "speaking_state",
		callType: "dm",
		senderId: 77,
		isSpeaking: true
	});
	assert.equal(call.isRemoteSpeaking.value, true);

	await call.handleIncomingSignal({
		type: "call_signal",
		action: "speaking_state",
		callType: "dm",
		senderId: 77,
		isSpeaking: false
	});
	assert.equal(call.isRemoteSpeaking.value, false);

	// 8. Real-time voice effects switching
	assert.equal(call.currentVoiceEffect.value, "original");
	assert.equal(call.availableVoiceEffects.length, 5);
	assert.deepEqual(
		call.availableVoiceEffects.map((e) => e.id),
		["original", "cute", "uncle", "robot", "echo"]
	);

	call.setVoiceEffect("cute");
	assert.equal(call.currentVoiceEffect.value, "cute");

	call.setVoiceEffect("uncle");
	assert.equal(call.currentVoiceEffect.value, "uncle");

	// 9. Stage moderation: Raise & lower hand
	call.callType.value = "group";
	assert.equal(call.isHandRaised.value, false);

	call.raiseHand();
	assert.equal(call.isHandRaised.value, true);
	assert.equal(signalsSent[signalsSent.length - 1].action, "raise_hand");

	call.lowerHand();
	assert.equal(call.isHandRaised.value, false);
	assert.equal(signalsSent[signalsSent.length - 1].action, "lower_hand");

	// 10. Stage moderation: Remote participant raises hand and approval
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "raise_hand",
		callType: "group",
		senderId: 100,
		displayName: "Charlie"
	});
	assert.equal(call.groupParticipants.value[0].isHandRaised, true);

	call.approveHand(100);
	assert.equal(call.groupParticipants.value[0].isHandRaised, false);
	assert.equal(signalsSent[signalsSent.length - 1].action, "approve_unmute");

	// 11. Stage moderation: Mute single participant & Mute all
	call.muteParticipant(100);
	assert.equal(call.groupParticipants.value[0].isMuted, true);
	assert.equal(signalsSent[signalsSent.length - 1].action, "mute_member");

	call.muteAll();
	assert.equal(signalsSent[signalsSent.length - 1].action, "mute_all");

	// 12. Stage moderation: Kick participant
	call.kickParticipant(100);
	assert.equal(call.groupParticipants.value.length, 0);
	assert.equal(signalsSent[signalsSent.length - 1].action, "kick_member");

	// 13. Room audio state broadcast sync
	call.callType.value = "group";
	call.callStatus.value = "connected";
	call.currentRoom.value = { id: 88, kind: "public" };
	await call.handleIncomingSignal({
		type: "call_signal",
		action: "room_audio_state",
		callType: "group",
		roomId: 88,
		participants: [
			{ userId: 501, displayName: "Eve", sessionId: "sess-eve", trackName: "track-eve" },
			{ userId: 502, displayName: "Frank", sessionId: "sess-frank", trackName: "track-frank" }
		]
	});
	assert.equal(call.groupParticipants.value.length, 2);
	assert.equal(call.groupParticipants.value[0].displayName, "Eve");
	assert.equal(call.groupParticipants.value[1].displayName, "Frank");
});

test("useAudioCall: applies group state received during host WebRTC setup", async () => {
	const { useAudioCall } = await import("../frontend/src/composables/useAudioCall.js");
	const call = useAudioCall({ currentUserId: () => 1 });
	call.callType.value = "group";
	call.callStatus.value = "calling";
	call.currentRoom.value = { id: 7, kind: "public" };

	await call.handleIncomingSignal({
		type: "call_signal",
		action: "room_audio_state",
		callType: "group",
		roomId: 7,
		participants: [
			{ userId: 1, displayName: "主持人" },
			{ userId: 2, displayName: "成员" },
		],
	});

	assert.deepEqual(call.groupParticipants.value.map((p) => p.userId), [2]);
});

test("useAudioCall: ignores stale room audio snapshots after newer participant updates", async () => {
	const { useAudioCall } = await import("../frontend/src/composables/useAudioCall.js");
	const call = useAudioCall({ currentUserId: () => 1 });
	call.callType.value = "group";
	call.callStatus.value = "connected";
	call.currentRoom.value = { id: 7, kind: "public" };

	await call.handleIncomingSignal({
		type: "call_signal",
		action: "room_audio_state",
		callType: "group",
		roomId: 7,
		roomAudioRevision: 2,
		participants: [
			{ userId: 1, displayName: "主持人" },
			{ userId: 2, displayName: "成员A" },
		],
	});
	assert.deepEqual(call.groupParticipants.value.map((p) => p.userId), [2]);

	await call.handleIncomingSignal({
		type: "call_signal",
		action: "join",
		callType: "group",
		roomId: 7,
		roomAudioRevision: 3,
		senderId: 3,
		displayName: "成员B",
		sessionId: "sess-b",
		trackName: "track-b",
	});
	assert.deepEqual(call.groupParticipants.value.map((p) => p.userId), [2, 3]);

	await call.handleIncomingSignal({
		type: "call_signal",
		action: "room_audio_state",
		callType: "group",
		roomId: 7,
		roomAudioRevision: 1,
		participants: [
			{ userId: 1, displayName: "主持人" },
		],
	});

	assert.deepEqual(call.groupParticipants.value.map((p) => p.userId), [2, 3]);
});
