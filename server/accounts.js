// Accounts and sessions. No dependencies — node:crypto has everything needed,
// and an auth library would be a bigger trust decision than the code it saves.

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mutate, readDb } from './store.js';
import {
  RECOVERY_ALPHABET,
  RECOVERY_LENGTH,
  formatRecoveryCode,
  normalizeRecoveryCode,
} from '../src/lib/recoveryCode.js';

export const SESSION_COOKIE = 'lacuna_session';
const SESSION_DAYS = 30;
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60; // seconds, for the cookie

const MIN_PASSWORD = 8;
const KEY_LENGTH = 64;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

// scrypt is deliberately slow and memory-hard, which is the point: it makes a
// stolen database expensive to attack. The salt is per-user, so two people with
// the same password get different hashes.
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, KEY_LENGTH).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, { hash, salt }) {
  if (!hash || !salt) return false;
  const candidate = scryptSync(String(password), salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  // Length check first: timingSafeEqual throws on a mismatch, and a wrong length
  // is not a secret worth protecting.
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function passwordProblem(password) {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  return null;
}

// What the client is allowed to see about a user. Never the hash or the salt —
// this function exists so that leaking them takes a deliberate mistake.
// `hasRecoveryCode` is a fact about the account, not a secret: the settings screen
// needs it to tell someone they have no way back in yet.
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    hasRecoveryCode: Boolean(user.recoveryHash),
  };
}

export async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  const db = await readDb();
  return db.users.find((u) => u.email === normalized) ?? null;
}

export async function findUserById(id) {
  const db = await readDb();
  return db.users.find((u) => u.id === id) ?? null;
}

export async function createUser({ email, name, password }) {
  const normalized = normalizeEmail(email);
  const { hash, salt } = hashPassword(password);
  const user = {
    id: randomUUID(),
    email: normalized,
    name: String(name ?? '').trim() || normalized.split('@')[0],
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: Date.now(),
  };
  await mutate((db) => db.users.push(user));
  return user;
}

export async function createSession(userId) {
  // 32 random bytes: not guessable, and never derived from anything about the
  // user, so a token tells an attacker nothing.
  const token = randomBytes(32).toString('base64url');
  const session = {
    token,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  };
  await mutate((db) => {
    // Opportunistic pruning: expired rows are dead weight and this is the only
    // place that reliably runs often enough to clear them.
    db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now());
    db.sessions.push(session);
  });
  return session;
}

export async function userForToken(token) {
  if (!token) return null;
  const db = await readDb();
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    await destroySession(token);
    return null;
  }
  return findUserById(session.userId);
}

export async function destroySession(token) {
  if (!token) return;
  await mutate((db) => {
    db.sessions = db.sessions.filter((s) => s.token !== token);
  });
}

// Every session but (optionally) the one doing the asking. A password change or a
// recovery has to end the sessions somebody else might be holding, or the change
// achieves nothing.
export async function destroySessionsForUser(userId, { except } = {}) {
  await mutate((db) => {
    db.sessions = db.sessions.filter((s) => s.userId !== userId || s.token === except);
  });
}

// --- passwords and recovery codes ------------------------------------------

export async function setPassword(userId, password) {
  const { hash, salt } = hashPassword(password);
  await mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return;
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.passwordChangedAt = Date.now();
  });
}

// Rejection sampling rather than `byte % 31`: the remainder would make the first
// few letters of the alphabet slightly likelier, and there is no reason to accept
// a biased secret when discarding a few bytes is free.
export function generateRecoveryCode() {
  const limit = 256 - (256 % RECOVERY_ALPHABET.length);
  let code = '';
  while (code.length < RECOVERY_LENGTH) {
    for (const byte of randomBytes(RECOVERY_LENGTH)) {
      if (byte >= limit) continue;
      code += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
      if (code.length === RECOVERY_LENGTH) break;
    }
  }
  return formatRecoveryCode(code);
}

// Returns the code in the clear exactly once — this is the only moment it exists
// outside the user's own notes. It is stored the same way a password is, so a
// leaked database does not hand over a way in.
export async function issueRecoveryCode(userId) {
  const code = generateRecoveryCode();
  const { hash, salt } = hashPassword(normalizeRecoveryCode(code));
  await mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return;
    user.recoveryHash = hash;
    user.recoverySalt = salt;
    user.recoveryIssuedAt = Date.now();
  });
  return code;
}

export function verifyRecoveryCode(user, code) {
  if (!user?.recoveryHash) return false;
  return verifyPassword(normalizeRecoveryCode(code), {
    hash: user.recoveryHash,
    salt: user.recoverySalt,
  });
}

// One code, one use. Clearing it on use means a code read over someone's shoulder
// stops being a spare key the moment it is spent — the reset flow immediately
// issues a fresh one, so nobody is left without a way back in.
export async function clearRecoveryCode(userId) {
  await mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return;
    delete user.recoveryHash;
    delete user.recoverySalt;
    delete user.recoveryIssuedAt;
  });
}

// Sign-in throttling, in memory. A restart clears it, which is an acceptable
// trade for having no extra moving parts: the point is to make online guessing
// slow, not to be a complete defence.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

export function resetThrottleForTests() {
  attempts.clear();
}

export function tooManyAttempts(key) {
  const record = attempts.get(key);
  if (!record) return false;
  if (Date.now() - record.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key) {
  const record = attempts.get(key);
  if (!record || Date.now() - record.first > WINDOW_MS) {
    attempts.set(key, { first: Date.now(), count: 1 });
    return;
  }
  record.count += 1;
}

export function clearAttempts(key) {
  attempts.delete(key);
}
