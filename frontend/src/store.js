import { reactive } from 'vue';
import {
  getStoredNativeServerOrigin,
  getStoredNativeServerPrefix,
  isCapacitorAndroid,
  restoreStoredNativeServerOrigin,
  resolveServerAssetUrl,
  setStoredNativeServerOrigin
} from './capacitor-platform.js';
import { isDemoMode, runtimeSessionToken } from './runtime.js';
import api from './api.js';
import {
  addAuthInvalidListener,
  clearStoredToken,
  getStoredToken,
  setStoredToken
} from './auth-storage.js';
import {
  clearLocalIdentityKey,
  getLocalIdentityKeyPair,
  getOrCreateIdentityKeyPair,
  storeImportedIdentityKeyPair
} from './crypto/keystore.js';
import {
  backupPrivateKeyWithPassphrase,
  computeKeyFingerprint,
  restorePrivateKeyWithPassphrase
} from './crypto/key-backup.js';
import { isX25519Supported } from './crypto/x25519.js';

const DEFAULT_SITE_ICON_URL = '/logo.svg';

const state = reactive({
  ready: false,
  token: isDemoMode ? runtimeSessionToken : getStoredToken(),
  session: null,
  site: {
    siteName: 'Edgechat',
    siteIconUrl: ''
  },
  presence: {},
  e2eeStatus: 'uninitialized',
  keyFingerprint: '',
  keyBackup: {
    hasBackup: false,
    keyVersion: 1
  }
});

const ensureIdentityPromiseMap = new Map();

function clearAuthState() {
  clearStoredToken();
  api.clearTicketCaches();
  state.token = '';
  state.session = null;
  state.e2eeStatus = 'uninitialized';
  state.keyFingerprint = '';
  state.keyBackup = {
    hasBackup: false,
    keyVersion: 1
  };
}

function applySiteMetadata(site) {
  const siteName = String(site?.siteName || 'Edgechat').trim() || 'Edgechat';
  const siteIconUrl = resolveServerAssetUrl(String(site?.siteIconUrl || '').trim());
  document.title = siteName;

  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.setAttribute('rel', 'icon');
    document.head.appendChild(favicon);
  }

  if (siteIconUrl) {
    favicon.setAttribute('href', siteIconUrl);
  } else {
    favicon.setAttribute('href', DEFAULT_SITE_ICON_URL);
  }
}

async function loadSite() {
  try {
    const payload = await api.getSite();
    setSite(payload.site);
  } catch {
    applySiteMetadata(state.site);
  }
}

async function ensureIdentityKey(userId) {
  const normalizedId = Number(userId);
  if (!normalizedId) return null;

  if (ensureIdentityPromiseMap.has(normalizedId)) {
    return ensureIdentityPromiseMap.get(normalizedId);
  }

  const promise = (async () => {
  try {
    const supported = await isX25519Supported();
    if (!supported) {
      state.e2eeStatus = 'unsupported';
      return null;
    }

    // 1. 优先检查本地是否已有有效私钥
    const localKey = await getLocalIdentityKeyPair(normalizedId);
    if (localKey?.privateKeyBase64) {
      state.e2eeStatus = 'ready';
      state.keyFingerprint = await computeKeyFingerprint(localKey.publicKeyBase64);

      if (state.token) {
        try {
          await api.uploadIdentityKey(localKey.publicKeyBase64, localKey.keyVersion, true);
        } catch (syncErr) {
          console.warn('Failed to sync existing local identity key:', syncErr);
        }
        void api.getKeyBackup().then((backupRes) => {
          state.keyBackup = {
            hasBackup: Boolean(backupRes?.backup?.encryptedPrivateKey),
            keyVersion: backupRes?.backup?.keyVersion || localKey.keyVersion
          };
        }).catch(() => {});
      }
      return localKey;
    }

    // 2. 本地无私钥（新设备/已清空缓存）：检查云端是否有已备份的私钥
    if (state.token) {
      try {
        const backupRes = await api.getKeyBackup();
        if (backupRes?.backup?.encryptedPrivateKey) {
          // 云端有备份：进入待恢复状态，不自动生成新密钥，阻止覆盖旧公钥
          state.e2eeStatus = 'pending_recovery';
          state.keyBackup = {
            hasBackup: true,
            keyVersion: backupRes.backup.keyVersion || 1
          };
          return null;
        }
      } catch (checkErr) {
        console.warn('Failed to check cloud key backup status:', checkErr);
      }
    }

    // 3. 本地无私钥且云端无备份：全新用户首次生成密钥
    const newKey = await getOrCreateIdentityKeyPair(normalizedId);
    state.e2eeStatus = 'ready';
    state.keyFingerprint = await computeKeyFingerprint(newKey.publicKeyBase64);
    state.keyBackup = {
      hasBackup: false,
      keyVersion: newKey.keyVersion || 1
    };

    if (state.token) {
      try {
        await api.uploadIdentityKey(newKey.publicKeyBase64, newKey.keyVersion, true);
      } catch (syncErr) {
        console.warn('Failed to sync identity key:', syncErr);
      }
    }
    return newKey;
  } catch (err) {
    console.warn('E2EE key initialization error:', err);
    return null;
  }
  })();

  ensureIdentityPromiseMap.set(normalizedId, promise);
  try {
    return await promise;
  } finally {
    ensureIdentityPromiseMap.delete(normalizedId);
  }
}

