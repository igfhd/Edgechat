import { nextTick, onBeforeUnmount, watch } from "vue";
import { registerBackHandler } from "../back-navigation.js";

let openOverlayCount = 0;
let previousBodyOverflow = "";

function lockPageScroll() {
	if (openOverlayCount === 0) {
		previousBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
	}
	openOverlayCount += 1;
}

function unlockPageScroll() {
	openOverlayCount = Math.max(0, openOverlayCount - 1);
	if (openOverlayCount === 0) {
		document.body.style.overflow = previousBodyOverflow;
	}
}

export function useOverlayLifecycle({ open, onClose, focusTarget, priority = 100 }) {
	let active = false;
	let previousFocus = null;
	let unregisterBack = null;

	function handleKeydown(event) {
		if (event.key === "Escape") {
			onClose();
		}
	}

	async function activate() {
		if (active) {
			return;
		}

		active = true;
		previousFocus = document.activeElement;
		lockPageScroll();
		window.addEventListener("keydown", handleKeydown);
		if (unregisterBack) {
			unregisterBack();
		}
		unregisterBack = registerBackHandler(priority, () => {
			onClose();
			return true;
		});
		await nextTick();
		if (active) {
			const target = typeof focusTarget === "function" ? focusTarget() : focusTarget?.value;
			target?.focus();
		}
	}

	function deactivate({ restoreFocus = true } = {}) {
		if (!active) {
			return;
		}

		active = false;
		if (unregisterBack) {
			unregisterBack();
			unregisterBack = null;
		}
		window.removeEventListener("keydown", handleKeydown);
		unlockPageScroll();
		if (restoreFocus && previousFocus instanceof HTMLElement) {
			previousFocus.focus();
		}
		previousFocus = null;
	}

	watch(
		open,
		(isOpen) => {
			if (isOpen) {
				void activate();
				return;
			}
			deactivate();
		},
		{ immediate: true },
	);

	onBeforeUnmount(() => deactivate({ restoreFocus: false }));
}
