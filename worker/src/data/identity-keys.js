export async function saveUserIdentityKey(db, userId, publicKey, keyVersion = 1) {
  const cleanKey = String(publicKey || '').trim();
  if (!cleanKey) {
    throw new Error('Identity public key is required');
  }
  const cleanVersion = Number.isInteger(Number(keyVersion)) ? Number(keyVersion) : 1;

  await db
    .prepare(
      `INSERT INTO user_identity_keys (user_id, public_key, key_version, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         public_key = excluded.public_key,
         key_version = excluded.key_version,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(Number(userId), cleanKey, cleanVersion)
    .run();

  return {
    userId: Number(userId),
    publicKey: cleanKey,
    keyVersion: cleanVersion
  };
}

export async function getUserIdentityKey(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT user_id, public_key, key_version, updated_at
       FROM user_identity_keys
       WHERE user_id = ?
       LIMIT 1`
    )
    .bind(Number(userId))
    .all();

  if (!results[0]) {
    return null;
  }

  return {
    userId: Number(results[0].user_id),
    publicKey: results[0].public_key,
    keyVersion: Number(results[0].key_version),
    updatedAt: results[0].updated_at
  };
}

export async function getUserIdentityKeys(db, userIds) {
  const validIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (validIds.length === 0) {
    return {};
  }

  const placeholders = validIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT user_id, public_key, key_version, updated_at
       FROM user_identity_keys
       WHERE user_id IN (${placeholders})`
    )
    .bind(...validIds)
    .all();

  const map = {};
  for (const row of results) {
    map[row.user_id] = {
      userId: Number(row.user_id),
      publicKey: row.public_key,
      keyVersion: Number(row.key_version),
      updatedAt: row.updated_at
    };
  }
  return map;
}

export async function saveUserKeyBackup(db, userId, { encryptedPrivateKey, backupSalt, backupIv = '', keyVersion = 1 }) {
  const cleanEnc = String(encryptedPrivateKey || '').trim();
  const cleanSalt = String(backupSalt || '').trim();
  const cleanIv = String(backupIv || '').trim();
  if (!cleanEnc || !cleanSalt) {
    throw new Error('Encrypted private key and backup salt are required');
  }
  const cleanVersion = Number.isInteger(Number(keyVersion)) ? Number(keyVersion) : 1;

  await db
    .prepare(
      `INSERT INTO user_encrypted_key_backups (user_id, encrypted_private_key, backup_salt, backup_iv, key_version, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         encrypted_private_key = excluded.encrypted_private_key,
         backup_salt = excluded.backup_salt,
         backup_iv = excluded.backup_iv,
         key_version = excluded.key_version,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(Number(userId), cleanEnc, cleanSalt, cleanIv, cleanVersion)
    .run();

  return {
    userId: Number(userId),
    keyVersion: cleanVersion
  };
}

export async function getUserKeyBackup(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT user_id, encrypted_private_key, backup_salt, backup_iv, key_version, updated_at
       FROM user_encrypted_key_backups
       WHERE user_id = ?
       LIMIT 1`
    )
    .bind(Number(userId))
    .all();

  if (!results[0]) {
    return null;
  }

  return {
    userId: Number(results[0].user_id),
    encryptedPrivateKey: results[0].encrypted_private_key,
    backupSalt: results[0].backup_salt,
    backupIv: results[0].backup_iv,
    keyVersion: Number(results[0].key_version),
    updatedAt: results[0].updated_at
  };
}
