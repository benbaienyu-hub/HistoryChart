import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeAiStatus,
  expandTopic,
  fetchAiStatus,
  findGaps,
  forgetAiStatus,
  isAiConfigured,
  normalizeSubtopics,
} from '../src/lib/aiFill';

// The status is cached in module scope, so it has to be cleared between tests or
// one test's answer becomes the next test's assumption.
afterEach(() => {
  vi.restoreAllMocks();
  forgetAiStatus();
});

// Sub-topics gained a per-item `detail` when the third level of a generated
// graph started arriving with content. This guards the boundary: whatever the
// route sends, the canvas must end up with usable { label, detail } pairs rather
// than blocks labelled "[object Object]" or "undefined".
describe('normalizeSubtopics', () => {
  it('passes through well-formed pairs', () => {
    expect(normalizeSubtopics([{ label: 'Calvin cycle', detail: 'Fixes carbon.' }])).toEqual([
      { label: 'Calvin cycle', detail: 'Fixes carbon.' },
    ]);
  });

  it('accepts a bare string, as an older server would send', () => {
    expect(normalizeSubtopics(['Calvin cycle'])).toEqual([
      { label: 'Calvin cycle', detail: '' },
    ]);
  });

  it('trims both fields', () => {
    expect(normalizeSubtopics([{ label: '  Light  ', detail: '  Reactions.  ' }])).toEqual([
      { label: 'Light', detail: 'Reactions.' },
    ]);
  });

  it('supplies an empty detail rather than undefined', () => {
    expect(normalizeSubtopics([{ label: 'Light' }])).toEqual([{ label: 'Light', detail: '' }]);
  });

  it('drops entries with no usable label', () => {
    const out = normalizeSubtopics([
      { label: '', detail: 'orphan' },
      { label: '   ', detail: 'orphan' },
      { detail: 'orphan' },
      null,
      undefined,
      '',
      { label: 'Kept', detail: '' },
    ]);
    expect(out).toEqual([{ label: 'Kept', detail: '' }]);
  });

  it('coerces non-string fields instead of throwing', () => {
    expect(normalizeSubtopics([{ label: 42, detail: 7 }])).toEqual([
      { label: '42', detail: '7' },
    ]);
  });

  it('handles a missing or empty list', () => {
    expect(normalizeSubtopics(undefined)).toEqual([]);
    expect(normalizeSubtopics(null)).toEqual([]);
    expect(normalizeSubtopics([])).toEqual([]);
  });
});

describe('when the server is unreachable', () => {
  // fetch rejects only when the request never reached a server. The browser calls
  // that "Failed to fetch", which surfaced verbatim and read like an AI failure.
  it('says what is actually wrong, and that it is not an AI problem', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await expandTopic({ topic: 'Ethiopia' }).catch((e) => e);

    expect(error.message).toMatch(/could not reach the server/i);
    // The point of the message: name the real cause. It deliberately no longer
    // assumes a dev server on this machine — the app can be deployed.
    expect(error.message).toMatch(/connection problem, not an AI one/);
    expect(error.message).not.toMatch(/^Failed to fetch$/);
    expect(stub).toHaveBeenCalled();
  });

  it('keeps the original failure as the cause, for the console', async () => {
    const original = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(original);
    const error = await expandTopic({ topic: 'Ethiopia' }).catch((e) => e);
    expect(error.cause).toBe(original);
  });

  it('a server that answers with an error is reported as that error, not as unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'Groq has no model called "nope".' }),
    });
    const error = await expandTopic({ topic: 'Ethiopia' }).catch((e) => e);
    expect(error.message).toBe('Groq has no model called "nope".');
  });
});

