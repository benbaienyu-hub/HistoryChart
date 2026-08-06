import { describe, expect, it, vi } from 'vitest';
import { readJSON, writeJSON } from '../src/lib/storage';
import { categoryColor, categoryLabel, CATEGORIES } from '../src/lib/categories';

describe('readJSON / writeJSON', () => {
  it('round-trips a value', () => {
    writeJSON('k', { a: [1, 2], b: 'x' });
    expect(readJSON('k', null)).toEqual({ a: [1, 2], b: 'x' });
  });

  it('returns the fallback for a missing key', () => {
    expect(readJSON('missing', 'fallback')).toBe('fallback');
  });

  it('returns the fallback for corrupt JSON instead of throwing', () => {
    localStorage.setItem('k', '{not json');
    expect(readJSON('k', [])).toEqual([]);
  });

  it('distinguishes a stored null from a missing key', () => {
    writeJSON('k', null);
    // 'null' is falsy-ish as a string but parses fine, so the fallback is not used.
    expect(readJSON('k', 'fallback')).toBeNull();
  });

  it('swallows a write failure (quota exceeded / storage disabled)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => writeJSON('k', { a: 1 })).not.toThrow();
  });

  it('swallows a read failure', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(readJSON('k', 'fallback')).toBe('fallback');
  });
});

describe('categories', () => {
  it('every category has a distinct key and a hex colour', () => {
    const keys = CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CATEGORIES) expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('resolves a known key', () => {
    expect(categoryLabel('person')).toBe('Person');
    expect(categoryColor('person')).toBe('#0071e3');
  });

  it('falls back to "none" for an unknown or missing key', () => {
    const none = CATEGORIES.find((c) => c.key === 'none');
    for (const key of ['nope', undefined, null]) {
      expect(categoryColor(key)).toBe(none.color);
      expect(categoryLabel(key)).toBe(none.label);
    }
  });
});
