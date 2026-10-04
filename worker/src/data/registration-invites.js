import { ApiError } from '../errors.js';

export const MAX_INVITE_USES = 1000;

function toInvite(row) {
  const maxUses = Number(row.max_uses);
  const usedCount = Number(row.used_count);
  const groupId = row.group_id ? Number(row.group_id) : null;

  return {
    id: Number(row.id),
    token: row.token,
    note: row.note || '',
    maxUses,
    usedCount,
    groupId,
    groupName: row.group_name || '',
    remainingUses: Math.max(0, maxUses - usedCount),
    createdAt: row.created_at,
    consumedAt: row.consumed_at || null,
    deletedAt: row.deleted_at || null,
    creatorDisplayName: row.creator_display_name || '管理员',
    consumerDisplayName: row.consumer_display_name || '',
    isAvailable: !row.deleted_at && usedCount < maxUses
  };
}

export async function listActiveRegistrationInvites(db) {
  const { results } = await db.prepare(
    `SELECT
       ri.id,
       ri.token,
       ri.note,
       ri.max_uses,
       ri.used_count,
       ri.group_id,
       ri.created_at,
       ri.consumed_at,
       ri.deleted_at,
       creator.display_name AS creator_display_name,
       consumer.display_name AS consumer_display_name,
       g.name AS group_name
     FROM registration_invites ri
     LEFT JOIN users creator ON creator.id = ri.created_by
     LEFT JOIN users consumer ON consumer.id = ri.consumed_by_user_id
     LEFT JOIN user_groups g ON g.id = ri.group_id AND g.deleted_at IS NULL
     WHERE ri.deleted_at IS NULL
       AND ri.used_count < ri.max_uses
     ORDER BY ri.created_at DESC`
  ).all();

  return results.map(toInvite);
}

export async function createRegistrationInvite(db, invite) {
  const groupId = invite.groupId ? Number(invite.groupId) : null;
  const result = await db.prepare(
    `INSERT INTO registration_invites (token, note, max_uses, group_id, created_by)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(invite.token, invite.note, invite.maxUses, groupId, invite.createdBy)
    .run();

  let groupName = '';
  if (groupId) {
    const g = await db.prepare('SELECT name FROM user_groups WHERE id = ? AND deleted_at IS NULL').bind(groupId).first();
    if (g?.name) groupName = String(g.name);
  }

  return toInvite({
    id: result.meta.last_row_id,
    token: invite.token,
    note: invite.note,
    max_uses: invite.maxUses,
    used_count: 0,
    group_id: groupId,
    group_name: groupName,
    created_at: new Date().toISOString(),
    consumed_at: null,
    deleted_at: null,
    creator_display_name: invite.creatorDisplayName,
    consumer_display_name: ''
  });
}

export async function revokeRegistrationInvite(db, inviteId) {
  await db.prepare(
    `UPDATE registration_invites
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND deleted_at IS NULL`
  )
    .bind(inviteId)
    .run();
}

export async function getAvailableRegistrationInvite(db, token) {
  const row = await db.prepare(
    `SELECT ri.id, ri.note, ri.max_uses, ri.used_count, ri.group_id, ri.created_at,
            g.name AS group_name
     FROM registration_invites ri
     LEFT JOIN user_groups g ON g.id = ri.group_id AND g.deleted_at IS NULL
     WHERE ri.token = ?
       AND ri.deleted_at IS NULL
       AND ri.used_count < ri.max_uses
     LIMIT 1`
  )
    .bind(token)
    .first();

  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    note: row.note || '',
    maxUses: Number(row.max_uses),
    usedCount: Number(row.used_count),
    groupId: row.group_id ? Number(row.group_id) : null,
    groupName: row.group_name || '',
    remainingUses: Math.max(0, Number(row.max_uses) - Number(row.used_count)),
    createdAt: row.created_at
  };
}

export async function createUserWithRegistrationInvite(db, user) {
  try {
    const statements = [
      db.prepare(
        `INSERT INTO users (
           username,
           display_name,
           password_hash,
           password_salt
         ) VALUES (?, ?, ?, ?)`
      ).bind(user.username, user.displayName, user.passwordHash, user.passwordSalt),
      db.prepare(
        `INSERT INTO registration_invite_uses (invite_id, user_id)
         VALUES (?, (SELECT id FROM users WHERE username = ?))`
      ).bind(user.inviteId, user.username)
    ];

    if (user.groupId) {
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO user_group_members (group_id, user_id)
           VALUES (?, (SELECT id FROM users WHERE username = ?))`
        ).bind(user.groupId, user.username)
      );
    }

    const [userResult] = await db.batch(statements);

    return Number(userResult.meta.last_row_id);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('REGISTRATION_INVITE_UNAVAILABLE')) {
      throw new ApiError('注册链接已失效');
    }
    if (message.includes('UNIQUE')) {
      throw new ApiError('用户名已存在');
    }
    throw error;
  }
}
