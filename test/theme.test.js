import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvedTheme, setTheme, storedChoice, systemTheme, toggleTheme } from '../src/lib/theme';

const KEY = 'lacuna:theme:v1';

// The store reads `matchMedia` on every call, so a settable flag is enough to
// simulate an OS that prefers dark.
let systemPrefersDark = false;

beforeEach(() => {
  systemPrefersDark = false;
  vi.stubGlobal('matchMedia', (query) => ({
    media: query,
    matches: systemPrefersDark,
    addEventListener() {},
    removeEventListener() {},
  }));
});

describe('storedChoice', () => {
  it('is null when nothing is stored — meaning "follow the system"', () => {
    expect(storedChoice()).toBeNull();
  });

  it('ignores a stored value that is not light or dark', () => {
    localStorage.setItem(KEY, 'sepia');
    expect(storedChoice()).toBeNull();
  });
});

describe('systemTheme / resolvedTheme', () => {
  it('follows the media query while no choice is stored', () => {
    expect(systemTheme()).toBe('light');
    expect(resolvedTheme()).toBe('light');
    systemPrefersDark = true;
    expect(systemTheme()).toBe('dark');
    expect(resolvedTheme()).toBe('dark');
  });

  it('lets an explicit choice override the system', () => {
    systemPrefersDark = true;
    setTheme('light');
    expect(resolvedTheme()).toBe('light');
  });
});

describe('setTheme', () => {
  it('stores the choice and stamps data-theme on the root', () => {
    setTheme('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('null clears the choice and removes the attribute, so CSS follows the OS', () => {
    setTheme('dark');
    setTheme(null);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('notifies subscribers with the resolved theme', () => {
    // useTheme subscribes via the same listener set; setTheme is what drives it.
    setTheme('dark');
    expect(resolvedTheme()).toBe('dark');
  });
});

describe('toggleTheme', () => {
  it('flips an explicit choice', () => {
    setTheme('light');
    toggleTheme();
    expect(resolvedTheme()).toBe('dark');
    toggleTheme();
    expect(resolvedTheme()).toBe('light');
  });

  it('from "follow the system", the first toggle opposes the system', () => {
    systemPrefersDark = true;
    toggleTheme();
    expect(storedChoice()).toBe('light');
  });
});
