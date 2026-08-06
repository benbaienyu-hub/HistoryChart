// The unique-title rule, in a module with no browser dependencies so the server
// can enforce it too. Titles have to be distinct wherever a canvas is created —
// in localStorage before you have an account, and in the database after.

export const DEFAULT_TITLE = 'Untitled canvas';

// Two canvases called "Untitled canvas" are indistinguishable in the library, and
// the library is how you find your work. So a colliding title gets a counter:
// the second is "Untitled canvas (1)", the third "(2)".
//
// A title that already ends in a counter is renumbered rather than stacked —
// duplicating "Notes (2)" gives "Notes (3)", not "Notes (2) (1)". Comparison is
// case-insensitive: "notes" and "Notes" are the same name to a person reading a
// list, whatever the string comparison says.
const COUNTER = /\s\((\d+)\)$/;

export function uniqueTitle(desired, taken) {
  const wanted = String(desired ?? '').trim() || DEFAULT_TITLE;
  const used = new Set((taken ?? []).map((t) => String(t ?? '').trim().toLowerCase()));
  if (!used.has(wanted.toLowerCase())) return wanted;

  const base = wanted.replace(COUNTER, '');
  for (let n = 1; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
