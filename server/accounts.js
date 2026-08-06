// Accounts and sessions. No dependencies — node:crypto has everything needed,
// and an auth library would be a bigger trust decision than the code it saves.

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mutate, readDb } from './store.js';

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
export function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

export function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  return readDb().users.find((u) => u.email === normalized) ?? null;
}

export function findUserById(id) {
  return readDb().users.find((u) => u.id === id) ?? null;
}

export function createUser({ email, name, password }) {
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
  mutate((db) => db.users.push(user));
  return user;
}

export function createSession(userId) {
  // 32 random bytes: not guessable, and never derived from anything about the
  // user, so a token tells an attacker nothing.
  const token = randomBytes(32).toString('base64url');
  const session = {
    token,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  };
  mutate((db) => {
    // Opportunistic pruning: expired rows are dead weight and this is the only
    // place that reliably runs often enough to clear them.
    db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now());
    db.sessions.push(session);
  });
  return session;
}

export function userForToken(token) {
  if (!token) return null;
  const session = readDb().sessions.find((s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    destroySession(token);
    return null;
  }
  return findUserById(session.userId);
}

export function destroySession(token) {
  if (!token) return;
  mutate((db) => {
    db.sessions = db.sessions.filter((s) => s.token !== token);
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
