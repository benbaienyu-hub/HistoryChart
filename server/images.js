// Image uploads.
//
// Images are files on disk with a row in the store, not data URLs inside the
// canvas. A base64 photo in `nodes` would be re-sent on every debounced save,
// re-written into the whole data file each time, and would blow past the request
// limit after two or three pictures.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mutate, readDb, dataFilePath } from './store.js';

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

function uploadDir() {
  return join(dirname(dataFilePath()), 'uploads');
}

function pathFor(image) {
  return join(uploadDir(), `${image.id}.${ALLOWED_TYPES[image.type]}`);
}

export function imageTypeProblem(type) {
  if (!type) return 'That file had no type — try a PNG or JPEG.';
  if (!ALLOWED_TYPES[type]) {
    return `${type} isn’t supported. Use a PNG, JPEG, WebP, or GIF.`;
  }
  return null;
}

export function saveImage({ canvasId, ownerId, type, name, bytes }) {
  const image = {
    id: randomUUID(),
    canvasId,
    ownerId,
    type,
    name: String(name ?? '').slice(0, 120) || 'image',
    size: bytes.length,
    createdAt: Date.now(),
  };
  mkdirSync(uploadDir(), { recursive: true });
  writeFileSync(pathFor(image), bytes);
  mutate((db) => {
    db.images ??= [];
    db.images.push(image);
  });
  return image;
}

export function findImage(id) {
  return (readDb().images ?? []).find((i) => i.id === id) ?? null;
}

export function readImageBytes(image) {
  return readFileSync(pathFor(image));
}

export function deleteImage(image) {
  // The row goes first: an image the app cannot find is a smaller problem than a
  // row pointing at a file that no longer exists.
  mutate((db) => {
    db.images = (db.images ?? []).filter((i) => i.id !== image.id);
  });
  rmSync(pathFor(image), { force: true });
}

// Called when a canvas is deleted, so its pictures don't sit on disk forever.
export function deleteImagesForCanvas(canvasId) {
  for (const image of (readDb().images ?? []).filter((i) => i.canvasId === canvasId)) {
    deleteImage(image);
  }
}
