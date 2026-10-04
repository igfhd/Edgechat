import assert from 'node:assert/strict';
import test from 'node:test';
import { insertMessage } from './data/messages.js';
import { isEncryptedMessageContent } from './encryption.js';

const testKeyring = JSON.stringify({
  activeKeyId: 'v1',
  keys: {
    v1: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64')
  }
});

test('insertMessage stores ciphertext and returns plaintext to the caller', async () => {
  let storedContent = null;
  const fakeDb = {
    prepare(sql) {
      return {
        bind(...values) {
          if (sql.includes('INSERT INTO messages')) {
            storedContent = values[2];
            return {
              async run() {
                return { meta: { last_row_id: 99 } };
              }
            };
          }

          return {
            async all() {
              return {
                results: [
                  {
                    id: 99,
                    channel_id: 7,
                    content: storedContent,
                    attachment_key: null,
                    attachment_name: null,
                    attachment_type: null,
                    attachment_size: null,
                    created_at: '2026-08-10 12:00:00',
                    sender_id: 42,
                    sender_username: 'tester',
                    sender_display_name: 'Tester',
                    sender_avatar_key: null
                  }
                ]
              };
            }
          };
        }
      };
    }
  };

  const saved = await insertMessage(
    { DB: fakeDb, EDGECHAT_ENCRYPTION_KEYRING: testKeyring },
    { channelId: 7, senderId: 42, content: 'database plaintext', attachment: null }
  );

  assert.equal(isEncryptedMessageContent(storedContent), true);
  assert.equal(storedContent.includes('database plaintext'), false);
  assert.equal(saved.content, 'database plaintext');
});

test('listMessages gracefully falls back when decryption fails or keyring is missing', async () => {
  const { listMessages } = await import('./data/messages.js');

  const fakeDb = {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              return {
                results: [
                  {
                    id: 1,
                    channel_id: 7,
                    content: 'edgechat:enc:v1:nonexistentkey:AAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBB',
                    created_at: '2026-08-10 12:00:00',
                    sender_id: 42,
                    sender_username: 'alice',
                    sender_display_name: 'Alice'
                  },
                  {
                    id: 2,
                    channel_id: 7,
                    content: 'legacy plaintext message',
                    created_at: '2026-08-10 12:01:00',
                    sender_id: 42,
                    sender_username: 'alice',
                    sender_display_name: 'Alice'
                  }
                ]
              };
            }
          };
        }
      };
    }
  };

  // 1. When keyring is missing entirely on worker env
  const messagesWithoutKeyring = await listMessages({ DB: fakeDb }, 7);
  assert.equal(messagesWithoutKeyring.length, 2);
  assert.equal(messagesWithoutKeyring[0].content, 'legacy plaintext message');
  assert.equal(messagesWithoutKeyring[1].content, '[加密消息无法解密]');

  // 2. When keyring is provided but keyId mismatches
  const messagesWithKeyring = await listMessages({ DB: fakeDb, EDGECHAT_ENCRYPTION_KEYRING: testKeyring }, 7);
  assert.equal(messagesWithKeyring.length, 2);
  assert.equal(messagesWithKeyring[0].content, 'legacy plaintext message');
  assert.equal(messagesWithKeyring[1].content, '[加密消息无法解密]');
});
