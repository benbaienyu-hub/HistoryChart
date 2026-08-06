// Spaced repetition: when a card should come back.
//
// The idea it rests on is that recall decays, and the moment just before you'd
// forget something is when reviewing it does the most good. So a card you knew
// cold goes away for longer each time, and a card you missed comes straight back.
//
// This is SM-2 in outline — an interval multiplied by a per-card ease factor that
// drifts up when you find something easy and down when you don't. It is
// deliberately not a faithful SM-2 implementation: that algorithm takes a 0–5
// self-rating per card, and this app already produces something better, namely the
// *fraction of a card's points* you actually recalled. The grade comes from real
// evidence rather than from asking "how hard was that?".
//
// Shared by the client (to count what's due) and the server (which owns the
// scheduling), so the numbers can never disagree.

export const DAY = 24 * 60 * 60 * 1000;

// Ease is how fast a card's interval grows. 2.3 is a middling start: a card you
// keep getting right roughly doubles its interval each time.
const START_EASE = 2.3;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;

// A year is far enough out that anything beyond it is noise, and it keeps a
// long-known card from disappearing for a decade.
const MAX_INTERVAL_DAYS = 365;

// What a fraction of recalled points counts as. The boundaries matter: 0.6 is
// "most of it", below 0.35 means the card did not really come back at all.
export const GRADES = ['again', 'hard', 'good', 'easy'];

export function gradeFor(recalled, total) {
  if (!total) return 'again';
  const ratio = recalled / total;
  if (ratio >= 0.95) return 'easy';
  if (ratio >= 0.6) return 'good';
  if (ratio >= 0.35) return 'hard';
  return 'again';
}

const EASE_DELTA = { again: -0.25, hard: -0.12, good: 0, easy: 0.12 };

// The first two intervals are fixed rather than computed. Early on there is no
// evidence to multiply — a card seen once and answered well should come back
// tomorrow whatever its ease happens to be.
const FIRST = { again: 0, hard: 1, good: 1, easy: 3 };
const SECOND = { again: 0, hard: 2, good: 3, easy: 6 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function emptyState() {
  return { interval: 0, ease: START_EASE, reps: 0, lapses: 0 };
}

// Given what the card knew before and how the review went, say what it should look
// like now. Pure: `now` is passed in so tests don't depend on the clock.
export function nextReview(state, { recalled, total }, now = Date.now()) {
  const previous = { ...emptyState(), ...(state ?? {}) };
  const grade = gradeFor(recalled, total);
  const ease = clamp(previous.ease + EASE_DELTA[grade], MIN_EASE, MAX_EASE);

  let interval;
  if (grade === 'again') {
    interval = 0;
  } else if (previous.reps === 0) {
    interval = FIRST[grade];
  } else if (previous.reps === 1) {
    interval = SECOND[grade];
  } else {
    interval = Math.round(previous.interval * ease);
  }
  interval = clamp(interval, 0, MAX_INTERVAL_DAYS);

  return {
    interval,
    ease,
    // A lapse resets the streak: the card is being learned again, so it goes back
    // through the early intervals rather than resuming a month-long gap.
    reps: grade === 'again' ? 0 : previous.reps + 1,
    lapses: previous.lapses + (grade === 'again' ? 1 : 0),
    lastGrade: grade,
    lastScore: { recalled, total },
    reviewedAt: now,
    dueAt: dueAfter(interval, now),
  };
}

// Intervals are in days, and a day means "the day", not 24 hours from this
// minute. Studying at 21:00 and again at 20:00 the next evening should count as a
// day later — with a strict 24-hour clock it wouldn't, and cards would drift an
// hour later every session until they fell off the end of the day.
export function dueAfter(intervalDays, now = Date.now()) {
  if (intervalDays <= 0) return now;
  return startOfDay(now) + intervalDays * DAY;
}

export function startOfDay(ts) {
  return Math.floor(ts / DAY) * DAY;
}

export function isDue(state, now = Date.now()) {
  // No state at all means never studied, which is due by definition — a new card
  // is the most overdue card there is.
  if (!state?.dueAt) return true;
  return state.dueAt <= now;
}

// How the schedule reads to a person. "Tomorrow" is friendlier than "in 1 day",
// and anything under a day is "today" because that is what it means in practice.
export function describeDue(state, now = Date.now()) {
  if (!state?.dueAt) return 'new';
  const days = Math.round((startOfDay(state.dueAt) - startOfDay(now)) / DAY);
  if (days <= 0) return 'due now';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  if (days < 30) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

// Which of a canvas's cards are due, given the review rows for this user. Cards
// with no row have never been studied and come first.
export function dueCards(cards, reviewsByBlock, now = Date.now()) {
  return (cards ?? []).filter((card) => isDue(reviewsByBlock?.[card.id], now));
}

export function countDue(cards, reviewsByBlock, now = Date.now()) {
  return dueCards(cards, reviewsByBlock, now).length;
}

// A summary of where a session left things, for the end-of-session screen: people
// want to know when they'll see this again.
export function scheduleSummary(states, now = Date.now()) {
  const buckets = { 'due now': 0, tomorrow: 0, later: 0 };
  for (const state of states ?? []) {
    const label = describeDue(state, now);
    if (label === 'due now') buckets['due now'] += 1;
    else if (label === 'tomorrow') buckets.tomorrow += 1;
    else buckets.later += 1;
  }
  return buckets;
}
