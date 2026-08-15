// What you actually know, per block.
//
// The canvas and the flashcards were two features that happened to share data:
// you studied, learned something about yourself, and then went back to a canvas
// that looked exactly as it had before. Every block was the same shade of "some
// notes". The evidence existed — the review rows already record how much of each
// card came back — it just never made it back onto the thing you look at.
//
// So: four states, derived from the review row, shown on the block itself.
//
//   Untested   there are notes here, and you have never been asked about them
//   Weak       last time, less than 60% of the points came back
//   Learning   you recalled it, but not enough times running to call it known
//   Mastered   you recalled it well, three sessions running
//
// Pure and time-free on purpose. Mastery answers "what do I know", the due count
// already answers "what should I study now", and blending the two makes both
// harder to read: a card can be perfectly well known and also due, and a card can
// be badly known and not due for a week. Keeping them separate means the colour
// on a block never changes just because you left the tab open overnight.

import { gradeFor } from './review';

// Three successful reviews running. It is `reps` rather than the interval
// because reps is the direct evidence — "you got this back three times" — and
// the interval is only a function of it anyway. A lapse resets reps to 0, so a
// mastered card you then fail drops to Weak and has to earn it back, which is
// the honest behaviour.
export const MASTERED_REPS = 3;

// A grade of `hard` or `again` — under 60% of the points. Above that you did
// recall the card, even if not perfectly.
const WEAK_GRADES = new Set(['again', 'hard']);

export const MASTERY = {
  weak: {
    key: 'weak',
    label: 'Weak',
    // Kept short: it goes in a tooltip under a longer sentence about the score.
    detail: 'Less than 60% of this block came back last time.',
    color: 'var(--color-danger)',
    pill: 'border-danger/30 bg-danger-bg text-danger',
    bar: 'bg-danger',
  },
  learning: {
    key: 'learning',
    label: 'Learning',
    detail: 'Recalled, but not yet enough times running to call it known.',
    color: 'var(--color-warn)',
    pill: 'border-warn-line bg-warn-bg text-warn',
    bar: 'bg-warn',
  },
  mastered: {
    key: 'mastered',
    label: 'Mastered',
    detail: `Recalled well ${MASTERED_REPS} sessions running.`,
    color: 'var(--color-good)',
    pill: 'border-good-line bg-good-bg text-good',
    bar: 'bg-good',
  },
  untested: {
    key: 'untested',
    label: 'Untested',
    detail: 'Notes you have never been quizzed on.',
    color: 'var(--color-subink)',
    // Outline only. On a fresh canvas every block is untested, and forty filled
    // grey badges would be forty pieces of noise carrying one bit between them.
    pill: 'border-line2 text-subink/70',
    bar: 'bg-line2',
  },
};

// Worst first, which is the order you want to read them in — the point of the
// feature is finding the weak ones. Untested trails because it is the absence of
// evidence rather than bad evidence.
export const MASTERY_ORDER = ['weak', 'learning', 'mastered', 'untested'];

export function isMasteryLevel(value) {
  return Object.hasOwn(MASTERY, value);
}

// The level for one review row. `hasNotes` is separate because a block with no
// notes is not a card at all — see masteryOf.
export function masteryFor(state, { hasNotes = true } = {}) {
  if (!hasNotes) return null;
  if (!state?.reviewedAt && !state?.dueAt) return 'untested';

  // The stored row carries the grade, but an older row (or a hand-written one)
  // may only have the score, so fall back to recomputing it.
  const grade = state.lastGrade ?? gradeFor(state.lastScore?.recalled ?? 0, state.lastScore?.total ?? 0);
  if (WEAK_GRADES.has(grade)) return 'weak';
  return (state.reps ?? 0) >= MASTERED_REPS ? 'mastered' : 'learning';
}

// The level for a canvas node. Returns null for a block with nothing written in
// it: "untested" would be a lie about a block that cannot be tested, and the
// distinction is the one that tells you whether to go and write something.
export function masteryOf(node, reviewsByBlock = {}) {
  const hasNotes = Boolean(node?.data?.notes?.trim());
  return masteryFor(reviewsByBlock[node?.id], { hasNotes });
}

