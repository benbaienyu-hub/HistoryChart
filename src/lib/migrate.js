// The app was called HistoryChart before it was called Lacuna, and every
// storage key carried that name. Renaming the prefix without moving the data
// would silently empty every existing user's library: their canvases, profiles
// and shares would still be on disk, under keys nothing reads any more.
//
// This runs once, before anything reads storage, and is idempotent — it deletes
// the legacy keys as it goes, so the second run finds nothing to do.

export const LEGACY_PREFIX = 'historychart:';
export const PREFIX = 'lacuna:';

export function migrateLegacyStorage() {
  let moved = 0;

  try {
    // Snapshot the key list first: writing to localStorage while iterating it
    // is not safe.
    const legacyKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
    }

    for (const legacyKey of legacyKeys) {
      const nextKey = PREFIX + legacyKey.slice(LEGACY_PREFIX.length);

      // If the new key already holds something, that data is newer than the
      // legacy copy — keep it and discard the old one rather than clobbering.
      if (localStorage.getItem(nextKey) === null) {
        const value = localStorage.getItem(legacyKey);
        if (value !== null) {
          localStorage.setItem(nextKey, value);
          moved += 1;
        }
      }
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // Storage disabled or full. Nothing useful to do; the app still runs, it
    // just starts empty for this session.
  }

  return moved;
}
