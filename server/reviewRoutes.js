// Spaced-repetition state.
//
// Keyed by **user and block**, not by block alone. A canvas shared between two
// people has to give each of them their own schedule: what Ada has drilled to
// death and what Ben has never seen are different facts about different people,
// and storing review state on the canvas would blend them into nonsense.
//
// The schedule itself is computed here rather than in the browser, so a client
// cannot inflate its own intervals, and so the algorithm has exactly one home.

import { mutate, readDb } from './store.js';
import { nextReview } from '../src/lib/review.js';
import { readJsonBody, send } from './http.js';
import { accessFor } from './canvasRoutes.js';

function reviewsFor(db, userId, canvasId = null) {
  return (db.reviews ?? []).filter(
    (r) => r.userId === userId && (canvasId === null || r.canvasId === canvasId)
  );
}

// The client wants a lookup by block, not a list.
function asMap(rows) {
  const map = {};
  for (const row of rows) {
    map[row.blockId] = {
      interval: row.interval,
      ease: row.ease,
      reps: row.reps,
      lapses: row.lapses,
      dueAt: row.dueAt,
      reviewedAt: row.reviewedAt,
      lastGrade: row.lastGrade,
      // The canvas shows each block's mastery with the score behind it — "Weak"
      // on its own invites an argument, "1 of 3 points" does not — so the last
      // score has to come back with the schedule, not only in the response to
      // the session that produced it.
      lastScore: row.lastScore,
    };
  }
  return map;
}

// Everything this user has ever studied, grouped by canvas — enough for the
// library to show due counts without a request per canvas.
export async function handleReviewList(req, res, user) {
  const db = await readDb();
  const byCanvas = {};
  for (const row of reviewsFor(db, user.id)) {
    byCanvas[row.canvasId] ??= {};
    byCanvas[row.canvasId][row.blockId] = asMap([row])[row.blockId];
  }
  return send(res, 200, { reviews: byCanvas });
}

export async function handleCanvasReviews(req, res, user, { id }) {
  const db = await readDb();
  const canvas = db.canvases.find((c) => c.id === id);
  if (!accessFor(db, canvas, user)) return send(res, 404, { error: 'Canvas not found.' });
  return send(res, 200, { reviews: asMap(reviewsFor(db, user.id, id)) });
}

// A finished session: the client reports how each card went, the server decides
// when each comes back.
export async function handleSubmitReviews(req, res, user, { id }) {
  const db = await readDb();
  const canvas = db.canvases.find((c) => c.id === id);
  const role = accessFor(db, canvas, user);
  if (!role) return send(res, 404, { error: 'Canvas not found.' });
  // Note: no edit check. Studying a canvas someone shared read-only should still
  // build *your* schedule — it changes nothing about their canvas.

  const body = await readJsonBody(req);
  const grades = Array.isArray(body.grades) ? body.grades : [];
  const now = Date.now();

  const updated = await mutate((doc) => {
    doc.reviews ??= [];
    const touched = [];
    for (const grade of grades) {
      const blockId = String(grade?.blockId ?? '');
      if (!blockId) continue;
      const recalled = Number(grade.recalled) || 0;
      const total = Number(grade.total) || 0;

      const existing = doc.reviews.find(
        (r) => r.userId === user.id && r.canvasId === id && r.blockId === blockId
      );
      const state = nextReview(existing, { recalled, total }, now);

      if (existing) Object.assign(existing, state);
      else doc.reviews.push({ userId: user.id, canvasId: id, blockId, ...state });
      touched.push({ blockId, ...state });
    }
    return touched;
  });

  // Re-read so the response reflects what was actually committed, which is not
  // necessarily what this request computed if it lost a race and re-ran.
  const after = await readDb();
  return send(res, 200, { reviews: asMap(reviewsFor(after, user.id, id)), updated });
}

// Called when a canvas is deleted: its schedules are meaningless without it, for
// every user who had one.
export function deleteReviewsForCanvas(canvasId) {
  return mutate((db) => {
    db.reviews = (db.reviews ?? []).filter((r) => r.canvasId !== canvasId);
  });
}
