// @vitest-environment node
// Server-side code: node:crypto and the filesystem, neither of which belongs in
// jsdom.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAttempts,
  createSession,
  createUser,
  destroySession,
  findUserByEmail,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  passwordProblem,
  publicUser,
  recordFailedAttempt,
  resetThrottleForTests,
  tooManyAttempts,
  userForToken,
  verifyPassword,
} from '../server/accounts.js';
import { readDb, setDataPathForTests } from '../server/store.js';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-test-'));
  setDataPathForTests(join(dir, 'db.json'));
  resetThrottleForTests();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('password hashing', () => {
  it('never stores the password itself', () => {
    const { hash, salt } = hashPassword('correct horse battery');
    expect(hash).not.toContain('correct');
    expect(hash).toHaveLength(128); // 64 bytes, hex
    expect(salt).toHaveLength(32);
  });

  it('accepts the right password and rejects everything else', () => {
    const stored = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', stored)).toBe(true);
    expect(verifyPassword('correct horse batter', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
    expect(verifyPassword('CORRECT HORSE BATTERY', stored)).toBe(false);
  });

  it('salts per user, so the same password hashes differently', () => {
    // Without this, a stolen database shows at a glance which accounts share a
    // password, and one cracked hash unlocks all of them.
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('is stable for a given salt', () => {
    const first = hashPassword('pw', 'fixedsalt');
    expect(hashPassword('pw', 'fixedsalt').hash).toBe(first.hash);
  });

  it('does not throw on a malformed stored hash', () => {
    expect(verifyPassword('pw', { hash: 'nonsense', salt: 'x' })).toBe(false);
    expect(verifyPassword('pw', {})).toBe(false);
  });

  it('asks for a password long enough to be worth hashing', () => {
    expect(passwordProblem('short')).toMatch(/8/);
    expect(passwordProblem('')).toMatch(/8/);
    expect(passwordProblem(undefined)).toMatch(/8/);
    expect(passwordProblem('longenough')).toBeNull();
  });
});

describe('email handling', () => {
  it('normalizes so casing and spacing cannot split an identity', () => {
    expect(normalizeEmail('  Ben@Example.COM ')).toBe('ben@example.com');
  });

  it('recognises addresses, and rejects the near-misses', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    for (const bad of ['', 'a@b', 'a b@c.co', '@b.co', 'a@.co', undefined]) {
      expect(isValidEmail(bad), String(bad)).toBe(false);
    }
  });
});

describe('users', () => {
  it('stores a user findable by any casing of their email', () => {
    createUser({ email: 'Ben@Example.com', name: 'Ben', password: 'longenough' });
    expect(findUserByEmail('ben@example.com')?.name).toBe('Ben');
    expect(findUserByEmail('BEN@EXAMPLE.COM')?.name).toBe('Ben');
  });

  it('falls back to the local part when no name is given', () => {
    const user = createUser({ email: 'ada@example.com', password: 'longenough' });
    expect(user.name).toBe('ada');
  });

  it('keeps the hash and salt out of what the client sees', () => {
    // The one place this could leak is a careless spread of the user row, so the
    // allowlist is asserted rather than the denylist.
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    expect(Object.keys(publicUser(user)).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
  });

  it('publicUser tolerates nothing being signed in', () => {
    expect(publicUser(null)).toBeNull();
  });
});

describe('sessions', () => {
  it('resolves a token back to its user', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const { token } = createSession(user.id);
    expect(userForToken(token)?.id).toBe(user.id);
  });

  it('issues unguessable, unrelated tokens', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const a = createSession(user.id).token;
    const b = createSession(user.id).token;
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
    expect(a).not.toContain(user.id);
  });

  it('refuses an unknown or absent token', () => {
    expect(userForToken('made-up')).toBeNull();
    expect(userForToken(null)).toBeNull();
    expect(userForToken('')).toBeNull();
  });

  it('refuses an expired token, and clears it out', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const { token } = createSession(user.id);
    // Reach into the store rather than waiting 30 days.
    readDb().sessions.find((s) => s.token === token).expiresAt = Date.now() - 1;
    expect(userForToken(token)).toBeNull();
    expect(readDb().sessions.some((s) => s.token === token)).toBe(false);
  });

  it('signing out invalidates the token immediately', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const { token } = createSession(user.id);
    destroySession(token);
    expect(userForToken(token)).toBeNull();
  });

  it('signing out one session leaves the other devices signed in', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const laptop = createSession(user.id).token;
    const phone = createSession(user.id).token;
    destroySession(laptop);
    expect(userForToken(phone)?.id).toBe(user.id);
  });
});

describe('sign-in throttling', () => {
  it('allows a few mistakes, then stops answering', () => {
    for (let i = 0; i < 9; i++) recordFailedAttempt('a@b.co');
    expect(tooManyAttempts('a@b.co')).toBe(false);
    recordFailedAttempt('a@b.co');
    expect(tooManyAttempts('a@b.co')).toBe(true);
  });

  it('is per address, so one person cannot lock out another', () => {
    for (let i = 0; i < 12; i++) recordFailedAttempt('a@b.co');
    expect(tooManyAttempts('other@b.co')).toBe(false);
  });

  it('forgets the failures once you get in', () => {
    for (let i = 0; i < 12; i++) recordFailedAttempt('a@b.co');
    clearAttempts('a@b.co');
    expect(tooManyAttempts('a@b.co')).toBe(false);
  });

  it('is quiet about an address that has never failed', () => {
    expect(tooManyAttempts('nobody@b.co')).toBe(false);
  });
});
