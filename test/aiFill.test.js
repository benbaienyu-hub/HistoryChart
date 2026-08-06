import { describe, expect, it, vi } from 'vitest';
import { expandTopic, normalizeSubtopics } from '../src/lib/aiFill';

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

describe('when the dev server is unreachable', () => {
  // fetch rejects only when the request never reached a server. The browser calls
  // that "Failed to fetch", which surfaced verbatim and read like an AI failure.
  it('says what is actually wrong, and how to check', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await expandTopic({ topic: 'Ethiopia' }).catch((e) => e);

    expect(error.message).toMatch(/npm run dev/);
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
