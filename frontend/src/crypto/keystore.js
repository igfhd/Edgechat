import {
  derivePublicKeyFromPrivateKey,
  exportPrivateKey,
  exportPublicKey,
  generateIdentityKeyPair,
  importPrivateKey,
  importPublicKey
} from './x25519.js';

const DB_NAME = 'edgechat_crypto_v1';
const STORE_IDENTITY = 'identity_keys';
const memoryStore = new Map();
const keyPairPromiseMap = new Map();

function hasIndexedDB() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDatabase() {
  if (!hasIndexedDB()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) {
        db.createObjectStore(STORE_IDENTITY, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredRecord(userId) {
  const normalizedId = Number(userId);
  const db = await openDatabase();
  if (!db) {
    return memoryStore.get(normalizedId) || null;
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE_IDENTITY, 'readonly');
      const store = transaction.objectStore(STORE_IDENTITY);
      const request = store.get(normalizedId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

async function saveStoredRecord(record) {
  const normalizedId = Number(record.userId);
  memoryStore.set(normalizedId, record);

  const db = await openDatabase();
  if (!db) {
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE_IDENTITY, 'readwrite');
      const store = transaction.objectStore(STORE_IDENTITY);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

export async function hasLocalIdentityKey(userId) {
  const normalizedId = Number(userId);
  if (!normalizedId) return false;
  try {
    const existing = await getStoredRecord(normalizedId);
    return Boolean(existing?.privateKeyBase64);
  } catch {
    return false;
  }
}

export async function getLocalIdentityKeyPair(userId) {
  const normalizedId = Number(userId);
  if (!normalizedId) return null;

  const existing = await getStoredRecord(normalizedId);
  if (!existing?.privateKeyBase64) {
    return null;
  }

  try {
    const privateKey = await importPrivateKey(existing.privateKeyBase64);
    let publicKey;
    let derivedPublicKeyBase64 = existing.publicKeyBase64;

    if (existing.publicKeyBase64) {
      try {
        publicKey = await importPublicKey(existing.publicKeyBase64);
      } catch {
        publicKey = await derivePublicKeyFromPrivateKey(privateKey);
        derivedPublicKeyBase64 = await exportPublicKey(publicKey);
      }
    } else {
      publicKey = await derivePublicKeyFromPrivateKey(privateKey);
      derivedPublicKeyBase64 = await exportPublicKey(publicKey);
    }

    if (derivedPublicKeyBase64 !== existing.publicKeyBase64) {
      existing.publicKeyBase64 = derivedPublicKeyBase64;
      await saveStoredRecord(existing);
    }

    return {
      userId: normalizedId,
      keyPair: { privateKey, publicKey },
      publicKeyBase64: derivedPublicKeyBase64,
      privateKeyBase64: existing.privateKeyBase64,
      keyVersion: existing.keyVersion || 1,
      isNew: false
    };
  } catch (err) {
    console.warn('Failed to parse existing private key from local store:', err);
    return null;
  }
}

export async function getOrCreateIdentityKeyPair(userId) {
  const normalizedId = Number(userId);
  if (!normalizedId) {
    throw new Error('Valid userId is required for key store');
  }

  if (keyPairPromiseMap.has(normalizedId)) {
    return keyPairPromiseMap.get(normalizedId);
  }

  const promise = (async () => {
  const existing = await getStoredRecord(normalizedId);
  if (existing?.privateKeyBase64) {
    try {
      const privateKey = await importPrivateKey(existing.privateKeyBase64);
      let publicKey;
      let derivedPublicKeyBase64 = existing.publicKeyBase64;

      if (existing.publicKeyBase64) {
        try {
          publicKey = await importPublicKey(existing.publicKeyBase64);
        } catch {
          publicKey = await derivePublicKeyFromPrivateKey(privateKey);
          derivedPublicKeyBase64 = await exportPublicKey(publicKey);
        }
      } else {
        publicKey = await derivePublicKeyFromPrivateKey(privateKey);
        derivedPublicKeyBase64 = await exportPublicKey(publicKey);
      }

      if (derivedPublicKeyBase64 !== existing.publicKeyBase64) {
        existing.publicKeyBase64 = derivedPublicKeyBase64;
        await saveStoredRecord(existing);
      }

      return {
        userId: normalizedId,
        keyPair: { privateKey, publicKey },
        publicKeyBase64: derivedPublicKeyBase64,
        privateKeyBase64: existing.privateKeyBase64,
        keyVersion: existing.keyVersion || 1,
        isNew: false
      };
    } catch (existingErr) {
      console.warn('Failed to load existing key pair, auto-regenerating fresh keys:', existingErr);
      await clearLocalIdentityKey(normalizedId);
    }
  }

  const keyPair = await generateIdentityKeyPair();
  const [publicKeyBase64, privateKeyBase64] = await Promise.all([
    exportPublicKey(keyPair.publicKey),
    exportPrivateKey(keyPair.privateKey)
  ]);

  const record = {
    userId: normalizedId,
    publicKeyBase64,
    privateKeyBase64,
    keyVersion: 1,
    createdAt: new Date().toISOString()
  };

  await saveStoredRecord(record);

  return {
    userId: normalizedId,
    keyPair,
    publicKeyBase64,
    privateKeyBase64,
    keyVersion: 1,
    isNew: true
  };
  })();

  keyPairPromiseMap.set(normalizedId, promise);
  try {
    return await promise;
  } finally {
    keyPairPromiseMap.delete(normalizedId);
  }
}

export async function storeImportedIdentityKeyPair(userId, { privateKeyBase64, publicKeyBase64 = '', keyVersion = 1 }) {
  const normalizedId = Number(userId);
  const privateKey = await importPrivateKey(privateKeyBase64);
  let publicKey;
  let derivedPublicKeyBase64 = publicKeyBase64;

  if (publicKeyBase64) {
    try {
      publicKey = await importPublicKey(publicKeyBase64);
    } catch {
      publicKey = await derivePublicKeyFromPrivateKey(privateKey);
      derivedPublicKeyBase64 = await exportPublicKey(publicKey);
    }
  } else {
    publicKey = await derivePublicKeyFromPrivateKey(privateKey);
    derivedPublicKeyBase64 = await exportPublicKey(publicKey);
  }

  const record = {
    userId: normalizedId,
    publicKeyBase64: derivedPublicKeyBase64,
    privateKeyBase64,
    keyVersion: Number(keyVersion) || 1,
    createdAt: new Date().toISOString()
  };

  await saveStoredRecord(record);

  return {
    userId: normalizedId,
    keyPair: { privateKey, publicKey },
    publicKeyBase64: derivedPublicKeyBase64,
    privateKeyBase64,
    keyVersion: record.keyVersion
  };
}

export async function clearLocalIdentityKey(userId) {
  const normalizedId = Number(userId);
  memoryStore.delete(normalizedId);

  const db = await openDatabase();
  if (!db) {
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE_IDENTITY, 'readwrite');
      const store = transaction.objectStore(STORE_IDENTITY);
      const request = store.delete(normalizedId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}