// Every block's level in one pass, so the canvas can render without doing this
// per node on every frame.
export function masteryByBlock(nodes = [], reviewsByBlock = {}) {
  const out = {};
  for (const node of nodes ?? []) {
    if (!node?.id) continue;
    const level = masteryOf(node, reviewsByBlock);
    if (level) out[node.id] = level;
  }
  return out;
}

// The canvas's own view: every node carrying its status, ready to render.
//
// References are kept when nothing about a node's status changed, the same way
// withVisibility does it — React Flow re-renders a node whenever its `data`
// object changes identity, and rebuilding all of them on every canvas render
// would undo the memo on the block component.
export function withMastery(nodes = [], reviewsByBlock = {}) {
  return (nodes ?? []).map((node) => {
    const level = masteryOf(node, reviewsByBlock);
    const state = reviewsByBlock?.[node?.id];
    const score = level && level !== 'untested' ? scoreLabel(state) : null;
    const title = level ? describeMastery(level, state) : undefined;

    if (node.data?.mastery === level && node.data?.masteryScore === score) return node;
    return {
      ...node,
      data: { ...node.data, mastery: level, masteryScore: score, masteryTitle: title },
    };
  });
}

function scoreLabel(state) {
  const { recalled, total } = state?.lastScore ?? {};
  if (!Number.isFinite(recalled) || !Number.isFinite(total) || total <= 0) return null;
  return `${recalled}/${total}`;
}

// Counting a level map the caller already has, so the canvas can render the
// blocks and the summary from one pass rather than two.
export function countLevels(levelsByBlock = {}) {
  const counts = { weak: 0, learning: 0, mastered: 0, untested: 0 };
  for (const level of Object.values(levelsByBlock)) {
    if (isMasteryLevel(level)) counts[level] += 1;
  }
  return counts;
}

export function countMastery(nodes = [], reviewsByBlock = {}) {
  return countLevels(masteryByBlock(nodes, reviewsByBlock));
}

// The blocks at one level, in canvas order — what a click on the summary
// actually studies.
export function idsAtLevel(nodes = [], reviewsByBlock = {}, level) {
  const levels = masteryByBlock(nodes, reviewsByBlock);
  return (nodes ?? []).filter((n) => levels[n?.id] === level).map((n) => n.id);
}

// The blocks worth studying first: something you got wrong beats something
// nobody has asked you about yet.
export function weakCardIds(nodes = [], reviewsByBlock = {}) {
  return idsAtLevel(nodes, reviewsByBlock, 'weak');
}

// How a block's status reads on hover. The score is the part worth having: "Weak"
// alone invites an argument, "2 of 5 points" does not.
export function describeMastery(level, state) {
  const meta = MASTERY[level];
  if (!meta) return '';
  if (level === 'untested') return `Untested — ${MASTERY.untested.detail.toLowerCase()}`;

  const { recalled, total } = state?.lastScore ?? {};
  const score =
    Number.isFinite(recalled) && Number.isFinite(total) && total > 0
      ? ` Last session: ${recalled} of ${total} point${total === 1 ? '' : 's'}.`
      : '';
  // Only while it is climbing. On a weak card the rep count is a leftover from
  // before the miss, and "1 of 3 good sessions towards mastered" printed under a
  // card you have just failed reads as encouragement the evidence does not
  // support. On a mastered one there is nothing left to count towards.
  const streak =
    level === 'learning'
      ? ` ${state?.reps ?? 0} of ${MASTERED_REPS} good sessions towards mastered.`
      : '';
  return `${meta.label} — ${meta.detail}${score}${streak}`;
}

// A one-line summary of a canvas, in the panel's own order, mentioning only what
// is actually there.
export function describeMasteryCounts(counts) {
  const parts = MASTERY_ORDER.filter((key) => counts?.[key] > 0).map(
    (key) => `${counts[key]} ${MASTERY[key].label.toLowerCase()}`
  );
  return parts.length ? parts.join(' · ') : 'Nothing to study yet';
}
