import { readJSON, writeJSON } from './storage';

// NOT real authentication. This is a local profile switcher backed by
// localStorage so the app can scope canvases to an identity and demo sharing.
// There is deliberately no password: with no server to verify one against,
// any check would be cosmetic and storing it would be a liability. Swap this
// module for a real auth provider (session cookie / OAuth / magic link) when
// a backend exists.
const USERS_KEY = 'historychart:users:v1';
const SESSION_KEY = 'historychart:session:v1';

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function listUsers() {
  return readJSON(USERS_KEY, []);
}

export function signIn({ email, name }) {
  const normalized = normalizeEmail(email);
  const users = listUsers();
  const existing = users.find((u) => u.email === normalized);
  const trimmedName = name?.trim();

  let user;
  if (existing) {
    user = trimmedName ? { ...existing, name: trimmedName } : existing;
    writeJSON(
      USERS_KEY,
      users.map((u) => (u.email === normalized ? user : u))
    );
  } else {
    user = {
      email: normalized,
      name: trimmedName || normalized.split('@')[0],
      createdAt: Date.now(),
    };
    writeJSON(USERS_KEY, [...users, user]);
  }

  writeJSON(SESSION_KEY, { email: normalized });
  return user;
}

export function signOut() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function getCurrentUser() {
  const session = readJSON(SESSION_KEY, null);
  if (!session?.email) return null;
  return listUsers().find((u) => u.email === session.email) ?? null;
}
