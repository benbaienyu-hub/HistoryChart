import { describe, expect, it } from 'vitest';
import { describeLibrary, librarySummary, nextAction, weakestBlocks } from '../src/lib/library';

// A measured canvas, as progress.js would hand it over.
const row = (over = {}) => ({
  id: over.id ?? 'c1',
  title: over.title ?? 'Cold War',
  coverage: { written: 8, total: 10, pct: 80 },
  mastery: { recalled: 6, total: 10, pct: 60, cards: 5, tested: 5 },
  scanned: true,
  gapCount: 0,
  due: 0,
  weak: 0,
  ...over,
});

describe('librarySummary', () => {
  it('adds up the counts across every canvas', () => {
    const totals = librarySummary([
      row({ id: 'a', due: 3, gapCount: 2, weak: 1 }),
      row({ id: 'b', due: 4, gapCount: 5, weak: 2 }),
    ]);
    expect(totals).toMatchObject({ canvases: 2, due: 7, gaps: 7, weak: 3, unscanned: 0 });
  });

  it('pools the underlying counts rather than averaging the percentages', () => {
    // Averaging would let a two-block canvas you abandoned drag down a hundred
    // blocks you know cold, because every canvas would count the same regardless
    // of size.
    const big = row({ id: 'big', coverage: { written: 90, total: 100, pct: 90 } });
    const tiny = row({ id: 'tiny', coverage: { written: 0, total: 2, pct: 0 } });

    const totals = librarySummary([big, tiny]);
    expect(totals.coverage).toMatchObject({ written: 90, total: 102, pct: 88 });
    // The average of 90% and 0% would have been 45%.
    expect(totals.coverage.pct).not.toBe(45);
  });

  it('pools mastery the same way', () => {
    const totals = librarySummary([
      row({ mastery: { recalled: 1, total: 2, pct: 50 } }),
      row({ mastery: { recalled: 9, total: 18, pct: 50 } }),
    ]);
    expect(totals.mastery).toMatchObject({ recalled: 10, total: 20, pct: 50 });
  });

  it('counts canvases that have never been scanned, rather than calling them zero', () => {
    const totals = librarySummary([row({ scanned: false, gapCount: null }), row({ gapCount: 3 })]);
    expect(totals).toMatchObject({ unscanned: 1, gaps: 3 });
  });

  it('has no percentages to report for a library with nothing written', () => {
    const totals = librarySummary([row({ coverage: null, mastery: null })]);
    expect(totals.coverage).toBeNull();
    expect(totals.mastery).toBeNull();
  });

  it('survives an empty or junk library', () => {
    expect(librarySummary([])).toMatchObject({ canvases: 0, due: 0, coverage: null });
    expect(librarySummary()).toMatchObject({ canvases: 0 });
    expect(librarySummary([null, undefined])).toMatchObject({ canvases: 0 });
  });
});

describe('nextAction', () => {
  it('sends you to study when anything is due, and names the fullest deck', () => {
    // Recall first: it is the thing that decays, and the only one of these with a
    // deadline attached.
    const action = nextAction([
      row({ id: 'a', title: 'Cold War', due: 2 }),
      row({ id: 'b', title: 'Cell Biology', due: 9 }),
    ]);
    expect(action).toMatchObject({ kind: 'study', canvasId: 'b', count: 9 });
    expect(action.label).toContain('Cell Biology');
  });

  it('offers a scan next, on the canvas you were last working on', () => {
    // Rows arrive most-recently-updated first, so this is the thing still warm in
    // your head rather than the oldest canvas you have forgotten about.
    const action = nextAction([
      row({ id: 'new', title: 'Macro', scanned: false }),
      row({ id: 'old', title: 'Ancient', scanned: false }),
    ]);
    expect(action).toMatchObject({ kind: 'scan', canvasId: 'new' });
  });

  it('will not send you to scan a canvas with nothing written on it', () => {
    // There is nothing to review. Writing something is the prerequisite, and the
    // app should not spend a model call to say so.
    const action = nextAction([
      row({ id: 'blank', scanned: false, coverage: { written: 0, total: 3, pct: 0 } }),
    ]);
    expect(action.kind).not.toBe('scan');
  });

  it('then points at the weakest canvas', () => {
    const action = nextAction([
      row({ id: 'a', title: 'Cold War', weak: 1 }),
      row({ id: 'b', title: 'Macro', weak: 4 }),
    ]);
    expect(action).toMatchObject({ kind: 'weak', canvasId: 'b', count: 4 });
  });

  it('then at gaps that were found and never dealt with', () => {
    const action = nextAction([row({ id: 'a', title: 'Cold War', gapCount: 6 })]);
    expect(action).toMatchObject({ kind: 'gaps', canvasId: 'a', count: 6 });
  });

  it('admits when there is genuinely nothing to do', () => {
    // An app that always has a task for you is an app you stop believing.
    expect(nextAction([row()])).toMatchObject({ kind: 'clear' });
  });

  it('asks an empty library for a first canvas rather than for a chore', () => {
    expect(nextAction([])).toMatchObject({ kind: 'start' });
    expect(nextAction()).toMatchObject({ kind: 'start' });
  });

  it('keeps its order: due beats unscanned beats weak beats gaps', () => {
    const everything = row({ id: 'a', due: 1, weak: 5, gapCount: 9, scanned: false });
    expect(nextAction([everything]).kind).toBe('study');
    expect(nextAction([{ ...everything, due: 0 }]).kind).toBe('scan');
    expect(nextAction([{ ...everything, due: 0, scanned: true }]).kind).toBe('weak');
    expect(nextAction([{ ...everything, due: 0, scanned: true, weak: 0 }]).kind).toBe('gaps');
  });

  it('always gives something with a label and an explanation', () => {
    for (const rows of [[], [row()], [row({ due: 3 })], [row({ scanned: false })]]) {
      const action = nextAction(rows);
      expect(action.label).toEqual(expect.any(String));
      expect(action.detail).toEqual(expect.any(String));
    }
  });
});

