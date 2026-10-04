import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getUserKeyBackup,
  saveUserIdentityKey,
  saveUserKeyBackup
} from '../worker/src/data/identity-keys.js';
import {
  backupPrivateKeyWithPassphrase,
  generateRecoveryPhrase,
  restorePrivateKeyWithPassphrase
} from '../frontend/src/crypto/key-backup.js';
import {
  exportPrivateKey,
  exportPublicKey,
  generateIdentityKeyPair
} from '../frontend/src/crypto/x25519.js';
import {
  decryptDmPayload,
  encryptDmPayload
} from '../frontend/src/crypto/message-cipher.js';
import initSqlJs from 'sql.js';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createTestDatabase() {
  const db = new SQL.Database();
  const schema = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');
  db.exec(schema);

  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              const stmt = db.prepare(sql);
              stmt.bind(params);
              const results = [];
              while (stmt.step()) {
                results.push(stmt.getAsObject());
              }
              stmt.free();
              return { results };
            },
            async run() {
              const stmt = db.prepare(sql);
              stmt.bind(params);
              stmt.step();
              stmt.free();
              const lastIdRes = db.exec('SELECT last_insert_rowid() AS id, changes() AS changes');
              const lastRowId = lastIdRes[0]?.values[0]?.[0] || 0;
              const changes = lastIdRes[0]?.values[0]?.[1] || 0;
              return { meta: { last_row_id: lastRowId, changes } };
            }
          };
        }
      };
    }
  };
}

test('Zero-Knowledge E2EE Key Backup, Roaming to New Device & Explicit Reset', async () => {
  const db = createTestDatabase();
  const aliceUserId = 1;
  const bobUserId = 2;

  // Insert users
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h1', 's1')").bind().run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (2, 'bob', 'Bob', 'h2', 's2')").bind().run();

  // 1. Device A: Alice creates identity key
  const aliceKeyPair = await generateIdentityKeyPair();
  const alicePrivBase64 = await exportPrivateKey(aliceKeyPair.privateKey);
  const alicePubBase64 = await exportPublicKey(aliceKeyPair.publicKey);

  await saveUserIdentityKey(db, aliceUserId, alicePubBase64, 1);

  // 2. Device A: Alice backs up private key with independent passphrase (never sent to server)
  const aliceSecretPassphrase = 'AliceIndependentSecurityPassphrase!2026';
  const backupPayload = await backupPrivateKeyWithPassphrase({
    privateKeyBase64: alicePrivBase64,
    passphrase: aliceSecretPassphrase,
    keyVersion: 1
  });

  // Server only receives ciphertext, salt, iv
  await saveUserKeyBackup(db, aliceUserId, backupPayload);

  // 3. Bob sends an encrypted message to Alice
  const bobKeyPair = await generateIdentityKeyPair();
  const bobPubBase64 = await exportPublicKey(bobKeyPair.publicKey);
  await saveUserIdentityKey(db, bobUserId, bobPubBase64, 1);

  const secretMessageText = 'Confidential financial report for Alice 📈';
  const envelope = await encryptDmPayload({
    senderId: bobUserId,
    senderKeyPair: bobKeyPair,
    recipientId: aliceUserId,
    recipientPublicKeyBase64: alicePubBase64,
    senderPublicKeyBase64: bobPubBase64,
    roomId: 99,
    text: secretMessageText
  });

  // 4. Device B (Alice on new laptop/phone):
  // Fetches cloud backup record
  const cloudBackup = await getUserKeyBackup(db, aliceUserId);
  assert.ok(cloudBackup);
  assert.equal(cloudBackup.encryptedPrivateKey, backupPayload.encryptedPrivateKey);

  // 4A. Wrong passphrase fails without corrupting anything
  await assert.rejects(
    async () => {
      await restorePrivateKeyWithPassphrase({
        encryptedPrivateKey: cloudBackup.encryptedPrivateKey,
        backupSalt: cloudBackup.backupSalt,
        backupIv: cloudBackup.backupIv,
        passphrase: 'IncorrectPassword'
      });
    },
    /安全口令或 12 词恢复短语错误/
  );

  // 4B. Correct passphrase restores private key
  const restoredAlicePrivBase64 = await restorePrivateKeyWithPassphrase({
    encryptedPrivateKey: cloudBackup.encryptedPrivateKey,
    backupSalt: cloudBackup.backupSalt,
    backupIv: cloudBackup.backupIv,
    passphrase: aliceSecretPassphrase
  });
  assert.equal(restoredAlicePrivBase64, alicePrivBase64);

  // 4C. Device B can now decrypt Bob's message
  const aliceRestoredKeyObj = await import('../frontend/src/crypto/x25519.js').then((m) =>
    m.importPrivateKey(restoredAlicePrivBase64)
  );

  const decrypted = await decryptDmPayload({
    currentUserId: aliceUserId,
    currentUserPrivateKey: aliceRestoredKeyObj,
    roomId: 99,
    envelopeContent: envelope
  });

  assert.equal(decrypted.decrypted, true);
  assert.equal(decrypted.text, secretMessageText);

  // 5. 12-word BIP-39 recovery phrase alternative
  const recoveryPhrase = await generateRecoveryPhrase();
  const phraseBackupPayload = await backupPrivateKeyWithPassphrase({
    privateKeyBase64: alicePrivBase64,
    passphrase: recoveryPhrase,
    keyVersion: 2
  });
  await saveUserKeyBackup(db, aliceUserId, phraseBackupPayload);

  const restoredWithPhrase = await restorePrivateKeyWithPassphrase({
    encryptedPrivateKey: phraseBackupPayload.encryptedPrivateKey,
    backupSalt: phraseBackupPayload.backupSalt,
    backupIv: phraseBackupPayload.backupIv,
    passphrase: recoveryPhrase
  });
  assert.equal(restoredWithPhrase, alicePrivBase64);
});
