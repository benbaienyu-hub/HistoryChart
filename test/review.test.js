import { describe, expect, it } from 'vitest';
import {
  DAY,
  countDue,
  describeDue,
  dueAfter,
  dueCards,
  emptyState,
  gradeFor,
  isDue,
  nextReview,
  scheduleSummary,
  startOfDay,
} from '../src/lib/review';

// A fixed clock: scheduling is arithmetic on timestamps, and a test that depends
// on the real time of day is a test that fails at midnight.
const NOW = startOfDay(Date.UTC(2026, 7, 1)) + 20 * 60 * 60 * 1000; // 20:00
const days = (n) => n * DAY;

const review = (state, recalled, total, now = NOW) => nextReview(state, { recalled, total }, now);

describe('gradeFor', () => {
  it('reads the grade off the fraction of points recalled', () => {
    expect(gradeFor(3, 3)).toBe('easy');
    expect(gradeFor(2, 3)).toBe('good');
    expect(gradeFor(2, 4)).toBe('hard');
    expect(gradeFor(0, 3)).toBe('again');
  });

  it('counts a third of a card as not recalled', () => {
    // A deliberate call, and the one boundary worth stating out loud: getting one
    // point of three is missing two of three, so the card is relearned rather
    // than merely pushed out a little.
    expect(gradeFor(1, 3)).toBe('again');
  });

  it('treats a card with no points as unlearned rather than perfect', () => {
    // 0/0 is not 100%. Scoring it as "easy" would push an empty card out a year.
    expect(gradeFor(0, 0)).toBe('again');
  });

  it('puts the boundaries where the wording implies', () => {
    expect(gradeFor(6, 10)).toBe('good'); // 0.60 exactly
    expect(gradeFor(59, 100)).toBe('hard');
    expect(gradeFor(35, 100)).toBe('hard');
    expect(gradeFor(34, 100)).toBe('again');
    expect(gradeFor(19, 20)).toBe('easy'); // 0.95 exactly
  });
});

describe('the first two reviews', () => {
  it('brings a new card back tomorrow when it went well', () => {
    const state = review(null, 2, 3);
    expect(state.interval).toBe(1);
    expect(state.dueAt).toBe(startOfDay(NOW) + days(1));
    expect(state.reps).toBe(1);
  });

  it('goes out further the second time, and further again the third', () => {
    const first = review(null, 3, 3, NOW);
    const second = review(first, 2, 3, NOW);
    const third = review(second, 2, 3, NOW);
    expect(first.interval).toBe(3); // easy, first review
    expect(second.interval).toBe(3); // good, second review
    expect(third.interval).toBeGreaterThan(second.interval);
  });

  it('does not multiply an interval it has no evidence for', () => {
    // reps 0 and 1 use fixed steps. Multiplying from zero would leave a new card
    // at zero forever; multiplying from one would send it out a month on ease alone.
    expect(review(null, 2, 4).interval).toBe(1); // hard, first review
    expect(review({ ...emptyState(), reps: 1, interval: 1 }, 2, 4).interval).toBe(2);
  });
});

describe('a card you missed', () => {
  it('comes straight back', () => {
    const state = review({ interval: 40, ease: 2.3, reps: 6, lapses: 0 }, 0, 4);
    expect(state.interval).toBe(0);
    expect(state.dueAt).toBe(NOW);
    expect(isDue(state, NOW)).toBe(true);
  });

  it('loses its streak, so it climbs back through the early steps', () => {
    // Without this a lapsed card resumes its month-long gap, which is how you
    // forget something twice.
    const state = review({ interval: 40, ease: 2.3, reps: 6, lapses: 1 }, 0, 4);
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(2);
    expect(review(state, 2, 4).interval).toBe(1);
  });

  it('gets harder to push out again', () => {
    const missed = review({ interval: 10, ease: 2.3, reps: 3, lapses: 0 }, 0, 4);
    expect(missed.ease).toBeLessThan(2.3);
  });
});