async function recoverPrivateKey(passphrase) {
  if (!state.session?.userId) {
    throw new Error('用户未登录，无法恢复私钥');
  }
  const backupRes = await api.getKeyBackup();
  if (!backupRes?.backup?.encryptedPrivateKey) {
    throw new Error('云端未找到私钥加密备份记录');
  }
  const restoredPrivKey = await restorePrivateKeyWithPassphrase({
    encryptedPrivateKey: backupRes.backup.encryptedPrivateKey,
    backupSalt: backupRes.backup.backupSalt,
    backupIv: backupRes.backup.backupIv,
    passphrase
  });
  const keyInfo = await storeImportedIdentityKeyPair(state.session.userId, {
    privateKeyBase64: restoredPrivKey,
    keyVersion: backupRes.backup.keyVersion
  });
  state.e2eeStatus = 'ready';
  state.keyFingerprint = await computeKeyFingerprint(keyInfo.publicKeyBase64);
  state.keyBackup = {
    hasBackup: true,
    keyVersion: keyInfo.keyVersion
  };
  if (state.token) {
    void api.uploadIdentityKey(keyInfo.publicKeyBase64, keyInfo.keyVersion).catch(() => {});
  }
  return keyInfo;
}

async function setupKeyBackup(passphrase) {
  if (!state.session?.userId) {
    throw new Error('用户未登录，无法配置私钥备份');
  }
  let keyInfo = await getLocalIdentityKeyPair(state.session.userId);
  if (!keyInfo) {
    keyInfo = await getOrCreateIdentityKeyPair(state.session.userId);
  }
  const backupPayload = await backupPrivateKeyWithPassphrase({
    privateKeyBase64: keyInfo.privateKeyBase64,
    passphrase,
    keyVersion: keyInfo.keyVersion
  });
  await api.uploadKeyBackup(backupPayload);
  state.keyBackup = {
    hasBackup: true,
    keyVersion: keyInfo.keyVersion
  };
  state.e2eeStatus = 'ready';
  return backupPayload;
}

async function resetIdentityKey() {
  if (!state.session?.userId) {
    throw new Error('用户未登录，无法重置密钥');
  }
  await clearLocalIdentityKey(state.session.userId);
  const newKey = await getOrCreateIdentityKeyPair(state.session.userId);
  await api.uploadIdentityKey(newKey.publicKeyBase64, newKey.keyVersion, true);
  state.e2eeStatus = 'pending_setup';
  state.keyFingerprint = await computeKeyFingerprint(newKey.publicKeyBase64);
  state.keyBackup = {
    hasBackup: false,
    keyVersion: newKey.keyVersion
  };
  return newKey;
}

async function refreshKeyStatus() {
  if (!state.session?.userId) return;
  await ensureIdentityKey(state.session.userId);
}

