import { useEffect, useState } from 'react';

// Theme is stored as an explicit 'light' | 'dark' choice, or absent to mean
// "follow the system". The pre-paint script in index.html reads the same key.
const KEY = 'lacuna:theme:v1';

const listeners = new Set();

function media() {
  return window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
}

export function storedChoice() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

export function systemTheme() {
  return media()?.matches ? 'dark' : 'light';
}

export function resolvedTheme() {
  return storedChoice() ?? systemTheme();
}

function apply(theme) {
  const root = document.documentElement;
  // Absent attribute = follow the media query (see index.css).
  if (storedChoice()) root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function notify() {
  const theme = resolvedTheme();
  apply(theme);
  for (const fn of listeners) fn(theme);
}

export function setTheme(choice) {
  try {
    if (choice === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage unavailable — the change still applies for this page view.
  }
  const root = document.documentElement;
  if (choice) root.dataset.theme = choice;
  else delete root.dataset.theme;
  notify();
}

export function toggleTheme() {
  setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
}

// Follow the OS while the user hasn't made an explicit choice.
media()?.addEventListener?.('change', () => {
  if (!storedChoice()) notify();
});

export function useTheme() {
  const [theme, setThemeState] = useState(() => resolvedTheme());

  useEffect(() => {
    const fn = (next) => setThemeState(next);
    listeners.add(fn);
    // Re-sync in case something changed between render and effect.
    setThemeState(resolvedTheme());
    return () => listeners.delete(fn);
  }, []);

  return theme;
}
