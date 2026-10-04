import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { registerUploadRoutes } from './api/upload.js';
import { encryptAttachment } from './encryption.js';

const keyring = JSON.stringify({
  activeKeyId: 'v1',
  keys: {
    v1: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)).toString('base64')
  }
});

function fileDb({ accessible, metadata = true }) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes('SELECT filename, content_type, size')) {
                return metadata
                  ? { results: [{ filename: '报告.bin', content_type: 'application/octet-stream', size: 4 }] }
                  : { results: [] };
              }
              return { results: accessible ? [{ found: 1 }] : [] };
            }
          };
        }
      };
    }
  };
}

test('attachment upload reports when the deployment has no R2 binding', async () => {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    c.set('session', { userId: 42 });
    return next();
  });
  registerUploadRoutes(app);

  const formData = new FormData();
  formData.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
  const response = await app.request(
    'https://edgechat.test/api/upload',
    {
      method: 'POST',
      body: formData
    },
    {}
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: '当前部署没有绑定 R2，无法上传附件'
  });
});

test('authorized attachment download decrypts bytes and disables shared caching', async () => {
  const objectKey = '42/example.bin';
  const plaintext = Uint8Array.from([1, 2, 3, 4]);
  const ciphertext = await encryptAttachment(keyring, plaintext, objectKey);
  const object = {
    uploaded: new Date('2026-08-10T00:00:00Z'),
    customMetadata: {},
    async arrayBuffer() {
      return ciphertext.buffer;
    },
    writeHttpMetadata(headers) {
      headers.set('content-type', 'application/octet-stream');
      headers.set('cache-control', 'public, max-age=31536000');
    }
  };
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    `https://edgechat.test/files/${objectKey}`,
    {},
    {
      DB: fileDb({ accessible: true }),
      FILES: {
        async get() {
          return object;
        }
      },
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), plaintext);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-disposition'), /%E6%8A%A5%E5%91%8A\.bin/);
});

test('unauthorized attachment download is rejected before reading R2', async () => {
  let r2Read = false;
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    'https://edgechat.test/files/42/private.bin',
    {},
    {
      DB: fileDb({ accessible: false }),
      FILES: {
        async get() {
          r2Read = true;
          return null;
        }
      },
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 403);
  assert.equal(r2Read, false);
});

test('authorized attachment download reports when the deployment has no R2 binding', async () => {
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    'https://edgechat.test/files/42/private.bin',
    {},
    { DB: fileDb({ accessible: true }) }
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: '当前部署没有绑定 R2，无法读取附件'
  });
});

test('telegram attachment downloads through message authorization without uploaded file ownership', async () => {
  const objectKey = 'telegram/-1001/9-example.jpg';
  const plaintext = Uint8Array.from([5, 6, 7]);
  const ciphertext = await encryptAttachment(keyring, plaintext, objectKey);
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    `https://edgechat.test/files/${encodeURIComponent(objectKey)}`,
    {},
    {
      DB: fileDb({ accessible: true, metadata: false }),
      FILES: {
        async get() {
          return {
            customMetadata: { filename: 'telegram-photo.jpg' },
            async arrayBuffer() {
              return ciphertext.buffer;
            },
            writeHttpMetadata(headers) {
              headers.set('content-type', 'image/jpeg');
            }
          };
        }
      },
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), plaintext);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.match(response.headers.get('content-disposition'), /telegram-photo\.jpg/);
});

test('Google Drive 存储配置下附件上传与下载正常路由', async () => {
  const originalFetch = globalThis.fetch;
  const storedFiles = new Map();

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'mock-gdrive-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (urlStr.includes('upload/drive/v3/files')) {
      const fileId = 'gdrive-file-12345';
      storedFiles.set(fileId, options.body);
      return new Response(JSON.stringify({ id: fileId, name: 'voice_record.webm' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (urlStr.includes('drive/v3/files/gdrive-file-12345')) {
      const raw = Uint8Array.from([10, 20, 30, 40]);
      return new Response(raw, {
        status: 200,
        headers: { 'Content-Type': 'audio/webm' }
      });
    }
    return new Response('Not Found', { status: 404 });
  };

  try {
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      c.set('session', { userId: 42 });
      return next();
    });
    registerUploadRoutes(app);

    const gdriveDb = {
      prepare(sql) {
        const self = {
          bind() {
            return self;
          },
          async all() {
            if (sql.includes('site_settings')) {
              return {
                results: [
                  { setting_key: 'storage_type', setting_value: 'gdrive' },
                  { setting_key: 'gdrive_client_id', setting_value: 'test-client-id' },
                  { setting_key: 'gdrive_client_secret', setting_value: 'test-client-secret' },
                  { setting_key: 'gdrive_refresh_token', setting_value: 'test-refresh-token' }
                ]
              };
            }
            if (sql.includes('SELECT filename, content_type, size')) {
              return { results: [{ filename: 'voice_record.webm', content_type: 'audio/webm', size: 4 }] };
            }
            return { results: [{ found: 1 }] };
          },
          async first() {
            return null;
          },
          async run() {
            return { meta: { last_row_id: 1 } };
          }
        };
        return self;
      }
    };

    // 1. 上传语音/附件
    const formData = new FormData();
    formData.set('file', new File(['audiobytes'], 'voice_record.webm', { type: 'audio/webm' }));
    const uploadRes = await app.request(
      'https://edgechat.test/api/upload',
      { method: 'POST', body: formData },
      { DB: gdriveDb, EDGECHAT_ENCRYPTION_KEYRING: keyring }
    );

    assert.equal(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.file.key, 'gdrive:gdrive-file-12345');
    assert.equal(uploadJson.file.url, '/files/gdrive%3Agdrive-file-12345');

    // 2. 读取语音/附件
    const downloadRes = await app.request(
      'https://edgechat.test/files/gdrive%3Agdrive-file-12345',
      {},
      { DB: gdriveDb, EDGECHAT_ENCRYPTION_KEYRING: keyring }
    );
    assert.equal(downloadRes.status, 200);
    assert.equal(downloadRes.headers.get('content-type'), 'audio/webm');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
