// @vitest-environment node
// Drives the real request handler through a real HTTP server, because the parts
// worth testing here are exactly the parts a direct function call skips: cookies,
// status codes, and who is allowed to do what.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleApiRequest } from '../server/api.js';
import { resetThrottleForTests } from '../server/accounts.js';
import { setDataPathForTests } from '../server/store.js';

let server;
let base;
let dir;

beforeAll(async () => {
  server = createServer((req, res) => {
    handleApiRequest(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not an api path');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-api-'));
  setDataPathForTests(join(dir, 'db.json'));
  resetThrottleForTests();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A minimal client that keeps one session cookie, so a test can act as a person
// rather than as a bag of requests.
function client() {
  let cookie = null;
  return {
    get cookie() {
      return cookie;
    },
    async call(method, path, body) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const value of setCookie) {
        const [pair] = value.split(';');
        // Max-Age=0 is the server clearing it.
        cookie = value.includes('Max-Age=0') ? null : pair;
      }
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json, setCookie };
    },
  };
}

async function signedUp(email, password = 'longenough1') {
  const person = client();
  const result = await person.call('POST', '/api/auth/register', { email, password });
  expect(result.status, `register ${email}`).toBe(201);
  return person;
}

describe('registration', () => {
  it('creates an account and signs it in immediately', async () => {
    const ben = client();
    const { status, json, setCookie } = await ben.call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      name: 'Ben',
      password: 'longenough1',
    });
    expect(status).toBe(201);
    expect(json.user).toMatchObject({ email: 'ben@example.com', name: 'Ben' });
    expect(json.user.passwordHash).toBeUndefined();
    expect(setCookie.join()).toContain('lacuna_session=');
  });

  it('sets the session cookie httpOnly and same-site, so script cannot take it', async () => {
    const ben = client();
    const { setCookie } = await ben.call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    expect(setCookie[0]).toContain('HttpOnly');
    expect(setCookie[0]).toContain('SameSite=Lax');
    expect(setCookie[0]).toContain('Path=/');
  });

  it('refuses a duplicate email, and says to sign in instead', async () => {
    await signedUp('ben@example.com');
    const again = client();
    const { status, json } = await again.call('POST', '/api/auth/register', {
      email: 'BEN@example.com',
      password: 'longenough1',
    });
    expect(status).toBe(409);
    expect(json.error).toMatch(/sign in/i);
  });

  it('refuses a bad address or a short password', async () => {
    const person = client();
    expect((await person.call('POST', '/api/auth/register', { email: 'nope', password: 'longenough1' })).status).toBe(400);
    expect((await person.call('POST', '/api/auth/register', { email: 'a@b.co', password: 'short' })).status).toBe(400);
  });
});

