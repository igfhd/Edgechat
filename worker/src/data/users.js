import { normalizeUtcIsoString, publicFileUrl } from "../utils.js";
import { activeUserSql, projectUserBan } from "../user-status.js";
import { hasAnyActiveGroups } from "./user-groups.js";

export function mapUserSummary(row) {
	return {
		id: Number(row.id),
		username: row.username,
		displayName: row.display_name,
		avatarUrl: row.avatar_key ? publicFileUrl(row.avatar_key) : "",
		lastActiveAt: normalizeUtcIsoString(row.last_active_at),
	};
}

export function mapAdminUser(row) {
	return {
		...mapUserSummary(row),
		isAdmin: Boolean(Number(row.is_admin)),
		...projectUserBan(row),
		createdAt: normalizeUtcIsoString(row.created_at),
		lastActiveAt: normalizeUtcIsoString(row.last_active_at),
	};
}

// In-memory throttle for user activity update (5 minutes window)
const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000;
const lastActiveTouchMap = new Map();

export async function touchUserLastActive(db, userId, force = false) {
	if (!userId || !Number.isFinite(Number(userId))) return;
	const uid = Number(userId);
	const now = Date.now();
	const lastTouch = lastActiveTouchMap.get(uid) || 0;
	if (!force && now - lastTouch < LAST_ACTIVE_THROTTLE_MS) {
		return;
	}
	lastActiveTouchMap.set(uid, now);
	try {
		await db
			.prepare(
				`UPDATE users
				 SET last_active_at = CURRENT_TIMESTAMP
				 WHERE id = ? AND deleted_at IS NULL`,
			)
			.bind(uid)
			.run();
	} catch {
		// Non-blocking
	}
}

export async function getUserByUsername(db, username) {
	const { results } = await db
		.prepare(
			`SELECT *
			 FROM users
			 WHERE username = ?
			   AND deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(username)
		.all();
	return results[0] || null;
}

export async function isUserActiveById(db, userId) {
	const { results } = await db
		.prepare(
			`SELECT id
			 FROM users
			 WHERE id = ?
			   AND deleted_at IS NULL
			   AND ${activeUserSql()}
			 LIMIT 1`,
		)
		.bind(Number(userId))
		.all();
	return Boolean(results[0]);
}

export async function listActiveUsers(db, excludeUserId, isAdmin = false) {
	const actorId = Number(excludeUserId);

	if (isAdmin) {
		const { results } = await db
			.prepare(
				`SELECT id, username, display_name, avatar_key, last_active_at
				 FROM users
				 WHERE deleted_at IS NULL
				   AND ${activeUserSql()}
				   AND id != ?
				 ORDER BY display_name ASC`,
			)
			.bind(actorId)
			.all();
		return results.map(mapUserSummary);
	}

	// 检查系统是否有任何活跃分组（复用内存缓存）
	let hasGroups = false;
	try {
		hasGroups = await hasAnyActiveGroups(db);
	} catch {
		hasGroups = false;
	}

	// 未配置任何分组时保持全开放广场模式
	if (!hasGroups) {
		const { results } = await db
			.prepare(
				`SELECT id, username, display_name, avatar_key, last_active_at
				 FROM users
				 WHERE deleted_at IS NULL
				   AND ${activeUserSql()}
				   AND id != ?
				 ORDER BY display_name ASC`,
			)
			.bind(actorId)
			.all();
		return results.map(mapUserSummary);
	}

	// 开启分组隔离模式：仅返回同组成员 + 管理员
	const { results } = await db
		.prepare(
			`SELECT DISTINCT u.id, u.username, u.display_name, u.avatar_key, u.last_active_at
			 FROM users u
			 INNER JOIN user_group_members ugm_target ON u.id = ugm_target.user_id
			 INNER JOIN user_group_members ugm_actor ON ugm_target.group_id = ugm_actor.group_id
			 INNER JOIN user_groups g ON ugm_actor.group_id = g.id
			 WHERE ugm_actor.user_id = ?
			   AND u.id != ?
			   AND u.deleted_at IS NULL
			   AND ${activeUserSql('u')}
			   AND g.deleted_at IS NULL
			   AND (
			     ugm_actor.role = 'leader'
			     OR ugm_target.role = 'leader'
			     OR (g.allow_member_dm != 0 AND g.allow_member_dm != '0')
			   )
			 UNION
			 SELECT id, username, display_name, avatar_key, last_active_at
			 FROM users
			 WHERE is_admin = 1
			   AND id != ?
			   AND deleted_at IS NULL
			   AND ${activeUserSql()}
			 ORDER BY display_name ASC`,
		)
		.bind(actorId, actorId, actorId)
		.all();

	return results.map(mapUserSummary);
}

export async function listAdminUsers(db) {
	const { results } = await db
		.prepare(
			`SELECT id, username, display_name, avatar_key, is_admin, is_disabled, disabled_until, created_at, last_active_at
			 FROM users
			 WHERE deleted_at IS NULL
			 ORDER BY created_at DESC`,
		)
		.all();
	return results.map(mapAdminUser);
}

export async function listStorageOwners(db) {
	const { results } = await db
		.prepare(
			`SELECT id, username, display_name, deleted_at
			 FROM users
			 ORDER BY id ASC`,
		)
		.all();
	return results.map((row) => ({
		id: Number(row.id),
		username: row.username,
		displayName: row.display_name,
		isDeleted: Boolean(row.deleted_at),
	}));
}
