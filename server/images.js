// Image uploads.
//
// Images are files on disk with a row in the store, not data URLs inside the
// canvas. A base64 photo in `nodes` would be re-sent on every debounced save,
// re-written into the whole data file each time, and would blow past the request
// limit after two or three pictures.

import { randomUUID } from 'node:crypto';
import { mutate, readDb } from './store.js';
import { fileStorage } from './fileStorage.js';

// SVG is deliberately absent. An SVG can contain script, and while it cannot run
// inside an <img>, it would run for anyone who opened the file's URL directly in a
// tab — a stored-XSS hole handed to us by an "images" feature. The raster formats
// carry no such risk.
export const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// The storage key. Kept on the row rather than recomputed, so a row written by an
// older version — or under a different backend — is still findable.
function keyFor(image) {
  return image.key ?? `${image.id}.${ALLOWED_TYPES[image.type]}`;
}

export function imageTypeProblem(type) {
  if (!type) return 'That file had no type — try a PNG or JPEG.';
  if (!ALLOWED_TYPES[type]) {
    return `${type} isn’t supported. Use a PNG, JPEG, WebP, or GIF.`;
  }
  return null;
}

export async function saveImage({ canvasId, ownerId, type, name, bytes }) {
  const id = randomUUID();
  const image = {
    id,
    canvasId,
    ownerId,
    type,
    name: String(name ?? '').slice(0, 120) || 'image',
    size: bytes.length,
    createdAt: Date.now(),
    key: `${id}.${ALLOWED_TYPES[type]}`,
  };

  // Bytes first, row second. A file with no row is orphaned storage; a row with no
  // file is a broken picture in somebody's canvas, which is the worse of the two.
  const stored = await fileStorage().put(image.key, bytes, type);
  if (stored.url) image.url = stored.url;

  await mutate((db) => {
    db.images ??= [];
    db.images.push(image);
  });
  return image;
}

export async function findImage(id) {
  const db = await readDb();
  return (db.images ?? []).find((i) => i.id === id) ?? null;
}

export function readImageBytes(image) {
  return fileStorage().get({ ...image, key: keyFor(image) });
}

export async function deleteImage(image) {
  // The row goes first: an image the app cannot find is a smaller problem than a
  // row pointing at bytes that no longer exist.
  await mutate((db) => {
    db.images = (db.images ?? []).filter((i) => i.id !== image.id);
  });
  await fileStorage()
    .remove({ ...image, key: keyFor(image) })
    // The row is already gone, so failing here would leave the caller thinking the
    // delete failed when the only casualty is some unreferenced bytes.
    .catch((error) => console.error(`[images] could not remove ${keyFor(image)}:`, error.message));
}

// Called when a canvas is deleted, so its pictures don't sit in storage forever.
export async function deleteImagesForCanvas(canvasId) {
  const db = await readDb();
  for (const image of (db.images ?? []).filter((i) => i.canvasId === canvasId)) {
    await deleteImage(image);
  }
}
