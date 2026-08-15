import { describe, expect, it } from 'vitest';
import {
  MASTERED_REPS,
  MASTERY,
  MASTERY_ORDER,
  countLevels,
  countMastery,
  describeMastery,
  describeMasteryCounts,
  idsAtLevel,
  isMasteryLevel,
  masteryByBlock,
  masteryFor,
  masteryOf,
  weakCardIds,
  withMastery,
} from '../src/lib/mastery';
import { nextReview } from '../src/lib/review';

const node = (id, notes = '- Something') => ({ id, data: { label: id, notes } });

// Built by putting a card through the real scheduler rather than by hand, so
// these tests break if the two ever disagree about what a review row looks like.
function afterSessions(...scores) {
  let state;
  let now = Date.UTC(2026, 0, 1);
  for (const [recalled, total] of scores) {
    state = nextReview(state, { recalled, total }, now);
    now += 40 * 24 * 60 * 60 * 1000;
  }
  return state;
}

describe('masteryFor', () => {
  it('calls a block with notes and no review history untested', () => {
    expect(masteryFor(undefined)).toBe('untested');
    expect(masteryFor(null)).toBe('untested');
    expect(masteryFor({})).toBe('untested');
  });

  it('is nothing at all for a block with no notes', () => {
    // Not "untested": a block with nothing written in it cannot be tested, and
    // the useful distinction is between "go and study this" and "go and write
    // this". Rendering the same badge for both would lose it.
    expect(masteryFor(undefined, { hasNotes: false })).toBeNull();
    expect(masteryFor(afterSessions([5, 5]), { hasNotes: false })).toBeNull();
  });

  it('is weak when most of the card did not come back', () => {
    expect(masteryFor(afterSessions([0, 5]))).toBe('weak');
    expect(masteryFor(afterSessions([2, 5]))).toBe('weak');
  });

  it('is learning after a good session that has not been repeated', () => {
    expect(masteryFor(afterSessions([4, 5]))).toBe('learning');
    expect(masteryFor(afterSessions([4, 5], [4, 5]))).toBe('learning');
  });

  it(`is mastered after ${MASTERED_REPS} good sessions running`, () => {
    expect(masteryFor(afterSessions([5, 5], [5, 5], [5, 5]))).toBe('mastered');
  });

  it('drops a mastered card straight back to weak when it is failed', () => {
    // The whole reason for the feature: it has to tell you the truth about
    // *now*, not about the best you have ever done.
    const state = afterSessions([5, 5], [5, 5], [5, 5], [1, 5]);
    expect(masteryFor(state)).toBe('weak');
  });

  it('makes a lapsed card earn mastery back rather than resuming it', () => {
    const state = afterSessions([5, 5], [5, 5], [5, 5], [1, 5], [5, 5]);
    expect(masteryFor(state)).toBe('learning');
  });

  it('reads the score when a row has no stored grade', () => {
    // Rows written before `lastGrade` existed, and anything hand-edited.
    expect(masteryFor({ reviewedAt: 1, reps: 4, lastScore: { recalled: 1, total: 5 } })).toBe(
      'weak'
    );
    expect(masteryFor({ reviewedAt: 1, reps: 4, lastScore: { recalled: 5, total: 5 } })).toBe(
      'mastered'
    );
  });

  it('treats a row with neither a grade nor a score as failed, not as mastered', () => {
    // gradeFor(0, 0) is "again". A row this broken should never colour a block
    // green on the strength of its rep count alone.
    expect(masteryFor({ reviewedAt: 1, reps: 9 })).toBe('weak');
  });
});

describe('masteryOf', () => {
  const reviews = { a: afterSessions([5, 5], [5, 5], [5, 5]), b: afterSessions([0, 4]) };

  it('joins a node to its review row', () => {
    expect(masteryOf(node('a'), reviews)).toBe('mastered');
    expect(masteryOf(node('b'), reviews)).toBe('weak');
    expect(masteryOf(node('c'), reviews)).toBe('untested');
  });

  it('ignores blocks with only whitespace in them', () => {
    expect(masteryOf(node('c', '   \n '), reviews)).toBeNull();
    expect(masteryOf(node('c', ''), reviews)).toBeNull();
  });

  it('survives a malformed node', () => {
    expect(masteryOf(undefined, reviews)).toBeNull();
    expect(masteryOf({}, reviews)).toBeNull();
    expect(masteryOf(node('a'), undefined)).toBe('untested');
  });
});