describe('the cached AI status', () => {
  // The bug this replaced: the status was memoised for the lifetime of the tab, so
  // a key added on the server (or by this account in another tab) left the app
  // insisting there was no key until a full page reload.
  beforeEach(() => {
    forgetAiStatus();
  });

  it('asks once for repeated questions in quick succession', async () => {
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ configured: true }), { status: 200 }));

    await Promise.all([fetchAiStatus(), fetchAiStatus(), isAiConfigured()]);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('asks again when forced, so a saved key takes effect without a reload', async () => {
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true }), { status: 200 }));

    expect(await isAiConfigured()).toBe(false);
    expect(await isAiConfigured({ force: true })).toBe(true);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it('asks again once the cached answer is stale', async () => {
    vi.useFakeTimers();
    try {
      const stub = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ configured: false }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true }), { status: 200 }));

      expect(await isAiConfigured()).toBe(false);
      vi.advanceTimersByTime(31_000);
      expect(await isAiConfigured()).toBe(true);
      expect(stub).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never lets the browser answer from its own cache', async () => {
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ configured: true }), { status: 200 }));
    await fetchAiStatus();
    expect(stub.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('treats an unreachable server as "no AI", not as a crash', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await isAiConfigured()).toBe(false);
  });

  it('drops the cached answer when a request comes back 503', async () => {
    // The server has just said there is no usable key; whatever we believed at page
    // load is out of date either way.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'No API key configured', code: 'NO_API_KEY' }), {
          status: 503,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: false }), { status: 200 }));

    expect(await isAiConfigured()).toBe(true);
    await expect(findGaps({ title: 'Rome', nodes: [{ id: 'b1' }] })).rejects.toMatchObject({
      code: 'NO_API_KEY',
    });
    // Not forced, and well inside the TTL — it re-asks because the 503 invalidated it.
    expect(await isAiConfigured()).toBe(false);
  });

  it('carries the server’s explanation, so the fix named is the right one', async () => {
    // A fresh Response per call: a body can only be read once, and reusing one
    // makes the second request look like a server that answered nothing.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error:
              'This server asks everyone to bring their own API key. Add yours in account settings.',
            code: 'NO_API_KEY',
            requiresOwnKey: true,
          }),
          { status: 503 }
        )
    );
    // The gap route throws — there is no useful partial answer to show — while the
    // graph route degrades to placeholders, which is why they differ here.
    await expect(findGaps({ title: 'Rome', nodes: [{ id: 'b1' }] })).rejects.toThrow(
      /bring their own API key/
    );
    const expanded = await expandTopic({ topic: 'Rome' });
    expect(expanded.reason).toMatch(/bring their own API key/);
  });

  it('sends the canvas to the gap route and returns the gaps', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gaps: [{ id: 'g1', kind: 'missing', title: 'A hole' }] }), {
        status: 200,
      })
    );
    const { gaps } = await findGaps({ title: 'Suez', nodes: [{ id: 'b1', data: {} }] });
    expect(stub.mock.calls[0][0]).toBe('/api/gaps');
    expect(JSON.parse(stub.mock.calls[0][1].body).title).toBe('Suez');
    expect(gaps).toHaveLength(1);
  });

  it('tolerates a malformed answer rather than crashing the canvas', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ nonsense: true }), { status: 200 })
    );
    expect((await findGaps({ title: 'x', nodes: [] })).gaps).toEqual([]);
  });
});

describe('describeAiStatus', () => {
  it('does not tell a hosted user to read .env.example', () => {
    // It used to. On a deployment there is no .env to look at, and the person
    // reading it may not be the person who owns the server.
    const message = describeAiStatus({ configured: false });
    expect(message).not.toMatch(/\.env/);
    expect(message).toMatch(/Account → AI key/);
    expect(message).toMatch(/OPENAI_API_KEY/);
  });

  it('names the own-key rule when that is the reason', () => {
    expect(describeAiStatus({ configured: false, requiresOwnKey: true })).toMatch(
      /their own API key/
    );
  });

  it('says whose key is being spent when it is yours', () => {
    expect(describeAiStatus({ configured: true, keySource: 'user' })).toMatch(/your own API key/);
    expect(describeAiStatus({ configured: true, keySource: 'server' })).not.toMatch(/your own/);
  });

  it('does not claim anything before the answer arrives', () => {
    expect(describeAiStatus(null)).toMatch(/Checking/);
  });
});
