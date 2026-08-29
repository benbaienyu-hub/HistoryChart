// What a study session is made of, and how it reacts to you.
//
// Two things live here, both of them about the same complaint: every card was the
// same move. A block title, tell me everything, tick what you had, next — with a
// deck that never varied and never paid attention.
//
//   1. The questions the gap scan already wrote become real cards.
//   2. A card you barely got comes back later in the same session.
//
// Pure, and deliberately shaped so the study component barely changes: a gap card
// is just a card, and the queue is just a list of ids.

import { splitPoints } from './deck.js';
import { gradeFor } from './review.js';

// Gap cards are namespaced so they cannot collide with a block id, and so the
// review row they build up is recognisable as belonging to a question rather
// than to a block. Mastery and coverage read blocks only, so a question you keep
// failing never drags down a percentage about your writing — which is right:
// those numbers are about what you wrote, and this is about what you did not.
const GAP_PREFIX = 'gap:';

export function gapCardId(gapId) {
  return `${GAP_PREFIX}${gapId}`;
}

export function isGapCardId(id) {
  return String(id ?? '').startsWith(GAP_PREFIX);
}

// The stored scan, as cards.
//
// Every kind is included, `missing` ones too. A question about something absent
// from your notes is exactly what the panel's "Test me" button asks, and there is
// no reason it should only be available in the panel — being asked is the point.
export function gapCards(gaps = [], { source = null } = {}) {
  return (gaps ?? [])
    .filter((gap) => gap?.id && (gap.question ?? '').trim() && (gap.answer ?? '').trim())
    .map((gap) => ({
      // `studyId` is set when several canvases have been merged: the id then has
      // to carry which canvas it belongs to, or the grade is filed against the
      // wrong one. Ordinary sessions never set it.
      id: gap.studyId ?? gapCardId(gap.id),
      // The question *is* the prompt, which is the whole point: a real question
      // beats a bare block label as a cue to recall against.
      label: gap.question.trim(),
      notes: gap.answer.trim(),
      points: splitPoints(gap.answer),
      date: '',
      category: 'none',
      unsure: false,
      images: [],
      source: gap.source ?? source,
      // So the card can say whose words these are. Marking it is not decoration:
      // the rest of the deck is your own writing, and quietly mixing in an answer
      // somebody else wrote would blur the one distinction this app is built on.
      gap: { kind: gap.kind, about: gap.blockLabel ?? null },
    }));
}

// How far ahead a failed card comes back. Far enough that you are recalling it
// rather than reading it off the last screen, close enough to still be in the
// same session.
export const REASK_SPACING = 4;

// Worth asking again? The same threshold the rest of the app calls weak, so a
// card that would be marked Weak on the canvas is exactly the card that comes
// back here. One definition of "you did not really have that", used everywhere.
export function shouldReask({ recalled = 0, total = 0 } = {}) {
  if (!(total > 0)) return false;
  const grade = gradeFor(recalled, total);
  return grade === 'again' || grade === 'hard';
}

// Put a card back into the queue, once.
//
// Once matters. A card you keep failing would otherwise loop until you gave up
// or guessed, which turns a study session into a hostage situation — and the
// scheduler already has a plan for something you cannot recall at all: tomorrow.
export function reinsert(queue = [], index = 0, cardId, { spacing = REASK_SPACING } = {}) {
  const list = [...(queue ?? [])];
  if (!cardId) return list;
  // Already been asked twice; the second time is the last.
  if (list.filter((id) => id === cardId).length > 1) return list;

  const at = Math.min(index + spacing, list.length);
  list.splice(at, 0, cardId);
  return list;
}

// One grade per card, the last attempt winning.
//
// A re-asked card is graded twice, and only the second time counts: it is the
// current state of your recall, and submitting both would file two schedules for
// one block and count it twice in the session score.
export function finalGrades(grades = []) {
  const byId = new Map();
  for (const grade of grades ?? []) {
    if (!grade?.id) continue;
    byId.set(grade.id, grade);
  }
  return [...byId.values()];
}

// How many cards are left, counting the ones queued to come back. The progress
// bar has to be honest about a session that just got longer.
export function sessionLength(queue = []) {
  return (queue ?? []).length;
}
