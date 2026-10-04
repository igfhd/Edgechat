import { hardDeleteChannel } from './data/channel-deletion.js';

const DEFAULT_MESSAGE_RETENTION_DAYS = 7;
const DEFAULT_SOFT_DELETE_RETENTION_DAYS = 60;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES_PER_RUN = 20;
const DEFAULT_R2_DELETE_MAX_RETRY = 8;
const MAX_ERROR_LENGTH = 500;
const DELETE_ALLOWED_IDENTIFIERS = {
  messages: new Set(['id', 'channel_id', 'sender_id']),
  registration_invites: new Set(['id']),
  channels: new Set(['id']),
  channel_members: new Set(['channel_id', 'user_id']),
  users: new Set(['id'])
};
const MESSAGE_ATTACHMENT_LOOKUP_COLUMNS = new Set(['id', 'channel_id', 'sender_id']);

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export async function getGcConfig(env) {
  let dbRetentionDays = null;
  let autoCleanupEnabled = true;
  let deletionPolicy = 'daily_reset_purge';
  if (env?.DB) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('message_retention_days', 'auto_cleanup_enabled', 'deletion_policy')"
      ).all();
      for (const row of results || []) {
        if (row.setting_key === 'message_retention_days' && row.setting_value) {
          dbRetentionDays = Number(row.setting_value);
        }
        if (row.setting_key === 'auto_cleanup_enabled' && row.setting_value !== undefined) {
          autoCleanupEnabled = row.setting_value !== '0';
        }
        if (row.setting_key === 'deletion_policy' && row.setting_value) {
          deletionPolicy = row.setting_value;
        }
      }
    } catch {
      // site_settings 未就绪时 fallback
    }
  }

  return {
    autoCleanupEnabled,
    deletionPolicy: deletionPolicy === 'immediate_purge' ? 'immediate_purge' : 'daily_reset_purge',
    messageRetentionDays: toPositiveInteger(
      dbRetentionDays || env?.MESSAGE_RETENTION_DAYS,
      DEFAULT_MESSAGE_RETENTION_DAYS
    ),
    softDeleteRetentionDays: toPositiveInteger(
      env?.SOFT_DELETE_RETENTION_DAYS,
      DEFAULT_SOFT_DELETE_RETENTION_DAYS
    ),
    batchSize: toPositiveInteger(env?.GC_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    maxBatchesPerRun: toPositiveInteger(
      env?.GC_MAX_BATCHES_PER_RUN,
      DEFAULT_MAX_BATCHES_PER_RUN
    ),
    r2DeleteMaxRetry: toPositiveInteger(
      env?.R2_DELETE_MAX_RETRY,
      DEFAULT_R2_DELETE_MAX_RETRY
    )
  };
}

function safeErrorMessage(error) {
  return String(error?.message || error || 'unknown_error').slice(0, MAX_ERROR_LENGTH);
}

function placeholders(length) {
  return Array.from({ length }, () => '?').join(', ');
}

function assertAllowedIdentifier(tableName, columnName, allowedIdentifiers) {
  const allowedColumns = allowedIdentifiers[tableName];
  if (!allowedColumns?.has(columnName)) {
    // 表名和列名不能用 bind 参数，必须用白名单限制动态 SQL 的可选范围。
    throw new Error('Invalid GC query identifier');
  }
}

