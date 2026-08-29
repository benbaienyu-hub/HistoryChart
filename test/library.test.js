import { describe, expect, it } from 'vitest';
import {
  describeLibrary,
  groupGradesByCanvas,
  librarySummary,
  mergeForStudy,
  nextAction,
  splitStudyId,
  studyCardId,
  weakestBlocks,
} from '../src/lib/library';

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
  it('sends you into one canvas when that is where all the due cards are', () => {
    // Recall first: it is the thing that decays, and the only one of these with a
    // deadline attached. One canvas means going there, where you can also see the
    // map you are being tested on.
    const action = nextAction([
      row({ id: 'a', title: 'Cold War', due: 0 }),
      row({ id: 'b', title: 'Cell Biology', due: 9 }),
    ]);
    expect(action).toMatchObject({ kind: 'study', canvasId: 'b', count: 9 });
    expect(action.label).toContain('Cell Biology');
  });

  it('offers one mixed session when the due cards are spread about', () => {
    // Revision does not respect canvas boundaries, and a session per canvas is
    // busywork.
    const action = nextAction([
      row({ id: 'a', title: 'Cold War', due: 2 }),
      row({ id: 'b', title: 'Cell Biology', due: 9 }),
    ]);
    expect(action).toMatchObject({ kind: 'study-all', count: 11 });
    expect(action.canvasId).toBeUndefined();
    expect(action.detail).toContain('2 canvases');
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

describe('merging canvases for one study session', () => {
  const block = (id, label = id) => ({ id, data: { label, notes: '- something' } });
  const src = (id, title, nodes, reviews = {}) => ({ id, title, nodes, reviews });

  it('produces something shaped exactly like a single canvas', () => {
    const { nodes, reviews } = mergeForStudy([
      src('c1', 'Cold War', [block('a')], { a: { lastScore: { recalled: 1, total: 2 } } }),
      src('c2', 'Macro', [block('b')]),
    ]);
    expect(nodes).toHaveLength(2);
    expect(reviews[studyCardId('c1', 'a')]).toEqual({ lastScore: { recalled: 1, total: 2 } });
  });

  it('namespaces block ids, so two canvases from one template cannot collide', () => {
    // Blocks made by hand get UUIDs, but canvases built from the same template
    // carry the same ids. A collision would merge two different Yaltas into one
    // card and file the grade against whichever canvas answered last.
    const { nodes, reviews } = mergeForStudy([
      src('c1', 'One', [block('b1', 'Yalta')], { b1: { lastScore: { recalled: 0, total: 2 } } }),
      src('c2', 'Two', [block('b1', 'Potsdam')], { b1: { lastScore: { recalled: 2, total: 2 } } }),
    ]);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(2);
    expect(Object.keys(reviews)).toHaveLength(2);
    expect(nodes.map((n) => n.data.label)).toEqual(['Yalta', 'Potsdam']);
  });

  it('tells each block which canvas it came from', () => {
    // "1876" means different things in a history deck and a chemistry one. A
    // mixed session without the source is a quiz with the context removed.
    const { nodes } = mergeForStudy([src('c1', 'Cold War', [block('a')])]);
    expect(nodes[0].data.source).toBe('Cold War');
  });

  it('keeps the rest of a block untouched', () => {
    const rich = { id: 'a', position: { x: 4, y: 5 }, data: { label: 'A', notes: '- x', unsure: true } };
    const { nodes } = mergeForStudy([src('c1', 'Cold War', [rich])]);
    expect(nodes[0]).toMatchObject({ position: { x: 4, y: 5 } });
    expect(nodes[0].data).toMatchObject({ label: 'A', notes: '- x', unsure: true });
  });

  it('carries no review row for a block that has never been studied', () => {
    const { reviews } = mergeForStudy([src('c1', 'Cold War', [block('a')])]);
    expect(reviews).toEqual({});
  });

  it('survives junk', () => {
    expect(mergeForStudy()).toEqual({ nodes: [], reviews: {} });
    expect(mergeForStudy([null, { id: null }, { id: 'c', nodes: null }])).toEqual({
      nodes: [],
      reviews: {},
    });
  });
});

describe('splitStudyId and groupGradesByCanvas', () => {
  it('round-trips an id', () => {
    expect(splitStudyId(studyCardId('c1', 'block-9'))).toEqual({
      canvasId: 'c1',
      blockId: 'block-9',
    });
  });

  it('survives a block id that itself contains the separator', () => {
    // Only the first separator counts, so the canvas id is always recovered whole.
    expect(splitStudyId(studyCardId('c1', 'odd::name'))).toEqual({
      canvasId: 'c1',
      blockId: 'odd::name',
    });
  });

  it('reports no canvas for a plain id rather than inventing one', () => {
    expect(splitStudyId('just-a-block')).toEqual({ canvasId: null, blockId: 'just-a-block' });
  });

  it('files each grade against the canvas its card came from', () => {
    const grouped = groupGradesByCanvas([
      { id: studyCardId('c1', 'a'), recalled: 1, total: 2 },
      { id: studyCardId('c2', 'b'), recalled: 2, total: 2 },
      { id: studyCardId('c1', 'c'), recalled: 0, total: 1 },
    ]);
    expect([...grouped.keys()]).toEqual(['c1', 'c2']);
    expect(grouped.get('c1')).toEqual([
      { id: 'a', recalled: 1, total: 2 },
      { id: 'c', recalled: 0, total: 1 },
    ]);
    // And the block id is restored, since that is what the server knows.
    expect(grouped.get('c2')[0].id).toBe('b');
  });

  it('drops a grade that names no canvas rather than guessing one', () => {
    expect(groupGradesByCanvas([{ id: 'orphan', recalled: 1, total: 1 }]).size).toBe(0);
    expect(groupGradesByCanvas().size).toBe(0);
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
