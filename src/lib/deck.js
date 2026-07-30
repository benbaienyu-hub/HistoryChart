// Flashcard deck construction, kept out of StudyMode so the selection and
// ordering rules can be tested without rendering anything.

// Deterministic shuffle (a seeded LCG) so a session's order doesn't reshuffle
// on every re-render — the deck is recomputed from props, not stored.
export function shuffle(list, seed) {
  const out = [...list];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A block becomes a card only once it has notes — the notes are the answer, so
// an empty block would be an unanswerable prompt. Collapsed blocks still count:
// folding a branch is a viewing choice, not a decision to stop studying it.
export function buildDeck(nodes, { flaggedOnly = false, seed = 1, restrictTo = null } = {}) {
  const usable = nodes.filter(
    (n) => n.data.notes?.trim() && (!flaggedOnly || n.data.unsure)
  );

  const cards = usable.map((n) => ({
    id: n.id,
    label: n.data.label,
    notes: n.data.notes,
    date: n.data.date,
    category: n.data.category,
    unsure: n.data.unsure,
  }));

  const ordered = shuffle(cards, seed);
  return restrictTo ? ordered.filter((c) => restrictTo.includes(c.id)) : ordered;
}

export function flaggedCardCount(nodes) {
  return nodes.filter((n) => n.data.unsure && n.data.notes?.trim()).length;
}
