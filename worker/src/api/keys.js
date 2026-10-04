import {
  getUserIdentityKey,
  getUserIdentityKeys,
  getUserKeyBackup,
  saveUserIdentityKey,
  saveUserKeyBackup
} from '../data/identity-keys.js';
import { canUsersDirectMessage } from '../data/user-groups.js';
import { errorResponse, parseJsonRequest } from '../utils.js';

export function registerKeyRoutes(app) {
  // 上传/更新当前用户的 X25519 身份公钥
  app.post('/api/keys/identity', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const publicKey = String(payload.publicKey || '').trim();
    const keyVersion = Number(payload.keyVersion) || 1;
    const resetConfirmed = Boolean(payload.resetConfirmed);

    if (!publicKey) {
      return errorResponse('公钥不能为空');
    }

    try {
      const existing = await getUserIdentityKey(c.env.DB, session.userId);
      const backup = await getUserKeyBackup(c.env.DB, session.userId);
      // 仅在云端已有加密私钥备份且未显式确认重置时，才提示需口令恢复或显式重置；
      // 若云端无备份（旧私钥已不可恢复），直接更新为当前设备新公钥，保障通信顺畅。
      if (existing?.publicKey && existing.publicKey !== publicKey && backup?.encryptedPrivateKey && !resetConfirmed) {
        return errorResponse('该账户已在云端备份私钥，请先输入口令恢复私钥，或显式确认重置公钥', 400);
      }
      const result = await saveUserIdentityKey(c.env.DB, session.userId, publicKey, keyVersion);
      return c.json({ ok: true, key: result });
    } catch (error) {
      return errorResponse(error.message || '保存公钥失败');
    }
  });

  // 获取指定用户的身份公钥
  app.get('/api/keys/identity/:userId', async (c) => {
    const session = c.get('session');
    const userId = Number(c.req.param('userId'));
    if (!Number.isInteger(userId) || userId <= 0) {
      return errorResponse('用户ID无效');
    }

    if (userId !== session.userId) {
      const canAccess = await canUsersDirectMessage(c.env.DB, session.userId, userId);
      if (!canAccess) {
        return errorResponse('无权获取该用户的身份公钥', 403);
      }
    }

    const key = await getUserIdentityKey(c.env.DB, userId);
    return c.json({ ok: true, key });
  });

  // 批量获取用户的身份公钥
  app.post('/api/keys/identity/batch', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const userIds = Array.isArray(payload.userIds) ? payload.userIds.map(Number) : [];

    const allowedIds = [];
    const checkPromises = userIds.map(async (uid) => {
      if (uid === session.userId) {
        return uid;
      }
      const canAccess = await canUsersDirectMessage(c.env.DB, session.userId, uid);
      return canAccess ? uid : null;
    });
    const checked = await Promise.all(checkPromises);
    for (const uid of checked) {
      if (uid !== null) {
        allowedIds.push(uid);
      }
    }

    const keys = await getUserIdentityKeys(c.env.DB, allowedIds);
    return c.json({ ok: true, keys });
  });

  // 上传私钥加密备份
  app.post('/api/keys/backup', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const encryptedPrivateKey = String(payload.encryptedPrivateKey || '').trim();
    const backupSalt = String(payload.backupSalt || '').trim();
    const backupIv = String(payload.backupIv || '').trim();
    const keyVersion = Number(payload.keyVersion) || 1;

    if (!encryptedPrivateKey || !backupSalt) {
      return errorResponse('备份密文与盐值不能为空');
    }

    try {
      const result = await saveUserKeyBackup(c.env.DB, session.userId, {
        encryptedPrivateKey,
        backupSalt,
        backupIv,
        keyVersion
      });
      return c.json({ ok: true, backup: result });
    } catch (error) {
      return errorResponse(error.message || '保存私钥备份失败');
    }
  });

  // 获取当前用户的私钥加密备份
  app.get('/api/keys/backup', async (c) => {
    const session = c.get('session');
    const backup = await getUserKeyBackup(c.env.DB, session.userId);
    return c.json({ ok: true, backup });
  });
}
