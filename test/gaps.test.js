import { describe, expect, it } from 'vitest';
import {
  GAP_KINDS,
  appendPoints,
  canvasDigest,
  countByKind,
  describeGaps,
  fillPoints,
  isGapKind,
  normalizeGaps,
} from '../src/lib/gaps';

const node = (id, label, notes = '') => ({ id, data: { label, notes } });

describe('canvasDigest', () => {
  it('numbers the blocks, so the model can point at one cheaply', () => {
    const digest = canvasDigest([node('uuid-a', 'Nationalisation'), node('uuid-b', 'Reaction')]);
    expect(digest).toEqual([
      { ref: 1, id: 'uuid-a', label: 'Nationalisation', notes: '' },
      { ref: 2, id: 'uuid-b', label: 'Reaction', notes: '' },
    ]);
  });

  it('skips blocks with no label, which have nothing to review', () => {
    expect(canvasDigest([node('a', '  '), node('b', 'Real')])).toHaveLength(1);
  });

  it('caps the canvas, so a huge one cannot blow the context window', () => {
    const many = Array.from({ length: 60 }, (_, i) => node(`n${i}`, `Block ${i}`));
    expect(canvasDigest(many)).toHaveLength(40);
  });

  it('truncates very long notes rather than dropping the block', () => {
    const digest = canvasDigest([node('a', 'Long', 'x'.repeat(2000))]);
    expect(digest[0].notes.length).toBeLessThan(1000);
    expect(digest[0].notes.endsWith('…')).toBe(true);
  });

  it('survives a malformed node list', () => {
    expect(canvasDigest(undefined)).toEqual([]);
    expect(canvasDigest([null, {}, { data: null }])).toEqual([]);
  });
});

describe('normalizeGaps', () => {
  const digest = canvasDigest([node('uuid-a', 'Nationalisation'), node('uuid-b', 'Reaction')]);

  const raw = (over = {}) => ({
    kind: 'missing',
    blockRef: 1,
    title: 'The canal company shareholders',
    detail: 'Nothing here says who owned it.',
    hint: 'Think about who lost money.',
    question: 'Who were the major shareholders?',
    answer: 'Britain and French investors.',
    fill: '- Britain held 44% of the shares.\n- French investors held most of the rest.',
    ...over,
  });

  it('resolves the block number back to a real block', () => {
    const [gap] = normalizeGaps([raw()], digest);
    expect(gap.blockId).toBe('uuid-a');
    expect(gap.blockLabel).toBe('Nationalisation');
  });

  it('treats blockRef 0 as belonging to the canvas, not to a block', () => {
    // A real case, and the most valuable one: "nothing here covers the economics".
    const [gap] = normalizeGaps([raw({ blockRef: 0 })], digest);
    expect(gap.blockId).toBeNull();
    expect(gap.blockLabel).toBeNull();
  });

  it('treats a block number that is not there the same way', () => {
    const [gap] = normalizeGaps([raw({ blockRef: 99 })], digest);
    expect(gap.blockId).toBeNull();
  });

  it('splits the fill into points the rest of the app works in', () => {
    const [gap] = normalizeGaps([raw()], digest);
    expect(gap.fill).toEqual([
      'Britain held 44% of the shares.',
      'French investors held most of the rest.',
    ]);
  });

  it('drops a gap with no title, which would render as an empty card', () => {
    expect(normalizeGaps([raw({ title: '   ' }), raw()], digest)).toHaveLength(1);
  });

  it('falls back to "missing" for a kind it does not know', () => {
    expect(normalizeGaps([raw({ kind: 'vibes' })], digest)[0].kind).toBe('missing');
  });

  it('shows the most alarming kind first', () => {
    // Believing something false does more damage than not having written something
    // down yet, so corrections lead.
    const gaps = normalizeGaps(
      [
        raw({ kind: 'incomplete', title: 'Thin' }),
        raw({ kind: 'missing', title: 'Absent' }),
        raw({ kind: 'incorrect', title: 'Wrong' }),
      ],
      digest
    );
    expect(gaps.map((g) => g.kind)).toEqual(['incorrect', 'missing', 'incomplete']);
  });

  it('drops the same gap reported twice', () => {
    // Usually once per block it touches, which reads as the model repeating itself.
    const gaps = normalizeGaps([raw(), raw({ blockRef: 2 })], digest);
    expect(gaps).toHaveLength(1);
  });

  it('keeps two different gaps that share a kind', () => {
    expect(normalizeGaps([raw(), raw({ title: 'Something else' })], digest)).toHaveLength(2);
  });

  it('caps how many are shown, since a wall of gaps is not actionable', () => {
    const many = Array.from({ length: 30 }, (_, i) => raw({ title: `Gap ${i}` }));
    expect(normalizeGaps(many, digest)).toHaveLength(12);
  });

  it('gives every gap a distinct id for the UI to key on', () => {
    const gaps = normalizeGaps([raw(), raw({ title: 'Another' })], digest);
    expect(new Set(gaps.map((g) => g.id)).size).toBe(2);
  });

  it('gives the same hole the same id next time it is found', () => {
    // A gap's question is a study card, and a card needs an id that survives the
    // next scan. Numbering by position meant re-finding the same hole minted a
    // new card and threw away everything the schedule had learned.
    const first = normalizeGaps([raw({ title: 'Something else' }), raw()], digest);
    const second = normalizeGaps([raw()], digest);
    expect(second[0].id).toBe(first.find((g) => g.title === raw().title).id);
  });

  it('tells two kinds of gap about the same thing apart', () => {
    const gaps = normalizeGaps(
      [raw({ title: 'Reparations' }), raw({ kind: 'incomplete', title: 'Reparations' })],
      digest
    );
    expect(new Set(gaps.map((g) => g.id)).size).toBe(2);
  });

  it('still has an id when the title is all punctuation', () => {
    expect(normalizeGaps([raw({ title: '???' })], digest)[0].id).toBe('missing-untitled');
  });

  it('survives junk instead of a list', () => {
    expect(normalizeGaps(undefined, digest)).toEqual([]);
    expect(normalizeGaps('nonsense', digest)).toEqual([]);
    expect(normalizeGaps([null, 42], digest)).toEqual([]);
  });

  it('never leaves a field undefined for the UI to render', () => {
    const [gap] = normalizeGaps([{ kind: 'missing', title: 'Bare' }], digest);
    expect(gap).toMatchObject({ detail: '', hint: '', question: '', answer: '', fill: [] });
  });
});

