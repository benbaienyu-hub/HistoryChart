// @vitest-environment node
// Server-side code: node:crypto and the filesystem, neither of which belongs in
// jsdom.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAttempts,
  clearRecoveryCode,
  createSession,
  createUser,
  destroySession,
  destroySessionsForUser,
  findUserByEmail,
  generateRecoveryCode,
  hashPassword,
  isValidEmail,
  issueRecoveryCode,
  normalizeEmail,
  passwordProblem,
  publicUser,
  recordFailedAttempt,
  resetThrottleForTests,
  setPassword,
  tooManyAttempts,
  userForToken,
  verifyPassword,
  verifyRecoveryCode,
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
    // allowlist is asserted rather than the denylist. Adding a field here should
    // take a deliberate edit to this line — including the recovery-code flag,
    // which is a fact about the account and not the code itself.
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    expect(Object.keys(publicUser(user)).sort()).toEqual([
      'createdAt',
      'email',
      'hasRecoveryCode',
      'id',
      'name',
    ]);
  });

  it('reports whether a recovery code exists, never the code or its hash', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    expect(publicUser(user).hasRecoveryCode).toBe(false);
    issueRecoveryCode(user.id);
    expect(publicUser(findUserByEmail('a@b.co')).hasRecoveryCode).toBe(true);
    expect(JSON.stringify(publicUser(findUserByEmail('a@b.co')))).not.toContain('recoveryHash');
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

  it('can end every session for one user without touching anyone else', () => {
    const mine = createUser({ email: 'a@b.co', password: 'longenough' });
    const theirs = createUser({ email: 'c@d.co', password: 'longenough' });
    const laptop = createSession(mine.id).token;
    const phone = createSession(mine.id).token;
    const other = createSession(theirs.id).token;

    destroySessionsForUser(mine.id);
    expect(userForToken(laptop)).toBeNull();
    expect(userForToken(phone)).toBeNull();
    expect(userForToken(other)?.id).toBe(theirs.id);
  });

  it('can spare the session doing the asking', () => {
    // Changing your password must not sign you out of the page you changed it on.
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const here = createSession(user.id).token;
    const elsewhere = createSession(user.id).token;

    destroySessionsForUser(user.id, { except: here });
    expect(userForToken(here)?.id).toBe(user.id);
    expect(userForToken(elsewhere)).toBeNull();
  });
});

describe('recovery codes', () => {
  it('issues a code of the documented shape', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}){3}$/);
  });

  it('never issues the same code twice', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(generateRecoveryCode());
    expect(seen.size).toBe(200);
  });

  it('leaves out the characters people misread', () => {
    // The whole alphabet is exercised over enough draws for this to be meaningful.
    const drawn = new Set([...Array(200)].map(generateRecoveryCode).join(''));
    for (const confusable of ['I', 'L', 'O', '0', '1']) {
      expect(drawn.has(confusable), confusable).toBe(false);
    }
  });

  it('stores the code the way a password is stored, not in the clear', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const code = issueRecoveryCode(user.id);
    const stored = findUserByEmail('a@b.co');
    expect(stored.recoveryHash).toBeTruthy();
    expect(stored.recoveryHash).not.toContain(code.replace(/-/g, ''));
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ''));
  });

  it('accepts the code however it was retyped', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const code = issueRecoveryCode(user.id);
    const stored = findUserByEmail('a@b.co');
    for (const variant of [
      code,
      code.toLowerCase(),
      code.replace(/-/g, ''),
      code.replace(/-/g, ' '),
      `  ${code}  `,
    ]) {
      expect(verifyRecoveryCode(stored, variant), variant).toBe(true);
    }
  });

  it('rejects a wrong code, an empty one, and an account that has none', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const code = issueRecoveryCode(user.id);
    const stored = findUserByEmail('a@b.co');
    expect(verifyRecoveryCode(stored, generateRecoveryCode())).toBe(false);
    expect(verifyRecoveryCode(stored, '')).toBe(false);
    expect(verifyRecoveryCode(null, code)).toBe(false);

    clearRecoveryCode(user.id);
    expect(verifyRecoveryCode(findUserByEmail('a@b.co'), code)).toBe(false);
  });

  it('replaces the old code when a new one is issued', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    const first = issueRecoveryCode(user.id);
    const second = issueRecoveryCode(user.id);
    const stored = findUserByEmail('a@b.co');
    expect(verifyRecoveryCode(stored, first)).toBe(false);
    expect(verifyRecoveryCode(stored, second)).toBe(true);
  });
});

describe('setting a password', () => {
  it('replaces the hash and the salt together', () => {
    const user = createUser({ email: 'a@b.co', password: 'longenough' });
    // Copied, not referenced: readDb hands back the live row, so holding onto it
    // would mean comparing the new salt against itself.
    const before = { ...findUserByEmail('a@b.co') };

    setPassword(user.id, 'a whole new password');
    const after = findUserByEmail('a@b.co');

    expect(after.passwordSalt).not.toBe(before.passwordSalt);
    expect(verifyPassword('a whole new password', {
      hash: after.passwordHash,
      salt: after.passwordSalt,
    })).toBe(true);
    expect(verifyPassword('longenough', {
      hash: after.passwordHash,
      salt: after.passwordSalt,
    })).toBe(false);
  });

  it('does nothing for an id that isn’t there', () => {
    expect(() => setPassword('no-such-user', 'longenough')).not.toThrow();
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
