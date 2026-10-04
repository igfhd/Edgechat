import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { registerBackHandler, triggerBack } from '../frontend/src/back-navigation.js';

test('back-navigation executes handlers in descending priority order', async () => {
  const executionOrder = [];

  const unreg10 = registerBackHandler(10, () => {
    executionOrder.push('p10');
    return false;
  });

  const unreg100 = registerBackHandler(100, () => {
    executionOrder.push('p100');
    return false;
  });

  const unreg50 = registerBackHandler(50, () => {
    executionOrder.push('p50');
    return true; // stops propagation
  });

  const unreg30 = registerBackHandler(30, () => {
    executionOrder.push('p30');
    return false;
  });

  const handled = await triggerBack();
  assert.equal(handled, true);
  assert.deepEqual(executionOrder, ['p100', 'p50']); // p30 and p10 should not be reached

  unreg10();
  unreg100();
  unreg50();
  unreg30();
});

test('back-navigation unregister removes handler correctly', async () => {
  const executionOrder = [];

  const unregA = registerBackHandler(60, () => {
    executionOrder.push('A');
    return false;
  });

  const unregB = registerBackHandler(40, () => {
    executionOrder.push('B');
    return true;
  });

  unregA(); // unregister A

  const handled = await triggerBack();
  assert.equal(handled, true);
  assert.deepEqual(executionOrder, ['B']);

  unregB();
});

test('Native Kotlin plugin contains back press handler and minimize/exit methods', () => {
  const pluginContent = readFileSync(
    'capacitor/android/app/src/main/java/com/aozorae/edgechat/web/nativebridge/EdgeChatNativePlugin.kt',
    'utf8'
  );
  assert.match(pluginContent, /OnBackPressedCallback/);
  assert.match(pluginContent, /setupBackPressHandler/);
  assert.match(pluginContent, /notifyListeners\("backButton",/);
  assert.match(pluginContent, /fun minimizeApp/);
  assert.match(pluginContent, /fun exitApp/);
  assert.match(pluginContent, /moveTaskToBack\(true\)/);
});

test('DriveFilePreviewModal contains back button, safe area inset, and horizontal scroll', () => {
  const modalContent = readFileSync(
    'frontend/src/components/drive/DriveFilePreviewModal.vue',
    'utf8'
  );
  assert.match(modalContent, /preview-back-btn/);
  assert.match(modalContent, /registerBackHandler/);
  assert.match(modalContent, /safe-area-inset-top/);
  assert.match(modalContent, /overflow-x:\s*auto/);
});

test('Dark theme contains visible chat-header__back style', () => {
  const darkCss = readFileSync('frontend/src/styles/dark.css', 'utf8');
  assert.match(darkCss, /\.chat-header__back/);
  assert.match(darkCss, /color:\s*#f1f5f9\s*!important/);

  const chatPage = readFileSync('frontend/src/pages/ChatPage.vue', 'utf8');
  assert.match(chatPage, /var\(--text-primary,\s*#111b21\)/);
});

test('Worker index.js provides CORS for /files/* and upload.js supports Range', () => {
  const indexJs = readFileSync('worker/src/index.js', 'utf8');
  assert.match(indexJs, /app\.use\('\/files\/\*', cors\(/);
  assert.match(indexJs, /'Range'/);

  const uploadJs = readFileSync('worker/src/api/upload.js', 'utf8');
  assert.match(uploadJs, /accept-ranges/);
  assert.match(uploadJs, /bytes=/);
  assert.match(uploadJs, /status:\s*206/);
});
