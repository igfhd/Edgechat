import { externalSenderExists } from "../data/messages.js";
import {
	createTelegramMapping,
	deleteTelegramMapping,
	getTelegramCredentials,
	getTelegramMappingByChatId,
	listTelegramBridgeAdminState,
	saveTelegramBridgeConfig,
	updateTelegramMapping,
} from "../data/telegram.js";
import { loadTelegramUserAvatar } from "../integrations/telegram/avatar.js";
import {
	getTelegramBot,
	getTelegramChat,
	setTelegramWebhook,
	TelegramApiError,
} from "../integrations/telegram/client.js";
import { ingestTelegramMessage } from "../integrations/telegram/bridge.js";
import { parseTelegramMessageUpdate } from "../integrations/telegram/parser.js";
import { errorResponse, parseJsonRequest, randomToken } from "../utils.js";
import { getRoutePrefixes } from "../disguise.js";

function webhookUrl(requestUrl, env) {
	const prefixes = getRoutePrefixes(env);
	const primaryPrefix = prefixes[0] || "";
	const prefixPath = primaryPrefix ? `/${primaryPrefix}` : "";
	const url = new URL(requestUrl);
	url.pathname = `${prefixPath}/api/integrations/telegram/webhook`;
	url.search = "";
	return url.toString();
}

function telegramApiError(error) {
	if (error instanceof TelegramApiError || error?.name === "TelegramApiError") {
		const msg = String(error.message || "");
		if (msg.includes("chat not found")) {
			return errorResponse("找不到目标 Telegram 会话。请检查 ID 是否正确；若绑定频道或私密群组，请确保已将 Bot 添加为管理员", 400);
		}
		if (msg.includes("bot was kicked") || msg.includes("bot is not a member")) {
			return errorResponse("Bot 未加入该群组/频道，或已被移出。请先将 Bot 添加为管理员", 400);
		}
		return errorResponse(error.message, 400);
	}
	return null;
}

const AVATAR_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";
const MISSING_AVATAR_CACHE_CONTROL = "public, max-age=600, s-maxage=600";

function avatarCacheKey(request, userId) {
	const url = new URL(request.url);
	url.pathname = `/api/integrations/telegram/avatar/${userId}`;
	url.search = "";
	return new Request(url.toString());
}

function missingAvatarResponse() {
	const response = errorResponse("头像不存在", 404);
	response.headers.set("Cache-Control", MISSING_AVATAR_CACHE_CONTROL);
	return response;
}

function telegramAvatarResponse(avatar) {
	return new Response(avatar.bytes, {
		headers: {
			"Cache-Control": AVATAR_CACHE_CONTROL,
			"Content-Length": String(avatar.bytes.byteLength),
			"Content-Type": avatar.contentType,
			"Content-Disposition": "inline",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
		},
	});
}

export function registerTelegramPublicRoutes(app) {
	app.get("/api/integrations/telegram/avatar/:userId", async (c) => {
		const userId = String(c.req.param("userId") || "");
		if (!/^\d+$/.test(userId)) {
			return missingAvatarResponse();
		}

		if (!(await externalSenderExists(c.env.DB, "telegram", userId))) {
			return missingAvatarResponse();
		}

		const cache = caches.default;
		const cacheKey = avatarCacheKey(c.req.raw, userId);
		const cached = await cache.match(cacheKey);
		if (cached) return cached;

		const credentials = await getTelegramCredentials(c.env);
		if (!credentials) {
			return errorResponse("Telegram Bridge 未配置", 503);
		}

		try {
			const avatar = await loadTelegramUserAvatar(credentials.botToken, userId);
			const response = avatar ? telegramAvatarResponse(avatar) : missingAvatarResponse();
			await cache.put(cacheKey, response.clone());
			return response;
		} catch {
			return errorResponse("Telegram 头像暂时不可用", 502);
		}
	});

	app.post("/api/integrations/telegram/webhook", async (c) => {
		const credentials = await getTelegramCredentials(c.env);
		if (!credentials) {
			return errorResponse("Telegram Bridge 未配置", 503);
		}
		if (
			c.req.header("X-Telegram-Bot-Api-Secret-Token") !== credentials.webhookSecret
		) {
			return errorResponse("Webhook 验证失败", 401);
		}

		const telegramMessage = parseTelegramMessageUpdate(await parseJsonRequest(c.req.raw));
		if (!telegramMessage) {
			return c.json({ ok: true });
		}
		const mapping = await getTelegramMappingByChatId(
			c.env.DB,
			telegramMessage.telegramChatId,
		);
		if (!mapping) {
			return c.json({ ok: true });
		}
		if (!["both", "from_telegram"].includes(mapping.syncMode)) {
			return c.json({ ok: true, ignored: true, reason: "sync_mode_disallows_inbound" });
		}

		await ingestTelegramMessage(c.env, {
			mapping,
			telegramMessage,
			botToken: credentials.botToken,
		});
		return c.json({ ok: true });
	});
}

