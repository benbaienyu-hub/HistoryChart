// The shape of the stored document, and the one rule about reading it.
//
// Its own module so both backends can depend on it without depending on each
// other or on store.js, which imports them.

export const EMPTY = {
  version: 1,
  users: [],
  sessions: [],
  canvases: [],
  grants: [],
  images: [],
  // Spaced-repetition state, one row per user per block — see reviewRoutes.js.
  reviews: [],
  // Each account's own AI credential, encrypted — see aiKeys.js.
  aiKeys: [],
};

// Merged over EMPTY on every read, so a document written by an older version of
// the app is still readable and a newly added collection doesn't have to be
// backfilled before the code that uses it can run.
export function withDefaults(doc) {
  return { ...structuredClone(EMPTY), ...(doc ?? {}) };
}
