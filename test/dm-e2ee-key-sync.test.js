import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveUserIdentityKey
} from '../worker/src/data/identity-keys.js';
import { canUsersDirectMessage } from '../worker/src/data/user-groups.js';
import {
  encryptDmPayload,
  decryptDmPayload
} from '../frontend/src/crypto/message-cipher.js';
import {
  exportPublicKey,
  generateIdentityKeyPair
} from '../frontend/src/crypto/x25519.js';
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

test('私聊双向 E2EE 加密/解密在跨设备及会话成员权限下均能正常解密', async () => {
  const db = createTestDatabase();

  // 1. 创建用户 1 (Alice) 和用户 2 (Bob)
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h1', 's1')").bind().run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (2, 'bob', 'Bob', 'h2', 's2')").bind().run();

  // 创建私聊频道
  await db.prepare("INSERT INTO channels (id, name, kind, dm_key) VALUES (100, '1:2', 'dm', '1:2')").bind().run();
  await db.prepare("INSERT INTO channel_members (channel_id, user_id) VALUES (100, 1)").bind().run();
  await db.prepare("INSERT INTO channel_members (channel_id, user_id) VALUES (100, 2)").bind().run();

  // 验证在已有私聊会话时，即使未配置企业分组，双方也能互访公钥 (canUsersDirectMessage 返回 true)
  const canAliceToBob = await canUsersDirectMessage(db, 1, 2);
  const canBobToAlice = await canUsersDirectMessage(db, 2, 1);
  assert.equal(canAliceToBob, true);
  assert.equal(canBobToAlice, true);

  // 2. Alice 生成密钥并同步公钥
  const aliceKey1 = await generateIdentityKeyPair();
  const alicePub1 = await exportPublicKey(aliceKey1.publicKey);
  await saveUserIdentityKey(db, 1, alicePub1);

  // 3. Bob 生成密钥并同步公钥
  const bobKey1 = await generateIdentityKeyPair();
  const bobPub1 = await exportPublicKey(bobKey1.publicKey);
  await saveUserIdentityKey(db, 2, bobPub1);

  // 4. Alice 发送私聊消息给 Bob
  const envAliceToBob = await encryptDmPayload({
    senderId: 1,
    senderKeyPair: aliceKey1,
    recipientId: 2,
    recipientPublicKeyBase64: bobPub1,
    senderPublicKeyBase64: alicePub1,
    roomId: 100,
    text: 'Hello Bob from Alice'
  });

  // Bob 解密 Alice 的消息 -> 成功
  const bobDec1 = await decryptDmPayload({
    currentUserId: 2,
    currentUserPrivateKey: bobKey1.privateKey,
    roomId: 100,
    envelopeContent: envAliceToBob
  });
  assert.equal(bobDec1.decrypted, true);
  assert.equal(bobDec1.text, 'Hello Bob from Alice');

  // Alice 查看自己发出的消息 -> 成功
  const aliceDecOwn = await decryptDmPayload({
    currentUserId: 1,
    currentUserPrivateKey: aliceKey1.privateKey,
    roomId: 100,
    envelopeContent: envAliceToBob
  });
  assert.equal(aliceDecOwn.decrypted, true);
  assert.equal(aliceDecOwn.text, 'Hello Bob from Alice');

  // 5. Bob 回复 Alice
  const envBobToAlice = await encryptDmPayload({
    senderId: 2,
    senderKeyPair: bobKey1,
    recipientId: 1,
    recipientPublicKeyBase64: alicePub1,
    senderPublicKeyBase64: bobPub1,
    roomId: 100,
    text: 'Hello Alice from Bob'
  });

  // Alice 解密 Bob 的消息 -> 成功！双方均能正常显示！
  const aliceDec1 = await decryptDmPayload({
    currentUserId: 1,
    currentUserPrivateKey: aliceKey1.privateKey,
    roomId: 100,
    envelopeContent: envBobToAlice
  });
  assert.equal(aliceDec1.decrypted, true);
  assert.equal(aliceDec1.text, 'Hello Alice from Bob');

  // Bob 查看自己发出的消息 -> 成功
  const bobDecOwn = await decryptDmPayload({
    currentUserId: 2,
    currentUserPrivateKey: bobKey1.privateKey,
    roomId: 100,
    envelopeContent: envBobToAlice
  });
  assert.equal(bobDecOwn.decrypted, true);
  assert.equal(bobDecOwn.text, 'Hello Alice from Bob');
});
