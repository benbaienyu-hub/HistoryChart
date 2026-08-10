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
  it('never stores the password itself', async () => {
    const { hash, salt } = hashPassword('correct horse battery');
    expect(hash).not.toContain('correct');
    expect(hash).toHaveLength(128); // 64 bytes, hex
    expect(salt).toHaveLength(32);
  });

  it('accepts the right password and rejects everything else', async () => {
    const stored = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', stored)).toBe(true);
    expect(verifyPassword('correct horse batter', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
    expect(verifyPassword('CORRECT HORSE BATTERY', stored)).toBe(false);
  });

  it('salts per user, so the same password hashes differently', async () => {
    // Without this, a stolen database shows at a glance which accounts share a
    // password, and one cracked hash unlocks all of them.
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('is stable for a given salt', async () => {
    const first = hashPassword('pw', 'fixedsalt');
    expect(hashPassword('pw', 'fixedsalt').hash).toBe(first.hash);
  });

  it('does not throw on a malformed stored hash', async () => {
    expect(verifyPassword('pw', { hash: 'nonsense', salt: 'x' })).toBe(false);
    expect(verifyPassword('pw', {})).toBe(false);
  });

  it('asks for a password long enough to be worth hashing', async () => {
    expect(passwordProblem('short')).toMatch(/8/);
    expect(passwordProblem('')).toMatch(/8/);
    expect(passwordProblem(undefined)).toMatch(/8/);
    expect(passwordProblem('longenough')).toBeNull();
  });
});

describe('email handling', () => {
  it('normalizes so casing and spacing cannot split an identity', async () => {
    expect(normalizeEmail('  Ben@Example.COM ')).toBe('ben@example.com');
  });

  it('recognises addresses, and rejects the near-misses', async () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    for (const bad of ['', 'a@b', 'a b@c.co', '@b.co', 'a@.co', undefined]) {
      expect(isValidEmail(bad), String(bad)).toBe(false);
    }
  });
});

describe('users', () => {
  it('stores a user findable by any casing of their email', async () => {
    await createUser({ email: 'Ben@Example.com', name: 'Ben', password: 'longenough' });
    expect((await findUserByEmail('ben@example.com'))?.name).toBe('Ben');
    expect((await findUserByEmail('BEN@EXAMPLE.COM'))?.name).toBe('Ben');
  });

  it('falls back to the local part when no name is given', async () => {
    const user = await createUser({ email: 'ada@example.com', password: 'longenough' });
    expect(user.name).toBe('ada');
  });

  it('keeps the hash and salt out of what the client sees', async () => {
    // The one place this could leak is a careless spread of the user row, so the
    // allowlist is asserted rather than the denylist. Adding a field here should
    // take a deliberate edit to this line — including the recovery-code flag,
    // which is a fact about the account and not the code itself.
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    expect(Object.keys(publicUser(user)).sort()).toEqual([
      'createdAt',
      'email',
      'hasRecoveryCode',
      'id',
      'name',
    ]);
  });

  it('reports whether a recovery code exists, never the code or its hash', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    expect(publicUser(user).hasRecoveryCode).toBe(false);
    await issueRecoveryCode(user.id);
    expect(publicUser(await findUserByEmail('a@b.co')).hasRecoveryCode).toBe(true);
    expect(JSON.stringify(publicUser(await findUserByEmail('a@b.co')))).not.toContain('recoveryHash');
  });

  it('publicUser tolerates nothing being signed in', async () => {
    expect(publicUser(null)).toBeNull();
  });
});

