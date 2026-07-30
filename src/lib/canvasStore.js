import { readJSON, writeJSON } from './storage';
import { normalizeEmail } from './auth';

const CANVASES_KEY = 'historychart:canvases:v1';

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

export function createCanvas({ ownerEmail, title = 'Untitled canvas', nodes = [], edges = [] }) {
  const now = Date.now();
  const canvas = {
    id: crypto.randomUUID(),
    title,
    ownerEmail: normalizeEmail(ownerEmail),
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

export function unshareCanvas(id, email) {
  const recipient = normalizeEmail(email);
  const canvas = getCanvas(id);
  if (!canvas) return;
  updateCanvas(id, {
    sharedWith: (canvas.sharedWith ?? []).filter((e) => e !== recipient),
  });
}
