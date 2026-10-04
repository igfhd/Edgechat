import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('Capacitor requires an HTTPS server and resolves Android requests through it', () => {
  const platform = readFileSync('frontend/src/capacitor-platform.js', 'utf8');
  assert.match(platform, /url\.protocol !== "https:"/);
  assert.match(platform, /return url\.origin/);
  assert.match(platform, /new URL\(path, `\$\{getEdgeChatServerOrigin\(\)\}\/`\)/);
  assert.match(platform, /NATIVE_SERVER_STORAGE_KEY/);
});

test('Capacitor Android project has a registered native bridge and separate app id', () => {
  const manifest = readFileSync('capacitor/android/app/src/main/AndroidManifest.xml', 'utf8');
  const activity = readFileSync(
    'capacitor/android/app/src/main/java/com/aozorae/edgechat/web/MainActivity.kt',
    'utf8'
  );
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(activity, /EdgeChatNativePlugin/);
  assert.match(readFileSync('capacitor/capacitor.config.json', 'utf8'), /com\.aozorae\.edgechat\.web/);
  assert.ok(existsSync('capacitor/android/gradlew'));
});

test('Capacitor resolves server origin and hidden entrance prefix correctly', async () => {
  const {
    resolveConfiguredServerOrigin,
    resolveConfiguredServerPrefix
  } = await import('../frontend/src/capacitor-platform.js');

  // 1. 带隐藏前缀的服务器地址
  assert.equal(
    resolveConfiguredServerOrigin('https://chat.example.com/secret_entry'),
    'https://chat.example.com'
  );
  assert.equal(
    resolveConfiguredServerPrefix('https://chat.example.com/secret_entry'),
    '/secret_entry'
  );

  // 2. 带尾部斜杠或深层路径的地址
  assert.equal(
    resolveConfiguredServerPrefix('https://chat.example.com/secret_entry/'),
    '/secret_entry'
  );
  assert.equal(
    resolveConfiguredServerPrefix('https://chat.example.com/secret_entry/login'),
    '/secret_entry'
  );

  // 3. 不带隐藏前缀的根地址或系统标准路由
  assert.equal(
    resolveConfiguredServerOrigin('https://chat.example.com'),
    'https://chat.example.com'
  );
  assert.equal(
    resolveConfiguredServerPrefix('https://chat.example.com'),
    ''
  );
  assert.equal(
    resolveConfiguredServerPrefix('https://chat.example.com/'),
    ''
  );
  assert.equal(
    resolveConfiguredServerPrefix('https://chat.example.com/login'),
    ''
  );
  assert.equal(
    resolveConfiguredServerPrefix('https://chat.example.com/admin/dashboard'),
    ''
  );

  // 4. 非 HTTPS 协议抛出异常
  assert.throws(
    () => resolveConfiguredServerOrigin('http://chat.example.com/secret_entry'),
    /native_server_https_required/
  );
  assert.throws(
    () => resolveConfiguredServerOrigin('not-a-valid-url'),
    /native_server_https_required/
  );

  // 5. 源码中包含前缀存储和前缀解析协议
  const platform = readFileSync('frontend/src/capacitor-platform.js', 'utf8');
  assert.match(platform, /NATIVE_SERVER_PREFIX_STORAGE_KEY/);
  assert.match(platform, /resolveConfiguredServerPrefix/);
  assert.match(platform, /getStoredNativeServerPrefix/);
  assert.match(platform, /getStoredNativeServerUrl/);
});
