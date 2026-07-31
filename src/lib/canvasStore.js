import { readJSON, writeJSON } from './storage';
import { normalizeEmail } from './auth';

const CANVASES_KEY = 'lacuna:canvases:v1';
const LAST_OPEN_KEY = 'lacuna:lastOpen:v1';

function all() {
  return readJSON(CANVASES_KEY, []);
}

function persist(canvases) {
  writeJSON(CANVASES_KEY, canvases);
}

export function canvasesOwnedBy(email) {
  const owner = normalizeEmail(email);
  return all()
    .filter((c) => c.ownerEmail === owner)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function canvasesSharedWith(email) {
  const recipient = normalizeEmail(email);
  return all()
    .filter((c) => c.ownerEmail !== recipient && (c.sharedWith ?? []).includes(recipient))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCanvas(id) {
  return all().find((c) => c.id === id) ?? null;
}

export const DEFAULT_TITLE = 'Untitled canvas';

// Two canvases called "Untitled canvas" are indistinguishable in the library, and
// the library is how you find your work. So a colliding title gets a counter:
// the second is "Untitled canvas (1)", the third "(2)".
//
// A title that already ends in a counter is renumbered rather than stacked —
// duplicating "Notes (2)" gives "Notes (3)", not "Notes (2) (1)". Comparison is
// case-insensitive: "notes" and "Notes" are the same name to a person reading a
// list, whatever the string comparison says.
const COUNTER = /\s\((\d+)\)$/;

export function uniqueTitle(desired, taken) {
  const wanted = String(desired ?? '').trim() || DEFAULT_TITLE;
  const used = new Set((taken ?? []).map((t) => String(t ?? '').trim().toLowerCase()));
  if (!used.has(wanted.toLowerCase())) return wanted;

  const base = wanted.replace(COUNTER, '');
  for (let n = 1; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

function titlesOwnedBy(owner, exceptId = null) {
  return all()
    .filter((c) => c.ownerEmail === owner && c.id !== exceptId)
    .map((c) => c.title);
}

// Renaming goes through the same rule, so the invariant holds however a title
// arrives — otherwise you could rename your way back into two identical names.
export function renameCanvas(id, title) {
  const canvas = getCanvas(id);
  if (!canvas) return null;
  return updateCanvas(id, {
    title: uniqueTitle(title, titlesOwnedBy(canvas.ownerEmail, id)),
  });
}

export function createCanvas({ ownerEmail, title = DEFAULT_TITLE, nodes = [], edges = [] }) {
  const now = Date.now();
  const owner = normalizeEmail(ownerEmail);
  const canvas = {
    id: crypto.randomUUID(),
    title: uniqueTitle(title, titlesOwnedBy(owner)),
    ownerEmail: owner,
    sharedWith: [],
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };
  persist([...all(), canvas]);
  return canvas;
}

export function updateCanvas(id, patch) {
  const canvases = all();
  const next = canvases.map((c) =>
    c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c
  );
  persist(next);
  return next.find((c) => c.id === id) ?? null;
}

export function deleteCanvas(id) {
  persist(all().filter((c) => c.id !== id));
}

export function shareCanvas(id, email) {
  const recipient = normalizeEmail(email);
  const canvas = getCanvas(id);
  if (!canvas) return { ok: false, reason: 'not-found' };
  if (recipient === canvas.ownerEmail) return { ok: false, reason: 'self' };
  if ((canvas.sharedWith ?? []).includes(recipient)) {
    return { ok: false, reason: 'already-shared' };
  }
  updateCanvas(id, { sharedWith: [...(canvas.sharedWith ?? []), recipient] });
  return { ok: true };
}

// Remembering which canvas was open (per user) so a reload doesn't dump you
// back on the library. Stored separately from the canvases themselves so a
// stale pointer can never corrupt canvas data.
export function rememberOpenCanvas(email, canvasId) {
  const map = readJSON(LAST_OPEN_KEY, {});
  if (canvasId) map[normalizeEmail(email)] = canvasId;
  else delete map[normalizeEmail(email)];
  writeJSON(LAST_OPEN_KEY, map);
}

// Returns the remembered id only if that canvas still exists and this user can
// still reach it — it may have been deleted, or un-shared, since.
export function restorableCanvasId(email) {
  const recipient = normalizeEmail(email);
  const id = readJSON(LAST_OPEN_KEY, {})[recipient];
  if (!id) return null;

  const canvas = getCanvas(id);
  if (!canvas) return null;

  const reachable =
    canvas.ownerEmail === recipient || (canvas.sharedWith ?? []).includes(recipient);
  return reachable ? id : null;
}

export function unshareCanvas(id, email) {
  const recipient = normalizeEmail(email);
  const canvas = getCanvas(id);
  if (!canvas) return;
  updateCanvas(id, {
    sharedWith: (canvas.sharedWith ?? []).filter((e) => e !== recipient),
  });
}
