// @vitest-environment node
// The gap-finding route: what it sends, what it refuses, and what it makes of the
// answer. The prompt itself cannot be unit-tested for quality, but the parts that
// would silently break it can be.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAP_SCHEMA, GAP_SYSTEM, buildGapPrompt, generateGaps } from '../server/gapRoutes.js';
import { canvasDigest } from '../src/lib/gaps.js';
import { forgetFormatTiersForTests } from '../server/modelCall.js';
import { setEnvFileForTests } from '../server/aiConfig.js';
import { setDataPathForTests } from '../server/store.js';

const node = (id, label, notes = '') => ({ id, data: { label, notes } });
const CANVAS = [
  node('a', 'Nationalisation', '- Nasser nationalised the canal in July 1956'),
  node('b', 'Reaction', '- Britain and France objected'),
];

// A stub provider, so the wire format is asserted rather than assumed.
let server;
let baseUrl;
const received = [];
let reply = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push(JSON.parse(raw || '{}'));
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(reply ?? { gaps: [] }) } }],
        })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-gaps-'));
  setDataPathForTests(join(dir, 'db.json'));
  received.length = 0;
  reply = null;
  forgetFormatTiersForTests();
  vi.stubEnv('OPENAI_MOCK', '');
  setEnvFileForTests(null);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const credentials = () => ({ apiKey: 'stub-key', baseUrl, model: 'stub-model', source: 'server' });

describe('the prompt', () => {
  it('numbers the blocks and includes their notes', () => {
    const prompt = buildGapPrompt({ title: 'Suez', digest: canvasDigest(CANVAS) });
    expect(prompt).toContain('[1] Nationalisation');
    expect(prompt).toContain('July 1956');
    expect(prompt).toContain('[2] Reaction');
  });

  it('says a block has no notes rather than leaving a blank', () => {
    // An empty line reads as "nothing to say about this", when the point is that
    // the block is empty — which is itself a gap.
    const prompt = buildGapPrompt({ title: 'Suez', digest: canvasDigest([node('a', 'Empty')]) });
    expect(prompt).toContain('(no notes written yet)');
  });

  it('carries the canvas title, so a bare block label is not read out of context', () => {
    expect(buildGapPrompt({ title: 'Suez Crisis', digest: [] })).toContain('Suez Crisis');
  });
});

describe('the instructions', () => {
  // These are the sentences that decide whether the feature is useful or corrosive.
  // Asserted so a later edit cannot quietly drop one.
  it('forbids padding, and says an empty answer is valid', () => {
    expect(GAP_SYSTEM).toMatch(/Do not pad/);
    expect(GAP_SYSTEM).toMatch(/empty list is a correct/i);
  });

  it('holds "incorrect" to a higher bar than the others', () => {
    // Being wrongly told you are wrong is worse than being told nothing: you go and
    // "correct" something that was right.
    expect(GAP_SYSTEM).toMatch(/only flag a claim you are confident is wrong/i);
  });

  it('says the hint must not contain the answer', () => {
    expect(GAP_SYSTEM).toMatch(/hint must not contain the answer/i);
  });

  it('asks for dot points, because they become study cards', () => {
    expect(GAP_SYSTEM).toMatch(/dot points/);
  });

  it('tells it to place a missing idea only where it would defend the position', () => {
    // A suggestion drawn between the wrong two blocks is worse than one parked
    // off to the side: it makes a claim about the argument that is not true.
    expect(GAP_SYSTEM).toMatch(/only guess a position you would defend/i);
    expect(GAP_SYSTEM).toMatch(/a step it jumps over/i);
  });

  it('keeps the other two kinds off the canvas', () => {
    expect(GAP_SYSTEM).toMatch(/for "incorrect" and "incomplete", always use 0 for both/i);
  });
});

describe('the schema', () => {
  it('requires every field the panel renders', () => {
    const props = GAP_SCHEMA.properties.gaps.items;
    expect(props.required).toEqual([
      'kind',
      'blockRef',
      'afterRef',
      'beforeRef',
      'title',
      'detail',
      'hint',
      'question',
      'answer',
      'fill',
    ]);
  });

  it('asks a missing gap where it belongs, so it can be drawn there', () => {
    // The two fields that turn a list entry into a block on the canvas between
    // the two it belongs between.
    const props = GAP_SCHEMA.properties.gaps.items.properties;
    expect(props.afterRef.type).toBe('integer');
    expect(props.beforeRef.type).toBe('integer');
    expect(props.beforeRef.description).toMatch(/missing/i);
  });

  it('constrains the kinds to the three the app knows', () => {
    expect(GAP_SCHEMA.properties.gaps.items.properties.kind.enum).toEqual([
      'missing',
      'incorrect',
      'incomplete',
    ]);
  });

  it('is strict, so a model cannot invent extra fields', () => {
    expect(GAP_SCHEMA.additionalProperties).toBe(false);
    expect(GAP_SCHEMA.properties.gaps.items.additionalProperties).toBe(false);
  });
});

