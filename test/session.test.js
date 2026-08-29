import { describe, expect, it } from 'vitest';
import {
  REASK_SPACING,
  finalGrades,
  gapCardId,
  gapCards,
  isGapCardId,
  reinsert,
  sessionLength,
  shouldReask,
} from '../src/lib/session';
import { splitPoints } from '../src/lib/deck';

const gap = (over = {}) => ({
  id: 'missing-weimar-republic',
  kind: 'missing',
  blockLabel: 'Versailles',
  title: 'The Weimar Republic',
  question: 'What replaced the Kaiserreich after 1918?',
  answer: 'The Weimar Republic, founded in 1919. It lasted until 1933.',
  ...over,
});

describe('gapCards', () => {
  it('turns a stored question into an ordinary card', () => {
    // The point of doing it this way: everything downstream — grading, the
    // summary, the scheduler — needs no idea that this card came from a scan.
    const [card] = gapCards([gap()]);
    expect(card).toMatchObject({
      id: gapCardId('missing-weimar-republic'),
      label: 'What replaced the Kaiserreich after 1918?',
      notes: 'The Weimar Republic, founded in 1919. It lasted until 1933.',
    });
    // Split by the same rule as any other card, so a two-sentence answer is
    // graded per point exactly like notes are.
    expect(card.points).toEqual(splitPoints(card.notes));
  });

  it('splits a multi-point answer into points to tick off', () => {
    const [card] = gapCards([
      gap({
        answer:
          'The Weimar Republic was founded in 1919. Hyperinflation destroyed savings in 1923.',
      }),
    ]);
    expect(card.points).toHaveLength(2);
  });

  it('marks the card as not your own writing', () => {
    // The rest of the deck is what you wrote. Quietly mixing in somebody else's
    // answer would blur the one distinction this app is built on.
    const [card] = gapCards([gap()]);
    expect(card.gap).toEqual({ kind: 'missing', about: 'Versailles' });
  });

  it('includes questions about things missing from your notes', () => {
    // Exactly what the panel's "Test me" button asks. There is no reason it
    // should only be available in the panel — being asked is the point.
    const cards = gapCards([
      gap({ id: 'a', kind: 'missing' }),
      gap({ id: 'b', kind: 'incorrect' }),
      gap({ id: 'c', kind: 'incomplete' }),
    ]);
    expect(cards).toHaveLength(3);
  });

  it('drops a gap with no question or no answer, which is not a card', () => {
    expect(gapCards([gap({ question: '' })])).toEqual([]);
    expect(gapCards([gap({ answer: '   ' })])).toEqual([]);
    expect(gapCards([gap({ id: null })])).toEqual([]);
  });

  it('carries a source through for a mixed session', () => {
    expect(gapCards([gap()], { source: 'Cold War' })[0].source).toBe('Cold War');
  });

  it('gives ids that cannot be mistaken for a block', () => {
    // The review row this builds up has to be recognisable as belonging to a
    // question rather than to a block.
    const [card] = gapCards([gap()]);
    expect(isGapCardId(card.id)).toBe(true);
    expect(isGapCardId('9c1f-a-real-block-id')).toBe(false);
  });

  it('survives junk', () => {
    expect(gapCards()).toEqual([]);
    expect(gapCards([null, {}, undefined])).toEqual([]);
  });
});

describe('shouldReask', () => {
  it('brings back a card you barely had', () => {
    // The same threshold the rest of the app calls weak, so the card that would
    // be marked Weak on the canvas is exactly the card that comes back here.
    expect(shouldReask({ recalled: 0, total: 3 })).toBe(true);
    expect(shouldReask({ recalled: 1, total: 3 })).toBe(true);
  });

  it('leaves a card you mostly had alone', () => {
    expect(shouldReask({ recalled: 2, total: 3 })).toBe(false);
    expect(shouldReask({ recalled: 3, total: 3 })).toBe(false);
  });

  it('has nothing to say about a card with no points', () => {
    expect(shouldReask({ recalled: 0, total: 0 })).toBe(false);
    expect(shouldReask()).toBe(false);
  });
});

describe('reinsert', () => {
  const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('puts the card back a few cards later, not next', () => {
    // Far enough that you are recalling it rather than reading it off the screen
    // you were just looking at.
    const next = reinsert(queue, 0, 'a');
    expect(next[REASK_SPACING]).toBe('a');
    expect(next).toHaveLength(queue.length + 1);
  });

  it('puts it at the end when the session is nearly over', () => {
    const next = reinsert(queue, 7, 'h');
    expect(next[next.length - 1]).toBe('h');
  });

  it('asks a card twice at most', () => {
    // A card you keep failing would otherwise loop until you gave up or guessed.
    // The scheduler already has a plan for something you cannot recall: tomorrow.
    const once = reinsert(queue, 0, 'a');
    const twice = reinsert(once, REASK_SPACING, 'a');
    expect(twice).toEqual(once);
  });

  it('leaves the queue alone when given nothing to add', () => {
    expect(reinsert(queue, 0, null)).toEqual(queue);
    expect(reinsert(undefined, 0, 'a')).toEqual(['a']);
  });

  it('does not disturb what has already been seen', () => {
    const next = reinsert(queue, 3, 'a');
    expect(next.slice(0, 4)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('finalGrades', () => {
  it('keeps only the last attempt at a card', () => {
    // A re-asked card is graded twice and only the second counts — it is the
    // current state of your recall. Submitting both would file two schedules for
    // one block and count it twice in the score.
    const grades = [
      { id: 'a', recalled: 0, total: 2 },
      { id: 'b', recalled: 2, total: 2 },
      { id: 'a', recalled: 2, total: 2 },
    ];
    expect(finalGrades(grades)).toEqual([
      { id: 'a', recalled: 2, total: 2 },
      { id: 'b', recalled: 2, total: 2 },
    ]);
  });

  it('leaves a session with no repeats untouched', () => {
    const grades = [{ id: 'a', recalled: 1, total: 1 }];
    expect(finalGrades(grades)).toEqual(grades);
  });

  it('survives junk', () => {
    expect(finalGrades()).toEqual([]);
    expect(finalGrades([null, {}, { id: 'a' }])).toEqual([{ id: 'a' }]);
  });
});

describe('sessionLength', () => {
  it('counts the cards queued, including ones coming back', () => {
    expect(sessionLength(reinsert(['a', 'b'], 0, 'a'))).toBe(3);
    expect(sessionLength()).toBe(0);
  });
});
