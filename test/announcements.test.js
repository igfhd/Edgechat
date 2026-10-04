import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import {
  listActiveAnnouncements,
  listAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement
} from '../worker/src/data/announcements.js';
import { useAnnouncements } from '../frontend/src/composables/useAnnouncements.js';
import { adminNavigation } from '../frontend/src/admin/navigation.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createMockD1Database() {
  const db = new SQL.Database();
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      avatar_key TEXT,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      disabled_until TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      creator_id INTEGER NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_announcements_active
      ON announcements(is_active, is_pinned, priority DESC, created_at DESC);
  `);

  return {
    raw: db,
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...params) {
          this._params = params;
          return this;
        },
        async all() {
          const stmt = db.prepare(this._sql);
          stmt.bind(this._params);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return { results };
        },
        async first() {
          const stmt = db.prepare(this._sql);
          stmt.bind(this._params);
          let row = null;
          if (stmt.step()) {
            row = stmt.getAsObject();
          }
          stmt.free();
          return row;
        },
        async run() {
          const stmt = db.prepare(this._sql);
          stmt.bind(this._params);
          stmt.step();
          stmt.free();
          const lastId = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] || 0;
          return { meta: { last_row_id: Number(lastId) } };
        }
      };
    }
  };
}

test('系统公告增删改查 (CRUD) 数据层逻辑正常', async () => {
  const db = createMockD1Database();

  // 创建管理员用户
  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin)
       VALUES (1, 'admin', '站长', 'hash', 'salt', 1)`
    )
    .run();

  // 1. 创建公告
  const created = await createAnnouncement(db, {
    title: '全站升级通知',
    content: '## 系统将于今晚进行升级\n请各位提前保存数据。',
    creatorId: 1,
    isPinned: true,
    isActive: true,
    priority: 10
  });

  assert.equal(created.title, '全站升级通知');
  assert.equal(created.creatorName, '站长');
  assert.equal(created.isPinned, true);
  assert.equal(created.isActive, true);
  assert.equal(created.priority, 10);

  // 2. 查询生效公告列表
  const activeList = await listActiveAnnouncements(db);
  assert.equal(activeList.length, 1);
  assert.equal(activeList[0].id, created.id);

  // 3. 更新公告
  const updated = await updateAnnouncement(db, created.id, {
    title: '全站升级通知 (已完成)',
    content: '系统升级已顺利完成！',
    isPinned: false
  });
  assert.equal(updated.title, '全站升级通知 (已完成)');
  assert.equal(updated.isPinned, false);

  // 4. 设置为禁用/下线
  await updateAnnouncement(db, created.id, { isActive: false });
  const activeListAfterDisable = await listActiveAnnouncements(db);
  assert.equal(activeListAfterDisable.length, 0);

  const allList = await listAllAnnouncements(db);
  assert.equal(allList.length, 1);
  assert.equal(allList[0].isActive, false);

  // 5. 删除公告
  await deleteAnnouncement(db, created.id);
  const allListAfterDelete = await listAllAnnouncements(db);
  assert.equal(allListAfterDelete.length, 0);
});

test('系统公告支持优先级与置顶排序', async () => {
  const db = createMockD1Database();
  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin)
       VALUES (1, 'admin', '站长', 'hash', 'salt', 1)`
    )
    .run();

  await createAnnouncement(db, {
    title: '普通公告 1',
    content: '普通内容',
    creatorId: 1,
    isPinned: false,
    priority: 0
  });

  await createAnnouncement(db, {
    title: '置顶高优先公告',
    content: '非常重要',
    creatorId: 1,
    isPinned: true,
    priority: 100
  });

  await createAnnouncement(db, {
    title: '置顶普通优先公告',
    content: '普通置顶',
    creatorId: 1,
    isPinned: true,
    priority: 10
  });

  const list = await listActiveAnnouncements(db);
  assert.equal(list.length, 3);
  assert.equal(list[0].title, '置顶高优先公告');
  assert.equal(list[1].title, '置顶普通优先公告');
  assert.equal(list[2].title, '普通公告 1');
});

test('前端 useAnnouncements 组合式函数支持关闭记忆与内容更新唤醒', () => {
  const storage = {};
  globalThis.window = {
    localStorage: {
      getItem(key) { return storage[key] || null; },
      setItem(key, val) { storage[key] = String(val); }
    }
  };

  const {
    announcements,
    activeUndismissedAnnouncements,
    dismissAnnouncement
  } = useAnnouncements();

  announcements.value = [
    {
      id: 1,
      title: '公告 1',
      content: '内容 1',
      isPinned: true,
      updatedAt: '2026-08-18T10:00:00Z'
    },
    {
      id: 2,
      title: '公告 2',
      content: '内容 2',
      isPinned: false,
      updatedAt: '2026-08-18T10:00:00Z'
    }
  ];

  // 初始状态：只有置顶的公告 1 显示在横幅中
  assert.equal(activeUndismissedAnnouncements.value.length, 1);
  assert.equal(activeUndismissedAnnouncements.value[0].id, 1);

  // 用户点击关闭公告 1
  dismissAnnouncement(announcements.value[0]);
  assert.equal(activeUndismissedAnnouncements.value.length, 0);

  // 管理员更新了公告 1 (updatedAt 发生改变)
  announcements.value = [
    {
      id: 1,
      title: '公告 1 (已更新)',
      content: '全新内容',
      isPinned: true,
      updatedAt: '2026-08-18T11:00:00Z'
    }
  ];

  // 此时自动重新唤醒提示
  assert.equal(activeUndismissedAnnouncements.value.length, 1);
  assert.equal(activeUndismissedAnnouncements.value[0].title, '公告 1 (已更新)');
});

test('后台管理导航配置包含系统公告模块', () => {
  const announcementNavItem = adminNavigation.find((item) => item.id === 'announcements');
  assert.ok(announcementNavItem, '后台导航应包含 announcements 项');
  assert.equal(announcementNavItem.to, '/admin/announcements');
  assert.equal(announcementNavItem.label, '系统公告');

  // 验证 router.js 包含 AdminAnnouncementsPage
  const routerContent = readFileSync(new URL('../frontend/src/router.js', import.meta.url), 'utf8');
  assert.match(routerContent, /AdminAnnouncementsPage/);
  assert.match(routerContent, /path:\s*'announcements'/);

  // 验证 ChatPage 引入了公告横幅与弹窗
  const chatPageContent = readFileSync(new URL('../frontend/src/pages/ChatPage.vue', import.meta.url), 'utf8');
  assert.match(chatPageContent, /AnnouncementBanner/);
  assert.match(chatPageContent, /AnnouncementModal/);
  assert.match(chatPageContent, /useAnnouncements/);
});
