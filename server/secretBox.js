// Encryption at rest for the few things in the database that are secrets rather
// than data: right now, other people's AI API keys.
//
// Why bother, when password hashes sit in the same file. A hash cannot be turned
// back into a password, so the file leaking is survivable. An API key stored in
// plaintext is immediately spendable by whoever reads it — and it isn't the
// owner's key, it's a guest's. Encrypting it means a leaked or backed-up
// lacuna.json is not a wallet.
//
// The key lives beside the database in a file that never leaves the machine, so
// this protects against the file being copied, committed, or backed up — not
// against someone who already has the server's disk and process. That is the
// threat that actually happens here.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { dirname, join } from 'node:path';
import { dataFilePath } from './store.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is defined for

// Cached per key-file path: reading and parsing on every request would be waste,
// but a test that repoints the data path must get a different key.
const keyCache = new Map();

function keyFilePath() {
  return join(dirname(dataFilePath()), 'secret.key');
}

// LACUNA_SECRET wins when set, so a hosted deployment can hold the secret in its
// environment (or a mounted secret) instead of on the same disk as the backup.
function loadKey() {
  const fromEnv = process.env.LACUNA_SECRET?.trim();
  if (fromEnv) {
    // Any length of passphrase, one fixed 32 bytes out. scrypt with a fixed salt
    // is right here: there is exactly one secret, so a per-secret salt would have
    // nowhere to live, and the input is expected to be high-entropy anyway.
    const cacheKey = `env:${fromEnv}`;
    if (!keyCache.has(cacheKey)) {
      keyCache.set(cacheKey, deriveFromPassphrase(fromEnv));
    }
    return keyCache.get(cacheKey);
  }

  const path = keyFilePath();
  if (keyCache.has(path)) return keyCache.get(path);

  let key;
  try {
    const hex = readFileSync(path, 'utf8').trim();
    key = Buffer.from(hex, 'hex');
    if (key.length !== KEY_BYTES) throw new Error('wrong length');
  } catch {
    // First run, or a file we cannot use. Generate one and keep it: losing it
    // only costs the stored API keys, which their owners can paste again.
    key = randomBytes(KEY_BYTES);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, key.toString('hex'), { mode: 0o600 });
    try {
      // If the file already existed with looser permissions, tighten it.
      chmodSync(path, 0o600);
    } catch {
      // Windows and some mounts don't support this. Not worth failing over.
    }
  }
  keyCache.set(path, key);
  return key;
}

function deriveFromPassphrase(passphrase) {
  return scryptSync(passphrase, 'lacuna:secretbox:v1', KEY_BYTES);
}

// Test seam: forget any cached key so a fresh temp directory gets a fresh one.
export function resetSecretCacheForTests() {
  keyCache.clear();
}

// Returns a self-describing envelope rather than a bare string: the version lets
// a future algorithm change read old rows instead of silently mis-decrypting them.
export function seal(plaintext) {
  const value = String(plaintext ?? '');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, loadKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

// Null rather than throwing when a row cannot be opened — a database restored
// without its key file should degrade to "no key saved, paste it again", not
// crash every request that touches the user's settings.
export function open(box) {
  if (!box || box.v !== 1 || !box.iv || !box.tag || !box.data) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, loadKey(), Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(box.data, 'base64')),
      decipher.final(),
    ]);
    return out.toString('utf8');
  } catch {
    // Wrong key, or the ciphertext was edited: GCM's tag check fails closed.
    return null;
  }
}
