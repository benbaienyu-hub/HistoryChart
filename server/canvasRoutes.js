// Canvases and who can reach them.
//
// Sharing is a grant row keyed by *email*, not by user id, which is what makes it
// possible to share with someone before they have signed up: the invitation is
// waiting the moment they register with that address. Keying on a user id would
// mean the recipient has to exist first, which is the wrong order for an invite.

import { randomUUID } from 'node:crypto';
import { findUserById, normalizeEmail, isValidEmail } from './accounts.js';
import { mutate, readDb } from './store.js';
import { uniqueTitle } from '../src/lib/titles.js';
import { readBinaryBody, readJsonBody, send } from './http.js';
import {
  ALLOWED_TYPES,
  MAX_IMAGE_BYTES,
  deleteImagesForCanvas,
  findImage,
  imageTypeProblem,
  readImageBytes,
  saveImage,
  deleteImage as removeImage,
} from './images.js';

export const ROLES = ['edit', 'view'];

function grantsFor(canvasId) {
  return readDb()
    .grants.filter((g) => g.canvasId === canvasId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// 'owner' can do anything, 'edit' can change the content, 'view' can only read.
// Returns null when the user has no business seeing the canvas at all.
export function accessFor(canvas, user) {
  if (!canvas || !user) return null;
  if (canvas.ownerId === user.id) return 'owner';
  const grant = grantsFor(canvas.id).find((g) => g.email === user.email);
  return grant ? grant.role : null;
}

// The client-facing shape. Deliberately not the stored row: internal ids stay in,
// the owner's email comes out, and `role` tells the UI what to allow.
function serialize(canvas, user) {
  const grants = grantsFor(canvas.id);
  return {
    id: canvas.id,
    title: canvas.title,
    nodes: canvas.nodes,
    edges: canvas.edges,
    lastScore: canvas.lastScore ?? null,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    ownerEmail: findUserById(canvas.ownerId)?.email ?? '',
    sharedWith: grants.map((g) => g.email),
    grants: grants.map((g) => ({ email: g.email, role: g.role })),
    role: accessFor(canvas, user),
  };
}

function byId(id) {
  return readDb().canvases.find((c) => c.id === id) ?? null;
}

function titlesOwnedBy(ownerId, exceptId = null) {
  return readDb()
    .canvases.filter((c) => c.ownerId === ownerId && c.id !== exceptId)
    .map((c) => c.title);
}

const asArray = (value) => (Array.isArray(value) ? value : []);

export function handleList(req, res, user) {
  const db = readDb();
  const recent = (a, b) => b.updatedAt - a.updatedAt;

  const owned = db.canvases.filter((c) => c.ownerId === user.id).sort(recent);
  const sharedIds = new Set(
    db.grants.filter((g) => g.email === user.email).map((g) => g.canvasId)
  );
  const shared = db.canvases
    .filter((c) => sharedIds.has(c.id) && c.ownerId !== user.id)
    .sort(recent);

  return send(res, 200, {
    owned: owned.map((c) => serialize(c, user)),
    shared: shared.map((c) => serialize(c, user)),
  });
}

export async function handleCreate(req, res, user) {
  const body = await readJsonBody(req);
  const now = Date.now();
  const canvas = {
    id: randomUUID(),
    ownerId: user.id,
    title: uniqueTitle(body.title, titlesOwnedBy(user.id)),
    nodes: asArray(body.nodes),
    edges: asArray(body.edges),
    lastScore: null,
    createdAt: now,
    updatedAt: now,
  };
  mutate((db) => db.canvases.push(canvas));
  return send(res, 201, { canvas: serialize(canvas, user) });
}

export function handleGet(req, res, user, { id }) {
  const canvas = byId(id);
  const role = accessFor(canvas, user);
  // 404 rather than 403 for a canvas you cannot reach: "it exists but is not
  // yours" is information about someone else's library.
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  return send(res, 200, { canvas: serialize(canvas, user) });
}

export async function handleUpdate(req, res, user, { id }) {
  const canvas = byId(id);
  const role = accessFor(canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  if (role === 'view') {
    return send(res, 403, { error: 'You have view-only access to this canvas.' });
  }

  const body = await readJsonBody(req);
  const patch = { updatedAt: Date.now() };
  if (body.nodes !== undefined) patch.nodes = asArray(body.nodes);
  if (body.edges !== undefined) patch.edges = asArray(body.edges);
  if (body.lastScore !== undefined) patch.lastScore = body.lastScore;
  if (body.title !== undefined) {
    // Uniqueness is per owner, and it is the owner's namespace even when an
    // editor is the one renaming.
    patch.title = uniqueTitle(body.title, titlesOwnedBy(canvas.ownerId, canvas.id));
  }

  const updated = mutate((db) => {
    const row = db.canvases.find((c) => c.id === id);
    Object.assign(row, patch);
    return row;
  });
  return send(res, 200, { canvas: serialize(updated, user) });
}

export function handleDelete(req, res, user, { id }) {
  const canvas = byId(id);
  const role = accessFor(canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  // An editor can change a canvas but not destroy it. Deleting other people's
  // work is not something "can edit" should imply.
  if (role !== 'owner') {
    return send(res, 403, { error: 'Only the owner can delete this canvas.' });
  }

  mutate((db) => {
    db.canvases = db.canvases.filter((c) => c.id !== id);
    db.grants = db.grants.filter((g) => g.canvasId !== id);
  });
  // Otherwise the pictures outlive the canvas that referenced them, and nothing
  // will ever ask for them again. Same for everyone's review schedules.
  deleteImagesForCanvas(id);
  mutate((db) => {
    db.reviews = (db.reviews ?? []).filter((r) => r.canvasId !== id);
  });
  return send(res, 200, {});
}

export async function handleShare(req, res, user, { id }) {
  const canvas = byId(id);
  const role = accessFor(canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  if (role !== 'owner') {
    return send(res, 403, { error: 'Only the owner can share this canvas.' });
  }

  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  const grantRole = ROLES.includes(body.role) ? body.role : 'edit';

  if (!isValidEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
  if (email === user.email) return send(res, 400, { error: 'That’s your own account.' });

  const existing = grantsFor(id).find((g) => g.email === email);
  if (existing && existing.role === grantRole) {
    return send(res, 409, { error: 'Already shared with that address.' });
  }

  mutate((db) => {
    if (existing) {
      // Re-sharing with a different role is a change of access, not an error.
      db.grants.find((g) => g.canvasId === id && g.email === email).role = grantRole;
    } else {
      db.grants.push({
        canvasId: id,
        email,
        role: grantRole,
        invitedBy: user.email,
        createdAt: Date.now(),
      });
    }
  });

  const registered = readDb().users.some((u) => u.email === email);
  return send(res, 200, {
    canvas: serialize(byId(id), user),
    // The UI says something different depending on this: an invite to an address
    // with no account yet is still valid, and the recipient needs telling to sign
    // up with that exact address.
    recipientHasAccount: registered,
  });
}

export async function handleUnshare(req, res, user, { id }) {
  const canvas = byId(id);
  const role = accessFor(canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  if (role !== 'owner') {
    return send(res, 403, { error: 'Only the owner can change sharing.' });
  }

  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  mutate((db) => {
    db.grants = db.grants.filter((g) => !(g.canvasId === id && g.email === email));
  });
  return send(res, 200, { canvas: serialize(byId(id), user) });
}

// --- images ----------------------------------------------------------------

// The client percent-encodes the filename, because a header may only carry ASCII
// and people do put emoji in filenames.
function decodeName(raw) {
  try {
    return decodeURIComponent(String(raw ?? ''));
  } catch {
    return String(raw ?? '');
  }
}

// Uploaded against a canvas, so permission to add a picture is the same as
// permission to edit the block it goes in.
export async function handleImageUpload(req, res, user, { id }) {
  const canvas = byId(id);
  const role = accessFor(canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  if (role === 'view') {
    return send(res, 403, { error: 'You have view-only access to this canvas.' });
  }

  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  const problem = imageTypeProblem(type);
  if (problem) return send(res, 415, { error: problem });

  const bytes = await readBinaryBody(req, MAX_IMAGE_BYTES);
  if (bytes.length === 0) return send(res, 400, { error: 'That file was empty.' });

  const image = saveImage({
    canvasId: id,
    ownerId: user.id,
    type,
    name: decodeName(req.headers['x-image-name']),
    bytes,
  });
  return send(res, 201, { image: { id: image.id, name: image.name, url: `/api/images/${image.id}` } });
}

// Serving is gated the same way the canvas is: an unguessable URL is not the same
// as a permission check, and someone removed from a canvas should lose its pictures
// too.
export function handleImageGet(req, res, user, { id }) {
  const image = findImage(id);
  if (!image) return send(res, 404, { error: 'Image not found.' });
  if (!accessFor(byId(image.canvasId), user)) {
    return send(res, 404, { error: 'Image not found.' });
  }

  let bytes;
  try {
    bytes = readImageBytes(image);
  } catch {
    return send(res, 404, { error: 'That image is no longer on disk.' });
  }

  res.statusCode = 200;
  res.setHeader('content-type', image.type);
  // nosniff so the browser cannot be talked into treating the bytes as something
  // executable, and a locked-down CSP in case it is opened as a document rather
  // than embedded.
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "default-src 'none'; sandbox");
  res.setHeader('content-disposition', 'inline');
  // Immutable: the id is unique per upload, so the bytes behind it never change.
  res.setHeader('cache-control', 'private, max-age=31536000, immutable');
  res.end(bytes);
}

export function handleImageDelete(req, res, user, { id }) {
  const image = findImage(id);
  if (!image) return send(res, 404, { error: 'Image not found.' });
  const role = accessFor(byId(image.canvasId), user);
  if (!role || role === 'view') return send(res, 404, { error: 'Image not found.' });
  removeImage(image);
  return send(res, 200, {});
}

export { ALLOWED_TYPES };
