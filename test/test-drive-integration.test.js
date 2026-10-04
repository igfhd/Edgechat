import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import app from '../worker/src/index.js';
import { createSession } from '../worker/src/auth.js';
import initSqlJs from 'sql.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createMockD1(db) {
  return {
    prepare(query) {
      const makeStmt = (params = []) => ({
        bind(...newParams) {
          return makeStmt(newParams);
        },
        async first(col) {
          const stmt = db.prepare(query);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return col ? row[col] : row;
          }
          stmt.free();
          return null;
        },
        async all() {
          const stmt = db.prepare(query);
          stmt.bind(params);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return { results };
        },
        async run() {
          db.run(query, params);
          return { success: true };
        }
      });
      return makeStmt();
    }
  };
}

test('Drive full lifecycle via app.fetch: stats, list, upload-ticket, direct-upload, confirm, download, delete', async () => {
  const schema = fs.readFileSync('worker/schema.sql', 'utf-8');
  const sqlDb = new SQL.Database();
  sqlDb.exec(schema);
  sqlDb.exec(`INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (1, 'alice', 'Alice', 'hash', 'salt', 1);`);

  const mockDb = createMockD1(sqlDb);
  const mockKv = new Map();
  const mockR2 = new Map();

  const env = {
    DB: mockDb,
    SESSIONS: {
      async get(k) { return mockKv.get(k) || null; },
      async put(k, v) { mockKv.set(k, v); },
      async delete(k) { mockKv.delete(k); }
    },
    FILES: {
      async get(k) {
        const v = mockR2.get(k);
        if (!v) return null;
        return {
          size: v.length,
          body: v,
          async arrayBuffer() { return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength); },
          writeHttpMetadata(_h) {}
        };
      },
      async put(k, v, _opts) {
        const buf = v instanceof Uint8Array ? v : Buffer.from(v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer());
        mockR2.set(k, buf);
      },
      async head(k) {
        const v = mockR2.get(k);
        if (!v) return null;
        return { size: v.length };
      },
      async delete(k) { mockR2.delete(k); }
    },
    ENCRYPTION_SECRET: 'testsecret1234567890123456789012',
    EDGECHAT_ENCRYPTION_KEYRING: JSON.stringify({
      activeKeyId: 'v1',
      keys: {
        v1: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)).toString('base64')
      }
    })
  };

  const session = await createSession(env, { id: 1, username: 'alice', display_name: 'Alice', is_admin: 1 });

  // 1. Stats
  const statsReq = new Request('https://example.com/api/drive/stats', {
    headers: { 'Authorization': `Bearer ${session.token}` }
  });
  const statsRes = await app.fetch(statsReq, env, {});
  assert.equal(statsRes.status, 200);

  // 2. Upload ticket
  const ticketReq = new Request('https://example.com/api/drive/files/upload-ticket', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: 'test.txt', size: 11, mimeType: 'text/plain' })
  });
  const ticketRes = await app.fetch(ticketReq, env, {});
  assert.equal(ticketRes.status, 200);
  const ticket = await ticketRes.json();
  assert.ok(ticket.fileId);

  // 3. Direct upload (PUT)
  const directReq = new Request(`https://example.com/api/drive/files/direct-upload?fileId=${ticket.fileId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'text/plain'
    },
    body: 'Hello World'
  });
  const directRes = await app.fetch(directReq, env, {});
  assert.equal(directRes.status, 200, `Direct upload failed with status ${directRes.status}`);

  // 4. Confirm upload
  const confirmReq = new Request('https://example.com/api/drive/files/confirm', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fileId: ticket.fileId, actualSize: 11 })
  });
  const confirmRes = await app.fetch(confirmReq, env, {});
  assert.equal(confirmRes.status, 200);

  // 5. Download / view file with Bearer token
  const getReq = new Request(`https://example.com/api/drive/files/${ticket.fileId}?view=1`, {
    headers: { 'Authorization': `Bearer ${session.token}` }
  });
  const getRes = await app.fetch(getReq, env, {});
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('Accept-Ranges'), 'bytes');
  const fileText = await getRes.text();
  assert.equal(fileText, 'Hello World');

  // 5.1 Download / view file with URL Ticket (no Bearer header)
  const fileTicketResp = await app.fetch(new Request('https://example.com/api/auth/file-ticket', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.token}` }
  }), env, {});
  assert.equal(fileTicketResp.status, 200);
  const fileTicketData = await fileTicketResp.json();
  assert.ok(fileTicketData.ticket);

  const getByTicketReq = new Request(`https://example.com/api/drive/files/${ticket.fileId}?view=1&ticket=${encodeURIComponent(fileTicketData.ticket)}`);
  const getByTicketRes = await app.fetch(getByTicketReq, env, {});
  assert.equal(getByTicketRes.status, 200, `Download via ticket failed with status ${getByTicketRes.status}`);
  const ticketFileText = await getByTicketRes.text();
  assert.equal(ticketFileText, 'Hello World');

  // 6. Delete file
  const delReq = new Request(`https://example.com/api/drive/files/${ticket.fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${session.token}` }
  });
  const delRes = await app.fetch(delReq, env, {});
  assert.equal(delRes.status, 200);

  // 7. Verify Trash & Restore
  const trashReq = new Request('https://example.com/api/drive/trash', {
    headers: { 'Authorization': `Bearer ${session.token}` }
  });
  const trashRes = await app.fetch(trashReq, env, {});
  assert.equal(trashRes.status, 200);
  const trashData = await trashRes.json();
  assert.equal(trashData.trash.length, 1);
  assert.equal(trashData.trash[0].id, ticket.fileId);
  assert.equal(trashData.trash[0].original_path, '根目录');

  const restoreReq = new Request(`https://example.com/api/drive/trash/${ticket.fileId}/restore`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.token}` }
  });
  const restoreRes = await app.fetch(restoreReq, env, {});
  assert.equal(restoreRes.status, 200);

  // 8. Permanently delete from trash
  await app.fetch(new Request(`https://example.com/api/drive/files/${ticket.fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${session.token}` }
  }), env, {});

  const purgeReq = new Request(`https://example.com/api/drive/trash/${ticket.fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${session.token}` }
  });
  const purgeRes = await app.fetch(purgeReq, env, {});
  assert.equal(purgeRes.status, 200);

  // 9. Chat attachment upload & download
  const formData = new FormData();
  formData.append('file', new File(['Chat attachment content'], 'chat_doc.txt', { type: 'text/plain' }));
  const uploadReq = new Request('https://example.com/api/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.token}` },
    body: formData
  });
  const uploadRes = await app.fetch(uploadReq, env, {});
  assert.equal(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.ok(uploadData.file.key);

  // Download chat attachment via ticket
  const chatFileTicketReq = new Request(`https://example.com/files/${encodeURIComponent(uploadData.file.key)}?ticket=${encodeURIComponent(fileTicketData.ticket)}`);
  const chatFileTicketRes = await app.fetch(chatFileTicketReq, env, {});
  assert.equal(chatFileTicketRes.status, 200);
  assert.equal(await chatFileTicketRes.text(), 'Chat attachment content');
});