describe('weakestBlocks', () => {
  const block = (id, notes = '- something') => ({ id, data: { label: id, notes } });
  const canvas = (id, title, nodes, reviews) => ({ id, title, nodes, reviews });
  const score = (recalled, total) => ({ lastScore: { recalled, total } });

  it('ranks the worst recall first, across every canvas at once', () => {
    // The point of the list: revision does not respect canvas boundaries, and a
    // fact you keep failing in one canvas is invisible while you look at another.
    const found = weakestBlocks([
      canvas('c1', 'Cold War', [block('yalta'), block('berlin')], {
        yalta: score(1, 4),
        berlin: score(3, 4),
      }),
      canvas('c2', 'Macro', [block('inflation')], { inflation: score(0, 3) }),
    ]);
    expect(found.map((b) => b.label)).toEqual(['inflation', 'yalta', 'berlin']);
    expect(found[0]).toMatchObject({ canvasTitle: 'Macro', recalled: 0, total: 3, missed: 3 });
  });

  it('leaves out blocks nobody has been asked about', () => {
    // Not known to be weak. Putting it here on suspicion would bury the ones you
    // demonstrably got wrong.
    const found = weakestBlocks([canvas('c1', 'Cold War', [block('never')], {})]);
    expect(found).toEqual([]);
  });

  it('leaves out blocks you got completely right', () => {
    const found = weakestBlocks([
      canvas('c1', 'Cold War', [block('a'), block('b')], { a: score(2, 2), b: score(1, 2) }),
    ]);
    expect(found.map((b) => b.label)).toEqual(['b']);
  });

  it('breaks a tie by how much was actually lost', () => {
    // Half of eight points is a bigger hole than half of two.
    const found = weakestBlocks([
      canvas('c1', 'Cold War', [block('small'), block('big')], {
        small: score(1, 2),
        big: score(4, 8),
      }),
    ]);
    expect(found.map((b) => b.label)).toEqual(['big', 'small']);
  });

  it('ignores blocks with no notes, which are not cards', () => {
    const found = weakestBlocks([
      canvas('c1', 'Cold War', [block('empty', '')], { empty: score(0, 2) }),
    ]);
    expect(found).toEqual([]);
  });

  it('carries what the row needs to link back to the block', () => {
    const [worst] = weakestBlocks([
      canvas('c1', 'Cold War', [block('yalta')], { yalta: score(1, 4) }),
    ]);
    expect(worst).toMatchObject({ blockId: 'yalta', canvasId: 'c1', canvasTitle: 'Cold War' });
  });

  it('caps the list, since this is a place to start rather than a backlog', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => block(`b${i}`));
    const reviews = Object.fromEntries(nodes.map((n, i) => [n.id, score(i % 3, 4)]));
    expect(weakestBlocks([canvas('c1', 'X', nodes, reviews)])).toHaveLength(6);
    expect(weakestBlocks([canvas('c1', 'X', nodes, reviews)], { limit: 3 })).toHaveLength(3);
  });

  it('survives junk', () => {
    expect(weakestBlocks()).toEqual([]);
    expect(weakestBlocks([{ id: 'c', nodes: null, reviews: null }])).toEqual([]);
    expect(weakestBlocks([canvas('c', 'X', [null, {}], {})])).toEqual([]);
  });
});

describe('describeLibrary', () => {
  it('mentions only what is actually there', () => {
    expect(describeLibrary(librarySummary([row({ due: 14, gapCount: 9 })]))).toBe(
      '14 cards due · 9 gaps found'
    );
  });

  it('counts the unscanned canvases', () => {
    const totals = librarySummary([row({ scanned: false }), row({ id: 'b', scanned: false })]);
    expect(describeLibrary(totals)).toBe('2 canvases never scanned');
  });

  it('gets the singular right', () => {
    const totals = librarySummary([row({ due: 1, gapCount: 1, scanned: true })]);
    expect(describeLibrary(totals)).toBe('1 card due · 1 gap found');
  });

  it('is empty when there is nothing to report, rather than a row of zeroes', () => {
    expect(describeLibrary(librarySummary([row()]))).toBe('');
  });
});