describe('masteryByBlock', () => {
  it('leaves out the blocks that are not cards', () => {
    const map = masteryByBlock([node('a'), node('b', ''), node('c')], {});
    expect(map).toEqual({ a: 'untested', c: 'untested' });
  });

  it('handles junk in the node list', () => {
    expect(masteryByBlock([null, {}, undefined], {})).toEqual({});
    expect(masteryByBlock(undefined, {})).toEqual({});
  });
});

describe('withMastery', () => {
  const nodes = [node('a'), node('b'), node('c', '')];
  const reviews = { a: afterSessions([1, 4]) };

  it('puts the status on the node data the block renders from', () => {
    const [a, b, c] = withMastery(nodes, reviews);
    expect(a.data.mastery).toBe('weak');
    expect(a.data.masteryScore).toBe('1/4');
    expect(a.data.masteryTitle).toMatch(/^Weak —/);
    expect(b.data.mastery).toBe('untested');
    expect(c.data.mastery).toBeNull();
  });

  it('gives an untested block no score to show', () => {
    // There is no last session to report, and "0/0" would read as a failure.
    expect(withMastery([node('b')], {})[0].data.masteryScore).toBeNull();
  });

  it('keeps the node object when nothing about its status changed', () => {
    // React Flow re-renders a node whenever its data identity changes, so
    // rebuilding these every frame would defeat the memo on the block.
    const once = withMastery(nodes, reviews);
    const twice = withMastery(once, reviews);
    expect(twice[0]).toBe(once[0]);
    expect(twice[1]).toBe(once[1]);
    expect(twice[2]).toBe(once[2]);
  });

  it('replaces the node when the status does change', () => {
    const once = withMastery(nodes, reviews);
    const twice = withMastery(once, { a: afterSessions([4, 4]) });
    expect(twice[0]).not.toBe(once[0]);
    expect(twice[0].data.mastery).toBe('learning');
    // And the block that did not change is still the same object.
    expect(twice[1]).toBe(once[1]);
  });

  it('leaves everything else on the node alone', () => {
    const decorated = withMastery([{ ...node('a'), position: { x: 5, y: 6 }, hidden: true }], {});
    expect(decorated[0].position).toEqual({ x: 5, y: 6 });
    expect(decorated[0].hidden).toBe(true);
    expect(decorated[0].data.label).toBe('a');
  });

  it('handles an empty or missing list', () => {
    expect(withMastery([], {})).toEqual([]);
    expect(withMastery(undefined, {})).toEqual([]);
  });
});

describe('countLevels', () => {
  it('counts a level map the caller already built', () => {
    expect(countLevels({ a: 'weak', b: 'weak', c: 'mastered' })).toEqual({
      weak: 2,
      learning: 0,
      mastered: 1,
      untested: 0,
    });
  });

  it('ignores anything that is not a level', () => {
    expect(countLevels({ a: null, b: undefined, c: 'brilliant' })).toEqual({
      weak: 0,
      learning: 0,
      mastered: 0,
      untested: 0,
    });
  });
});

describe('idsAtLevel', () => {
  it('names the blocks at one level, in canvas order', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const reviews = { a: afterSessions([4, 4]), b: afterSessions([0, 4]) };
    expect(idsAtLevel(nodes, reviews, 'learning')).toEqual(['a']);
    expect(idsAtLevel(nodes, reviews, 'untested')).toEqual(['c']);
  });

  it('is empty for a level nothing is at', () => {
    expect(idsAtLevel([node('a')], {}, 'mastered')).toEqual([]);
  });
});

