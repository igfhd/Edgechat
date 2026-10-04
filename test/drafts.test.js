import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { useDrafts } from "../frontend/src/composables/useDrafts.js";

test("useDrafts sets, gets, checks, and clears drafts per roomKey", () => {
	const session = ref({ id: 10, username: "alice" });
	const { getDraft, setDraft, clearDraft, hasDraft } = useDrafts(session);

	assert.equal(hasDraft("channel:1"), false);
	assert.equal(getDraft("channel:1"), "");

	setDraft("channel:1", "Hello Channel 1 draft");
	assert.equal(hasDraft("channel:1"), true);
	assert.equal(getDraft("channel:1"), "Hello Channel 1 draft");

	setDraft("dm:5", "Secret draft for Bob");
	assert.equal(hasDraft("dm:5"), true);
	assert.equal(getDraft("dm:5"), "Secret draft for Bob");

	// Channel 1 draft is unaffected
	assert.equal(getDraft("channel:1"), "Hello Channel 1 draft");

	// Empty string clears draft
	setDraft("channel:1", "   ");
	assert.equal(hasDraft("channel:1"), false);
	assert.equal(getDraft("channel:1"), "");

	// clearDraft clears draft
	clearDraft("dm:5");
	assert.equal(hasDraft("dm:5"), false);
	assert.equal(getDraft("dm:5"), "");
});
