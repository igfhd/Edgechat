import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PBKDF2_ITERATIONS,
  LEGACY_PBKDF2_ITERATIONS,
  backupPrivateKeyWithPassphrase,
  computeKeyFingerprint,
  generateRecoveryPhrase,
  normalizeSecretInput,
  restorePrivateKeyWithPassphrase,
  validateRecoveryPhrase
} from '../frontend/src/crypto/key-backup.js';
import {
  derivePublicKeyFromPrivateKey,
  exportPrivateKey,
  exportPublicKey,
  generateIdentityKeyPair,
  importPrivateKey
} from '../frontend/src/crypto/x25519.js';
import {
  getLocalIdentityKeyPair,
  hasLocalIdentityKey,
  storeImportedIdentityKeyPair
} from '../frontend/src/crypto/keystore.js';

test('E2EE Private Key Backup & Restore with Passphrase (PBKDF2 600,000 iterations)', async () => {
  assert.equal(PBKDF2_ITERATIONS, 600000);
  assert.equal(LEGACY_PBKDF2_ITERATIONS, 100000);

  const keyPair = await generateIdentityKeyPair();
  const privateKeyBase64 = await exportPrivateKey(keyPair.privateKey);
  const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

  const userPassphrase = 'MySecureE2EEPassphrase!2026';

  // 1. Create encrypted backup (defaults to 600k iterations)
  const backup = await backupPrivateKeyWithPassphrase({
    privateKeyBase64,
    passphrase: userPassphrase,
    keyVersion: 1
  });

  assert.ok(backup.encryptedPrivateKey);
  assert.ok(backup.backupSalt);
  assert.ok(backup.backupIv);
  assert.equal(backup.keyVersion, 1);
  assert.notEqual(backup.encryptedPrivateKey, privateKeyBase64);

  // 2. Restore with matching passphrase
  const restoredPrivateKey = await restorePrivateKeyWithPassphrase({
    encryptedPrivateKey: backup.encryptedPrivateKey,
    backupSalt: backup.backupSalt,
    backupIv: backup.backupIv,
    passphrase: userPassphrase
  });

  assert.equal(restoredPrivateKey, privateKeyBase64);

  // 3. Restore with incorrect passphrase fails authentication with friendly error
  await assert.rejects(
    async () => {
      await restorePrivateKeyWithPassphrase({
        encryptedPrivateKey: backup.encryptedPrivateKey,
        backupSalt: backup.backupSalt,
        backupIv: backup.backupIv,
        passphrase: 'WrongPassword123'
      });
    },
    /安全口令或 12 词恢复短语错误/
  );

  // 4. Backward compatibility: verify legacy 100k iteration backups are seamlessly restored
  const legacyBackup = await backupPrivateKeyWithPassphrase({
    privateKeyBase64,
    passphrase: userPassphrase,
    keyVersion: 1,
    iterations: LEGACY_PBKDF2_ITERATIONS
  });

  const restoredFromLegacy = await restorePrivateKeyWithPassphrase({
    encryptedPrivateKey: legacyBackup.encryptedPrivateKey,
    backupSalt: legacyBackup.backupSalt,
    backupIv: legacyBackup.backupIv,
    passphrase: userPassphrase
  });
  assert.equal(restoredFromLegacy, privateKeyBase64);

  // 5. Compute fingerprint
  const fingerprint = await computeKeyFingerprint(publicKeyBase64);
  assert.match(fingerprint, /^([0-9A-F]{2}:){7}[0-9A-F]{2}$/);

  // 6. Verify public key derived from restored private key matches original
  const restoredPrivKeyObj = await importPrivateKey(restoredPrivateKey);
  const derivedPubKeyObj = await derivePublicKeyFromPrivateKey(restoredPrivKeyObj);
  const derivedPubKeyBase64 = await exportPublicKey(derivedPubKeyObj);
  assert.equal(derivedPubKeyBase64, publicKeyBase64);

  // 7. Test storeImportedIdentityKeyPair and getLocalIdentityKeyPair
  const importedRecord = await storeImportedIdentityKeyPair(999, {
    privateKeyBase64: restoredPrivateKey,
    keyVersion: 1
  });
  assert.equal(importedRecord.publicKeyBase64, publicKeyBase64);

  const hasKey = await hasLocalIdentityKey(999);
  assert.equal(hasKey, true);

  const localKey = await getLocalIdentityKeyPair(999);
  assert.equal(localKey.publicKeyBase64, publicKeyBase64);
  assert.equal(localKey.privateKeyBase64, restoredPrivateKey);
});

test('E2EE 12-word BIP-39 Recovery Phrase Generation & Verification', async () => {
  // 1. Generate 12-word phrase
  const phrase = await generateRecoveryPhrase();
  assert.equal(typeof phrase, 'string');
  const words = phrase.split(' ');
  assert.equal(words.length, 12);

  // 2. Validate phrase
  const isValid = await validateRecoveryPhrase(phrase);
  assert.equal(isValid, true);

  // 3. Normalized input handling (extra spaces, uppercase)
  const messyPhrase = `  ${words.map((w, idx) => (idx % 2 === 0 ? w.toUpperCase() : w)).join('   ')}  `;
  const normalized = normalizeSecretInput(messyPhrase);
  assert.equal(normalized, phrase.toLowerCase());

  // 4. Invalid word rejected
  const invalidWordPhrase = `${words.slice(0, 11).join(' ')} xyzinvalidword`;
  assert.equal(await validateRecoveryPhrase(invalidWordPhrase), false);

  // 5. Invalid checksum rejected
  const fakeChecksumPhrase = `${words.slice(0, 11).join(' ')} zoo`;
  assert.equal(await validateRecoveryPhrase(fakeChecksumPhrase), false);

  // 6. Encrypt & Restore private key using 12-word phrase
  const keyPair = await generateIdentityKeyPair();
  const privateKeyBase64 = await exportPrivateKey(keyPair.privateKey);

  const phraseBackup = await backupPrivateKeyWithPassphrase({
    privateKeyBase64,
    passphrase: phrase,
    keyVersion: 2
  });

  const restoredKey = await restorePrivateKeyWithPassphrase({
    encryptedPrivateKey: phraseBackup.encryptedPrivateKey,
    backupSalt: phraseBackup.backupSalt,
    backupIv: phraseBackup.backupIv,
    passphrase: messyPhrase // restore with messy typed input
  });

  assert.equal(restoredKey, privateKeyBase64);
});
