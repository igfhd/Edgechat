// In-memory cache for site settings per DB instance (60 seconds TTL)
const SITE_SETTINGS_CACHE_TTL_MS = 60 * 1000;
const dbSiteSettingsCache = new WeakMap();
const dbStorageSecretCache = new WeakMap();
const dbCallsSecretCache = new WeakMap();

export function invalidateSiteSettingsCache(db = null) {
	if (db && typeof db === 'object') {
		dbSiteSettingsCache.delete(db);
		dbStorageSecretCache.delete(db);
		dbCallsSecretCache.delete(db);
	}
}

export async function getSiteSettings(db, env = {}) {
	if (db && typeof db === 'object') {
		const cached = dbSiteSettingsCache.get(db);
		if (cached && Date.now() < cached.exp) {
			return { ...cached.settings };
		}
	}

	const { results } = await db
		.prepare("SELECT setting_key, setting_value FROM site_settings")
		.all();
	const map = Object.fromEntries(
		results.map((row) => [row.setting_key, row.setting_value]),
	);

	const envAppId = env?.CALLS_APP_ID || "";
	const envAppSecret = env?.CALLS_APP_SECRET || "";

	const dbCallsAppId = map.calls_app_id !== undefined ? String(map.calls_app_id) : "";
	const dbCallsAppSecret = map.calls_app_secret !== undefined ? String(map.calls_app_secret) : "";

	const effectiveAppId = (dbCallsAppId || envAppId).trim();
	const effectiveAppSecret = (dbCallsAppSecret || envAppSecret).trim();

	const defaultCallsEnabled = Boolean(effectiveAppId && effectiveAppSecret);
	const callsEnabled = map.calls_enabled !== undefined ? map.calls_enabled === "1" : defaultCallsEnabled;

	const envStorageAccountId = env?.R2_ACCOUNT_ID || env?.CLOUDFLARE_ACCOUNT_ID || "";
	const envStorageBucketName = env?.R2_BUCKET_NAME || "edgechat-files";
	const envStorageAccessKeyId = env?.R2_ACCESS_KEY_ID || env?.AWS_ACCESS_KEY_ID || "";
	const envStorageSecretAccessKey = env?.R2_SECRET_ACCESS_KEY || env?.AWS_SECRET_ACCESS_KEY || "";
	const envStorageEndpoint = env?.R2_S3_ENDPOINT || env?.AWS_ENDPOINT || "";
	const envStorageRegion = env?.AWS_REGION || "auto";

	const dbStorageType = map.storage_type !== undefined ? String(map.storage_type) : "r2";
	const dbStorageAccountId = map.storage_account_id !== undefined ? String(map.storage_account_id) : "";
	const dbStorageBucketName = map.storage_bucket_name !== undefined ? String(map.storage_bucket_name) : "";
	const dbStorageAccessKeyId = map.storage_access_key_id !== undefined ? String(map.storage_access_key_id) : "";
	const dbStorageSecretAccessKey = map.storage_secret_access_key !== undefined ? String(map.storage_secret_access_key) : "";
	const dbStorageEndpoint = map.storage_endpoint !== undefined ? String(map.storage_endpoint) : "";
	const dbStorageRegion = map.storage_region !== undefined ? String(map.storage_region) : "";
	const dbStoragePublicDomain = map.storage_public_domain !== undefined ? String(map.storage_public_domain) : "";

	const effectiveStorageAccountId = (dbStorageAccountId || envStorageAccountId).trim();
	const effectiveStorageBucketName = (dbStorageBucketName || envStorageBucketName).trim();
	const effectiveStorageAccessKeyId = (dbStorageAccessKeyId || envStorageAccessKeyId).trim();
	const effectiveStorageSecret = (dbStorageSecretAccessKey || envStorageSecretAccessKey).trim();
	const effectiveStorageEndpoint = (dbStorageEndpoint || envStorageEndpoint).trim();
	const effectiveStorageRegion = (dbStorageRegion || envStorageRegion).trim() || "auto";

	const envGdriveClientId = env?.GDRIVE_CLIENT_ID || "";
	const envGdriveClientSecret = env?.GDRIVE_CLIENT_SECRET || "";
	const envGdriveRefreshToken = env?.GDRIVE_REFRESH_TOKEN || "";
	const envGdriveFolderId = env?.GDRIVE_FOLDER_ID || "";

	const dbGdriveClientId = map.gdrive_client_id !== undefined ? String(map.gdrive_client_id) : "";
	const dbGdriveClientSecret = map.gdrive_client_secret !== undefined ? String(map.gdrive_client_secret) : "";
	const dbGdriveRefreshToken = map.gdrive_refresh_token !== undefined ? String(map.gdrive_refresh_token) : "";
	const dbGdriveFolderId = map.gdrive_folder_id !== undefined ? String(map.gdrive_folder_id) : "";

	const effectiveGdriveClientId = (dbGdriveClientId || envGdriveClientId).trim();
	const effectiveGdriveClientSecret = (dbGdriveClientSecret || envGdriveClientSecret).trim();
	const effectiveGdriveRefreshToken = (dbGdriveRefreshToken || envGdriveRefreshToken).trim();
	const effectiveGdriveFolderId = (dbGdriveFolderId || envGdriveFolderId).trim();

	const settings = {
		siteName: String(map.site_name || "Edgechat"),
		siteIconUrl: String(map.site_icon_url || ""),
		generalChannelHidden: map.general_channel_hidden === "1",
		generalChannelMuted: map.general_channel_muted === "1",
		messageRetentionDays: Number(map.message_retention_days) > 0 ? Number(map.message_retention_days) : 7,
		autoCleanupEnabled: map.auto_cleanup_enabled === undefined ? true : map.auto_cleanup_enabled !== "0",
		deletionPolicy: map.deletion_policy === "immediate_purge" ? "immediate_purge" : "daily_reset_purge",
		uploadRestrictionMode: String(map.upload_restriction_mode || "none"),
		uploadAllowedTypes: String(map.upload_allowed_types || "image/*, video/*, audio/*, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, zip, 7z, tar, gz"),
		uploadBlockedTypes: String(map.upload_blocked_types || "exe, bat, cmd, sh, php"),
		uploadMaxFileSizeMb: Number(map.upload_max_file_size_mb) > 0 ? Number(map.upload_max_file_size_mb) : 20,
		callsEnabled,
		callsAppId: effectiveAppId,
		callsAppSecretConfigured: Boolean(effectiveAppSecret),
		callsAppSource: dbCallsAppId ? "database" : (envAppId ? "environment" : "none"),
		storageType: dbStorageType,
		storageAccountId: effectiveStorageAccountId,
		storageBucketName: effectiveStorageBucketName,
		storageAccessKeyId: effectiveStorageAccessKeyId,
		storageSecretAccessKeyConfigured: Boolean(effectiveStorageSecret),
		storageEndpoint: effectiveStorageEndpoint,
		storageRegion: effectiveStorageRegion,
		storagePublicDomain: dbStoragePublicDomain.trim(),
		storageSource: dbStorageAccessKeyId || dbGdriveClientId ? "database" : (envStorageAccessKeyId || envGdriveClientId ? "environment" : "binding"),
		gdriveClientId: effectiveGdriveClientId,
		gdriveClientSecretConfigured: Boolean(effectiveGdriveClientSecret),
		gdriveRefreshTokenConfigured: Boolean(effectiveGdriveRefreshToken),
		gdriveFolderId: effectiveGdriveFolderId
	};
	if (db && typeof db === 'object') {
		dbSiteSettingsCache.set(db, { settings, exp: Date.now() + SITE_SETTINGS_CACHE_TTL_MS });
	}
	return settings;
}

