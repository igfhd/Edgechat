import { decryptSecretValue, encryptSecretValue } from "../encryption.js";

const BOT_TOKEN_CONTEXT = "telegram:bot-token";
const WEBHOOK_SECRET_CONTEXT = "telegram:webhook-secret";

function mapMapping(row) {
	return {
		id: Number(row.id),
		channelId: Number(row.channel_id),
		channelName: row.channel_name || "",
		telegramChatId: String(row.telegram_chat_id),
		telegramChatTitle: row.telegram_chat_title || "",
		syncMode: row.sync_mode || "both",
		enabled: Boolean(Number(row.enabled)),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function listTelegramBridgeAdminState(env) {
	const [configResult, channelsResult] = await Promise.all([
		env.DB.prepare(
			`SELECT bot_username, webhook_url, updated_at
			 FROM telegram_bridge_config
			 WHERE id = 1
			 LIMIT 1`,
		).all(),
		env.DB.prepare(
			`SELECT id, name
			 FROM channels
			 WHERE kind = 'public' AND deleted_at IS NULL
			 ORDER BY CASE WHEN name = 'general' THEN 0 ELSE 1 END, name ASC`,
		).all(),
	]);

	// mappings 查询单独执行：若 sync_mode 列尚不存在（迁移未执行），
	// 只有映射列表降级为空，config 和 channels（群组下拉框）不受影响。
	let mappings = [];
	try {
		const mappingsResult = await env.DB.prepare(
			`SELECT tm.id, tm.channel_id, c.name AS channel_name, tm.telegram_chat_id,
			        tm.telegram_chat_title, tm.sync_mode, tm.enabled, tm.created_at, tm.updated_at
			 FROM telegram_mappings tm
			 JOIN channels c ON c.id = tm.channel_id
			 WHERE c.deleted_at IS NULL
			 ORDER BY tm.updated_at DESC, tm.id DESC`,
		).all();
		mappings = mappingsResult.results.map(mapMapping);
	} catch (e) {
		if (String(e?.message || e).includes("sync_mode")) {
			try {
				const fallbackResult = await env.DB.prepare(
					`SELECT tm.id, tm.channel_id, c.name AS channel_name, tm.telegram_chat_id,
					        tm.telegram_chat_title, 'both' AS sync_mode, tm.enabled, tm.created_at, tm.updated_at
					 FROM telegram_mappings tm
					 JOIN channels c ON c.id = tm.channel_id
					 WHERE c.deleted_at IS NULL
					 ORDER BY tm.updated_at DESC, tm.id DESC`,
				).all();
				mappings = fallbackResult.results.map(mapMapping);
			} catch (fallbackErr) {
				console.warn("[listTelegramBridgeAdminState] mappings fallback failed:", fallbackErr?.message || fallbackErr);
			}
		} else {
			console.warn("[listTelegramBridgeAdminState] mappings query failed:", e?.message || e);
		}
	}

	const config = configResult.results[0] || null;
	return {
		config: {
			configured: Boolean(config),
			botUsername: config?.bot_username || "",
			webhookUrl: config?.webhook_url || "",
			updatedAt: config?.updated_at || null,
		},
		channels: channelsResult.results.map((row) => ({
			id: Number(row.id),
			name: row.name,
		})),
		mappings,
	};
}

export async function getTelegramCredentials(env) {
	const { results } = await env.DB.prepare(
		`SELECT bot_token_ciphertext, webhook_secret_ciphertext, bot_username, webhook_url
		 FROM telegram_bridge_config
		 WHERE id = 1
		 LIMIT 1`,
	).all();
	const row = results[0];
	if (!row) {
		return null;
	}

	try {
		const [botToken, webhookSecret] = await Promise.all([
			decryptSecretValue(env, row.bot_token_ciphertext, BOT_TOKEN_CONTEXT),
			decryptSecretValue(env, row.webhook_secret_ciphertext, WEBHOOK_SECRET_CONTEXT),
		]);
		return {
			botToken,
			webhookSecret,
			botUsername: row.bot_username || "",
			webhookUrl: row.webhook_url || "",
		};
	} catch (e) {
		console.warn("[getTelegramCredentials] Decryption failed:", e?.message || e);
		return null;
	}
}

export async function saveTelegramBridgeConfig(env, {
	botToken,
	webhookSecret,
	botUsername,
	webhookUrl,
	updatedBy,
}) {
	const [botTokenCiphertext, webhookSecretCiphertext] = await Promise.all([
		encryptSecretValue(env, botToken, BOT_TOKEN_CONTEXT),
		encryptSecretValue(env, webhookSecret, WEBHOOK_SECRET_CONTEXT),
	]);
	await env.DB.prepare(
		`INSERT INTO telegram_bridge_config (
		   id, bot_token_ciphertext, webhook_secret_ciphertext,
		   bot_username, webhook_url, updated_by, updated_at
		 ) VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(id) DO UPDATE SET
		   bot_token_ciphertext = excluded.bot_token_ciphertext,
		   webhook_secret_ciphertext = excluded.webhook_secret_ciphertext,
		   bot_username = excluded.bot_username,
		   webhook_url = excluded.webhook_url,
		   updated_by = excluded.updated_by,
		   updated_at = CURRENT_TIMESTAMP`,
	)
		.bind(
			botTokenCiphertext,
			webhookSecretCiphertext,
			String(botUsername || ""),
			String(webhookUrl || ""),
			Number(updatedBy),
		)
		.run();
}

export async function getTelegramMappingByChatId(db, telegramChatId) {
	try {
		const { results } = await db.prepare(
			`SELECT tm.id, tm.channel_id, c.name AS channel_name, c.kind AS channel_kind,
			        tm.telegram_chat_id, tm.telegram_chat_title, tm.sync_mode, tm.enabled,
			        tm.created_at, tm.updated_at
			 FROM telegram_mappings tm
			 JOIN channels c ON c.id = tm.channel_id
			 WHERE tm.telegram_chat_id = ?
			   AND tm.enabled = 1
			   AND c.kind = 'public'
			   AND c.deleted_at IS NULL
			 LIMIT 1`,
		)
			.bind(String(telegramChatId))
			.all();
		return results[0] ? mapMapping(results[0]) : null;
	} catch (e) {
		if (String(e?.message || e).includes("sync_mode")) {
			const { results } = await db.prepare(
				`SELECT tm.id, tm.channel_id, c.name AS channel_name, c.kind AS channel_kind,
				        tm.telegram_chat_id, tm.telegram_chat_title, 'both' AS sync_mode, tm.enabled,
				        tm.created_at, tm.updated_at
				 FROM telegram_mappings tm
				 JOIN channels c ON c.id = tm.channel_id
				 WHERE tm.telegram_chat_id = ?
				   AND tm.enabled = 1
				   AND c.kind = 'public'
				   AND c.deleted_at IS NULL
				 LIMIT 1`,
			)
				.bind(String(telegramChatId))
				.all();
			return results[0] ? mapMapping(results[0]) : null;
		}
		throw e;
	}
}

export async function listEnabledTelegramMappingsForChannel(db, channelId) {
	try {
		const { results } = await db.prepare(
			`SELECT tm.id, tm.channel_id, c.name AS channel_name, tm.telegram_chat_id,
			        tm.telegram_chat_title, tm.sync_mode, tm.enabled, tm.created_at, tm.updated_at
			 FROM telegram_mappings tm
			 JOIN channels c ON c.id = tm.channel_id
			 WHERE tm.channel_id = ?
			   AND tm.enabled = 1
			   AND tm.sync_mode IN ('both', 'to_telegram')
			   AND c.kind = 'public'
			   AND c.deleted_at IS NULL
			 ORDER BY tm.id ASC`,
		)
			.bind(Number(channelId))
			.all();
		return results.map(mapMapping);
	} catch (e) {
		if (String(e?.message || e).includes("sync_mode")) {
			const { results } = await db.prepare(
				`SELECT tm.id, tm.channel_id, c.name AS channel_name, tm.telegram_chat_id,
				        tm.telegram_chat_title, 'both' AS sync_mode, tm.enabled, tm.created_at, tm.updated_at
				 FROM telegram_mappings tm
				 JOIN channels c ON c.id = tm.channel_id
				 WHERE tm.channel_id = ?
				   AND tm.enabled = 1
				   AND c.kind = 'public'
				   AND c.deleted_at IS NULL
				 ORDER BY tm.id ASC`,
			)
				.bind(Number(channelId))
				.all();
			return results.map(mapMapping);
		}
		throw e;
	}
}

export async function createTelegramMapping(db, {
	channelId,
	telegramChatId,
	telegramChatTitle,
	syncMode = "both",
	createdBy,
}) {
	const normalizedSyncMode = ["both", "to_telegram", "from_telegram"].includes(syncMode)
		? syncMode
		: "both";
	const channelResult = await db.prepare(
		`SELECT id
		 FROM channels
		 WHERE id = ? AND kind = 'public' AND deleted_at IS NULL
		 LIMIT 1`,
	)
		.bind(Number(channelId))
		.all();
	if (!channelResult.results[0]) {
		return null;
	}

	let result;
	try {
		result = await db.prepare(
			`INSERT INTO telegram_mappings (
			   channel_id, telegram_chat_id, telegram_chat_title, sync_mode, created_by
			 ) VALUES (?, ?, ?, ?, ?)`,
		)
			.bind(
				Number(channelId),
				String(telegramChatId),
				String(telegramChatTitle || ""),
				normalizedSyncMode,
				Number(createdBy),
			)
			.run();
	} catch (err) {
		const errStr = String(err?.message || err);
		if (errStr.includes("sync_mode")) {
			// 数据库迁移尚未执行时降级为兼容格式写入，保证映射能顺利创建
			result = await db.prepare(
				`INSERT INTO telegram_mappings (
				   channel_id, telegram_chat_id, telegram_chat_title, created_by
				 ) VALUES (?, ?, ?, ?)`,
			)
				.bind(
					Number(channelId),
					String(telegramChatId),
					String(telegramChatTitle || ""),
					Number(createdBy),
				)
				.run();
		} else {
			throw err;
		}
	}
	return Number(result.meta?.last_row_id || 0);
}

export async function updateTelegramMapping(db, mappingId, { enabled, syncMode }) {
	const updates = [];
	const binds = [];
	if (typeof enabled === "boolean") {
		updates.push("enabled = ?");
		binds.push(enabled ? 1 : 0);
	}
	if (syncMode && ["both", "to_telegram", "from_telegram"].includes(syncMode)) {
		updates.push("sync_mode = ?");
		binds.push(syncMode);
	}
	if (!updates.length) return false;
	updates.push("updated_at = CURRENT_TIMESTAMP");
	binds.push(Number(mappingId));

	try {
		const result = await db.prepare(
			`UPDATE telegram_mappings
			 SET ${updates.join(", ")}
			 WHERE id = ?`,
		)
			.bind(...binds)
			.run();
		return Number(result.meta?.changes || 0) > 0;
	} catch (err) {
		if (String(err?.message || err).includes("sync_mode") && typeof enabled === "boolean") {
			const result = await db.prepare(
				`UPDATE telegram_mappings
				 SET enabled = ?, updated_at = CURRENT_TIMESTAMP
				 WHERE id = ?`,
			)
				.bind(enabled ? 1 : 0, Number(mappingId))
				.run();
			return Number(result.meta?.changes || 0) > 0;
		}
		throw err;
	}
}

export async function deleteTelegramMapping(db, mappingId) {
	const result = await db.prepare("DELETE FROM telegram_mappings WHERE id = ?")
		.bind(Number(mappingId))
		.run();
	return Number(result.meta?.changes || 0) > 0;
}
