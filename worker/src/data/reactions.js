import { getMessageById } from './messages.js';

let reactionsSchemaChecked = false;

export async function ensureReactionsAndPinSchema(db) {
  if (reactionsSchemaChecked) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        reaction TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, user_id, reaction),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_message_reactions_msg ON message_reactions(message_id)`).run();
  } catch (err) {
    console.warn('[reactions schema check]', err.message);
  }

  try {
    await db.prepare(`ALTER TABLE channels ADD COLUMN pinned_message_id INTEGER DEFAULT NULL`).run();
  } catch {
    // Column already exists, ignore
  }
  reactionsSchemaChecked = true;
}

export const MAX_REACTION_LENGTH = 32;

export async function toggleMessageReaction(db, { messageId, userId, reaction }) {
  await ensureReactionsAndPinSchema(db);
  const mid = Number(messageId);
  const uid = Number(userId);
  const emoji = String(reaction || '').trim();
  if (!mid || !uid || !emoji) {
    throw new Error('参数无效');
  }
  if (emoji.length > MAX_REACTION_LENGTH) {
    throw new Error('表情长度超出限制');
  }

  const existing = await db.prepare(
    `SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ? LIMIT 1`
  ).bind(mid, uid, emoji).first();

  if (existing) {
    await db.prepare(`DELETE FROM message_reactions WHERE id = ?`).bind(existing.id).run();
    return { action: 'removed', reaction: emoji, messageId: mid, userId: uid };
  } else {
    await db.prepare(
      `INSERT INTO message_reactions (message_id, user_id, reaction, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(mid, uid, emoji).run();
    return { action: 'added', reaction: emoji, messageId: mid, userId: uid };
  }
}

export async function getReactionsForMessages(db, messageIds, currentUserId = null) {
  await ensureReactionsAndPinSchema(db);
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return {};
  }

  const ids = messageIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return {};

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT mr.message_id, mr.reaction, mr.user_id, u.display_name
     FROM message_reactions mr
     JOIN users u ON mr.user_id = u.id
     WHERE mr.message_id IN (${placeholders})
     ORDER BY mr.created_at ASC`
  ).bind(...ids).all();

  const reactionMap = {};
  for (const row of results || []) {
    const msgId = Number(row.message_id);
    if (!reactionMap[msgId]) {
      reactionMap[msgId] = {};
    }
    const emoji = row.reaction;
    if (!reactionMap[msgId][emoji]) {
      reactionMap[msgId][emoji] = {
        reaction: emoji,
        count: 0,
        userNames: [],
        reactedByMe: false
      };
    }
    reactionMap[msgId][emoji].count += 1;
    reactionMap[msgId][emoji].userNames.push(row.display_name || '用户');
    if (currentUserId && Number(row.user_id) === Number(currentUserId)) {
      reactionMap[msgId][emoji].reactedByMe = true;
    }
  }

  // Convert to array per message: { [messageId]: [{ reaction, count, userNames, reactedByMe }] }
  const finalMap = {};
  for (const [msgId, emojis] of Object.entries(reactionMap)) {
    finalMap[msgId] = Object.values(emojis);
  }
  return finalMap;
}

export async function setChannelPinnedMessage(db, channelId, messageId = null) {
  await ensureReactionsAndPinSchema(db);
  const cid = Number(channelId);
  const mid = messageId ? Number(messageId) : null;
  await db.prepare(
    `UPDATE channels SET pinned_message_id = ? WHERE id = ?`
  ).bind(mid, cid).run();
  return mid;
}

export async function getChannelPinnedMessage(env, channelId) {
  await ensureReactionsAndPinSchema(env.DB);
  const cid = Number(channelId);
  const channel = await env.DB.prepare(
    `SELECT pinned_message_id FROM channels WHERE id = ? LIMIT 1`
  ).bind(cid).first();

  if (!channel?.pinned_message_id) return null;
  return getMessageById(env, channel.pinned_message_id);
}
