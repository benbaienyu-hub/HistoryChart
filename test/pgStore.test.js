// @vitest-environment node
// The Postgres backend, against a real Postgres.
//
// Skipped unless TEST_POSTGRES_URL points at a database this may create a table in
// and truncate — so a normal `npm test` run doesn't need one. See README, Scripts.
//
// The interesting behaviour here is not "does it save"; it is what happens when two
// requests save at once. A whole-document store gets that wrong by default, and the
// wrong answer is silent data loss, so it is tested rather than assumed.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mutate, readDb, resetStoreForTests, storeKind, usePostgresForTests } from '../server/store.js';
import { createPgStore, redact } from '../server/stores/pgStore.js';

const URL = process.env.TEST_POSTGRES_URL;
const describeIfPg = URL ? describe : describe.skip;

describe('redact', () => {
  it('keeps the password out of a connection string that will be logged', () => {
    expect(redact('postgres://user:hunter2@db.example.com:5432/lacuna')).toBe(
      'postgres://***@db.example.com:5432/lacuna'
    );
    expect(redact('postgres://db.example.com/lacuna')).toBe('postgres://db.example.com/lacuna');
    expect(redact('nonsense')).toBe('invalid connection string');
  });
});

describeIfPg('the Postgres store', () => {
  beforeEach(async () => {
    usePostgresForTests(URL);
    // A clean document per test, through the same interface the app uses.
    await mutate((db) => {
      for (const key of ['users', 'sessions', 'canvases', 'grants', 'images', 'reviews', 'aiKeys']) {
        db[key] = [];
      }
    });
  });

  afterEach(async () => {
    await resetStoreForTests();
  });

  afterAll(async () => {
    await resetStoreForTests();
  });

  it('reports which backend is in use', () => {
    expect(storeKind()).toBe('postgres');
  });

  it('creates its table on first use, and reads back an empty document', async () => {
    const db = await readDb();
    expect(db.users).toEqual([]);
    expect(db.canvases).toEqual([]);
  });

  it('persists a change, and returns what the callback returned', async () => {
    const returned = await mutate((db) => {
      db.users.push({ id: 'u1', email: 'a@b.co' });
      return 'from the callback';
    });
    expect(returned).toBe('from the callback');
    expect((await readDb()).users).toEqual([{ id: 'u1', email: 'a@b.co' }]);
  });

  it('does not hold a stale copy between reads', async () => {
    // The file backend caches the parsed document, which is safe because one
    // process owns the file. Here another instance may have changed it a moment
    // ago, so caching would serve fiction — and then write it back as fact.
    await mutate((db) => db.users.push({ id: 'u1' }));
    const first = await readDb();
    await mutate((db) => db.users.push({ id: 'u2' }));
    const second = await readDb();
    expect(first.users).toHaveLength(1);
    expect(second.users).toHaveLength(2);
  });

  it('keeps both changes when two writes race in one process', async () => {
    await Promise.all([
      mutate((db) => db.users.push({ id: 'from-a' })),
      mutate((db) => db.users.push({ id: 'from-b' })),
    ]);
    const ids = (await readDb()).users.map((u) => u.id).sort();
    expect(ids).toEqual(['from-a', 'from-b']);
  });

  it('keeps every change when many writes race in one process', async () => {
    // Twelve at once starved the optimistic retries when writes weren't queued —
    // two of the twelve gave up. This is that case, kept.
    const writes = Array.from({ length: 12 }, (_, i) =>
      mutate((db) => db.canvases.push({ id: `c${i}` }))
    );
    await Promise.all(writes);
    expect((await readDb()).canvases).toHaveLength(12);
  });

  it('keeps both changes when two separate instances write at once', async () => {
    // The case the version column actually exists for, and the one that happens on
    // a serverless platform: two processes, neither aware of the other's queue.
    // Without the check, the loser would write a document it read before the
    // winner's change and silently revert it.
    const one = createPgStore(URL);
    const two = createPgStore(URL);
    try {
      await Promise.all([
        one.mutate((db) => db.users.push({ id: 'instance-one' })),
        two.mutate((db) => db.users.push({ id: 'instance-two' })),
      ]);
      const ids = (await readDb()).users.map((u) => u.id).sort();
      expect(ids).toEqual(['instance-one', 'instance-two']);
    } finally {
      await one.close();
      await two.close();
    }
  });

  it('keeps every change when eight instances write at once', async () => {
    const stores = Array.from({ length: 8 }, () => createPgStore(URL));
    try {
      await Promise.all(
        stores.map((store, i) => store.mutate((db) => db.canvases.push({ id: `from-${i}` })))
      );
      expect((await readDb()).canvases).toHaveLength(8);
    } finally {
      await Promise.all(stores.map((store) => store.close()));
    }
  });

  it('re-runs the callback against the winner’s document rather than replaying a stale read', async () => {
    // A callback that counts what it finds proves the retry saw the other write,
    // not the document as it was when this mutate started.
    await mutate((db) => db.users.push({ id: 'first' }));
    let seen = [];
    await Promise.all([
      mutate((db) => db.users.push({ id: 'second' })),
      mutate((db) => {
        seen = db.users.map((u) => u.id);
        db.users.push({ id: 'third' });
      }),
    ]);
    const ids = (await readDb()).users.map((u) => u.id);
    expect(ids).toContain('second');
    expect(ids).toContain('third');
    // Whichever order they landed in, the last callback to run saw 'first'.
    expect(seen).toContain('first');
  });

  it('survives a document with a collection the code has not heard of', async () => {
    await mutate((db) => {
      db.somethingFromTheFuture = [{ ok: true }];
    });
    const db = await readDb();
    expect(db.somethingFromTheFuture).toEqual([{ ok: true }]);
    // And the known collections are still all present.
    expect(db.reviews).toEqual([]);
  });

  it('round-trips the awkward parts of real content', async () => {
    const notes = 'Line one\n- Añejo “quoted” — em dash\n\t{"json": true} 日本語 end';
    await mutate((db) => db.canvases.push({ id: 'c1', title: 'Ünicode ✓', notes }));
    const stored = (await readDb()).canvases[0];
    expect(stored.title).toBe('Ünicode ✓');
    expect(stored.notes).toContain('Añejo “quoted” — em dash');
    expect(stored.notes).toContain('日本語');
  });

  it('does not choke on a NUL character in pasted text', async () => {
    // jsonb refuses a NUL outright ("unsupported Unicode escape sequence"), so one
    // stray \u0000 in pasted notes would fail every later save of that canvas — and
    // a document that cannot be written is a canvas that cannot be edited. The
    // store drops it rather than letting one paste wedge an account.
    await mutate((db) => db.canvases.push({ id: 'c1', notes: 'before\u0000after' }));
    expect((await readDb()).canvases[0].notes).toBe('beforeafter');
  });
});
