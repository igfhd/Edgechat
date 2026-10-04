export async function recordUploadedFile(
	db,
	{ key, ownerUserId, filename, contentType, size },
) {
	await db
		.prepare(
			`INSERT INTO uploaded_files (
			   object_key, owner_user_id, filename, content_type, size, created_at
			 ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(object_key) DO UPDATE SET
			   owner_user_id = excluded.owner_user_id,
			   filename = excluded.filename,
			   content_type = excluded.content_type,
			   size = excluded.size`,
		)
		.bind(
			String(key),
			Number(ownerUserId),
			String(filename || ""),
			String(contentType || ""),
			Number(size || 0),
		)
		.run();
}

export async function getUploadedFileMetadata(db, key) {
	const { results } = await db
		.prepare(
			`SELECT filename, content_type, size
			 FROM uploaded_files WHERE object_key = ? LIMIT 1`,
		)
		.bind(String(key))
		.all();
	const row = results[0];
	return row
		? {
				filename: row.filename,
				contentType: row.content_type,
				size: Number(row.size || 0),
			}
		: null;
}

export async function getOwnedUploadedFileMetadata(db, key, userId) {
	const { results } = await db
		.prepare(
			`SELECT filename, content_type, size
			 FROM uploaded_files
			 WHERE object_key = ? AND owner_user_id = ?
			 LIMIT 1`,
		)
		.bind(String(key), Number(userId))
		.all();
	const row = results[0];
	return row
		? {
				filename: row.filename,
				contentType: row.content_type,
				size: Number(row.size || 0),
			}
		: null;
}

export async function fileBelongsToUser(db, key, userId) {
	const { results } = await db
		.prepare(
			`SELECT 1 AS found FROM uploaded_files
			 WHERE object_key = ? AND owner_user_id = ? LIMIT 1`,
		)
		.bind(String(key), Number(userId))
		.all();
	return Boolean(results[0]);
}

export async function canAccessFile(db, key, userId = null) {
	const cleanKey = String(key || "");
	if (!cleanKey) return false;

	// 头像本来就是公开资料，保持无会话访问，避免登录页和成员列表出现破图。
	const publicRefs = await db
		.prepare(
			`SELECT 1 AS found
			 WHERE EXISTS (SELECT 1 FROM users WHERE avatar_key = ? AND deleted_at IS NULL)
			    OR EXISTS (SELECT 1 FROM channels WHERE avatar_key = ? AND deleted_at IS NULL)`,
		)
		.bind(cleanKey, cleanKey)
		.all();
	if (publicRefs.results[0]) return true;
	if (!Number.isFinite(Number(userId))) return false;

	// 发送前允许上传者预览；发送后则按消息所在公开群组或成员关系授权。
	const { results } = await db
		.prepare(
			`SELECT 1 AS found
			 WHERE EXISTS (
			   SELECT 1 FROM uploaded_files uf
			   WHERE uf.object_key = ? AND uf.owner_user_id = ?
			 ) OR EXISTS (
			   SELECT 1 FROM messages m
			   JOIN channels c ON c.id = m.channel_id
			   WHERE m.attachment_key = ?
			     AND m.deleted_at IS NULL AND c.deleted_at IS NULL
			     AND (c.kind = 'public' OR EXISTS (
			       SELECT 1 FROM channel_members cm
			       WHERE cm.channel_id = c.id AND cm.user_id = ?
			     ))
			 )`,
		)
		.bind(cleanKey, Number(userId), cleanKey, Number(userId))
		.all();
	return Boolean(results[0]);
}