async function initialize() {
  if (state.ready) {
    return;
  }

  if (isCapacitorAndroid && !getStoredNativeServerOrigin()) {
    clearAuthState();
    state.ready = true;
    return;
  }

  await loadSite();

  if (!state.token) {
    state.ready = true;
    return;
  }

  try {
    const payload = await api.session();
    state.session = payload.session;
    if (state.session?.userId) {
      try {
        await ensureIdentityKey(state.session.userId);
      } catch (err) {
        console.warn('Failed to ensure identity key on initialize:', err);
      }
      await api.ensureFileTicket().catch(() => {});
    }
  } catch {
    clearAuthState();
  } finally {
    state.ready = true;
  }
}

async function login(credentials) {
  const payload = await api.login(credentials);
  state.token = payload.token;
  state.session = payload.session;
  state.ready = true;
  setStoredToken(payload.token);
  if (state.session?.userId) {
    try {
      await ensureIdentityKey(state.session.userId);
    } catch (err) {
      console.warn('Failed to ensure identity key on login:', err);
    }
    await api.ensureFileTicket().catch(() => {});
  }
}

async function configureNativeServer(configuredOrigin) {
  if (!isCapacitorAndroid) return '';

  const previousOrigin = getStoredNativeServerOrigin();
  const previousPrefix = getStoredNativeServerPrefix();
  const nextOrigin = setStoredNativeServerOrigin(configuredOrigin);
  const nextPrefix = getStoredNativeServerPrefix();
  try {
    const payload = await api.getSite();
    if (nextOrigin !== previousOrigin || nextPrefix !== previousPrefix) {
      clearAuthState();
    }
    setSite(payload.site);
    return nextOrigin;
  } catch (error) {
    restoreStoredNativeServerOrigin(previousOrigin, previousPrefix);
    throw new Error('native_server_unavailable', { cause: error });
  }
}

async function logout() {
  const token = state.token;
  clearAuthState();
  try {
    if (token) {
      await api.logout();
    }
  } catch {
    // ignore
  }
}

function setSession(session) {
  state.session = session;
}

function setSite(site) {
  state.site = {
    siteName: String(site?.siteName || 'Edgechat').trim() || 'Edgechat',
    siteIconUrl: String(site?.siteIconUrl || '').trim()
  };
  applySiteMetadata(state.site);
}

function setPresence(userId, online = undefined, lastActiveAt = undefined) {
  const id = Number(userId);
  if (!id) return;
  const current = state.presence[id] || { online: false, lastActiveAt: null };
  state.presence[id] = {
    online: online !== undefined ? Boolean(online) : current.online,
    lastActiveAt: lastActiveAt !== undefined ? lastActiveAt : current.lastActiveAt
  };
}

function setBatchPresence(users = []) {
  if (!Array.isArray(users)) return;
  for (const u of users) {
    if (!u?.id) continue;
    const id = Number(u.id);
    const current = state.presence[id] || { online: false, lastActiveAt: null };
    state.presence[id] = {
      online: u.online !== undefined ? Boolean(u.online) : current.online,
      lastActiveAt: u.lastActiveAt !== undefined ? u.lastActiveAt : (current.lastActiveAt || u.createdAt)
    };
  }
}

function getUserPresence(userId) {
  const id = Number(userId);
  return state.presence[id] || { online: false, lastActiveAt: null };
}

if (typeof window !== 'undefined') {
  addAuthInvalidListener(() => {
    clearAuthState();
  });
}

export default {
  get ready() {
    return state.ready;
  },
  get token() {
    return state.token;
  },
  get session() {
    return state.session;
  },
  get site() {
    return state.site;
  },
  get presence() {
    return state.presence;
  },
  get e2eeStatus() {
    return state.e2eeStatus;
  },
  get keyFingerprint() {
    return state.keyFingerprint;
  },
  get keyBackup() {
    return state.keyBackup;
  },
  initialize,
  login,
  configureNativeServer,
  logout,
  setSession,
  setSite,
  loadSite,
  setPresence,
  setBatchPresence,
  getUserPresence,
  ensureIdentityKey,
  recoverPrivateKey,
  setupKeyBackup,
  resetIdentityKey,
  refreshKeyStatus
};