function uniqueKeys(keys) {
  return [...new Set(
    keys
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
}

function createSummary() {
  return {
    retryQueueFetched: 0,
    retryQueueDeleted: 0,
    retryQueueFailed: 0,
    retryQueueSkippedReferenced: 0,
    expiredMessagesDeleted: 0,
    softDeletedMessagesDeleted: 0,
    invitesDeleted: 0,
    channelsDeleted: 0,
    channelMembersDeleted: 0,
    channelMessagesDeleted: 0,
    usersDeleted: 0,
    userMessagesDeleted: 0,
    userMembershipsDeleted: 0,
    r2Deleted: 0,
    r2DeleteFailed: 0,
    r2DeleteQueued: 0,
    r2SkippedReferenced: 0
  };
}

let gcSchemaChecked = false;
async function ensureGcSchema(db) {
  if (gcSchemaChecked) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS pending_r2_delete (
         object_key TEXT PRIMARY KEY,
         retry_count INTEGER NOT NULL DEFAULT 0,
         next_retry_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         last_error TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_pending_r2_delete_next_retry
       ON pending_r2_delete(next_retry_at, retry_count)`
    )
  ]);
  gcSchemaChecked = true;
}

async function isR2KeyReferenced(db, key) {
  const { results } = await db
    .prepare(
      `SELECT 1 AS found
       FROM (
         SELECT attachment_key AS object_key
         FROM messages
         WHERE attachment_key = ?
         UNION ALL
         SELECT avatar_key AS object_key
         FROM users
         WHERE avatar_key = ?
         UNION ALL
         SELECT avatar_key AS object_key
         FROM channels
         WHERE avatar_key = ?
       ) refs
       LIMIT 1`
    )
    .bind(key, key, key)
    .all();
  return Boolean(results[0]);
}

async function queueR2DeleteFailure(db, key, errorMessage) {
  await db
    .prepare(
      `INSERT INTO pending_r2_delete (
         object_key,
         retry_count,
         next_retry_at,
         last_error,
         created_at,
         updated_at
       )
       VALUES (?, 0, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(object_key) DO UPDATE
       SET next_retry_at = CURRENT_TIMESTAMP,
           last_error = excluded.last_error,
           updated_at = CURRENT_TIMESTAMP`
    )
    .bind(key, errorMessage)
    .run();
}

async function removePendingR2Delete(db, key) {
  await db
    .prepare(
      `DELETE FROM pending_r2_delete
       WHERE object_key = ?`
    )
    .bind(key)
    .run();
}

function retryDelayMinutes(nextRetryCount, retryExponentCap) {
  const exponent = Math.min(Math.max(nextRetryCount, 1), retryExponentCap);
  const delay = 2 ** exponent;
  return Math.min(delay, 24 * 60);
}

async function markR2RetryFailure(db, key, retryCount, delayMinutes, errorMessage) {
  await db
    .prepare(
      `UPDATE pending_r2_delete
       SET retry_count = ?,
           next_retry_at = datetime('now', ?),
           last_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE object_key = ?`
    )
    .bind(retryCount, `+${delayMinutes} minutes`, errorMessage, key)
    .run();
}

async function deleteRowsByIds(db, tableName, columnName, ids, extraSql = '') {
  assertAllowedIdentifier(tableName, columnName, DELETE_ALLOWED_IDENTIFIERS);

  if (!ids.length) {
    return 0;
  }

  const { meta } = await db
    .prepare(
      `DELETE FROM ${tableName}
       WHERE ${columnName} IN (${placeholders(ids.length)})${extraSql}`
    )
    .bind(...ids)
    .run();
  return Number(meta?.changes || 0);
}

async function collectMessageAttachmentsByColumn(db, columnName, ids) {
  if (!MESSAGE_ATTACHMENT_LOOKUP_COLUMNS.has(columnName)) {
    // 只允许当前 GC 调用到的 messages 列，避免新增调用时误把用户输入拼进 SQL。
    throw new Error('Invalid GC attachment lookup column');
  }

  if (!ids.length) {
    return [];
  }

  const { results } = await db
    .prepare(
      `SELECT attachment_key
       FROM messages
       WHERE ${columnName} IN (${placeholders(ids.length)})
         AND attachment_key IS NOT NULL
         AND attachment_key != ''`
    )
    .bind(...ids)
    .all();

  return uniqueKeys(results.map((row) => row.attachment_key));
}

async function processR2CandidateKeys(env, db, keys, summary) {
  const unique = uniqueKeys(keys);
  for (const key of unique) {
    if (await isR2KeyReferenced(db, key)) {
      summary.r2SkippedReferenced += 1;
      continue;
    }

    try {
      await env.FILES.delete(key);
      summary.r2Deleted += 1;
    } catch (error) {
      summary.r2DeleteFailed += 1;
      summary.r2DeleteQueued += 1;
      await queueR2DeleteFailure(db, key, safeErrorMessage(error));
    }
  }
}

async function runRetryQueueStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT object_key, retry_count
       FROM pending_r2_delete
       WHERE next_retry_at <= CURRENT_TIMESTAMP
       ORDER BY next_retry_at ASC
       LIMIT ?`
    )
      .bind(config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    summary.retryQueueFetched += results.length;

    for (const row of results) {
      const key = String(row.object_key || '');
      if (!key) {
        await removePendingR2Delete(env.DB, key);
        summary.retryQueueDeleted += 1;
        continue;
      }

      if (await isR2KeyReferenced(env.DB, key)) {
        await removePendingR2Delete(env.DB, key);
        summary.retryQueueSkippedReferenced += 1;
        continue;
      }

      try {
        await env.FILES.delete(key);
        await removePendingR2Delete(env.DB, key);
        summary.retryQueueDeleted += 1;
        summary.r2Deleted += 1;
      } catch (error) {
        const currentRetry = Number(row.retry_count || 0);
        const nextRetry = currentRetry + 1;
        const delayMinutes = retryDelayMinutes(nextRetry, config.r2DeleteMaxRetry);
        await markR2RetryFailure(
          env.DB,
          key,
          nextRetry,
          delayMinutes,
          safeErrorMessage(error)
        );
        summary.retryQueueFailed += 1;
      }
    }

    if (results.length < config.batchSize) {
      break;
    }
  }
}

async function runExpiredMessagesStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id, attachment_key
       FROM messages
       WHERE created_at < datetime('now', ?)
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(`-${config.messageRetentionDays} day`, config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    const ids = results.map((row) => Number(row.id));
    const keys = results.map((row) => row.attachment_key);
    summary.expiredMessagesDeleted += await deleteRowsByIds(
      env.DB,
      'messages',
      'id',
      ids
    );

    await processR2CandidateKeys(env, env.DB, keys, summary);

    if (results.length < config.batchSize) {
      break;
    }
  }
}

async function runHardDeleteInvitesStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id
       FROM registration_invites
       WHERE (
           deleted_at IS NOT NULL
           AND deleted_at < datetime('now', ?)
         )
         OR (
           deleted_at IS NULL
           AND consumed_at IS NOT NULL
           AND consumed_at < datetime('now', ?)
         )
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(
        `-${config.softDeleteRetentionDays} day`,
        `-${config.softDeleteRetentionDays} day`,
        config.batchSize
      )
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    const ids = results.map((row) => Number(row.id));
    summary.invitesDeleted += await deleteRowsByIds(
      env.DB,
      'registration_invites',
      'id',
      ids
    );

    if (results.length < config.batchSize) {
      break;
    }
  }
}

