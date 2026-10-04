import { isCapacitorAndroid, minimizeNativeApp } from "./capacitor-platform.js";

const handlers = [];
let lastBackPressTime = 0;
let exitToastElement = null;
let toastTimeoutId = null;

function showExitToast(message = "再按一次退出应用") {
	if (typeof document === "undefined") return;

	if (!exitToastElement) {
		exitToastElement = document.createElement("div");
		exitToastElement.className = "edgechat-back-toast";
		exitToastElement.style.position = "fixed";
		exitToastElement.style.bottom = "80px";
		exitToastElement.style.left = "50%";
		exitToastElement.style.transform = "translateX(-50%)";
		exitToastElement.style.background = "rgba(17, 27, 33, 0.88)";
		exitToastElement.style.color = "#ffffff";
		exitToastElement.style.padding = "8px 18px";
		exitToastElement.style.borderRadius = "20px";
		exitToastElement.style.fontSize = "13px";
		exitToastElement.style.fontWeight = "500";
		exitToastElement.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.25)";
		exitToastElement.style.zIndex = "99999";
		exitToastElement.style.pointerEvents = "none";
		exitToastElement.style.transition = "opacity 0.2s ease, transform 0.2s ease";
		exitToastElement.style.backdropFilter = "blur(8px)";
		document.body.appendChild(exitToastElement);
	}

	exitToastElement.textContent = message;
	exitToastElement.style.opacity = "1";
	exitToastElement.style.transform = "translateX(-50%) translateY(0)";

	if (toastTimeoutId) {
		clearTimeout(toastTimeoutId);
	}
	toastTimeoutId = setTimeout(() => {
		if (exitToastElement) {
			exitToastElement.style.opacity = "0";
			exitToastElement.style.transform = "translateX(-50%) translateY(10px)";
		}
	}, 1800);
}

/**
 * 注册返回键拦截器
 * @param {number} priority 优先级，数值越大越先执行 (例如: 模态框 100, 抽屉 80, 会话视图 50, 上级目录 40)
 * @param {() => boolean | Promise<boolean>} handler 返回 true 表示已消费此事件，停止后续传播
 * @returns {() => void} 用于注销该拦截器的清理函数
 */
export function registerBackHandler(priority, handler) {
	const entry = { priority, handler };
	handlers.push(entry);
	handlers.sort((a, b) => b.priority - a.priority);

	return () => {
		const index = handlers.indexOf(entry);
		if (index !== -1) {
			handlers.splice(index, 1);
		}
	};
}

/**
 * 触发返回处理逻辑
 * @returns {Promise<boolean>} 是否被拦截器消费
 */
export async function triggerBack() {
	// 浅拷贝一份当前按键处理器快照，避免在执行过程中注销导致的索引偏移
	const currentHandlers = [...handlers];
	for (const entry of currentHandlers) {
		try {
			const handled = await entry.handler();
			if (handled) {
				return true;
			}
		} catch (err) {
			console.error("Error executing back button handler:", err);
		}
	}

	// 若没有任何拦截器消费，且在根界面，执行双击退出防误触检测
	const now = Date.now();
	if (now - lastBackPressTime < 2000) {
		lastBackPressTime = 0;
		await minimizeNativeApp();
		return true;
	}

	lastBackPressTime = now;
	showExitToast();
	return true;
}

let isInitialized = false;

export function initBackNavigation() {
	if (isInitialized || !isCapacitorAndroid) {
		return;
	}
	isInitialized = true;

	const EdgeChatNative = window?.Capacitor?.registerPlugin?.("EdgeChatNative");
	if (EdgeChatNative) {
		void EdgeChatNative.addListener("backButton", () => {
			void triggerBack();
		});
	}
}