export async function getStorageServerSecret(db, env = {}) {
	if (db && typeof db === 'object') {
		const cached = dbStorageSecretCache.get(db);
		if (cached && Date.now() < cached.exp) {
			return { ...cached.secret };
		}
	}

	const { results } = await db
		.prepare("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('storage_type', 'storage_account_id', 'storage_bucket_name', 'storage_access_key_id', 'storage_secret_access_key', 'storage_endpoint', 'storage_region', 'storage_public_domain', 'gdrive_client_id', 'gdrive_client_secret', 'gdrive_refresh_token', 'gdrive_folder_id')")
		.all();
	const map = Object.fromEntries(
		results.map((row) => [row.setting_key, row.setting_value]),
	);

	const storageType = map.storage_type || "r2";
	const accountId = (map.storage_account_id || env?.R2_ACCOUNT_ID || env?.CLOUDFLARE_ACCOUNT_ID || "").trim();
	const bucketName = (map.storage_bucket_name || env?.R2_BUCKET_NAME || "edgechat-files").trim();
	const accessKeyId = (map.storage_access_key_id || env?.R2_ACCESS_KEY_ID || env?.AWS_ACCESS_KEY_ID || "").trim();
	const secretAccessKey = (map.storage_secret_access_key || env?.R2_SECRET_ACCESS_KEY || env?.AWS_SECRET_ACCESS_KEY || "").trim();
	const endpoint = (map.storage_endpoint || env?.R2_S3_ENDPOINT || env?.AWS_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")).trim();
	const region = (map.storage_region || env?.AWS_REGION || "auto").trim();
	const publicDomain = (map.storage_public_domain || "").trim();

	const gdriveClientId = (map.gdrive_client_id || env?.GDRIVE_CLIENT_ID || "").trim();
	const gdriveClientSecret = (map.gdrive_client_secret || env?.GDRIVE_CLIENT_SECRET || "").trim();
	const gdriveRefreshToken = (map.gdrive_refresh_token || env?.GDRIVE_REFRESH_TOKEN || "").trim();
	const gdriveFolderId = (map.gdrive_folder_id || env?.GDRIVE_FOLDER_ID || "").trim();

	const secret = {
		storageType,
		accountId,
		bucketName,
		accessKeyId,
		secretAccessKey,
		endpoint,
		region,
		publicDomain,
		gdriveClientId,
		gdriveClientSecret,
		gdriveRefreshToken,
		gdriveFolderId
	};
	if (db && typeof db === 'object') {
		dbStorageSecretCache.set(db, { secret, exp: Date.now() + SITE_SETTINGS_CACHE_TTL_MS });
	}
	return secret;
}

export async function getCallsServerSecret(db, env = {}) {
	if (db && typeof db === 'object') {
		const cached = dbCallsSecretCache.get(db);
		if (cached && Date.now() < cached.exp) {
			return { ...cached.secret };
		}
	}

	const { results } = await db
		.prepare("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('calls_app_id', 'calls_app_secret', 'calls_enabled')")
		.all();
	const map = Object.fromEntries(
		results.map((row) => [row.setting_key, row.setting_value]),
	);
	const appId = (map.calls_app_id || env?.CALLS_APP_ID || "").trim();
	const appSecret = (map.calls_app_secret || env?.CALLS_APP_SECRET || "").trim();
	const enabled = map.calls_enabled !== undefined ? map.calls_enabled === "1" : Boolean(appId && appSecret);
	const secret = {
		enabled,
		appId,
		appSecret
	};
	if (db && typeof db === 'object') {
		dbCallsSecretCache.set(db, { secret, exp: Date.now() + SITE_SETTINGS_CACHE_TTL_MS });
	}
	return secret;
}

export async function updateSiteSettings(db, {
	siteName,
	siteIconUrl,
	generalChannelHidden,
	generalChannelMuted,
	messageRetentionDays,
	autoCleanupEnabled,
	deletionPolicy,
	uploadRestrictionMode,
	uploadAllowedTypes,
	uploadBlockedTypes,
	uploadMaxFileSizeMb,
	callsEnabled,
	callsAppId,
	callsAppSecret,
	storageType,
	storageAccountId,
	storageBucketName,
		storageAccessKeyId,
		storageSecretAccessKey,
		storageEndpoint,
		storageRegion,
		storagePublicDomain,
		gdriveClientId,
		gdriveClientSecret,
		gdriveRefreshToken,
		gdriveFolderId
	}, env = {}) {
	const statements = [];
	if (siteName !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('site_name', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(siteName || "Edgechat").trim() || "Edgechat"),
		);
	}
	if (siteIconUrl !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('site_icon_url', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(siteIconUrl || "").trim()),
		);
	}
	if (generalChannelHidden !== undefined) {
		const hidden = generalChannelHidden ? "1" : "0";
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('general_channel_hidden', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(hidden),
		);
	}
	if (generalChannelMuted !== undefined) {
		const muted = generalChannelMuted ? "1" : "0";
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('general_channel_muted', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(muted),
		);
	}
	if (messageRetentionDays !== undefined) {
		const days = Math.max(1, Math.min(3650, Number(messageRetentionDays) || 7));
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('message_retention_days', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(days)),
		);
	}
	if (autoCleanupEnabled !== undefined) {
		const enabled = autoCleanupEnabled ? "1" : "0";
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('auto_cleanup_enabled', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(enabled),
		);
	}
	if (deletionPolicy !== undefined) {
		const policy = deletionPolicy === 'immediate_purge' ? 'immediate_purge' : 'daily_reset_purge';
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('deletion_policy', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(policy),
		);
	}
	if (uploadRestrictionMode !== undefined) {
		const mode = ['none', 'allowlist', 'blocklist'].includes(uploadRestrictionMode) ? uploadRestrictionMode : 'none';
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('upload_restriction_mode', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(mode),
		);
	}
	if (uploadAllowedTypes !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('upload_allowed_types', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(uploadAllowedTypes || '').trim()),
		);
	}
	if (uploadBlockedTypes !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('upload_blocked_types', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(uploadBlockedTypes || '').trim()),
		);
	}
	if (uploadMaxFileSizeMb !== undefined) {
		const sizeMb = Math.max(1, Math.min(100, Number(uploadMaxFileSizeMb) || 20));
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('upload_max_file_size_mb', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(sizeMb)),
		);
	}
	if (callsEnabled !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('calls_enabled', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(callsEnabled ? "1" : "0"),
		);
	}
	if (callsAppId !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('calls_app_id', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(callsAppId || '').trim()),
		);
	}
	if (callsAppSecret !== undefined && String(callsAppSecret).trim()) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('calls_app_secret', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(callsAppSecret).trim()),
		);
	}
	if (storageType !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('storage_type', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(storageType || 'r2').trim()),
		);
	}
	if (storageAccountId !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('storage_account_id', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(storageAccountId || '').trim()),
		);
	}
	if (storageBucketName !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('storage_bucket_name', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(storageBucketName || 'edgechat-files').trim()),
		);
	}
	if (storageAccessKeyId !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('storage_access_key_id', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(storageAccessKeyId || '').trim()),
		);
	}
	if (storageSecretAccessKey !== undefined && String(storageSecretAccessKey).trim() && storageSecretAccessKey !== '********') {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('storage_secret_access_key', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(storageSecretAccessKey).trim()),
		);
	}
	if (storageEndpoint !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('storage_endpoint', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(storageEndpoint || '').trim()),
		);
	}
	if (storageRegion !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('storage_region', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(storageRegion || 'auto').trim()),
		);
	}
	if (storagePublicDomain !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('storage_public_domain', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(storagePublicDomain || '').trim()),
		);
	}
	if (gdriveClientId !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('gdrive_client_id', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(gdriveClientId || '').trim()),
		);
	}
	if (gdriveClientSecret !== undefined && String(gdriveClientSecret).trim() && gdriveClientSecret !== '********') {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('gdrive_client_secret', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(gdriveClientSecret).trim()),
		);
	}
	if (gdriveRefreshToken !== undefined && String(gdriveRefreshToken).trim() && gdriveRefreshToken !== '********') {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('gdrive_refresh_token', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(gdriveRefreshToken).trim()),
		);
	}
	if (gdriveFolderId !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('gdrive_folder_id', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(gdriveFolderId || '').trim()),
		);
	}
	if (statements.length) {
		await db.batch(statements);
	}
	invalidateSiteSettingsCache(db);
	return getSiteSettings(db, env);
}