describe('signing in', () => {
  it('works with the right password', async () => {
    await signedUp('ben@example.com');
    const fresh = client();
    const { status, json } = await fresh.call('POST', '/api/auth/login', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    expect(status).toBe(200);
    expect(json.user.email).toBe('ben@example.com');
  });

  it('gives the same answer for a wrong password and a missing account', async () => {
    // Otherwise the endpoint tells anyone who asks whether you have an account.
    await signedUp('ben@example.com');
    const fresh = client();
    const wrong = await fresh.call('POST', '/api/auth/login', {
      email: 'ben@example.com',
      password: 'wrongpassword',
    });
    const missing = await fresh.call('POST', '/api/auth/login', {
      email: 'nobody@example.com',
      password: 'wrongpassword',
    });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.json.error).toBe(missing.json.error);
  });

  it('stops answering after repeated failures', async () => {
    await signedUp('ben@example.com');
    const attacker = client();
    for (let i = 0; i < 10; i++) {
      await attacker.call('POST', '/api/auth/login', {
        email: 'ben@example.com',
        password: `guess${i}`,
      });
    }
    const blocked = await attacker.call('POST', '/api/auth/login', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    expect(blocked.status).toBe(429);
  });

  it('reports who is signed in, and nobody when the cookie is gone', async () => {
    const ben = await signedUp('ben@example.com');
    expect((await ben.call('GET', '/api/auth/me')).json.user.email).toBe('ben@example.com');

    await ben.call('POST', '/api/auth/logout');
    expect((await ben.call('GET', '/api/auth/me')).json.user).toBeNull();
  });

  it('a session survives being used from a second request', async () => {
    const ben = await signedUp('ben@example.com');
    expect((await ben.call('GET', '/api/canvases')).status).toBe(200);
    expect((await ben.call('GET', '/api/canvases')).status).toBe(200);
  });
});

describe('canvases require a session', () => {
  it('answers 401 to a stranger', async () => {
    const stranger = client();
    // No body on GET/DELETE — fetch refuses one, and the point is the status.
    for (const [method, path, body] of [
      ['GET', '/api/canvases'],
      ['POST', '/api/canvases', {}],
      ['GET', '/api/canvases/anything'],
      ['PUT', '/api/canvases/anything', {}],
      ['DELETE', '/api/canvases/anything'],
    ]) {
      expect((await stranger.call(method, path, body)).status, `${method} ${path}`).toBe(401);
    }
  });

  it('ignores a forged cookie', async () => {
    const res = await fetch(`${base}/api/canvases`, {
      headers: { cookie: 'lacuna_session=not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });
});

describe('a canvas belongs to its owner', () => {
  it('round-trips through create, list, and read', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {
      title: 'Ethiopia',
      nodes: [{ id: 'n1' }],
    });
    expect(json.canvas).toMatchObject({ title: 'Ethiopia', role: 'owner' });

    const list = await ben.call('GET', '/api/canvases');
    expect(list.json.owned.map((c) => c.title)).toEqual(['Ethiopia']);
    expect(list.json.shared).toEqual([]);

    const read = await ben.call('GET', `/api/canvases/${json.canvas.id}`);
    expect(read.json.canvas.nodes).toEqual([{ id: 'n1' }]);
  });

  it('numbers a colliding title, the same rule as the local store', async () => {
    const ben = await signedUp('ben@example.com');
    await ben.call('POST', '/api/canvases', {});
    const second = await ben.call('POST', '/api/canvases', {});
    expect(second.json.canvas.title).toBe('Untitled canvas (1)');
  });

  it('scopes titles per person — my Rome is not yours', async () => {
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    await ben.call('POST', '/api/canvases', { title: 'Rome' });
    const hers = await ada.call('POST', '/api/canvases', { title: 'Rome' });
    expect(hers.json.canvas.title).toBe('Rome');
  });

  it('hides someone else’s canvas behind a 404, not a 403', async () => {
    // 403 would confirm the canvas exists, which is information about another
    // person's library.
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const { json } = await ben.call('POST', '/api/canvases', { title: 'Private' });

    expect((await ada.call('GET', `/api/canvases/${json.canvas.id}`)).status).toBe(404);
    expect((await ada.call('PUT', `/api/canvases/${json.canvas.id}`, { title: 'Mine now' })).status).toBe(404);
    expect((await ada.call('DELETE', `/api/canvases/${json.canvas.id}`)).status).toBe(404);
  });

  it('deletes only when the owner asks', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    expect((await ben.call('DELETE', `/api/canvases/${json.canvas.id}`)).status).toBe(200);
    expect((await ben.call('GET', '/api/canvases')).json.owned).toEqual([]);
  });
});

describe('sharing', () => {
  it('puts the canvas in the recipient’s library, and lets them edit it', async () => {
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const { json } = await ben.call('POST', '/api/canvases', { title: 'Ethiopia' });
    const id = json.canvas.id;

    const shared = await ben.call('POST', `/api/canvases/${id}/share`, {
      email: 'ada@example.com',
      role: 'edit',
    });
    expect(shared.status).toBe(200);
    expect(shared.json.recipientHasAccount).toBe(true);

    const adasLibrary = await ada.call('GET', '/api/canvases');
    expect(adasLibrary.json.owned).toEqual([]);
    expect(adasLibrary.json.shared.map((c) => c.title)).toEqual(['Ethiopia']);
    expect(adasLibrary.json.shared[0].role).toBe('edit');

    const edit = await ada.call('PUT', `/api/canvases/${id}`, { nodes: [{ id: 'from-ada' }] });
    expect(edit.status).toBe(200);

    // And the owner sees her edit.
    const bensCopy = await ben.call('GET', `/api/canvases/${id}`);
    expect(bensCopy.json.canvas.nodes).toEqual([{ id: 'from-ada' }]);
  });

  it('an invitation can precede the account it is for', async () => {
    // The whole reason grants are keyed by email: you invite someone who has not
    // signed up yet, and it is waiting when they do.
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', { title: 'Ethiopia' });
    const shared = await ben.call('POST', `/api/canvases/${json.canvas.id}/share`, {
      email: 'newcomer@example.com',
    });
    expect(shared.json.recipientHasAccount).toBe(false);

    const newcomer = await signedUp('newcomer@example.com');
    expect((await newcomer.call('GET', '/api/canvases')).json.shared.map((c) => c.title)).toEqual([
      'Ethiopia',
    ]);
  });

  it('a view-only grant can read but not write', async () => {
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const { json } = await ben.call('POST', '/api/canvases', { title: 'Ethiopia' });
    const id = json.canvas.id;
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ada@example.com', role: 'view' });

    expect((await ada.call('GET', `/api/canvases/${id}`)).status).toBe(200);
    const refused = await ada.call('PUT', `/api/canvases/${id}`, { title: 'Changed' });
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatch(/view-only/i);
  });

  it('an editor cannot delete, or re-share, someone else’s canvas', async () => {
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const { json } = await ben.call('POST', '/api/canvases', { title: 'Ethiopia' });
    const id = json.canvas.id;
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ada@example.com', role: 'edit' });

    expect((await ada.call('DELETE', `/api/canvases/${id}`)).status).toBe(403);
    expect(
      (await ada.call('POST', `/api/canvases/${id}/share`, { email: 'cara@example.com' })).status
    ).toBe(403);
  });

  it('refuses to share with yourself, or with a non-address', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const id = json.canvas.id;
    expect((await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ben@example.com' })).status).toBe(400);
    expect((await ben.call('POST', `/api/canvases/${id}/share`, { email: 'nope' })).status).toBe(400);
  });

  it('says so when the address already has the same access', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const id = json.canvas.id;
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ada@example.com', role: 'edit' });
    const again = await ben.call('POST', `/api/canvases/${id}/share`, {
      email: 'ada@example.com',
      role: 'edit',
    });
    expect(again.status).toBe(409);
  });

  it('re-sharing at a different level changes the access instead of erroring', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const id = json.canvas.id;
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ada@example.com', role: 'edit' });
    const changed = await ben.call('POST', `/api/canvases/${id}/share`, {
      email: 'ada@example.com',
      role: 'view',
    });
    expect(changed.status).toBe(200);
    expect(changed.json.canvas.grants).toEqual([{ email: 'ada@example.com', role: 'view' }]);
  });

  it('un-sharing takes it out of their library', async () => {
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const { json } = await ben.call('POST', '/api/canvases', { title: 'Ethiopia' });
    const id = json.canvas.id;
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ada@example.com' });
    await ben.call('POST', `/api/canvases/${id}/unshare`, { email: 'ada@example.com' });

    expect((await ada.call('GET', '/api/canvases')).json.shared).toEqual([]);
    expect((await ada.call('GET', `/api/canvases/${id}`)).status).toBe(404);
  });

  it('deleting a canvas takes its grants with it', async () => {
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    await ben.call('POST', `/api/canvases/${json.canvas.id}/share`, { email: 'ada@example.com' });
    await ben.call('DELETE', `/api/canvases/${json.canvas.id}`);
    expect((await ada.call('GET', '/api/canvases')).json.shared).toEqual([]);
  });
});

describe('the API surface itself', () => {
  it('404s an unknown /api path rather than falling through to the app', async () => {
    // Falling through would hand index.html to a client expecting JSON.
    const { status, json } = await client().call('GET', '/api/nonsense');
    expect(status).toBe(404);
    expect(json.error).toMatch(/No API route/);
  });

  it('rejects the wrong method on a real path', async () => {
    expect((await client().call('DELETE', '/api/auth/login')).status).toBe(404);
  });

  it('reports unparseable JSON as a client error', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('leaves the knowledge routes to their own handler', async () => {
    // They are mounted separately; this router must not answer for them.
    const res = await fetch(`${base}/api/knowledge-status`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('not an api path');
  });
});

// A one-pixel PNG, so the tests exercise real bytes rather than a string that
// happens to be labelled image/png.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

async function upload(person, canvasId, { type = 'image/png', body = PNG, name = 'pixel.png' } = {}) {
  const res = await fetch(`${base}/api/canvases/${canvasId}/images`, {
    method: 'POST',
    headers: {
      'content-type': type,
      'x-image-name': encodeURIComponent(name),
      ...(person.cookie ? { cookie: person.cookie } : {}),
    },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

describe('images', () => {
  it('uploads against a canvas and returns a URL that serves the bytes back', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', { title: 'With pictures' });

    const uploaded = await upload(ben, json.canvas.id);
    expect(uploaded.status).toBe(201);
    expect(uploaded.json.image.url).toBe(`/api/images/${uploaded.json.image.id}`);
    expect(uploaded.json.image.name).toBe('pixel.png');

    const fetched = await fetch(`${base}${uploaded.json.image.url}`, {
      headers: { cookie: ben.cookie },
    });
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('serves images with the headers that stop them being treated as documents', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const uploaded = await upload(ben, json.canvas.id);
    const fetched = await fetch(`${base}${uploaded.json.image.url}`, {
      headers: { cookie: ben.cookie },
    });
    expect(fetched.headers.get('x-content-type-options')).toBe('nosniff');
    expect(fetched.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('refuses SVG, which can carry script', async () => {
    // The reason images are restricted to raster formats: an SVG opened directly
    // would execute whatever is inside it, from our own origin.
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const refused = await upload(ben, json.canvas.id, {
      type: 'image/svg+xml',
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      name: 'evil.svg',
    });
    expect(refused.status).toBe(415);
    expect(refused.json.error).toMatch(/PNG/);
  });

  it('refuses a non-image and an empty file', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    expect((await upload(ben, json.canvas.id, { type: 'application/pdf' })).status).toBe(415);
    expect((await upload(ben, json.canvas.id, { body: Buffer.alloc(0) })).status).toBe(400);
  });

  it('lets an editor add images but not a viewer', async () => {
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const cara = await signedUp('cara@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const id = json.canvas.id;
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ada@example.com', role: 'edit' });
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'cara@example.com', role: 'view' });

    expect((await upload(ada, id)).status).toBe(201);
    expect((await upload(cara, id)).status).toBe(403);
  });

  it('will not upload to someone else’s canvas at all', async () => {
    const ben = await signedUp('ben@example.com');
    const stranger = await signedUp('stranger@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    expect((await upload(stranger, json.canvas.id)).status).toBe(404);
  });

  it('an image is only readable by people who can reach its canvas', async () => {
    // An unguessable URL is not a permission check: someone removed from a canvas
    // must lose its pictures too.
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const id = json.canvas.id;
    const uploaded = await upload(ben, id);

    const before = await fetch(`${base}${uploaded.json.image.url}`, { headers: { cookie: ada.cookie } });
    expect(before.status).toBe(404);

    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ada@example.com' });
    const during = await fetch(`${base}${uploaded.json.image.url}`, { headers: { cookie: ada.cookie } });
    expect(during.status).toBe(200);

    await ben.call('POST', `/api/canvases/${id}/unshare`, { email: 'ada@example.com' });
    const after = await fetch(`${base}${uploaded.json.image.url}`, { headers: { cookie: ada.cookie } });
    expect(after.status).toBe(404);
  });

  it('needs a session even to read an image', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const uploaded = await upload(ben, json.canvas.id);
    expect((await fetch(`${base}${uploaded.json.image.url}`)).status).toBe(401);
  });

  it('deletes an image on request', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const uploaded = await upload(ben, json.canvas.id);
    expect((await ben.call('DELETE', uploaded.json.image.url)).status).toBe(200);
    expect((await fetch(`${base}${uploaded.json.image.url}`, { headers: { cookie: ben.cookie } })).status).toBe(404);
  });

  it('takes the images with the canvas when it is deleted', async () => {
    // Otherwise every deleted canvas leaves files nobody will ever ask for again.
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const uploaded = await upload(ben, json.canvas.id);
    await ben.call('DELETE', `/api/canvases/${json.canvas.id}`);
    expect((await fetch(`${base}${uploaded.json.image.url}`, { headers: { cookie: ben.cookie } })).status).toBe(404);
  });

  it('keeps a filename with characters a header cannot carry', async () => {
    const ben = await signedUp('ben@example.com');
    const { json } = await ben.call('POST', '/api/canvases', {});
    const uploaded = await upload(ben, json.canvas.id, { name: 'diagram — draft 🇪🇹.png' });
    expect(uploaded.json.image.name).toBe('diagram — draft 🇪🇹.png');
  });
});

describe('review schedules', () => {
  async function canvasWithCard(person, title = 'Ethiopia') {
    const { json } = await person.call('POST', '/api/canvases', {
      title,
      nodes: [{ id: 'b1', data: { label: 'Adwa', notes: 'Italy lost in 1896.' } }],
    });
    return json.canvas.id;
  }

  it('starts with nothing scheduled', async () => {
    const ben = await signedUp('ben@example.com');
    const id = await canvasWithCard(ben);
    expect((await ben.call('GET', `/api/canvases/${id}/reviews`)).json.reviews).toEqual({});
    expect((await ben.call('GET', '/api/reviews')).json.reviews).toEqual({});
  });

  it('schedules a card forward when the session went well', async () => {
    const ben = await signedUp('ben@example.com');
    const id = await canvasWithCard(ben);
    const { status, json } = await ben.call('POST', `/api/canvases/${id}/reviews`, {
      grades: [{ blockId: 'b1', recalled: 2, total: 2 }],
    });
    expect(status).toBe(200);
    expect(json.reviews.b1.interval).toBeGreaterThan(0);
    expect(json.reviews.b1.dueAt).toBeGreaterThan(Date.now());
    expect(json.reviews.b1.reps).toBe(1);
  });

  it('brings a missed card straight back', async () => {
    const ben = await signedUp('ben@example.com');
    const id = await canvasWithCard(ben);
    const { json } = await ben.call('POST', `/api/canvases/${id}/reviews`, {
      grades: [{ blockId: 'b1', recalled: 0, total: 2 }],
    });
    expect(json.reviews.b1.interval).toBe(0);
    expect(json.reviews.b1.dueAt).toBeLessThanOrEqual(Date.now());
  });

  it('accumulates across sessions rather than starting over', async () => {
    const ben = await signedUp('ben@example.com');
    const id = await canvasWithCard(ben);
    const good = { grades: [{ blockId: 'b1', recalled: 2, total: 2 }] };
    const first = await ben.call('POST', `/api/canvases/${id}/reviews`, good);
    const second = await ben.call('POST', `/api/canvases/${id}/reviews`, good);
    expect(second.json.reviews.b1.reps).toBe(2);
    expect(second.json.reviews.b1.interval).toBeGreaterThan(first.json.reviews.b1.interval);
  });

  it('keeps one row per block rather than a row per session', async () => {
    const ben = await signedUp('ben@example.com');
    const id = await canvasWithCard(ben);
    const grades = { grades: [{ blockId: 'b1', recalled: 1, total: 2 }] };
    await ben.call('POST', `/api/canvases/${id}/reviews`, grades);
    await ben.call('POST', `/api/canvases/${id}/reviews`, grades);
    expect(Object.keys((await ben.call('GET', `/api/canvases/${id}/reviews`)).json.reviews)).toEqual(['b1']);
  });

  it('gives each person their own schedule for a shared canvas', async () => {
    // The reason review rows are keyed by user: what Ada has drilled and what Ben
    // has never seen are different facts about different people.
    const ben = await signedUp('ben@example.com');
    const ada = await signedUp('ada@example.com');
    const id = await canvasWithCard(ben);
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'ada@example.com' });

    await ben.call('POST', `/api/canvases/${id}/reviews`, {
      grades: [{ blockId: 'b1', recalled: 2, total: 2 }],
    });

    expect((await ben.call('GET', `/api/canvases/${id}/reviews`)).json.reviews.b1).toBeDefined();
    expect((await ada.call('GET', `/api/canvases/${id}/reviews`)).json.reviews).toEqual({});
  });

  it('lets a view-only reader build their own schedule', async () => {
    // Studying changes nothing about someone else's canvas, so read-only access is
    // no reason to refuse it.
    const ben = await signedUp('ben@example.com');
    const cara = await signedUp('cara@example.com');
    const id = await canvasWithCard(ben);
    await ben.call('POST', `/api/canvases/${id}/share`, { email: 'cara@example.com', role: 'view' });

    const { status } = await cara.call('POST', `/api/canvases/${id}/reviews`, {
      grades: [{ blockId: 'b1', recalled: 1, total: 2 }],
    });
    expect(status).toBe(200);
    expect((await cara.call('GET', `/api/canvases/${id}/reviews`)).json.reviews.b1).toBeDefined();
  });

  it('refuses a canvas the user cannot reach', async () => {
    const ben = await signedUp('ben@example.com');
    const stranger = await signedUp('stranger@example.com');
    const id = await canvasWithCard(ben);
    expect((await stranger.call('GET', `/api/canvases/${id}/reviews`)).status).toBe(404);
    expect(
      (await stranger.call('POST', `/api/canvases/${id}/reviews`, { grades: [] })).status
    ).toBe(404);
  });

  it('needs a session', async () => {
    expect((await client().call('GET', '/api/reviews')).status).toBe(401);
  });

  it('groups every schedule by canvas for the library', async () => {
    const ben = await signedUp('ben@example.com');
    const one = await canvasWithCard(ben, 'One');
    const two = await canvasWithCard(ben, 'Two');
    await ben.call('POST', `/api/canvases/${one}/reviews`, {
      grades: [{ blockId: 'b1', recalled: 2, total: 2 }],
    });
    const all = (await ben.call('GET', '/api/reviews')).json.reviews;
    expect(Object.keys(all)).toEqual([one]);
    expect(all[two]).toBeUndefined();
  });

  it('ignores a grade with no block', async () => {
    const ben = await signedUp('ben@example.com');
    const id = await canvasWithCard(ben);
    const { json } = await ben.call('POST', `/api/canvases/${id}/reviews`, {
      grades: [{ recalled: 1, total: 2 }, { blockId: '', recalled: 1, total: 1 }],
    });
    expect(json.reviews).toEqual({});
  });

  it('takes the schedules with the canvas when it is deleted', async () => {
    const ben = await signedUp('ben@example.com');
    const id = await canvasWithCard(ben);
    await ben.call('POST', `/api/canvases/${id}/reviews`, {
      grades: [{ blockId: 'b1', recalled: 2, total: 2 }],
    });
    await ben.call('DELETE', `/api/canvases/${id}`);
    expect((await ben.call('GET', '/api/reviews')).json.reviews).toEqual({});
  });
});

describe('recovery codes and getting back in', () => {
  it('hands out a recovery code once, at sign-up', async () => {
    const ben = client();
    const { json } = await ben.call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    expect(json.recoveryCode).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
    expect(json.user.hasRecoveryCode).toBe(true);

    // And never again from a route that just reports who you are.
    const me = await ben.call('GET', '/api/auth/me');
    expect(me.json.recoveryCode).toBeUndefined();
    expect(JSON.stringify(me.json)).not.toContain(json.recoveryCode.replace(/-/g, ''));
  });

  it('resets a forgotten password with the code, and signs the person in', async () => {
    const ben = client();
    const { json: signup } = await ben.call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'the old one',
    });

    // A different browser: the person is locked out and has only the code.
    const stranger = client();
    const { status, json } = await stranger.call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: signup.recoveryCode,
      password: 'a brand new password',
    });
    expect(status).toBe(200);
    expect(json.user.email).toBe('ben@example.com');
    expect(stranger.cookie).toBeTruthy();
    expect((await stranger.call('GET', '/api/canvases')).status).toBe(200);

    // The old password is gone and the new one works.
    const check = client();
    expect((await check.call('POST', '/api/auth/login', {
      email: 'ben@example.com',
      password: 'the old one',
    })).status).toBe(401);
    expect((await check.call('POST', '/api/auth/login', {
      email: 'ben@example.com',
      password: 'a brand new password',
    })).status).toBe(200);
  });

  it('ends the sessions that knew the old password', async () => {
    // Otherwise a reset does not lock anyone out, which is most of the point.
    const ben = client();
    const { json: signup } = await ben.call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'the old one',
    });
    expect((await ben.call('GET', '/api/canvases')).status).toBe(200);

    const stranger = client();
    await stranger.call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: signup.recoveryCode,
      password: 'a brand new password',
    });

    expect((await ben.call('GET', '/api/canvases')).status).toBe(401);
  });

  it('spends the code, and issues a fresh one so nobody is left locked out', async () => {
    const ben = client();
    const { json: signup } = await ben.call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'longenough1',
    });

    const first = await client().call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: signup.recoveryCode,
      password: 'second password',
    });
    expect(first.json.recoveryCode).toBeTruthy();
    expect(first.json.recoveryCode).not.toBe(signup.recoveryCode);

    // The spent code is dead.
    resetThrottleForTests();
    const reuse = await client().call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: signup.recoveryCode,
      password: 'third password',
    });
    expect(reuse.status).toBe(401);

    // The new one works.
    const again = await client().call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: first.json.recoveryCode,
      password: 'third password',
    });
    expect(again.status).toBe(200);
  });

  it('gives the same answer for a wrong code and an account that does not exist', async () => {
    // Otherwise this endpoint reports who has an account here.
    const { json: signup } = await client().call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    const wrongCode = await client().call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: 'K7QFX-M2XRT-9BWHD-CJ4NP',
      password: 'a new password',
    });
    resetThrottleForTests();
    const noAccount = await client().call('POST', '/api/auth/reset', {
      email: 'nobody@example.com',
      code: signup.recoveryCode,
      password: 'a new password',
    });
    expect(wrongCode.status).toBe(401);
    expect(noAccount.status).toBe(401);
    expect(wrongCode.json.error).toBe(noAccount.json.error);
  });

  it('rejects a malformed code before looking at the account, and a weak new password', async () => {
    const { json: signup } = await client().call('POST', '/api/auth/register', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    const malformed = await client().call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: 'nope',
      password: 'a new password',
    });
    expect(malformed.status).toBe(400);
    expect(malformed.json.error).toMatch(/recovery code/i);

    resetThrottleForTests();
    const weak = await client().call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: signup.recoveryCode,
      password: 'short',
    });
    expect(weak.status).toBe(400);
    expect(weak.json.error).toMatch(/8/);
  });

  it('stops answering after enough wrong codes', async () => {
    await signedUp('ben@example.com');
    const attacker = client();
    for (let i = 0; i < 10; i++) {
      await attacker.call('POST', '/api/auth/reset', {
        email: 'ben@example.com',
        code: 'K7QFX-M2XRT-9BWHD-CJ4NP',
        password: 'a new password',
      });
    }
    const { status } = await attacker.call('POST', '/api/auth/reset', {
      email: 'ben@example.com',
      code: 'K7QFX-M2XRT-9BWHD-CJ4NP',
      password: 'a new password',
    });
    expect(status).toBe(429);
  });

  it('re-issues a code for someone signed in, but only with their password', async () => {
    const ben = await signedUp('ben@example.com');
    const refused = await ben.call('POST', '/api/account/recovery-code', { password: 'wrong' });
    expect(refused.status).toBe(401);

    const { status, json } = await ben.call('POST', '/api/account/recovery-code', {
      password: 'longenough1',
    });
    expect(status).toBe(200);
    expect(json.recoveryCode).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
  });

  it('needs a session to re-issue a code at all', async () => {
    await signedUp('ben@example.com');
    const { status } = await client().call('POST', '/api/account/recovery-code', {
      password: 'longenough1',
    });
    expect(status).toBe(401);
  });
});