async function runHardDeleteChannelsStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id
       FROM channels
       WHERE deleted_at IS NOT NULL
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    for (const row of results) {
      const channelId = Number(row.id);
      const res = await hardDeleteChannel(env.DB, channelId);
      summary.channelsDeleted += res.channelsDeleted;
      summary.channelMessagesDeleted += res.channelMessagesDeleted;
      summary.channelMembersDeleted += res.channelMembersDeleted;
    }

    if (results.length < config.batchSize) {
      break;
    }
  }
}

async function runHardDeleteSoftDeletedMessagesStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id, attachment_key
       FROM messages
       WHERE deleted_at IS NOT NULL
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    const ids = results.map((row) => Number(row.id));
    const keys = results.map((row) => row.attachment_key);

    await env.DB.prepare(
      `DELETE FROM message_reactions WHERE message_id IN (${placeholders(ids.length)})`
    ).bind(...ids).run().catch(() => {});

    summary.softDeletedMessagesDeleted += await deleteRowsByIds(
      env.DB,
      'messages',
      'id',
      ids
    );

    await processR2CandidateKeys(env, env.DB, keys, summary);

    if (results.length < config.batchSize) {
      break;
    }
  }
}

async function clearUserReferences(env, userIds) {
  const binds = [...userIds];
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE channels
       SET created_by = NULL
       WHERE created_by IN (${placeholders(userIds.length)})`
    ).bind(...binds),
    env.DB.prepare(
      `UPDATE registration_invites
       SET created_by = NULL
       WHERE created_by IN (${placeholders(userIds.length)})`
    ).bind(...binds),
    env.DB.prepare(
      `UPDATE registration_invites
       SET consumed_by_user_id = NULL
       WHERE consumed_by_user_id IN (${placeholders(userIds.length)})`
    ).bind(...binds),
    env.DB.prepare(
      `UPDATE channel_members
       SET invited_by = NULL
       WHERE invited_by IN (${placeholders(userIds.length)})`
    ).bind(...binds)
  ]);
}

async function runHardDeleteUsersStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id, avatar_key
       FROM users
       WHERE deleted_at IS NOT NULL
         AND deleted_at < datetime('now', ?)
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(`-${config.softDeleteRetentionDays} day`, config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    const userIds = results.map((row) => Number(row.id));
    const avatarKeys = results.map((row) => row.avatar_key);
    const attachmentKeys = await collectMessageAttachmentsByColumn(
      env.DB,
      'sender_id',
      userIds
    );

    await clearUserReferences(env, userIds);
    summary.userMessagesDeleted += await deleteRowsByIds(
      env.DB,
      'messages',
      'sender_id',
      userIds
    );
    summary.userMembershipsDeleted += await deleteRowsByIds(
      env.DB,
      'channel_members',
      'user_id',
      userIds
    );
    summary.usersDeleted += await deleteRowsByIds(
      env.DB,
      'users',
      'id',
      userIds
    );

    await processR2CandidateKeys(
      env,
      env.DB,
      [...attachmentKeys, ...avatarKeys],
      summary
    );

    if (results.length < config.batchSize) {
      break;
    }
  }
}

export async function runScheduledGc(env) {
  const config = await getGcConfig(env);
  const summary = createSummary();
  await ensureGcSchema(env.DB);

  await runRetryQueueStep(env, config, summary);
  if (config.autoCleanupEnabled) {
    await runExpiredMessagesStep(env, config, summary);
  }
  await runHardDeleteChannelsStep(env, config, summary);
  await runHardDeleteSoftDeletedMessagesStep(env, config, summary);
  await runHardDeleteInvitesStep(env, config, summary);
  await runHardDeleteUsersStep(env, config, summary);
  await runRetryQueueStep(env, config, summary);

  console.log(JSON.stringify({
    type: 'scheduled_gc_summary',
    config,
    summary
  }));

  return summary;
}
