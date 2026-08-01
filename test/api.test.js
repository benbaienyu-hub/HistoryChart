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