export function registerTelegramAdminRoutes(app) {
	app.get("/api/admin/telegram", async (c) => {
		return c.json(await listTelegramBridgeAdminState(c.env));
	});

	app.put("/api/admin/telegram/config", async (c) => {
		const payload = await parseJsonRequest(c.req.raw);
		const botToken = String(payload.botToken || "").trim();
		if (!botToken) {
			return errorResponse("Telegram Bot Token 不能为空");
		}

		try {
			const bot = await getTelegramBot(botToken);
			const secret = randomToken(32);
			const url = webhookUrl(c.req.url, c.env);
			await setTelegramWebhook(botToken, { url, secretToken: secret });
			await saveTelegramBridgeConfig(c.env, {
				botToken,
				webhookSecret: secret,
				botUsername: bot.username || "",
				webhookUrl: url,
				updatedBy: c.get("session").userId,
			});
			return c.json(await listTelegramBridgeAdminState(c.env));
		} catch (error) {
			return telegramApiError(error) || errorResponse("Telegram 配置保存失败", 500);
		}
	});

	app.post("/api/admin/telegram/mappings", async (c) => {
		const payload = await parseJsonRequest(c.req.raw);
		const channelId = Number(payload.channelId);
		const telegramChatId = String(payload.telegramChatId || "").trim();
		const syncMode = String(payload.syncMode || "both").trim();
		if (!Number.isInteger(channelId) || channelId <= 0 || !/^-\d+$/.test(telegramChatId)) {
			return errorResponse("请选择公开群组并填写有效的 Telegram 群组或频道 ID");
		}
		if (!["both", "to_telegram", "from_telegram"].includes(syncMode)) {
			return errorResponse("无效的同步方向配置");
		}

		try {
			const credentials = await getTelegramCredentials(c.env);
			if (!credentials) {
				return errorResponse("请先连接 Telegram Bot");
			}
			const telegramChat = await getTelegramChat(credentials.botToken, telegramChatId);
			if (!["group", "supergroup", "channel"].includes(telegramChat.type)) {
				return errorResponse("目标必须是 Telegram 群组、超级群组或频道");
			}
			const mappingId = await createTelegramMapping(c.env.DB, {
				channelId,
				telegramChatId,
				telegramChatTitle:
					telegramChat.title || telegramChat.username || String(telegramChat.id),
				syncMode,
				createdBy: c.get("session").userId,
			});
			if (!mappingId) {
				return errorResponse("公开群组不存在", 404);
			}
			return c.json(await listTelegramBridgeAdminState(c.env));
		} catch (error) {
			const telegramError = telegramApiError(error);
			if (telegramError) {
				return telegramError;
			}
			const errStr = String(error?.message || error);
			if (errStr.includes("UNIQUE")) {
				return errorResponse("这个 EdgeChat 群组或 Telegram 群/频道已经绑定");
			}
			console.error("[createTelegramMapping error]", error);
			return errorResponse(error?.message || "创建 Telegram 映射失败", 400);
		}
	});

	app.patch("/api/admin/telegram/mappings/:mappingId", async (c) => {
		const payload = await parseJsonRequest(c.req.raw);
		const updates = {};
		if (typeof payload.enabled === "boolean") {
			updates.enabled = payload.enabled;
		}
		if (payload.syncMode !== undefined) {
			if (!["both", "to_telegram", "from_telegram"].includes(payload.syncMode)) {
				return errorResponse("无效的同步方向配置");
			}
			updates.syncMode = payload.syncMode;
		}
		try {
			const updated = await updateTelegramMapping(c.env.DB, c.req.param("mappingId"), updates);
			if (!updated) {
				return errorResponse("Telegram 映射不存在", 404);
			}
			return c.json(await listTelegramBridgeAdminState(c.env));
		} catch (error) {
			console.error("[updateTelegramMapping error]", error);
			return errorResponse(error?.message || "更新 Telegram 映射失败", 400);
		}
	});

	app.delete("/api/admin/telegram/mappings/:mappingId", async (c) => {
		const deleted = await deleteTelegramMapping(c.env.DB, c.req.param("mappingId"));
		if (!deleted) {
			return errorResponse("Telegram 映射不存在", 404);
		}
		return c.json(await listTelegramBridgeAdminState(c.env));
	});
}