describe('generateGaps', () => {
  it('asks the provider with the schema, and shapes what comes back', async () => {
    reply = {
      gaps: [
        {
          kind: 'incorrect',
          blockRef: 1,
          title: 'Wrong year',
          detail: 'The notes say 1953; it was 1956.',
          hint: 'Check the year against Eden’s premiership.',
          question: 'When was the canal nationalised?',
          answer: 'July 1956.',
          fill: '- Nasser nationalised the canal in July 1956.',
        },
      ],
    };

    const { gaps } = await generateGaps({ title: 'Suez', nodes: CANVAS }, credentials());

    expect(received[0].response_format.type).toBe('json_schema');
    expect(received[0].model).toBe('stub-model');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ kind: 'incorrect', blockId: 'a', blockLabel: 'Nationalisation' });
    expect(gaps[0].fill).toEqual(['Nasser nationalised the canal in July 1956.']);
  });

  it('resolves the placement refs back to real blocks', async () => {
    reply = {
      gaps: [
        {
          kind: 'missing',
          blockRef: 0,
          afterRef: 1,
          beforeRef: 2,
          title: 'What actually connected them',
          detail: 'The canvas jumps straight from one to the other.',
          hint: 'Think about what happened in between.',
          question: 'What linked them?',
          answer: 'A thing.',
          fill: '- A thing happened in between.',
        },
      ],
    };

    const { gaps } = await generateGaps({ title: 'Suez', nodes: CANVAS }, credentials());
    expect(gaps[0]).toMatchObject({
      afterId: 'a',
      afterLabel: 'Nationalisation',
      beforeId: 'b',
      beforeLabel: 'Reaction',
    });
  });

  it('offers an offline sample that sits between two blocks', async () => {
    // So the drawn-on-canvas case can be seen with no key and no bill.
    vi.stubEnv('OPENAI_MOCK', '1');
    const { gaps } = await generateGaps({ title: 'Suez', nodes: CANVAS }, credentials());
    const missing = gaps.find((g) => g.kind === 'missing');
    expect(missing.afterId).toBe('a');
    expect(missing.beforeId).toBe('b');
  });

  it('spends nothing on an empty canvas', async () => {
    const { gaps } = await generateGaps({ title: 'Suez', nodes: [] }, credentials());
    expect(gaps).toEqual([]);
    expect(received).toHaveLength(0);
  });

  it('passes an empty answer through as an empty answer', async () => {
    // "Nothing is missing" has to survive the whole pipeline, or the feature can
    // only ever be alarming.
    reply = { gaps: [] };
    const { gaps } = await generateGaps({ title: 'Suez', nodes: CANVAS }, credentials());
    expect(gaps).toEqual([]);
  });

  it('returns offline samples in mock mode without calling anything', async () => {
    vi.stubEnv('OPENAI_MOCK', '1');
    const { gaps } = await generateGaps({ title: 'Suez', nodes: CANVAS }, credentials());
    expect(received).toHaveLength(0);
    expect(gaps).toHaveLength(3);
    // One of each kind, so the whole panel can be exercised with no key.
    expect(new Set(gaps.map((g) => g.kind))).toEqual(new Set(['incorrect', 'missing', 'incomplete']));
    // And labelled, so sample output can never be mistaken for a real review.
    expect(gaps.every((g) => g.title.includes('[offline sample]'))).toBe(true);
  });

  it('refuses to call out with no key rather than failing at the provider', async () => {
    await expect(
      generateGaps({ title: 'Suez', nodes: CANVAS }, { apiKey: null, source: 'none' })
    ).rejects.toMatchObject({ code: 'NO_API_KEY' });
    expect(received).toHaveLength(0);
  });

  it('will not guess a model for an account that named a provider without one', async () => {
    await expect(
      generateGaps(
        { title: 'Suez', nodes: CANVAS },
        { apiKey: 'k', baseUrl, model: null, source: 'user' }
      )
    ).rejects.toMatchObject({ code: 'CONFIG' });
    expect(received).toHaveLength(0);
  });
});
