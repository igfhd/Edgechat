import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getUserIdentityKey,
  getUserIdentityKeys,
  saveUserIdentityKey
} from '../worker/src/data/identity-keys.js';
import {
  decryptDmPayload,
  encryptDmPayload
} from '../frontend/src/crypto/message-cipher.js';
import {
  exportPublicKey,
  generateIdentityKeyPair
} from '../frontend/src/crypto/x25519.js';
import { isE2eeEnvelope } from '../frontend/src/crypto/utils.js';
import { insertMessage, listMessages } from '../worker/src/data/messages.js';
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

  // Wrap in D1-compatible prepare API
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

test('E2EE Identity Key lifecycle and DM messaging full integration', async () => {
  const db = createTestDatabase();
  const env = {
    DB: db,
    EDGECHAT_ENCRYPTION_KEY_1: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
  };

  // 1. Create 2 users (Alice & Bob)
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'hash', 'salt')").bind().run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (2, 'bob', 'Bob', 'hash', 'salt')").bind().run();

  // Create DM channel between Alice & Bob
  await db.prepare("INSERT INTO channels (id, name, kind, dm_key) VALUES (10, 'dm:1:2', 'dm', 'dm:1:2')").bind().run();
  await db.prepare("INSERT INTO channel_members (channel_id, user_id) VALUES (10, 1)").bind().run();
  await db.prepare("INSERT INTO channel_members (channel_id, user_id) VALUES (10, 2)").bind().run();

  // 2. Alice & Bob generate their X25519 identity keypairs
  const aliceKeyPair = await generateIdentityKeyPair();
  const bobKeyPair = await generateIdentityKeyPair();

  const alicePubBase64 = await exportPublicKey(aliceKeyPair.publicKey);
  const bobPubBase64 = await exportPublicKey(bobKeyPair.publicKey);

  // 3. Alice & Bob upload public keys to D1
  await saveUserIdentityKey(db, 1, alicePubBase64);
  await saveUserIdentityKey(db, 2, bobPubBase64);

  // 4. Verify public keys can be queried individually and in batch
  const aliceKeyRecord = await getUserIdentityKey(db, 1);
  assert.equal(aliceKeyRecord.publicKey, alicePubBase64);

  const batchRecords = await getUserIdentityKeys(db, [1, 2]);
  assert.equal(batchRecords[1].publicKey, alicePubBase64);
  assert.equal(batchRecords[2].publicKey, bobPubBase64);

  // 5. Alice writes an E2EE encrypted message to Bob in DM room 10
  const originalSecretText = 'Hey Bob, this message is end-to-end encrypted with X25519+HKDF+AES-256-GCM! 🛡️';
  const e2eeEnvelope = await encryptDmPayload({
    senderId: 1,
    senderKeyPair: aliceKeyPair,
    recipientId: 2,
    recipientPublicKeyBase64: bobPubBase64,
    senderPublicKeyBase64: alicePubBase64,
    roomId: 10,
    text: originalSecretText
  });

  assert.equal(isE2eeEnvelope(e2eeEnvelope), true);

  // 6. Alice submits the encrypted envelope to Worker
  const saved = await insertMessage(env, {
    channelId: 10,
    senderId: 1,
    content: e2eeEnvelope
  });

  assert.equal(saved.e2ee, true);
  assert.equal(saved.content, e2eeEnvelope); // Server did not modify the envelope

  // 7. Bob fetches messages from Worker
  const messages = await listMessages(env, 10);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].e2ee, true);
  assert.equal(messages[0].content, e2eeEnvelope);

  // 8. Bob decrypts the message locally
  const bobDecrypted = await decryptDmPayload({
    currentUserId: 2,
    currentUserPrivateKey: bobKeyPair.privateKey,
    roomId: 10,
    envelopeContent: messages[0].content
  });

  assert.equal(bobDecrypted.decrypted, true);
  assert.equal(bobDecrypted.text, originalSecretText);

  // 9. Alice also decrypts her own message from history
  const aliceDecrypted = await decryptDmPayload({
    currentUserId: 1,
    currentUserPrivateKey: aliceKeyPair.privateKey,
    roomId: 10,
    envelopeContent: messages[0].content
  });

  assert.equal(aliceDecrypted.decrypted, true);
  assert.equal(aliceDecrypted.text, originalSecretText);
});