describe('fillPoints', () => {
  it('accepts whichever bullet the model chose', () => {
    expect(fillPoints('- one\n• two\n* three')).toEqual(['one', 'two', 'three']);
  });

  it('drops blank lines', () => {
    expect(fillPoints('- one\n\n\n- two')).toEqual(['one', 'two']);
  });

  it('handles prose with no bullets at all', () => {
    expect(fillPoints('Just a sentence.')).toEqual(['Just a sentence.']);
  });

  it('is empty for nothing', () => {
    expect(fillPoints('')).toEqual([]);
    expect(fillPoints(undefined)).toEqual([]);
  });
});

describe('appendPoints', () => {
  it('adds points as dot points', () => {
    expect(appendPoints('- Existing', ['New one'])).toBe('- Existing\n- New one');
  });

  it('writes into empty notes without a leading blank line', () => {
    expect(appendPoints('', ['First'])).toBe('- First');
    expect(appendPoints('   \n', ['First'])).toBe('- First');
  });

  it('never rewrites what is already there', () => {
    // The whole reason applying a gap is an append: a correction contradicts a line
    // the person wrote, and deleting their sentence on a model's say-so is not this
    // app's call.
    const notes = '- Nasser nationalised the canal in 1953';
    const out = appendPoints(notes, ['Nasser nationalised the canal in July 1956']);
    expect(out).toContain('1953');
    expect(out).toContain('July 1956');
  });

  it('does not duplicate a point that is already written', () => {
    const notes = '- Britain held 44% of the shares.';
    expect(appendPoints(notes, ['Britain held 44% of the shares.'])).toBe(notes);
  });

  it('ignores trivial differences when deciding that', () => {
    const notes = '- Britain held 44% of the shares';
    expect(appendPoints(notes, ['britain held 44% of the shares.'])).toBe(notes);
  });

  it('adds the new points from a partly-known list', () => {
    const notes = '- Known';
    expect(appendPoints(notes, ['Known', 'Unknown'])).toBe('- Known\n- Unknown');
  });

  it('leaves notes untouched when there is nothing to add', () => {
    expect(appendPoints('- Known', [])).toBe('- Known');
    expect(appendPoints('- Known', ['   '])).toBe('- Known');
  });
});

describe('summarising a scan', () => {
  const gap = (kind) => ({ kind });

  it('counts by kind', () => {
    expect(countByKind([gap('missing'), gap('missing'), gap('incorrect')])).toEqual({
      incorrect: 1,
      missing: 2,
      incomplete: 0,
    });
  });

  it('says so plainly when there is nothing wrong', () => {
    // Not a failure state, and the wording matters: a scan that finds nothing is a
    // real answer about notes that hold up.
    expect(describeGaps([])).toBe('No gaps found');
  });

  it('reads in the order the panel shows them', () => {
    expect(describeGaps([gap('incomplete'), gap('incorrect'), gap('missing')])).toBe(
      '1 incorrect · 1 missing · 1 incomplete'
    );
  });

  it('mentions only the kinds present', () => {
    expect(describeGaps([gap('missing'), gap('missing')])).toBe('2 missing');
  });
});

describe('the kinds themselves', () => {
  it('recognises exactly the three', () => {
    expect(isGapKind('missing')).toBe(true);
    expect(isGapKind('incorrect')).toBe(true);
    expect(isGapKind('incomplete')).toBe(true);
    expect(isGapKind('other')).toBe(false);
  });

  it('calls the correction action something other than "fill"', () => {
    // "Fill gap" is the wrong verb when the note already says something — it is
    // being contradicted, not completed.
    expect(GAP_KINDS.incorrect.fillLabel).not.toMatch(/fill/i);
    expect(GAP_KINDS.missing.fillLabel).toMatch(/fill/i);
  });
});
