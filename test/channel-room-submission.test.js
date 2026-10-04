import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelRoom } from '../worker/src/do/ChannelRoom.js';

test('ChannelRoom handles revalidation and webSocketMessage routing without reference errors', async () => {
  const mockState = {
    getWebSockets() {
      return [];
    },
    acceptWebSocket() {},
    waitUntil() {}
  };

  const mockKv = {
    async get(key) {
      if (key === 'sess_valid_token') {
        return JSON.stringify({
          token: 'sess_valid_token',
          userId: 1,
          username: 'testuser',
          isAdmin: true,
          sessionVersion: 0
        });
      }
      return null;
    },
    async put(_key, _val) {},
    async delete(_key) {}
  };

  const mockDb = {
    prepare(query) {
      return {
        bind() { return this; },
        async first() {
          if (query.includes('FROM channels')) {
            return { id: 1, name: 'general', kind: 'public' };
          }
          if (query.includes('FROM channel_members')) {
            return { role: 'admin' };
          }
          return null;
        },
        async all() {
          if (query.includes('FROM users')) {
            return {
              results: [{
                username: 'testuser',
                is_disabled: 0,
                deleted_at: null,
                session_version: 0,
                is_admin: 1
              }]
            };
          }
          if (query.includes('FROM channels')) {
            return {
              results: [{
                id: 1,
                name: 'general',
                kind: 'public',
                description: '',
                avatar_key: null,
                dm_key: null,
                created_by: 1
              }]
            };
          }
          if (query.includes('FROM channel_members')) {
            return {
              results: [{
                channel_id: 1,
                user_id: 1,
                role: 'admin',
                joined_at: '2026-01-01'
              }]
            };
          }
          return { results: [] };
        },
        async run() { return { success: true, meta: { last_row_id: 1, changes: 1 } }; }
      };
    }
  };

  const mockEnv = {
    SESSIONS: mockKv,
    DB: mockDb,
    FILES: null
  };

  const room = new ChannelRoom(mockState, mockEnv);

  const mockSocket = {
    send(_msg) {},
    close() {},
    serializeAttachment() {}
  };

  const meta = {
    token: 'sess_valid_token',
    principal: { userId: 1, isAdmin: true },
    room: { id: 1, kind: 'public', name: 'general' }
  };

  // Verify revalidateConnection executes validateSession without ReferenceError
  const revalidated = await room.revalidateConnection(mockSocket, meta);
  assert.ok(revalidated);
  assert.equal(revalidated.principal.userId, 1);

  // Setup connection in room
  room.connections.set(mockSocket, meta);

  const errors = [];
  mockSocket.send = (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'error') {
        errors.push(parsed.error);
      }
    } catch {}
  };

  // Test mark_read
  await room.webSocketMessage(mockSocket, JSON.stringify({ type: 'mark_read', messageId: 10 }));
  assert.equal(errors.length, 0);

  // Test typing
  await room.webSocketMessage(mockSocket, JSON.stringify({ type: 'typing' }));
  assert.equal(errors.length, 0);

  // Test cover_traffic
  await room.webSocketMessage(mockSocket, JSON.stringify({ type: 'cover_traffic' }));
  assert.equal(errors.length, 0);

  // Test unsupported message type
  await room.webSocketMessage(mockSocket, JSON.stringify({ type: 'some_unknown_action' }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0], '不支持的消息类型');
});