describe('changing a password', () => {
  it('changes it, keeps this session, and drops the others', async () => {
    const laptop = await signedUp('ben@example.com');
    const phone = client();
    await phone.call('POST', '/api/auth/login', {
      email: 'ben@example.com',
      password: 'longenough1',
    });
    expect((await phone.call('GET', '/api/canvases')).status).toBe(200);

    const { status } = await laptop.call('POST', '/api/account/password', {
      currentPassword: 'longenough1',
      newPassword: 'a much better password',
    });
    expect(status).toBe(200);

    // Still signed in here — signing you out of the page you used to change it
    // would be a bug, not security.
    expect((await laptop.call('GET', '/api/canvases')).status).toBe(200);
    // Gone everywhere else.
    expect((await phone.call('GET', '/api/canvases')).status).toBe(401);
  });

  it('refuses without the current password, or with a weak new one', async () => {
    const ben = await signedUp('ben@example.com');
    expect((await ben.call('POST', '/api/account/password', {
      currentPassword: 'not it',
      newPassword: 'a much better password',
    })).status).toBe(401);
    expect((await ben.call('POST', '/api/account/password', {
      currentPassword: 'longenough1',
      newPassword: 'short',
    })).status).toBe(400);

    // The password did not change on either failed attempt.
    expect((await client().call('POST', '/api/auth/login', {
      email: 'ben@example.com',
      password: 'longenough1',
    })).status).toBe(200);
  });
});