describe('ease', () => {
  it('drifts up on easy answers and down on hard ones', () => {
    const start = emptyState();
    expect(review(start, 4, 4).ease).toBeGreaterThan(start.ease); // easy
    expect(review(start, 3, 5).ease).toBe(start.ease); // good leaves it alone
    expect(review(start, 2, 4).ease).toBeLessThan(start.ease); // hard
  });

  it('never leaves the range where intervals still grow sensibly', () => {
    // Below ~1.3 a card barely moves and you see it forever; far above 2.8 it
    // vanishes for months after two good answers.
    let state = emptyState();
    for (let i = 0; i < 30; i++) state = review(state, 0, 4);
    expect(state.ease).toBeGreaterThanOrEqual(1.3);

    state = emptyState();
    for (let i = 0; i < 30; i++) state = review(state, 4, 4);
    expect(state.ease).toBeLessThanOrEqual(2.8);
  });
});

describe('intervals over a long run', () => {
  it('grows but is capped at a year', () => {
    let state = emptyState();
    for (let i = 0; i < 40; i++) state = review(state, 4, 4, NOW);
    expect(state.interval).toBe(365);
  });

  it('always produces a whole number of days', () => {
    let state = emptyState();
    for (let i = 0; i < 12; i++) {
      state = review(state, 3, 4, NOW);
      expect(Number.isInteger(state.interval), `rep ${i}`).toBe(true);
    }
  });
});

describe('due dates land on days, not on the minute', () => {
  it('a one-day interval means tomorrow, whatever time you studied', () => {
    // Studied at 20:00 and again at 19:00 tomorrow: with a strict 24-hour clock
    // that would not be due, and every session would drift an hour later.
    const state = review(null, 2, 3, NOW);
    const nextEvening = NOW + days(1) - 60 * 60 * 1000;
    expect(isDue(state, nextEvening)).toBe(true);
  });

  it('but "again" is due immediately, not tomorrow', () => {
    const state = review(null, 0, 3, NOW);
    expect(isDue(state, NOW)).toBe(true);
    expect(state.dueAt).toBe(NOW);
  });

  it('dueAfter counts from the start of the day', () => {
    expect(dueAfter(2, NOW)).toBe(startOfDay(NOW) + days(2));
    expect(dueAfter(0, NOW)).toBe(NOW);
  });
});

describe('isDue', () => {
  it('treats a card that has never been studied as due', () => {
    expect(isDue(null)).toBe(true);
    expect(isDue(undefined)).toBe(true);
    expect(isDue({})).toBe(true);
  });

  it('is due once the moment arrives, not after it passes', () => {
    const state = { dueAt: NOW };
    expect(isDue(state, NOW)).toBe(true);
    expect(isDue(state, NOW - 1)).toBe(false);
  });
});

describe('describeDue', () => {
  it('says it the way a person would', () => {
    expect(describeDue(null)).toBe('new');
    expect(describeDue({ dueAt: NOW }, NOW)).toBe('due now');
    expect(describeDue({ dueAt: NOW - days(3) }, NOW)).toBe('due now');
    expect(describeDue({ dueAt: NOW + days(1) }, NOW)).toBe('tomorrow');
    expect(describeDue({ dueAt: NOW + days(4) }, NOW)).toBe('in 4 days');
    expect(describeDue({ dueAt: NOW + days(14) }, NOW)).toBe('in 2 weeks');
    expect(describeDue({ dueAt: NOW + days(90) }, NOW)).toBe('in 3 months');
  });
});

describe('picking what to study', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('includes new cards and overdue ones, and leaves the rest alone', () => {
    const reviews = {
      b: { dueAt: NOW - days(1) },
      c: { dueAt: NOW + days(5) },
    };
    expect(dueCards(cards, reviews, NOW).map((c) => c.id)).toEqual(['a', 'b']);
    expect(countDue(cards, reviews, NOW)).toBe(2);
  });

  it('counts everything when nothing has been studied', () => {
    expect(countDue(cards, {}, NOW)).toBe(3);
    expect(countDue(cards, undefined, NOW)).toBe(3);
  });

  it('counts nothing on an empty canvas', () => {
    expect(countDue([], {}, NOW)).toBe(0);
    expect(countDue(undefined, {}, NOW)).toBe(0);
  });
});

describe('scheduleSummary', () => {
  it('groups where a session left things', () => {
    const states = [
      { dueAt: NOW },
      { dueAt: NOW + days(1) },
      { dueAt: NOW + days(1) },
      { dueAt: NOW + days(9) },
    ];
    expect(scheduleSummary(states, NOW)).toEqual({ 'due now': 1, tomorrow: 2, later: 1 });
  });

  it('is all zeroes for nothing', () => {
    expect(scheduleSummary([], NOW)).toEqual({ 'due now': 0, tomorrow: 0, later: 0 });
  });
});
