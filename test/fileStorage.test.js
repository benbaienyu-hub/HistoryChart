// @vitest-environment node
// Where image bytes go.
//
// The disk backend is exercised for real. The Blob backend is exercised against a
// stub of the SDK — this sandbox cannot reach Vercel — so what is tested here is
// the logic I wrote: which access level is requested, what happens when the store
// disagrees, and that a read is authenticated rather than a bare fetch of a URL.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blobToken, fileStorage, resetFileStorageForTests } from '../server/fileStorage.js';
import { setDataPathForTests } from '../server/store.js';

let dir;
const BYTES = Buffer.from('not really a png');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-files-'));
  setDataPathForTests(join(dir, 'db.json'));
  resetFileStorageForTests();
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('LACUNA_UPLOADS', '');
  vi.stubEnv('LACUNA_BLOB_ACCESS', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
  resetFileStorageForTests();
});

describe('choosing a backend', () => {
  it('uses the disk when no blob token is present', () => {
    expect(blobToken()).toBeNull();
    expect(fileStorage().kind).toBe('disk');
  });

  it('uses blob storage as soon as a token is', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_TOKEN');
    resetFileStorageForTests();
    expect(fileStorage().kind).toBe('blob');
  });
});

describe('the disk backend', () => {
  it('round-trips bytes and then forgets them', async () => {
    const storage = fileStorage();
    await storage.put('abc.png', BYTES, 'image/png');
    expect(await storage.get({ key: 'abc.png' })).toEqual(BYTES);

    await storage.remove({ key: 'abc.png' });
    await expect(storage.get({ key: 'abc.png' })).rejects.toThrow();
  });

  it('writes next to the data file by default', async () => {
    await fileStorage().put('abc.png', BYTES, 'image/png');
    expect(readFileSync(join(dir, 'uploads', 'abc.png'))).toEqual(BYTES);
  });

  it('honours LACUNA_UPLOADS, for a database with a mounted volume', async () => {
    const elsewhere = join(dir, 'volume');
    vi.stubEnv('LACUNA_UPLOADS', elsewhere);
    resetFileStorageForTests();
    await fileStorage().put('abc.png', BYTES, 'image/png');
    expect(readFileSync(join(elsewhere, 'abc.png'))).toEqual(BYTES);
  });

  it('explains a read-only filesystem instead of leaking an errno', async () => {
    // The serverless case: no disk, and the fix is a blob store.
    const occupied = join(dir, 'occupied');
    writeFileSync(occupied, 'a file where a directory should be');
    vi.stubEnv('LACUNA_UPLOADS', join(occupied, 'uploads'));
    vi.stubEnv('VERCEL', '1');
    resetFileStorageForTests();

    await expect(fileStorage().put('abc.png', BYTES, 'image/png')).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('BLOB_READ_WRITE_TOKEN'),
    });
  });
});

// The SDK is replaced wholesale. These assert the contract this app relies on.
describe('the blob backend', () => {
  const calls = { put: [], get: [], del: [] };
  let rejectAccess = null;

  beforeEach(() => {
    calls.put = [];
    calls.get = [];
    calls.del = [];
    rejectAccess = null;

    vi.doMock('@vercel/blob', () => ({
      put: async (pathname, body, options) => {
        calls.put.push({ pathname, options, size: body.length });
        if (rejectAccess && options.access === rejectAccess) {
          throw new Error('This store does not allow public access for blobs.');
        }
        return { url: `https://blob.example.com/${pathname}` };
      },
      get: async (urlOrPathname, options) => {
        calls.get.push({ urlOrPathname, options });
        return {
          statusCode: 200,
          stream: new Response(BYTES).body,
          headers: new Headers(),
          blob: { contentType: 'image/png', size: BYTES.length },
        };
      },
      del: async (urlOrPathname, options) => {
        calls.del.push({ urlOrPathname, options });
      },
    }));

    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_TOKEN');
    resetFileStorageForTests();
  });

  it('asks for a private blob by default, since these are private notes', async () => {
    const stored = await fileStorage().put('abc.png', BYTES, 'image/png');
    expect(calls.put[0].options.access).toBe('private');
    expect(calls.put[0].options.token).toBe('vercel_blob_rw_TOKEN');
    expect(calls.put[0].pathname).toBe('lacuna/abc.png');
    expect(stored).toMatchObject({ key: 'abc.png', access: 'private' });
  });

  it('does not let the store invent its own filename', async () => {
    // With a random suffix the stored URL becomes the only way to find the object.
    await fileStorage().put('abc.png', BYTES, 'image/png');
    expect(calls.put[0].options.addRandomSuffix).toBe(false);
  });

  it('falls back to public when the store turns out to be public, and remembers', async () => {
    rejectAccess = 'private';
    const storage = fileStorage();

    const first = await storage.put('one.png', BYTES, 'image/png');
    expect(calls.put.map((c) => c.options.access)).toEqual(['private', 'public']);
    expect(first.access).toBe('public');

    // Second upload should not repeat the failed attempt.
    calls.put.length = 0;
    const second = await storage.put('two.png', BYTES, 'image/png');
    expect(calls.put.map((c) => c.options.access)).toEqual(['public']);
    expect(second.access).toBe('public');
  });

  it('can be told the access level outright', async () => {
    vi.stubEnv('LACUNA_BLOB_ACCESS', 'public');
    resetFileStorageForTests();
    await fileStorage().put('abc.png', BYTES, 'image/png');
    expect(calls.put[0].options.access).toBe('public');
  });

  it('passes an unrelated failure straight through rather than retrying', async () => {
    vi.doMock('@vercel/blob', () => ({
      put: async () => {
        throw new Error('Request Entity Too Large');
      },
      get: async () => null,
      del: async () => {},
    }));
    resetFileStorageForTests();
    await expect(fileStorage().put('abc.png', BYTES, 'image/png')).rejects.toThrow(/Too Large/);
  });

  it('reads through the authenticated SDK, not a bare fetch of the URL', async () => {
    // A plain fetch cannot read a private blob, and for a public one it would mean
    // the URL alone is enough — which is what the permission check exists to avoid.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const bytes = await fileStorage().get({
      key: 'abc.png',
      url: 'https://blob.example.com/lacuna/abc.png',
      access: 'private',
    });
    expect(bytes).toEqual(BYTES);
    expect(calls.get[0].options).toMatchObject({ access: 'private', token: 'vercel_blob_rw_TOKEN' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the access level recorded on the image, not today’s setting', async () => {
    // A database can outlive a blob store; an old row knows how it was written.
    await fileStorage().get({ key: 'old.png', url: 'https://blob.example.com/old.png', access: 'public' });
    expect(calls.get[0].options.access).toBe('public');
  });

  it('falls back to the pathname when a row has no URL', async () => {
    await fileStorage().get({ key: 'abc.png' });
    expect(calls.get[0].urlOrPathname).toBe('lacuna/abc.png');
  });

  it('complains rather than returning nothing when the blob is gone', async () => {
    vi.doMock('@vercel/blob', () => ({
      put: async () => ({ url: 'x' }),
      get: async () => null,
      del: async () => {},
    }));
    resetFileStorageForTests();
    await expect(fileStorage().get({ key: 'missing.png' })).rejects.toThrow(/nothing for missing.png/);
  });

  it('deletes by URL, with the token', async () => {
    await fileStorage().remove({ key: 'abc.png', url: 'https://blob.example.com/lacuna/abc.png' });
    expect(calls.del[0]).toMatchObject({
      urlOrPathname: 'https://blob.example.com/lacuna/abc.png',
      options: { token: 'vercel_blob_rw_TOKEN' },
    });
  });
});
