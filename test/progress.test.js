import { describe, expect, it } from 'vitest';
import {
  canvasProgress,
  coverageScore,
  describeCoverage,
  describeMasteryScore,
  formatPct,
  masteryScore,
  notesSignature,
} from '../src/lib/progress';

const node = (id, notes = '', label = id) => ({ id, position: { x: 0, y: 0 }, data: { label, notes } });
const gap = (kind, id = `${kind}-1`) => ({ id, kind });
const scored = (recalled, total) => ({ lastScore: { recalled, total }, reviewedAt: 1 });

describe('coverageScore', () => {
  it('is the share of blocks that have anything written in them', () => {
    const nodes = [node('a', '- one'), node('b', '- two'), node('c'), node('d')];
    expect(coverageScore(nodes)).toMatchObject({ written: 2, empty: 2, total: 4, pct: 50 });
  });

  it('counts a missing gap as something that belongs here and is not here', () => {
    // The whole reason coverage can be below 100 on a canvas with no empty
    // blocks: the scan found things that should be on it at all.
    const nodes = [node('a', '- one'), node('b', '- two')];
    expect(coverageScore(nodes, [gap('missing'), gap('missing', 'm2')])).toMatchObject({
      written: 2,
      empty: 0,
      missing: 2,
      total: 4,
      pct: 50,
    });
  });

  it('ignores incorrect and incomplete gaps, which are about blocks that exist', () => {
    // Those are a mastery-shaped problem. Counting them here would mark the same
    // block down twice for the same fault.
    const nodes = [node('a', '- one')];
    const gaps = [gap('incorrect'), gap('incomplete')];
    expect(coverageScore(nodes, gaps)).toMatchObject({ missing: 0, pct: 100 });
  });

  it('is 100% for a canvas that is written and has been found sound', () => {
    expect(coverageScore([node('a', '- one')], []).pct).toBe(100);
  });

  it('treats whitespace as unwritten', () => {
    expect(coverageScore([node('a', '   \n ')]).pct).toBe(0);
  });

  it('skips things that are not blocks', () => {
    expect(coverageScore([node('a', '- one'), { id: 'b', data: { label: '  ' } }]).total).toBe(1);
  });

  it('is nothing at all for an empty canvas, rather than zero', () => {
    // 0% reads as a failure. An empty canvas has not failed at anything.
    expect(coverageScore([])).toBeNull();
    expect(coverageScore(undefined)).toBeNull();
  });

  it('rounds to whole percents', () => {
    const nodes = [node('a', '- x'), node('b'), node('c')];
    expect(coverageScore(nodes).pct).toBe(33);
  });
});

describe('masteryScore', () => {
  const nodes = [node('a', '- one\n- two'), node('b', '- three\n- four')];

  it('is the share of points that came back last time', () => {
    const reviews = { a: scored(2, 2), b: scored(1, 2) };
    expect(masteryScore(nodes, reviews)).toMatchObject({ recalled: 3, total: 4, pct: 75 });
  });

  it('counts a card never studied as none of it known', () => {
    // The uncomfortable one, and the right one: not having checked is not
    // evidence of knowing. Excluding untested cards would let a canvas where one
    // card was studied and aced read 100%.
    expect(masteryScore(nodes, { a: scored(2, 2) })).toMatchObject({
      recalled: 2,
      total: 4,
      pct: 50,
      tested: 1,
      cards: 2,
    });
  });

  it('reports how many were tested, so a bare 0% can be explained', () => {
    expect(masteryScore(nodes, {})).toMatchObject({ pct: 0, tested: 0, cards: 2 });
  });

  it('measures an old score against the points that are there now', () => {
    // Notes get edited after a session. Scoring 5 out of a card that now has two
    // points would put mastery above 100%.
    const edited = [node('a', '- one\n- two')];
    expect(masteryScore(edited, { a: scored(5, 5) })).toMatchObject({ recalled: 2, pct: 100 });
  });

  it('ignores blocks with no notes, which are not cards', () => {
    expect(masteryScore([node('a', '- one'), node('b')], { a: scored(1, 1) })).toMatchObject({
      cards: 1,
      pct: 100,
    });
  });

  it('is nothing at all when there are no cards', () => {
    expect(masteryScore([node('a')], {})).toBeNull();
    expect(masteryScore([], {})).toBeNull();
  });

  it('survives junk review rows', () => {
    expect(masteryScore(nodes, { a: {}, b: { lastScore: null } })).toMatchObject({ pct: 0 });
    expect(masteryScore(nodes, undefined).pct).toBe(0);
  });
});

describe('the two are genuinely independent', () => {
  // The argument for showing both. These are the two people a single progress
  // bar would describe identically and unhelpfully.
  it('separates lots written and little remembered from little written and all remembered', () => {
    const wide = [node('a', '- one'), node('b', '- two'), node('c', '- three'), node('d', '- four')];
    const wideProgress = canvasProgress({
      nodes: wide,
      gaps: [],
      reviews: { a: scored(1, 1) },
    });

    const deep = [node('a', '- one'), node('b', '- two')];
    const deepProgress = canvasProgress({
      nodes: deep,
      gaps: [gap('missing'), gap('missing', 'm2')],
      reviews: { a: scored(1, 1), b: scored(1, 1) },
    });

    expect(wideProgress.coverage.pct).toBe(100);
    expect(wideProgress.mastery.pct).toBe(25);

    expect(deepProgress.coverage.pct).toBe(50);
    expect(deepProgress.mastery.pct).toBe(100);
  });
});

