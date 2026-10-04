import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { useCloudDrive } from '../frontend/src/composables/useCloudDrive.js';

test('useCloudDrive sortedFiles correctly sorts files by name, size, type and updated_at', () => {
  const drive = useCloudDrive();

  drive.files.value = [
    { id: 'f1', name: 'beta.txt', is_folder: 0, size: 2048, updated_at: '2026-08-10T10:00:00Z' },
    { id: 'f2', name: 'alpha.md', is_folder: 0, size: 512, updated_at: '2026-08-15T12:00:00Z' },
    { id: 'd1', name: 'Documents', is_folder: 1, size: 0, updated_at: '2026-08-01T08:00:00Z' },
    { id: 'f3', name: 'gamma.png', is_folder: 0, size: 1048576, updated_at: '2026-08-05T09:00:00Z' }
  ];

  // 1. Folders first, sorted by updated_at desc
  drive.setSort('updated_at', 'desc');
  let ids = drive.sortedFiles.value.map(f => f.id);
  assert.equal(ids[0], 'd1'); // folder first
  assert.deepEqual(ids.slice(1), ['f2', 'f1', 'f3']);

  // 2. Sort by name asc
  drive.setSort('name', 'asc');
  ids = drive.sortedFiles.value.map(f => f.id);
  assert.equal(ids[0], 'd1'); // folder first
  assert.deepEqual(ids.slice(1), ['f2', 'f1', 'f3']); // alpha, beta, gamma

  // 3. Sort by size desc
  drive.setSort('size', 'desc');
  ids = drive.sortedFiles.value.map(f => f.id);
  assert.equal(ids[0], 'd1'); // folder first
  assert.deepEqual(ids.slice(1), ['f3', 'f1', 'f2']); // gamma (1MB), beta (2KB), alpha (512B)
});

test('useCloudDrive multi-selection manages selected files correctly', () => {
  const drive = useCloudDrive();

  drive.files.value = [
    { id: '1', name: 'doc1.md' },
    { id: '2', name: 'doc2.md' },
    { id: '3', name: 'doc3.md' }
  ];

  assert.equal(drive.isMultiSelectMode.value, false);
  assert.equal(drive.selectedFileIds.value.size, 0);

  // Toggle select file 1
  drive.toggleSelectFile('1');
  assert.equal(drive.isMultiSelectMode.value, true);
  assert.ok(drive.selectedFileIds.value.has('1'));

  // Toggle select file 2
  drive.toggleSelectFile('2');
  assert.equal(drive.selectedFileIds.value.size, 2);

  // Select all
  drive.selectAllFiles();
  assert.equal(drive.selectedFileIds.value.size, 3);
  assert.ok(drive.selectedFileIds.value.has('3'));

  // Clear selection
  drive.clearSelection();
  assert.equal(drive.isMultiSelectMode.value, false);
  assert.equal(drive.selectedFileIds.value.size, 0);
});

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createMockDb() {
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE drive_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      is_folder INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'text/plain',
      storage_key TEXT,
      backend TEXT NOT NULL DEFAULT 'r2',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size)
    VALUES ('f-101', 1, NULL, '测试笔记.md', 0, 100),
           ('dir-1', 1, NULL, '工作归档', 1, 0);
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
          return { success: true };
        }
      };
    }
  };
}

test('drive database supports moving files between folders and updating content size', async () => {
  const db = createMockDb();

  // 1. Move file 'f-101' into folder 'dir-1'
  await db.prepare(`
    UPDATE drive_files
    SET parent_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind('dir-1', 'f-101').run();

  const file = await db.prepare('SELECT id, parent_id, size FROM drive_files WHERE id = ?').bind('f-101').first();
  assert.equal(file.parent_id, 'dir-1');

  // 2. Update content size
  const newContent = '# EdgeChat 协作新计划\n\n第三阶段全面完成！';
  const newSize = new TextEncoder().encode(newContent).byteLength;

  await db.prepare(`
    UPDATE drive_files
    SET size = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(newSize, 'f-101').run();

  const updatedFile = await db.prepare('SELECT id, size FROM drive_files WHERE id = ?').bind('f-101').first();
  assert.equal(updatedFile.size, newSize);
});
