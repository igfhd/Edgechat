// API 和历史群组 GC 共用这一事务，避免不同入口遗漏关联记录或继续占用群名。
export async function hardDeleteChannel(db, channelId) {
  const target = `SELECT id FROM channels
    WHERE id = ? AND kind IN ('public', 'private') AND name != 'general'`;

  // 确保 pending_r2_delete 表存在
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS pending_r2_delete (
       object_key TEXT PRIMARY KEY,
       retry_count INTEGER NOT NULL DEFAULT 0,
       next_retry_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       last_error TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  ).run().catch(() => {});

  // 尝试清理 message_reactions（若存在）
  await db.prepare(
    `DELETE FROM message_reactions WHERE message_id IN (
       SELECT id FROM messages WHERE channel_id IN (${target})
     )`
  ).bind(channelId).run().catch(() => {});

  const [, messages, members, , channel] = await db.batch([
    // 文件键先持久化再删消息；R2 由已有队列分批清理，失败或进程中断也不会丢失任务。
    db.prepare(
      `INSERT OR IGNORE INTO pending_r2_delete (object_key)
       SELECT attachment_key FROM messages
       WHERE channel_id IN (${target}) AND attachment_key IS NOT NULL AND attachment_key != ''
       UNION
       SELECT avatar_key FROM channels
       WHERE id IN (${target}) AND avatar_key IS NOT NULL AND avatar_key != ''`
    ).bind(channelId, channelId),
    db.prepare(`DELETE FROM messages WHERE channel_id IN (${target})`).bind(channelId),
    db.prepare(`DELETE FROM channel_members WHERE channel_id IN (${target})`).bind(channelId),
    // 已读游标没有级联外键，必须先显式删除；置顶、同步事件和 Telegram 映射由外键级联。
    db.prepare(`DELETE FROM message_reads WHERE channel_id IN (${target})`).bind(channelId),
    db.prepare(`DELETE FROM channels WHERE id IN (${target})`).bind(channelId)
  ]);

  return {
    channelsDeleted: channel?.meta?.changes ?? 0,
    channelMessagesDeleted: messages?.meta?.changes ?? 0,
    channelMembersDeleted: members?.meta?.changes ?? 0
  };
}

export async function softDeleteChannelWithRename(db, channelId) {
  const timestamp = Date.now();
  const result = await db.prepare(
    `UPDATE channels
     SET deleted_at = CURRENT_TIMESTAMP,
         name = 'deleted_' || id || '_' || ? || '_' || name
     WHERE id = ?
       AND kind IN ('public', 'private')
       AND name != 'general'
       AND deleted_at IS NULL`
  ).bind(timestamp, channelId).run();

  return {
    channelsDeleted: result?.meta?.changes ?? 0
  };
}