describe('sessions', () => {
  it('resolves a token back to its user', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const { token } = await createSession(user.id);
    expect((await userForToken(token))?.id).toBe(user.id);
  });

  it('issues unguessable, unrelated tokens', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const a = (await createSession(user.id)).token;
    const b = (await createSession(user.id)).token;
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
    expect(a).not.toContain(user.id);
  });

  it('refuses an unknown or absent token', async () => {
    expect(await userForToken('made-up')).toBeNull();
    expect(await userForToken(null)).toBeNull();
    expect(await userForToken('')).toBeNull();
  });

  it('refuses an expired token, and clears it out', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const { token } = await createSession(user.id);
    // Reach into the store rather than waiting 30 days.
    (await readDb()).sessions.find((s) => s.token === token).expiresAt = Date.now() - 1;
    expect(await userForToken(token)).toBeNull();
    expect((await readDb()).sessions.some((s) => s.token === token)).toBe(false);
  });

  it('signing out invalidates the token immediately', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const { token } = await createSession(user.id);
    await destroySession(token);
    expect(await userForToken(token)).toBeNull();
  });

  it('signing out one session leaves the other devices signed in', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const laptop = (await createSession(user.id)).token;
    const phone = (await createSession(user.id)).token;
    await destroySession(laptop);
    expect((await userForToken(phone))?.id).toBe(user.id);
  });

  it('can end every session for one user without touching anyone else', async () => {
    const mine = await createUser({ email: 'a@b.co', password: 'longenough' });
    const theirs = await createUser({ email: 'c@d.co', password: 'longenough' });
    const laptop = (await createSession(mine.id)).token;
    const phone = (await createSession(mine.id)).token;
    const other = (await createSession(theirs.id)).token;

    await destroySessionsForUser(mine.id);
    expect(await userForToken(laptop)).toBeNull();
    expect(await userForToken(phone)).toBeNull();
    expect((await userForToken(other))?.id).toBe(theirs.id);
  });

  it('can spare the session doing the asking', async () => {
    // Changing your password must not sign you out of the page you changed it on.
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const here = (await createSession(user.id)).token;
    const elsewhere = (await createSession(user.id)).token;

    await destroySessionsForUser(user.id, { except: here });
    expect((await userForToken(here))?.id).toBe(user.id);
    expect(await userForToken(elsewhere)).toBeNull();
  });
});

describe('recovery codes', () => {
  it('issues a code of the documented shape', async () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}){3}$/);
  });

  it('never issues the same code twice', async () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(generateRecoveryCode());
    expect(seen.size).toBe(200);
  });

  it('leaves out the characters people misread', async () => {
    // The whole alphabet is exercised over enough draws for this to be meaningful.
    const drawn = new Set([...Array(200)].map(generateRecoveryCode).join(''));
    for (const confusable of ['I', 'L', 'O', '0', '1']) {
      expect(drawn.has(confusable), confusable).toBe(false);
    }
  });

  it('stores the code the way a password is stored, not in the clear', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const code = await issueRecoveryCode(user.id);
    const stored = await findUserByEmail('a@b.co');
    expect(stored.recoveryHash).toBeTruthy();
    expect(stored.recoveryHash).not.toContain(code.replace(/-/g, ''));
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ''));
  });

  it('accepts the code however it was retyped', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const code = await issueRecoveryCode(user.id);
    const stored = await findUserByEmail('a@b.co');
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

  it('rejects a wrong code, an empty one, and an account that has none', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const code = await issueRecoveryCode(user.id);
    const stored = await findUserByEmail('a@b.co');
    expect(verifyRecoveryCode(stored, generateRecoveryCode())).toBe(false);
    expect(verifyRecoveryCode(stored, '')).toBe(false);
    expect(verifyRecoveryCode(null, code)).toBe(false);

    await clearRecoveryCode(user.id);
    expect(verifyRecoveryCode(await findUserByEmail('a@b.co'), code)).toBe(false);
  });

  it('replaces the old code when a new one is issued', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    const first = await issueRecoveryCode(user.id);
    const second = await issueRecoveryCode(user.id);
    const stored = await findUserByEmail('a@b.co');
    expect(verifyRecoveryCode(stored, first)).toBe(false);
    expect(verifyRecoveryCode(stored, second)).toBe(true);
  });
});

describe('setting a password', () => {
  it('replaces the hash and the salt together', async () => {
    const user = await createUser({ email: 'a@b.co', password: 'longenough' });
    // Copied, not referenced: readDb hands back the live row, so holding onto it
    // would mean comparing the new salt against itself.
    const before = { ...findUserByEmail('a@b.co') };

    await setPassword(user.id, 'a whole new password');
    const after = await findUserByEmail('a@b.co');

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

  it('does nothing for an id that isn’t there', async () => {
    await expect(setPassword('no-such-user', 'longenough')).resolves.toBeUndefined();
  });
});

describe('sign-in throttling', () => {
  it('allows a few mistakes, then stops answering', async () => {
    for (let i = 0; i < 9; i++) recordFailedAttempt('a@b.co');
    expect(tooManyAttempts('a@b.co')).toBe(false);
    recordFailedAttempt('a@b.co');
    expect(tooManyAttempts('a@b.co')).toBe(true);
  });

  it('is per address, so one person cannot lock out another', async () => {
    for (let i = 0; i < 12; i++) recordFailedAttempt('a@b.co');
    expect(tooManyAttempts('other@b.co')).toBe(false);
  });

  it('forgets the failures once you get in', async () => {
    for (let i = 0; i < 12; i++) recordFailedAttempt('a@b.co');
    clearAttempts('a@b.co');
    expect(tooManyAttempts('a@b.co')).toBe(false);
  });

  it('is quiet about an address that has never failed', async () => {
    expect(tooManyAttempts('nobody@b.co')).toBe(false);
  });
});
