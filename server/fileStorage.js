// Where uploaded image bytes live: the disk next to the data file, or Vercel Blob
// when a token for it is present.
//
// Same reasoning as the document store. A serverless platform has no writable
// disk, so `writeFileSync` there either throws or writes to a /tmp that the next
// request cannot see. Blob storage is the object store that platform provides.
//
// Both are addressed by an opaque key we choose, and the bytes are always served
// back through /api/images/:id so the permission check still runs. The Blob URL is
// never handed to the browser: a public-but-unguessable URL would be a way to read
// somebody's picture without being signed in, and this app's images are private
// study material.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataFilePath } from './store.js';

const DEFAULT_DIR = fileURLToPath(new URL('../.data/uploads', import.meta.url));

export function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
}

let storage = null;

export function fileStorage() {
  storage ??= blobToken() ? createBlobStorage(blobToken()) : createDiskStorage();
  return storage;
}

export function resetFileStorageForTests() {
  storage = null;
}

// --- disk ------------------------------------------------------------------

function createDiskStorage() {
  // Next to the data file when there is one, so a local checkout keeps everything
  // under .data/. With a database backing the document there is no such file, and
  // the uploads still have to go somewhere — where the document lives is not the
  // same question as where the bytes live.
  const dir = () => {
    const explicit = process.env.LACUNA_UPLOADS?.trim();
    if (explicit) return explicit;
    const file = dataFilePath();
    return file ? join(dirname(file), 'uploads') : DEFAULT_DIR;
  };

  return {
    kind: 'disk',

    async put(key, bytes) {
      try {
        mkdirSync(dir(), { recursive: true });
        writeFileSync(join(dir(), key), bytes);
      } catch (cause) {
        // A read-only filesystem is the signature of a serverless deployment with
        // no blob store attached. "EROFS" on its own tells the person nothing about
        // what to do, and the picture is lost either way — so say what is missing.
        if (cause.code === 'EROFS' || cause.code === 'EACCES' || process.env.VERCEL) {
          const error = new Error(
            'This deployment has nowhere to keep uploaded images. Add a Blob store and set ' +
              'BLOB_READ_WRITE_TOKEN, or run somewhere with a writable disk.'
          );
          error.status = 503;
          error.cause = cause;
          throw error;
        }
        throw cause;
      }
      return { key };
    },

    async get({ key }) {
      return readFileSync(join(dir(), key));
    },

    async remove({ key }) {
      rmSync(join(dir(), key), { force: true });
    },

    describe() {
      return `files in ${dir()}`;
    },
  };
}

// --- Vercel Blob -----------------------------------------------------------

function createBlobStorage(token) {
  // Imported where it is used so a local checkout with no Blob token never loads
  // the SDK at all.
  const load = () => import('@vercel/blob');

  // A blob store is created as either private or public and cannot be changed
  // afterwards, so this has to match whichever the store is. Private is the right
  // choice — these are somebody's study notes, and a private blob cannot be read
  // without the token even by someone holding the URL — but a store created public
  // still has to work.
  //
  // Rather than adding a setting nobody would know to change, the access level is
  // learned: try the preferred one, and if the store disagrees, remember what it
  // wanted. Same approach as the response-format tiers in knowledgeRoutes.js.
  let access = process.env.LACUNA_BLOB_ACCESS?.trim() === 'public' ? 'public' : 'private';

  function mismatched(error) {
    // The API rejects an access level the store does not allow. Matching on the
    // message is unpleasant, but the SDK gives no code for it, and the fallback is
    // one retry rather than a wrong answer.
    const message = String(error?.message ?? '').toLowerCase();
    return message.includes('access') && (message.includes('store') || message.includes('allow'));
  }

  async function upload(key, bytes, contentType, level) {
    const { put } = await load();
    return put(`lacuna/${key}`, bytes, {
      token,
      access: level,
      contentType,
      // Our key is already unique, and a random suffix would mean the stored URL
      // is the only way to find the object again.
      addRandomSuffix: false,
    });
  }

  return {
    kind: 'blob',

    async put(key, bytes, contentType) {
      let result;
      try {
        result = await upload(key, bytes, contentType, access);
      } catch (error) {
        if (!mismatched(error)) throw error;
        const other = access === 'private' ? 'public' : 'private';
        result = await upload(key, bytes, contentType, other);
        console.log(`[images] this blob store is ${other}; using that from now on.`);
        access = other;
      }
      // `access` is recorded per image: a store's level cannot change, but a
      // database can outlive one store, and a read has to know how to fetch.
      return { key, url: result.url, access };
    },

    async get(image) {
      const { get } = await load();
      const result = await get(image.url ?? `lacuna/${image.key}`, {
        token,
        access: image.access ?? access,
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error(`Blob storage had nothing for ${image.key}`);
      }
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },

    async remove(image) {
      const { del } = await load();
      await del(image.url ?? `lacuna/${image.key}`, { token });
    },

    describe() {
      return `Vercel Blob (${access})`;
    },
  };
}
