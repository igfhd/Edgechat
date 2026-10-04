import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import {
  exportDatabaseBackup,
  previewBackupData,
  importBackupData
} from '../worker/src/data/backup-restore.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createMockD1Database() {
  const db = new SQL.Database();
  const schema = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');
  db.exec(schema);

  function createStatement(sql, currentBinds = []) {
    return {
      bind(...binds) {
        return createStatement(sql, binds);
      },
      async all() {
        const stmt = db.prepare(sql);
        if (currentBinds.length) stmt.bind(currentBinds);
        const results = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return { results };
      },
      async first() {
        const stmt = db.prepare(sql);
        if (currentBinds.length) stmt.bind(currentBinds);
        let result = null;
        if (stmt.step()) {
          result = stmt.getAsObject();
        }
        stmt.free();
        return result;
      },
      async run() {
        db.run(sql, currentBinds);
        const lastIdRes = db.exec('SELECT last_insert_rowid() AS id');
        const lastRowId = lastIdRes[0]?.values[0]?.[0] || 0;
        return { meta: { last_row_id: lastRowId, changes: db.getRowsModified() } };
      }
    };
  }

  return {
    db,
    prepare(sql) {
      return createStatement(sql);
    }
  };
}

test('导出数据包含用户体系但不包含私钥与历史消息', async () => {
  const d1 = createMockD1Database();

  // Insert test users
  await d1.prepare(
    `INSERT INTO users (username, display_name, password_hash, password_salt, is_admin)
     VALUES ('admin', 'Administrator', 'hash_admin', 'salt_admin', 1),
            ('alice', 'Alice Wang', 'hash_alice', 'salt_alice', 0)`
  ).run();

  // Insert mock E2EE keys in DB (to verify they are NOT exported)
  await d1.prepare(
    `INSERT INTO user_encrypted_key_backups (user_id, encrypted_private_key, backup_salt, backup_iv)
     VALUES (1, 'cipher_admin_private', 'salt1', 'iv1'),
            (2, 'cipher_alice_private', 'salt2', 'iv2')`
  ).run();

  // Insert mock message in DB (to verify messages are NOT exported)
  await d1.prepare(
    `INSERT INTO messages (channel_id, sender_id, content)
     VALUES (1, 1, '秘密历史消息')`
  ).run();

  // Insert user group
  await d1.prepare(
    `INSERT INTO user_groups (name, description) VALUES ('研发组', '研发部门')`
  ).run();
  await d1.prepare(
    `INSERT INTO user_group_members (group_id, user_id) VALUES (1, 2)`
  ).run();

  // Export
  const backup = await exportDatabaseBackup(d1, { userId: 1, username: 'admin' });

  assert.equal(backup.format, 'edgechat-backup');
  assert.equal(backup.summary.usersCount, 2);
  assert.equal(backup.data.users.length, 2);
  assert.equal(backup.data.users[0].username, 'admin');
  assert.equal(backup.data.users[1].username, 'alice');
  assert.equal(backup.data.userGroups.length, 1);
  assert.equal(backup.data.userGroups[0].name, '研发组');
  assert.equal(backup.data.userGroupMembers.length, 1);
  assert.equal(backup.data.userGroupMembers[0].username, 'alice');

  // Verify private keys & passphrases & messages are completely omitted
  const exportedJson = JSON.stringify(backup);
  assert.equal(exportedJson.includes('cipher_admin_private'), false, '不得导出私钥密文');
  assert.equal(exportedJson.includes('cipher_alice_private'), false, '不得导出私钥密文');
  assert.equal(exportedJson.includes('秘密历史消息'), false, '不得导出聊天消息');
  assert.equal(backup.data.userEncryptedKeyBackups, undefined);
  assert.equal(backup.data.messages, undefined);
});

test('预检备份正确识别新用户与冲突管理员', async () => {
  const d1 = createMockD1Database();

  await d1.prepare(
    `INSERT INTO users (username, display_name, password_hash, password_salt, is_admin)
     VALUES ('admin', 'Current Admin', 'hash_curr', 'salt_curr', 1)`
  ).run();

  const mockBackup = {
    format: 'edgechat-backup',
    version: 1,
    data: {
      users: [
        { username: 'admin', displayName: 'Old Admin', passwordHash: 'hash_old', passwordSalt: 'salt_old', isAdmin: 1 },
        { username: 'bob', displayName: 'Bob Lee', passwordHash: 'hash_bob', passwordSalt: 'salt_bob', isAdmin: 0 },
        { username: 'charlie', displayName: 'Charlie', passwordHash: 'hash_charlie', passwordSalt: 'salt_charlie', isAdmin: 0 }
      ],
      userGroups: [{ name: '测试组' }]
    }
  };

  const preview = await previewBackupData(d1, mockBackup, 1);

  assert.equal(preview.valid, true);
  assert.equal(preview.totalUsersInBackup, 3);
  assert.equal(preview.newUsersCount, 2);
  assert.equal(preview.conflictsCount, 1);
  assert.equal(preview.hasAdminConflict, true);
  assert.equal(preview.conflicts[0].username, 'admin');
  assert.equal(preview.conflicts[0].isCurrentAdmin, true);
});

test('导入备份使用 keep_current 策略保护当前管理员凭据不被篡改', async () => {
  const d1 = createMockD1Database();

  // 当前数据库中已有的管理员
  await d1.prepare(
    `INSERT INTO users (username, display_name, password_hash, password_salt, is_admin)
     VALUES ('admin', 'Current Active Admin', 'hash_protected_current', 'salt_curr', 1)`
  ).run();

  const mockBackup = {
    format: 'edgechat-backup',
    version: 1,
    data: {
      users: [
        { username: 'admin', displayName: 'Imported Admin', passwordHash: 'hash_overwritten_threat', passwordSalt: 'salt_threat', isAdmin: 1 },
        { username: 'david', displayName: 'David Chen', passwordHash: 'hash_david', passwordSalt: 'salt_david', isAdmin: 0 }
      ],
      userGroups: [{ name: '设计组' }],
      userGroupMembers: [{ groupName: '设计组', username: 'david' }]
    }
  };

  // 执行导入，默认 keep_current 策略
  const result = await importBackupData(d1, mockBackup, {
    adminConflictStrategy: 'keep_current',
    userConflictStrategy: 'skip'
  }, 1);

  assert.equal(result.ok, true);
  assert.equal(result.imported.usersCreated, 1); // david
  assert.equal(result.imported.usersSkipped, 1); // admin skipped

  // 验证当前管理员凭据未被修改
  const adminInDb = await d1.prepare('SELECT * FROM users WHERE username = ?').bind('admin').first();
  assert.equal(adminInDb.password_hash, 'hash_protected_current', '管理员密码哈希不得被覆盖');
  assert.equal(adminInDb.display_name, 'Current Active Admin');

  // 验证新用户已创建并加入分组和 general 群
  const davidInDb = await d1.prepare('SELECT * FROM users WHERE username = ?').bind('david').first();
  assert.equal(davidInDb.display_name, 'David Chen');

  const generalMember = await d1.prepare(
    `SELECT * FROM channel_members cm JOIN channels c ON cm.channel_id = c.id WHERE c.name = 'general' AND cm.user_id = ?`
  ).bind(davidInDb.id).first();
  assert.ok(generalMember, '新导入用户必须自动加入 general 频道');
});

