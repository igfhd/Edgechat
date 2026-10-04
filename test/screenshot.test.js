import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { useScreenshot } from "../frontend/src/composables/useScreenshot.js";
import { useChatRoom } from "../frontend/src/composables/useChatRoom.js";

test("useScreenshot provides reactive state and methods", () => {
	const {
		isCapturing,
		screenshotImage,
		showModal,
		closeScreenshotModal
	} = useScreenshot();

	assert.equal(isCapturing.value, false);
	assert.equal(screenshotImage.value, null);
	assert.equal(showModal.value, false);

	// Test closeScreenshotModal
	screenshotImage.value = "data:image/png;base64,test";
	showModal.value = true;
	closeScreenshotModal();
	assert.equal(showModal.value, false);
	assert.equal(screenshotImage.value, null);
});

test("captureScreen handles environment without getDisplayMedia with friendly message", async () => {
	const { captureScreen, error } = useScreenshot();
	// Node.js 测试环境下 navigator.mediaDevices 不存在，应抛出友好中文提示
	await assert.rejects(
		async () => {
			await captureScreen();
		},
		(err) => {
			assert.ok(err.message.includes("当前环境不支持") || err.message.includes("Ctrl+V"));
			return true;
		}
	);
	assert.ok(error.value.includes("当前环境不支持") || error.value.includes("Ctrl+V"));
});

test("useChatRoom exports processAndUploadFile for screenshot handling", () => {
	const activeRoom = ref({ kind: "channel", id: 1 });
	const session = ref({ id: 1, username: "tester" });
	const error = ref("");

	const chatRoom = useChatRoom({
		activeRoom,
		session,
		error
	});

	assert.equal(typeof chatRoom.processAndUploadFile, "function");
});