describe('canvasProgress', () => {
  const nodes = [node('a', '- one'), node('b')];

  it('reports a gap count only when there has been a scan', () => {
    // Zero gaps and never looked are different facts, and showing "0 gaps" for
    // the second one is a claim the app cannot make.
    expect(canvasProgress({ nodes }).gapCount).toBeNull();
    expect(canvasProgress({ nodes }).scanned).toBe(false);
    expect(canvasProgress({ nodes, gaps: [] })).toMatchObject({ scanned: true, gapCount: 0 });
    expect(canvasProgress({ nodes, gaps: [gap('missing')] }).gapCount).toBe(1);
  });

  it('leaves missing gaps out of coverage until they have been scanned for', () => {
    expect(canvasProgress({ nodes }).coverage).toMatchObject({ missing: 0, pct: 50 });
  });

  it('marks a scan stale once the notes it read have been rewritten', () => {
    const signature = notesSignature(nodes);
    expect(canvasProgress({ nodes, gaps: [], signature }).stale).toBe(false);

    const edited = [node('a', '- something else entirely'), node('b')];
    expect(canvasProgress({ nodes: edited, gaps: [], signature }).stale).toBe(true);
  });

  it('does not call a scan stale merely because the canvas was saved', () => {
    // The bug this replaced: staleness compared timestamps, and the canvas saves
    // itself for all sorts of reasons that leave the words alone — including
    // immediately after a scan, so almost every scan reported itself out of date
    // the moment it finished.
    const moved = [
      { ...node('a', '- one'), position: { x: 900, y: 900 } },
      { ...node('b'), position: { x: 5, y: 5 } },
    ];
    expect(canvasProgress({ nodes: moved, gaps: [], signature: notesSignature(nodes) }).stale).toBe(
      false
    );
  });

  it('is never stale when there is no signature to compare against', () => {
    expect(canvasProgress({ nodes, gaps: [], signature: null }).stale).toBe(false);
  });
});

describe('notesSignature', () => {
  it('changes when a note is edited', () => {
    expect(notesSignature([node('a', '- one')])).not.toBe(notesSignature([node('a', '- two')]));
  });

  it('changes when a label is renamed', () => {
    expect(notesSignature([node('a', '- one', 'First')])).not.toBe(
      notesSignature([node('a', '- one', 'Second')])
    );
  });

  it('changes when a block is added or removed', () => {
    const one = notesSignature([node('a', '- one')]);
    expect(notesSignature([node('a', '- one'), node('b', '- two')])).not.toBe(one);
  });

  it('does not change when blocks are merely reordered', () => {
    // Dragging blocks around is not rewriting them, and a gap count that went
    // stale every time you tidied the layout would be noise.
    const a = node('a', '- one');
    const b = node('b', '- two');
    expect(notesSignature([a, b])).toBe(notesSignature([b, a]));
  });

  it('is stable for the same content', () => {
    expect(notesSignature([node('a', '- one')])).toBe(notesSignature([node('a', '- one')]));
  });

  it('survives junk', () => {
    expect(typeof notesSignature([null, {}, undefined])).toBe('string');
    expect(typeof notesSignature()).toBe('string');
  });

  it('survives being handed nothing', () => {
    expect(canvasProgress()).toMatchObject({ coverage: null, mastery: null, scanned: false });
  });
});

describe('how the numbers read', () => {
  it('shows a dash rather than a zero for something unmeasurable', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct({ pct: 0 })).toBe('0%');
    expect(formatPct({ pct: 81 })).toBe('81%');
  });

  it('says what coverage is a percentage of', () => {
    const score = coverageScore([node('a', '- one'), node('b')], [gap('missing')]);
    const text = describeCoverage(score, { scanned: true });
    expect(text).toContain('1 of 3 written');
    expect(text).toContain('1 block still empty');
    expect(text).toContain('1 missing from the last scan');
  });

  it('admits coverage means little before a scan', () => {
    const text = describeCoverage(coverageScore([node('a', '- one')]), { scanned: false });
    expect(text).toMatch(/Scan for gaps/);
  });

  it('explains a zero that only means "not studied yet"', () => {
    const text = describeMasteryScore(masteryScore([node('a', '- one')], {}));
    expect(text).toMatch(/none studied yet/);
    expect(text).not.toMatch(/came back/);
  });

  it('says how many cards are being counted as unknown', () => {
    const score = masteryScore([node('a', '- one'), node('b', '- two')], { a: scored(1, 1) });
    expect(describeMasteryScore(score)).toContain('1 of 2 cards still unstudied');
  });

  it('has something to say about an empty canvas', () => {
    expect(describeCoverage(null)).toMatch(/Nothing written/);
    expect(describeMasteryScore(null)).toMatch(/No cards/);
  });
});
