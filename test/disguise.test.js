import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNginxResponse,
  handleDisguiseRouting,
  getRoutePrefixes
} from '../worker/src/disguise.js';

test('createNginxResponse returns standard Nginx 200 and 404 HTML', () => {
  const res200 = createNginxResponse(true);
  assert.equal(res200.status, 200);
  assert.equal(res200.headers.get('Server'), 'nginx');

  const res404 = createNginxResponse(false);
  assert.equal(res404.status, 404);
  assert.equal(res404.headers.get('Server'), 'nginx');
});

test('handleDisguiseRouting passes through when ROUTE_PREFIX is empty', async () => {
  const req = new Request('https://example.com/api/site');
  const env = { ROUTE_PREFIX: '', DISGUISE_HOST: 'nginx' };

  let called = false;
  const res = await handleDisguiseRouting(req, env, async (strippedReq) => {
    called = true;
    assert.equal(new URL(strippedReq.url).pathname, '/api/site');
    return new Response('OK');
  });

  assert.equal(called, true);
  assert.equal(res.status, 200);
});

test('handleDisguiseRouting proxies to Nginx when prefix mismatches', async () => {
  const req = new Request('https://example.com/api/site');
  const env = { ROUTE_PREFIX: 'secret_chat', DISGUISE_HOST: 'nginx' };

  let called = false;
  const res = await handleDisguiseRouting(req, env, async () => {
    called = true;
    return new Response('OK');
  });

  assert.equal(called, false);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Server'), 'nginx');
});

test('handleDisguiseRouting redirects exact prefix without trailing slash to /prefix/', async () => {
  const req = new Request('https://example.com/secret_chat');
  const env = { ROUTE_PREFIX: 'secret_chat', DISGUISE_HOST: 'nginx' };

  let called = false;
  const res = await handleDisguiseRouting(req, env, async () => {
    called = true;
    return new Response('OK');
  });

  assert.equal(called, false);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://example.com/secret_chat/');
});

test('handleDisguiseRouting strips prefix when matching and rewrites Location headers', async () => {
  const req = new Request('https://example.com/secret_chat/api/health');
  const env = { ROUTE_PREFIX: 'secret_chat', DISGUISE_HOST: 'nginx' };

  let receivedPath = '';
  const res = await handleDisguiseRouting(req, env, async (strippedReq) => {
    receivedPath = new URL(strippedReq.url).pathname;
    return new Response('Redirect', {
      status: 302,
      headers: { Location: '/login' }
    });
  });

  assert.equal(receivedPath, '/api/health');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/secret_chat/login');
});

test('handleDisguiseRouting handles SPA subpaths (like /edgechat/admin) cleanly', async () => {
  const req = new Request('https://example.com/edgechat/admin');
  const env = { ROUTE_PREFIX: 'edgechat', DISGUISE_HOST: 'nginx' };

  let receivedPath = '';
  const res = await handleDisguiseRouting(req, env, async (strippedReq) => {
    receivedPath = new URL(strippedReq.url).pathname;
    return new Response('<!DOCTYPE html><html><body>index.html</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  });

  assert.equal(receivedPath, '/admin');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('index.html'));
});

test('handleDisguiseRouting handles deep SPA invite registration route (/edgechat/register/token) cleanly', async () => {
  const req = new Request('https://example.com/edgechat/register/token-12345');
  const env = { ROUTE_PREFIX: 'edgechat', DISGUISE_HOST: 'nginx' };

  let receivedPath = '';
  const res = await handleDisguiseRouting(req, env, async (strippedReq) => {
    receivedPath = new URL(strippedReq.url).pathname;
    return new Response('<!DOCTYPE html><html><head><title>Edgechat</title></head><body>index.html</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  });

  assert.equal(receivedPath, '/register/token-12345');
  assert.equal(res.status, 200);
});

test('getRoutePrefixes parses various delimiters (comma, semicolon, pipe, whitespace) into normalized array', () => {
  assert.deepEqual(getRoutePrefixes({ ROUTE_PREFIX: 'chat_a, chat_b, team_entry' }), ['chat_a', 'chat_b', 'team_entry']);
  assert.deepEqual(getRoutePrefixes({ ROUTE_PREFIX: ' /portal1/ ; /portal2/ | portal3 ' }), ['portal1', 'portal2', 'portal3']);
  assert.deepEqual(getRoutePrefixes({ ROUTE_PREFIX: '' }), []);
  assert.deepEqual(getRoutePrefixes({}), []);
  assert.deepEqual(getRoutePrefixes('entry1, entry2'), ['entry1', 'entry2']);
});

test('handleDisguiseRouting supports multiple hidden entrances seamlessly', async () => {
  const env = { ROUTE_PREFIX: 'secret_a, secret_b, admin_hub', DISGUISE_HOST: 'nginx' };

  // 1. Exact match on secret_a without trailing slash -> Redirect to /secret_a/
  const req1 = new Request('https://example.com/secret_a');
  const res1 = await handleDisguiseRouting(req1, env, async () => new Response('OK'));
  assert.equal(res1.status, 302);
  assert.equal(res1.headers.get('Location'), 'https://example.com/secret_a/');

  // 2. Exact match on secret_b without trailing slash -> Redirect to /secret_b/
  const req2 = new Request('https://example.com/secret_b');
  const res2 = await handleDisguiseRouting(req2, env, async () => new Response('OK'));
  assert.equal(res2.status, 302);
  assert.equal(res2.headers.get('Location'), 'https://example.com/secret_b/');

  // 3. Access via secret_a -> Strips prefix and passes X-Matched-Prefix: secret_a
  const req3 = new Request('https://example.com/secret_a/api/bootstrap');
  let passedReq3 = null;
  const res3 = await handleDisguiseRouting(req3, env, async (strippedReq) => {
    passedReq3 = strippedReq;
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(res3.status, 200);
  assert.equal(new URL(passedReq3.url).pathname, '/api/bootstrap');
  assert.equal(passedReq3.headers.get('X-Matched-Prefix'), 'secret_a');

  // 4. Access via admin_hub -> Strips prefix and passes X-Matched-Prefix: admin_hub with redirect Location rewrite
  const req4 = new Request('https://example.com/admin_hub/admin');
  let passedReq4 = null;
  const res4 = await handleDisguiseRouting(req4, env, async (strippedReq) => {
    passedReq4 = strippedReq;
    return new Response('Redirecting', { status: 302, headers: { Location: '/login' } });
  });
  assert.equal(res4.status, 302);
  assert.equal(new URL(passedReq4.url).pathname, '/admin');
  assert.equal(passedReq4.headers.get('X-Matched-Prefix'), 'admin_hub');
  assert.equal(res4.headers.get('Location'), '/admin_hub/login');

  // 5. Access via unlisted prefix -> Proxy to Nginx / Disguise
  const req5 = new Request('https://example.com/unauthorized_entry/admin');
  let called5 = false;
  const res5 = await handleDisguiseRouting(req5, env, async () => {
    called5 = true;
    return new Response('OK');
  });
  assert.equal(called5, false);
  assert.equal(res5.status, 404);
  assert.equal(res5.headers.get('Server'), 'nginx');
});
