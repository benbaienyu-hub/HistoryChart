import { describe, expect, it } from 'vitest';
import {
  getCurrentUser,
  isValidEmail,
  listUsers,
  normalizeEmail,
  signIn,
  signOut,
} from '../src/lib/auth';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });
});

describe('isValidEmail', () => {
  it('accepts an ordinary address, with surrounding whitespace', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('  a@b.co  ')).toBe(true);
  });

  it('rejects addresses missing an @, a dot, or a part', () => {
    for (const bad of ['', 'a', 'a@b', 'a@.com', '@b.co', 'a b@c.co', 'a@b c.co']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
});

describe('signIn', () => {
  it('creates a user and starts a session', () => {
    const user = signIn({ email: 'Alice@Example.com', name: '  Alice  ' });
    expect(user).toMatchObject({ email: 'alice@example.com', name: 'Alice' });
    expect(getCurrentUser()).toEqual(user);
  });

  it('derives a name from the address when none is given', () => {
    expect(signIn({ email: 'alice@example.com' }).name).toBe('alice');
    signOut();
    expect(signIn({ email: 'bob@example.com', name: '   ' }).name).toBe('bob');
  });

  it('reuses the existing profile rather than duplicating it', () => {
    signIn({ email: 'alice@example.com', name: 'Alice' });
    signIn({ email: 'ALICE@example.com' });
    expect(listUsers()).toHaveLength(1);
    // No new name supplied, so the stored one survives.
    expect(getCurrentUser().name).toBe('Alice');
  });

  it('updates the name when one is supplied on a later sign-in', () => {
    signIn({ email: 'alice@example.com', name: 'Alice' });
    signIn({ email: 'alice@example.com', name: 'Alice B' });
    expect(listUsers()).toHaveLength(1);
    expect(getCurrentUser().name).toBe('Alice B');
  });

  it('switches the session when a different user signs in', () => {
    signIn({ email: 'alice@example.com' });
    signIn({ email: 'bob@example.com' });
    expect(getCurrentUser().email).toBe('bob@example.com');
    expect(listUsers()).toHaveLength(2);
  });
});

describe('signOut / getCurrentUser', () => {
  it('is null with no session', () => {
    expect(getCurrentUser()).toBeNull();
  });

  it('clears the session but keeps the profile, so signing back in restores it', () => {
    signIn({ email: 'alice@example.com', name: 'Alice' });
    signOut();
    expect(getCurrentUser()).toBeNull();
    expect(listUsers()).toHaveLength(1);
    expect(signIn({ email: 'alice@example.com' }).name).toBe('Alice');
  });

  it('returns null when the session points at a profile that no longer exists', () => {
    signIn({ email: 'alice@example.com' });
    localStorage.removeItem('lacuna:users:v1');
    expect(getCurrentUser()).toBeNull();
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('lacuna:session:v1', '{not json');
    localStorage.setItem('lacuna:users:v1', 'also not json');
    expect(getCurrentUser()).toBeNull();
    expect(listUsers()).toEqual([]);
  });
});