describe('countMastery', () => {
  it('counts every level, including the ones at zero', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d', '')];
    const reviews = { a: afterSessions([0, 4]), b: afterSessions([4, 5]) };
    expect(countMastery(nodes, reviews)).toEqual({
      weak: 1,
      learning: 1,
      mastered: 0,
      // `d` has no notes, so it is not counted anywhere — the totals are of
      // cards, not of blocks.
      untested: 1,
    });
  });

  it('is all zeroes for an empty canvas', () => {
    expect(countMastery([], {})).toEqual({ weak: 0, learning: 0, mastered: 0, untested: 0 });
  });
});

describe('weakCardIds', () => {
  it('names the blocks that need work, in canvas order', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const reviews = { a: afterSessions([0, 4]), c: afterSessions([1, 4]) };
    expect(weakCardIds(nodes, reviews)).toEqual(['a', 'c']);
  });

  it('does not count untested blocks as weak', () => {
    // They may be fine. Nobody has asked.
    expect(weakCardIds([node('a')], {})).toEqual([]);
  });
});

describe('describeMastery', () => {
  it('gives the score, which is the part that settles an argument', () => {
    const text = describeMastery('weak', afterSessions([2, 5]));
    expect(text).toMatch(/^Weak —/);
    expect(text).toContain('2 of 5 points');
  });

  it('says how far off mastered a learning card is', () => {
    expect(describeMastery('learning', afterSessions([5, 5]))).toContain(
      `1 of ${MASTERED_REPS} good sessions`
    );
  });

  it('stops counting sessions once the card is mastered', () => {
    expect(describeMastery('mastered', afterSessions([5, 5], [5, 5], [5, 5]))).not.toMatch(
      /good sessions/
    );
  });

  it('does not congratulate a card that has just been failed', () => {
    // A "hard" grade still increments the rep count, so a weak card can carry a
    // streak — and "1 of 3 good sessions towards mastered" printed under a block
    // you just got half of reads as encouragement the evidence does not support.
    expect(describeMastery('weak', afterSessions([2, 5]))).not.toMatch(/good sessions/);
  });

  it('handles the singular', () => {
    expect(describeMastery('weak', afterSessions([0, 1]))).toContain('0 of 1 point.');
  });

  it('says something sensible for untested, which has no score', () => {
    expect(describeMastery('untested')).toMatch(/never been quizzed/);
  });

  it('is empty rather than broken for a level that does not exist', () => {
    expect(describeMastery(null)).toBe('');
    expect(describeMastery('brilliant')).toBe('');
  });
});

describe('describeMasteryCounts', () => {
  it('reads worst first', () => {
    expect(describeMasteryCounts({ weak: 2, learning: 1, mastered: 3, untested: 4 })).toBe(
      '2 weak · 1 learning · 3 mastered · 4 untested'
    );
  });

  it('mentions only what is there', () => {
    expect(describeMasteryCounts({ weak: 0, learning: 0, mastered: 3, untested: 0 })).toBe(
      '3 mastered'
    );
  });

  it('says so plainly when there is nothing to count', () => {
    expect(describeMasteryCounts({ weak: 0, learning: 0, mastered: 0, untested: 0 })).toBe(
      'Nothing to study yet'
    );
    expect(describeMasteryCounts(undefined)).toBe('Nothing to study yet');
  });
});

describe('the levels themselves', () => {
  it('recognises exactly the four', () => {
    expect(MASTERY_ORDER).toEqual(['weak', 'learning', 'mastered', 'untested']);
    expect(MASTERY_ORDER.every(isMasteryLevel)).toBe(true);
    expect(isMasteryLevel('perfect')).toBe(false);
  });

  it('gives every level everything the UI reads off it', () => {
    for (const key of MASTERY_ORDER) {
      expect(MASTERY[key]).toMatchObject({
        key,
        label: expect.any(String),
        detail: expect.any(String),
        color: expect.any(String),
        pill: expect.any(String),
        bar: expect.any(String),
      });
    }
  });

  it('leads with the weak ones, because that is what the feature is for', () => {
    expect(MASTERY_ORDER[0]).toBe('weak');
  });
});
