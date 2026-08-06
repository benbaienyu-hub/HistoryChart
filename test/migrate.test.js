import { describe, expect, it, vi } from 'vitest';
import { LEGACY_PREFIX, migrateLegacyStorage, PREFIX } from '../src/lib/migrate';
import { canvasesOwnedBy, createCanvas } from '../src/lib/canvasStore';
import { getCurrentUser, signIn } from '../src/lib/auth';

const legacy = (k) => LEGACY_PREFIX + k;
const current = (k) => PREFIX + k;

describe('migrateLegacyStorage', () => {
  it('does nothing on a fresh install', () => {
    expect(migrateLegacyStorage()).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('moves a legacy key to the new prefix and removes the original', () => {
    localStorage.setItem(legacy('canvases:v1'), '[{"id":"a"}]');
    expect(migrateLegacyStorage()).toBe(1);
    expect(localStorage.getItem(current('canvases:v1'))).toBe('[{"id":"a"}]');
    expect(localStorage.getItem(legacy('canvases:v1'))).toBeNull();
  });

  it('moves every legacy key, not just the first', () => {
    for (const k of ['canvases:v1', 'users:v1', 'session:v1', 'theme:v1', 'lastOpen:v1']) {
      localStorage.setItem(legacy(k), `value-${k}`);
    }
    expect(migrateLegacyStorage()).toBe(5);
    for (const k of ['canvases:v1', 'users:v1', 'session:v1', 'theme:v1', 'lastOpen:v1']) {
      expect(localStorage.getItem(current(k))).toBe(`value-${k}`);
      expect(localStorage.getItem(legacy(k))).toBeNull();
    }
  });

  it('leaves unrelated keys alone', () => {
    localStorage.setItem('some-other-app:data', 'keep me');
    localStorage.setItem(legacy('theme:v1'), 'dark');
    migrateLegacyStorage();
    expect(localStorage.getItem('some-other-app:data')).toBe('keep me');
  });

  it('is idempotent — a second run has nothing to do', () => {
    localStorage.setItem(legacy('theme:v1'), 'dark');
    expect(migrateLegacyStorage()).toBe(1);
    expect(migrateLegacyStorage()).toBe(0);
    expect(localStorage.getItem(current('theme:v1'))).toBe('dark');
  });

  it('does not clobber newer data already under the new prefix', () => {
    // Someone used the renamed app, then a stale legacy key turned up (another
    // tab, a restored backup). The new data wins.
    localStorage.setItem(current('canvases:v1'), 'new');
    localStorage.setItem(legacy('canvases:v1'), 'old');
    expect(migrateLegacyStorage()).toBe(0);
    expect(localStorage.getItem(current('canvases:v1'))).toBe('new');
    // The stale copy is still cleared, so it cannot come back later.
    expect(localStorage.getItem(legacy('canvases:v1'))).toBeNull();
  });

  it('preserves an empty-string value rather than treating it as absent', () => {
    localStorage.setItem(legacy('theme:v1'), '');
    migrateLegacyStorage();
    expect(localStorage.getItem(current('theme:v1'))).toBe('');
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => migrateLegacyStorage()).not.toThrow();
  });
});

describe('migration end to end', () => {
  it('a pre-rename library survives the rename', () => {
    // Build real data, then rewrite its keys to the legacy names to stand in
    // for a user who last opened the app before it was renamed.
    signIn({ email: 'alice@example.com', name: 'Alice' });
    createCanvas({ ownerEmail: 'alice@example.com', title: 'Cold War' });

    for (const k of ['users:v1', 'session:v1', 'canvases:v1']) {
      const value = localStorage.getItem(current(k));
      localStorage.setItem(legacy(k), value);
      localStorage.removeItem(current(k));
    }
    // Precondition: without the migration the app looks freshly installed.
    expect(getCurrentUser()).toBeNull();
    expect(canvasesOwnedBy('alice@example.com')).toEqual([]);

    migrateLegacyStorage();

    expect(getCurrentUser()).toMatchObject({ email: 'alice@example.com', name: 'Alice' });
    expect(canvasesOwnedBy('alice@example.com').map((c) => c.title)).toEqual(['Cold War']);
  });
});
