// Canvases and who can reach them.
//
// Sharing is a grant row keyed by *email*, not by user id, which is what makes it
// possible to share with someone before they have signed up: the invitation is
// waiting the moment they register with that address. Keying on a user id would
// mean the recipient has to exist first, which is the wrong order for an invite.

import { randomUUID } from 'node:crypto';
import { normalizeEmail, isValidEmail } from './accounts.js';
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

// Every helper here is handed the document rather than reading it. With the
// Postgres backend a read is a query, and a handler that serialized a list of
// canvases would otherwise make one per canvas — plus one per grant lookup.
function grantsFor(db, canvasId) {
  return db.grants
    .filter((g) => g.canvasId === canvasId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// 'owner' can do anything, 'edit' can change the content, 'view' can only read.
// Returns null when the user has no business seeing the canvas at all.
export function accessFor(db, canvas, user) {
  if (!canvas || !user) return null;
  if (canvas.ownerId === user.id) return 'owner';
  const grant = grantsFor(db, canvas.id).find((g) => g.email === user.email);
  return grant ? grant.role : null;
}

// The client-facing shape. Deliberately not the stored row: internal ids stay in,
// the owner's email comes out, and `role` tells the UI what to allow.
function serialize(db, canvas, user) {
  const grants = grantsFor(db, canvas.id);
  return {
    id: canvas.id,
    title: canvas.title,
    nodes: canvas.nodes,
    edges: canvas.edges,
    lastScore: canvas.lastScore ?? null,
    // The last "Find my gaps" result, kept so the library can say how many holes
    // a canvas has without running a model call per canvas, and so the panel
    // still has something to show after a reload. Stored on the canvas rather
    // than per user because a gap is a fact about the notes, not about a reader.
    gaps: Array.isArray(canvas.gaps) ? canvas.gaps : null,
    gapsScannedAt: canvas.gapsScannedAt ?? null,
    gapsSignature: canvas.gapsSignature ?? null,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    ownerEmail: db.users.find((u) => u.id === canvas.ownerId)?.email ?? '',
    sharedWith: grants.map((g) => g.email),
    grants: grants.map((g) => ({ email: g.email, role: g.role })),
    role: accessFor(db, canvas, user),
  };
}

function byId(db, id) {
  return db.canvases.find((c) => c.id === id) ?? null;
}

function titlesOwnedBy(db, ownerId, exceptId = null) {
  return db.canvases
    .filter((c) => c.ownerId === ownerId && c.id !== exceptId)
    .map((c) => c.title);
}

const asArray = (value) => (Array.isArray(value) ? value : []);

export async function handleList(req, res, user) {
  const db = await readDb();
  const recent = (a, b) => b.updatedAt - a.updatedAt;

  const owned = db.canvases.filter((c) => c.ownerId === user.id).sort(recent);
  const sharedIds = new Set(
    db.grants.filter((g) => g.email === user.email).map((g) => g.canvasId)
  );
  const shared = db.canvases
    .filter((c) => sharedIds.has(c.id) && c.ownerId !== user.id)
    .sort(recent);

  return send(res, 200, {
    owned: owned.map((c) => serialize(db, c, user)),
    shared: shared.map((c) => serialize(db, c, user)),
  });
}

export async function handleCreate(req, res, user) {
  const body = await readJsonBody(req);
  const db = await readDb();
  const now = Date.now();
  const canvas = {
    id: randomUUID(),
    ownerId: user.id,
    title: uniqueTitle(body.title, titlesOwnedBy(db, user.id)),
    nodes: asArray(body.nodes),
    edges: asArray(body.edges),
    lastScore: null,
    createdAt: now,
    updatedAt: now,
  };
  await mutate((doc) => doc.canvases.push(canvas));
  // Serialized against the document as it was read: a brand-new canvas has no
  // grants, and its owner is the caller.
  return send(res, 201, { canvas: serialize(db, canvas, user) });
}

export async function handleGet(req, res, user, { id }) {
  const db = await readDb();
  const canvas = byId(db, id);
  const role = accessFor(db, canvas, user);
  // 404 rather than 403 for a canvas you cannot reach: "it exists but is not
  // yours" is information about someone else's library.
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  return send(res, 200, { canvas: serialize(db, canvas, user) });
}

export async function handleUpdate(req, res, user, { id }) {
  const db = await readDb();
  const canvas = byId(db, id);
  const role = accessFor(db, canvas, user);
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
    patch.title = uniqueTitle(body.title, titlesOwnedBy(db, canvas.ownerId, canvas.id));
  }

  const updated = await mutate((doc) => {
    const row = doc.canvases.find((c) => c.id === id);
    // Gone between the read and the write: whoever deleted it wins, and there is
    // nothing left to patch.
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  });
  if (!updated) return send(res, 404, { error: 'Canvas not found.' });
  // The grants in `db` are still current — this request changed content, not
  // sharing — so it can serialize the new row against the old document.
  return send(res, 200, { canvas: serialize(db, updated, user) });
}

export async function handleDelete(req, res, user, { id }) {
  const db = await readDb();
  const canvas = byId(db, id);
  const role = accessFor(db, canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  // An editor can change a canvas but not destroy it. Deleting other people's
  // work is not something "can edit" should imply.
  if (role !== 'owner') {
    return send(res, 403, { error: 'Only the owner can delete this canvas.' });
  }

  // The pictures go first: once the canvas row is gone, nothing knows which
  // images belonged to it, and they would sit in storage forever.
  await deleteImagesForCanvas(id);
  await mutate((doc) => {
    doc.canvases = doc.canvases.filter((c) => c.id !== id);
    doc.grants = doc.grants.filter((g) => g.canvasId !== id);
    // Everyone's schedules for its blocks go with it.
    doc.reviews = (doc.reviews ?? []).filter((r) => r.canvasId !== id);
  });
  return send(res, 200, {});
}

export async function handleShare(req, res, user, { id }) {
  const db = await readDb();
  const canvas = byId(db, id);
  const role = accessFor(db, canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  if (role !== 'owner') {
    return send(res, 403, { error: 'Only the owner can share this canvas.' });
  }

  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  const grantRole = ROLES.includes(body.role) ? body.role : 'edit';

  if (!isValidEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
  if (email === user.email) return send(res, 400, { error: 'That’s your own account.' });

  const existing = grantsFor(db, id).find((g) => g.email === email);
  if (existing && existing.role === grantRole) {
    return send(res, 409, { error: 'Already shared with that address.' });
  }

  await mutate((doc) => {
    // Re-checked inside the callback rather than reusing `existing`: this may run
    // against a freshly read document in which the grant now exists, and pushing a
    // second row for the same address would double it.
    const already = doc.grants.find((g) => g.canvasId === id && g.email === email);
    if (already) {
      // Re-sharing with a different role is a change of access, not an error.
      already.role = grantRole;
    } else {
      doc.grants.push({
        canvasId: id,
        email,
        role: grantRole,
        invitedBy: user.email,
        createdAt: Date.now(),
      });
    }
  });

  // Re-read: the response carries the grant list, which is exactly what changed.
  const after = await readDb();
  const registered = after.users.some((u) => u.email === email);
  return send(res, 200, {
    canvas: serialize(after, byId(after, id), user),
    // The UI says something different depending on this: an invite to an address
    // with no account yet is still valid, and the recipient needs telling to sign
    // up with that exact address.
    recipientHasAccount: registered,
  });
}

export async function handleUnshare(req, res, user, { id }) {
  const db = await readDb();
  const canvas = byId(db, id);
  const role = accessFor(db, canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  if (role !== 'owner') {
    return send(res, 403, { error: 'Only the owner can change sharing.' });
  }

  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  await mutate((doc) => {
    doc.grants = doc.grants.filter((g) => !(g.canvasId === id && g.email === email));
  });
  const after = await readDb();
  return send(res, 200, { canvas: serialize(after, byId(after, id), user) });
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
  const db = await readDb();
  const canvas = byId(db, id);
  const role = accessFor(db, canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  if (role === 'view') {
    return send(res, 403, { error: 'You have view-only access to this canvas.' });
  }

  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  const problem = imageTypeProblem(type);
  if (problem) return send(res, 415, { error: problem });

  const bytes = await readBinaryBody(req, MAX_IMAGE_BYTES);
  if (bytes.length === 0) return send(res, 400, { error: 'That file was empty.' });

  const image = await saveImage({
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
export async function handleImageGet(req, res, user, { id }) {
  const db = await readDb();
  const image = await findImage(id);
  if (!image) return send(res, 404, { error: 'Image not found.' });
  if (!accessFor(db, byId(db, image.canvasId), user)) {
    return send(res, 404, { error: 'Image not found.' });
  }

  let bytes;
  try {
    bytes = await readImageBytes(image);
  } catch {
    return send(res, 404, { error: 'Those image bytes are no longer in storage.' });
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

export async function handleImageDelete(req, res, user, { id }) {
  const db = await readDb();
  const image = await findImage(id);
  if (!image) return send(res, 404, { error: 'Image not found.' });
  const role = accessFor(db, byId(db, image.canvasId), user);
  if (!role || role === 'view') return send(res, 404, { error: 'Image not found.' });
  await removeImage(image);
  return send(res, 200, {});
}

export { ALLOWED_TYPES };
