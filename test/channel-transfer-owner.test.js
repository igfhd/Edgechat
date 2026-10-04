import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { registerChannelRoutes } from '../worker/src/api/channels.js';
import { useRoomManagement } from '../frontend/src/composables/useRoomManagement.js';
import { ref, computed } from 'vue';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createTestDb() {
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_key TEXT,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      disabled_until TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      avatar_key TEXT,
      kind TEXT NOT NULL,
      dm_key TEXT UNIQUE,
      created_by INTEGER,
      pinned_message_id INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE TABLE channel_members (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by INTEGER,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id)
    );
    CREATE TABLE site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO users (id, username, display_name) VALUES
      (1, 'alice', 'Alice'),
      (2, 'bob', 'Bob'),
      (3, 'carol', 'Carol');
    INSERT INTO channels (id, name, kind, created_by) VALUES
      (1, 'general', 'public', NULL),
      (2, 'Team', 'private', 1);
    INSERT INTO channel_members (channel_id, user_id, role) VALUES
      (1, 1, 'member'),
      (1, 2, 'member'),
      (2, 1, 'owner'),
      (2, 2, 'member');
  `);

  return {
    rawDb: db,
    prepare(query) {
      return {
        _bound: [],
        bind(...args) {
          this._bound = args;
          return this;
        },
        async first() {
          const stmt = db.prepare(query);
          stmt.bind(this._bound);
          let row = null;
          if (stmt.step()) {
            row = stmt.getAsObject();
          }
          stmt.free();
          return row;
        },
        async all() {
          const stmt = db.prepare(query);
          stmt.bind(this._bound);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return { results };
        },
        async run() {
          const stmt = db.prepare(query);
          stmt.bind(this._bound);
          stmt.step();
          stmt.free();
          const lastId = Number(db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] || 1);
          return { success: true, meta: { changes: 1, last_row_id: lastId } };
        }
      };
    },
    async batch(stmts) {
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    }
  };
}

test('POST /api/channels/:channelId/transfer-owner 允许群主转让权限给其他群成员', async () => {
  const db = createTestDb();
  const app = new Hono();
  app.use('*', async (c, next) => {
    const uid = Number(c.req.header('x-user-id') || 1);
    c.set('session', { userId: uid, username: `user_${uid}`, isAdmin: false });
    await next();
  });
  registerChannelRoutes(app);

  // 1. 普通成员 Bob (id=2) 尝试转让群主，应被 403 拒绝
  const resForbidden = await app.request('/api/channels/2/transfer-owner', {
    method: 'POST',
    headers: { 'x-user-id': '2', 'content-type': 'application/json' },
    body: JSON.stringify({ newOwnerId: 1 })
  }, { DB: db });
  assert.equal(resForbidden.status, 403);

  // 2. 转让给非本群成员 (Carol, id=3) 报错 400
  const resNonMember = await app.request('/api/channels/2/transfer-owner', {
    method: 'POST',
    headers: { 'x-user-id': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ newOwnerId: 3 })
  }, { DB: db });
  assert.equal(resNonMember.status, 400);

  // 3. 转让给已经是群主的自己报错 400
  const resSelf = await app.request('/api/channels/2/transfer-owner', {
    method: 'POST',
    headers: { 'x-user-id': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ newOwnerId: 1 })
  }, { DB: db });
  assert.equal(resSelf.status, 400);

  // 4. 群主 Alice (id=1) 将群主转让给 Bob (id=2)，应成功 200
  const resSuccess = await app.request('/api/channels/2/transfer-owner', {
    method: 'POST',
    headers: { 'x-user-id': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ newOwnerId: 2 })
  }, { DB: db });
  assert.equal(resSuccess.status, 200);
  const data = await resSuccess.json();
  assert.equal(data.ok, true);
  assert.equal(data.newOwnerId, 2);

  // 验证数据库状态：Bob 为 owner，Alice 为 member，created_by 为 2
  const members = db.rawDb.exec('SELECT user_id, role FROM channel_members WHERE channel_id = 2 ORDER BY user_id ASC')[0].values;
  assert.deepEqual(members, [[1, 'member'], [2, 'owner']]);
  const channel = db.rawDb.exec('SELECT created_by FROM channels WHERE id = 2')[0].values[0][0];
  assert.equal(channel, 2);
});

test('useRoomManagement transferOwner 调用转让接口并刷新成员与侧栏', async () => {
  const calls = [];
  const mockApi = {
    async transferChannelOwner(channelId, newOwnerId) {
      calls.push(['transferChannelOwner', channelId, newOwnerId]);
      return { members: [{ id: 1, role: 'member' }, { id: 2, role: 'owner' }] };
    },
    async getChannelMembers() {
      return { room: { canManage: false, myRole: 'member', name: 'Team' }, members: [] };
    }
  };

  const activeRoom = ref({ id: 2, kind: 'private', name: 'Team', isGeneral: false, canManage: true, myRole: 'owner' });
  const channels = ref([{ id: 2, name: 'Team' }]);
  const users = ref([]);
  const error = ref('');

  const management = useRoomManagement({
    activeRoom,
    channels,
    users,
    error,
    refreshSidebar: async () => calls.push(['refreshSidebar']),
    conversationItems: ref([]),
    openConversation: async () => {},
    canManageActiveRoom: computed(() => true),
    roomApi: mockApi,
    confirmAction: () => true
  });

  await management.members.transferOwner({ id: 2, displayName: 'Bob' });
  assert.deepEqual(calls, [
    ['transferChannelOwner', 2, 2],
    ['refreshSidebar']
  ]);
  assert.equal(activeRoom.value.canManage, false);
  assert.equal(activeRoom.value.myRole, 'member');
});