describe('an account’s own AI key', () => {
  const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD';

  it('starts with nothing saved', async () => {
    const ben = await signedUp('ben@example.com');
    const { status, json } = await ben.call('GET', '/api/account/ai');
    expect(status).toBe(200);
    expect(json.own).toMatchObject({ configured: false });
  });

  it('saves a key and never hands it back', async () => {
    const ben = await signedUp('ben@example.com');
    const saved = await ben.call('PUT', '/api/account/ai', {
      apiKey: KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
    });
    expect(saved.status).toBe(200);
    expect(saved.json.own).toMatchObject({
      configured: true,
      preview: 'sk-…ABCD',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
    });
    expect(JSON.stringify(saved.json)).not.toContain(KEY);

    const read = await ben.call('GET', '/api/account/ai');
    expect(JSON.stringify(read.json)).not.toContain(KEY);
  });

  it('changes the model without being re-sent the key', async () => {
    const ben = await signedUp('ben@example.com');
    await ben.call('PUT', '/api/account/ai', { apiKey: KEY, model: 'gpt-4o' });
    const { json } = await ben.call('PUT', '/api/account/ai', { apiKey: '', model: 'gpt-4o-mini' });
    expect(json.own).toMatchObject({ configured: true, model: 'gpt-4o-mini', preview: 'sk-…ABCD' });
  });

  it('asks for a key when there is nothing stored to keep', async () => {
    const ben = await signedUp('ben@example.com');
    const { status, json } = await ben.call('PUT', '/api/account/ai', { model: 'gpt-4o' });
    expect(status).toBe(400);
    expect(json.error).toMatch(/Paste an API key/);
  });

  it('refuses a provider URL that would put the key on the wire in the clear', async () => {
    const ben = await signedUp('ben@example.com');
    const { status, json } = await ben.call('PUT', '/api/account/ai', {
      apiKey: KEY,
      baseUrl: 'http://example.com/v1',
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/https/);
  });

  it('forgets the key when asked', async () => {
    const ben = await signedUp('ben@example.com');
    await ben.call('PUT', '/api/account/ai', { apiKey: KEY });
    const { json } = await ben.call('DELETE', '/api/account/ai');
    expect(json.own).toMatchObject({ configured: false });
  });

  it('is per account: one person’s key is invisible to another', async () => {
    const ben = await signedUp('ben@example.com');
    await ben.call('PUT', '/api/account/ai', { apiKey: KEY });
    const mia = await signedUp('mia@example.com');
    expect((await mia.call('GET', '/api/account/ai')).json.own).toMatchObject({ configured: false });
  });

  it('needs a session', async () => {
    expect((await client().call('GET', '/api/account/ai')).status).toBe(401);
    expect((await client().call('PUT', '/api/account/ai', { apiKey: KEY })).status).toBe(401);
    expect((await client().call('DELETE', '/api/account/ai')).status).toBe(401);
  });
});
