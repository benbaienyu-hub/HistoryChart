import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { categoryColor, categoryLabel } from '../lib/categories';
import { buildDeck, flaggedCardCount, gradeCard, sessionTally } from '../lib/deck';
import { countDue, describeDue, isDue, scheduleSummary } from '../lib/review';
import { gradeTyped } from '../lib/recall';
import StudySetup from './StudySetup';

export default function StudyMode({ nodes, canvasTitle, reviews = {}, onExit, onFinish }) {
  const [seed, setSeed] = useState(1);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [restrictTo, setRestrictTo] = useState(null);
  // The session starts on a setup screen rather than straight into a card: with
  // scheduling and two answer modes there is now a real choice to make, and
  // guessing it for the user would be worse than asking once.
  const [setup, setSetup] = useState(null);

  const everything = useMemo(() => buildDeck(nodes, { flaggedOnly: false, seed: 1 }), [nodes]);
  const dueTotal = countDue(everything, reviews);

  const deck = useMemo(() => {
    const built = buildDeck(nodes, { flaggedOnly, seed, restrictTo });
    // "Due" is a filter over the same deck rather than a different deck, so the
    // shuffle, the flag filter and the retry list all still apply.
    return setup?.scope === 'due' ? built.filter((c) => isDue(reviews[c.id])) : built;
  }, [nodes, flaggedOnly, seed, restrictTo, setup?.scope, reviews]);

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // Which points of the current card the user says they had. Grading is a
  // fraction, not a verdict, so this is the whole answer to "how did I do".
  const [ticked, setTicked] = useState([]);
  const [typed, setTyped] = useState('');
  const [matches, setMatches] = useState(null);
  const [grades, setGrades] = useState([]);
  const [done, setDone] = useState(false);
  const [scheduled, setScheduled] = useState(null);

  const typing = setup?.mode === 'type';
  const flaggedCount = flaggedCardCount(nodes);

  // Defaults on the setup screen: study what's due if anything is, and stay in
  // whichever answer mode was chosen last time within this session.
  const [pendingScope, setPendingScope] = useState('due');
  const [pendingMode, setPendingMode] = useState('check');
  useEffect(() => {
    if (dueTotal === 0) setPendingScope((current) => (current === 'due' ? 'all' : current));
  }, [dueTotal]);
  const card = deck[index];
  // Memoised so the key handler's deps don't churn on every render — the empty
  // fallback would otherwise be a new array each time.
  const points = useMemo(() => card?.points ?? [], [card]);
  const single = points.length === 1;

  const restart = useCallback((opts = {}) => {
    setIndex(0);
    setRevealed(false);
    setTicked([]);
    setTyped('');
    setMatches(null);
    setGrades([]);
    setDone(false);
    setScheduled(null);
    if (opts.reshuffle) setSeed((s) => s + 1);
  }, []);

  const toggle = useCallback((i) => {
    setTicked((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i]));
  }, []);

  const commit = useCallback(
    (recalled) => {
      if (!card) return;
      const next = [...grades, gradeCard(card, recalled)];
      setGrades(next);

      if (index + 1 >= deck.length) {
        setDone(true);
        // The grades go to the server, which decides when each card comes back and
        // hands the new schedule straight back for the summary.
        onFinish?.(next)?.then?.((states) => setScheduled(states ?? null));
      } else {
        setIndex((i) => i + 1);
        setRevealed(false);
        setTicked([]);
        setTyped('');
        setMatches(null);
      }
    },
    [card, grades, index, deck.length, onFinish]
  );

  // Typed mode: the matcher pre-fills the checklist, and the user can overrule it.
  const check = useCallback(() => {
    const graded = gradeTyped(typed, points);
    setMatches(graded.results);
    setTicked(graded.recalled);
    setRevealed(true);
  }, [typed, points]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        onExit();
        return;
      }
      // The typing box owns its own keys. Without this, every character typed into
      // an answer would also be read as a shortcut — "a" would tick everything.
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (done || !card) return;
      if (!revealed) {
        // In typing mode the keyboard belongs to the textarea — Space is a space,
        // and ⌘/Ctrl+Enter submits (handled on the field itself).
        if (typing) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setRevealed(true);
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        commit(ticked);
        return;
      }
      if (e.key === 'ArrowLeft') {
        commit([]);
        return;
      }
      if (e.key === 'a' || e.key === 'A') {
        setTicked(points.map((_, i) => i));
        return;
      }
      // 1–9 tick a point directly, so a card can be graded without the mouse.
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= points.length) {
        e.preventDefault();
        toggle(digit - 1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [revealed, card, done, commit, onExit, ticked, points, toggle, typing]);

  const header = (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onExit}
        className="rounded-full px-2 py-1.5 text-[13px] text-subink hover:bg-hover hover:text-ink"
      >
        ✕ Close
      </button>
      <p className="min-w-0 truncate text-[13px] font-medium text-ink">{canvasTitle}</p>
      {flaggedCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setFlaggedOnly((v) => !v);
            setRestrictTo(null);
            restart();
          }}
          className={`ml-auto shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
            flaggedOnly
              ? 'border-warn-line bg-warn-bg text-warn'
              : 'border-line2 text-subink hover:bg-hover hover:text-ink'
          }`}
        >
          ? Flagged only ({flaggedCount})
        </button>
      )}
    </div>
  );

  // Setup first. `scope` also drives the flagged filter, so choosing "flagged"
  // here and the old flagged toggle in the header mean the same thing.
  if (!setup) {
    return (
      <StudySetup
        canvasTitle={canvasTitle}
        totalCards={everything.length}
        dueCount={dueTotal}
        flaggedCount={flaggedCount}
        scope={pendingScope}
        mode={pendingMode}
        onScope={setPendingScope}
        onMode={setPendingMode}
        onExit={onExit}
        onStart={() => {
          setFlaggedOnly(pendingScope === 'flagged');
          setRestrictTo(null);
          restart();
          setSetup({ scope: pendingScope, mode: pendingMode });
        }}
      />
    );
  }

  if (done) {
    const tally = sessionTally(grades);
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-canvas/95 backdrop-blur-xl">
        <div className="border-b border-line bg-surface px-5 py-3">{header}</div>
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-3xl border border-line bg-panel p-7 text-center shadow-[0_16px_48px_-16px_rgba(0,0,0,0.2)]"
          >
            <p className="text-[13px] font-medium uppercase tracking-wide text-subink">Session complete</p>
            <p className="mt-2 flex items-baseline justify-center gap-1 text-[44px] font-semibold leading-tight tracking-tight text-ink">
              {tally.recalled}
              <span className="text-[22px] font-medium text-subink">/ {tally.total}</span>
            </p>
            <p className="text-[11.5px] uppercase tracking-wide text-subink/80">points recalled</p>
            <p className="mt-2 text-[13.5px] text-subink">
              {tally.pct}% · {tally.fullyRecalled} of {tally.cards} cards in full
            </p>

            {/* The whole point of the schedule is that you can stop deciding what
                to revise. Saying when things come back is what makes that
                trustworthy rather than mysterious. */}
            {scheduled && (
              <div className="mt-4 rounded-xl bg-sunken px-3 py-2.5 text-left">
                <p className="text-[11px] font-medium uppercase tracking-wide text-subink/80">
                  Coming back
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-ink/90">
                  {Object.entries(scheduleSummary(scheduled)).map(([label, count]) =>
                    count > 0 ? (
                      <span key={label}>
                        <span className="tabular-nums font-medium">{count}</span>{' '}
                        <span className="text-subink">{label}</span>
                      </span>
                    ) : null
                  )}
                </div>
              </div>
            )}

            {tally.missed.length > 0 && (
              <div className="mt-5 text-left">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
                  Points that got away
                </p>
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {tally.missed.map((m) => (
                    <div key={m.id} className="rounded-lg bg-sunken px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: categoryColor(m.category) }}
                        />
                        <span className="truncate text-[12.5px] font-medium text-ink">{m.label}</span>
                        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-subink">
                          {m.recalled}/{m.total}
                        </span>
                        {scheduled?.find((st) => st.blockId === m.id) && (
                          <span className="shrink-0 text-[11px] text-accent">
                            {describeDue(scheduled.find((st) => st.blockId === m.id))}
                          </span>
                        )}
                      </div>
                      <ul className="mt-1 space-y-0.5 pl-4">
                        {m.missedPoints.map((p, i) => (
                          <li key={i} className="text-[12px] leading-snug text-subink">
                            · {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2">
              {tally.missed.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setRestrictTo(tally.missed.map((m) => m.id));
                    restart();
                  }}
                  className="rounded-xl bg-accent py-2.5 text-[13.5px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]"
                >
                  Retry the {tally.missed.length} with gaps
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRestrictTo(null);
                  restart({ reshuffle: true });
                }}
                className="rounded-xl border border-line2 py-2.5 text-[13.5px] text-subink hover:bg-hover hover:text-ink"
              >
                Study all again
              </button>
              <button
                type="button"
                onClick={onExit}
                className="py-1 text-[13px] text-subink hover:text-ink"
              >
                Back to canvas
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // After the summary, not before it: finishing a "due now" session empties the
  // deck by definition — every card in it has just been rescheduled — and checking
  // for an empty deck first would replace the results screen with "nothing to
  // study" at the exact moment the session was completed.
  if (deck.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-canvas/95 backdrop-blur-xl">
        <div className="border-b border-line bg-surface px-5 py-3">{header}</div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-[16px] font-medium text-ink">
            {flaggedOnly ? 'No flagged blocks with notes' : 'Nothing to study yet'}
          </p>
          <p className="mt-1.5 max-w-sm text-[13.5px] leading-snug text-subink">
            {flaggedOnly
              ? 'Clear the filter, or flag a block with the “?” button to revisit it here.'
              : 'Study cards come from your notes — add notes to a block and it becomes a card, with the title as the prompt.'}
          </p>
          <button
            type="button"
            onClick={onExit}
            className="mt-5 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white"
          >
            Back to canvas
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas/95 backdrop-blur-xl">
      <div className="border-b border-line bg-surface px-5 py-3">{header}</div>

      <div className="px-5 pt-4">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/10">
            <motion.div
              className="h-full rounded-full bg-accent"
              animate={{ width: `${((index + (revealed ? 1 : 0)) / deck.length) * 100}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 26 }}
            />
          </div>
          <span className="shrink-0 text-[12px] tabular-nums text-subink">
            {index + 1} / {deck.length}
          </span>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-6">
        <div className="w-full max-w-xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="rounded-3xl border border-line bg-panel p-7 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.2)]"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: categoryColor(card.category) }}
                />
                <span className="text-[11px] font-medium uppercase tracking-wide text-subink">
                  {categoryLabel(card.category)}
                </span>
                {card.unsure && (
                  <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn">
                    flagged
                  </span>
                )}
                {card.date && (
                  <span className="ml-auto text-[11.5px] font-medium uppercase tracking-wide text-subink">
                    {card.date}
                  </span>
                )}
              </div>

              <p className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-ink">
                {card.label}
              </p>

              {/* Saying how many points there are turns "reproduce the paragraph"
                  into a target you can actually hit. */}
              <p className="mt-1.5 text-[12.5px] text-subink">
                {single ? '1 point to recall' : `${points.length} points to recall`}
                {typing && !revealed && ' — write them out'}
              </p>

              <div className="mt-4 min-h-[92px] rounded-2xl border border-line bg-sunken p-3">
                <AnimatePresence mode="wait">
                  {revealed ? (
                    <motion.div key="answer" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      {/* Wrapping rather than scrolling sideways: a second image
                          half off the edge of the card looks broken, and you
                          would not know to scroll for it. */}
                      {card.images?.length > 0 && (
                        <div className="mb-3 flex flex-wrap items-start justify-center gap-2">
                          {card.images.map((image) => (
                            <figure key={image.id} className="max-w-full">
                              <img
                                src={image.url}
                                alt={image.caption || image.name}
                                className="max-h-40 max-w-full rounded-lg border border-line"
                              />
                              {image.caption && (
                                <figcaption className="mt-1 max-w-[240px] text-center text-[11px] leading-snug text-subink">
                                  {image.caption}
                                </figcaption>
                              )}
                            </figure>
                          ))}
                        </div>
                      )}
                      <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
                        Tick what you had
                      </p>
                      <ul className="space-y-1">
                        {points.map((point, i) => {
                          const on = ticked.includes(i);
                          const match = matches?.[i];
                          return (
                            <li key={i}>
                              <button
                                type="button"
                                onClick={() => toggle(i)}
                                aria-pressed={on}
                                className={`flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                                  on
                                    ? 'border-accent/40 bg-accent-soft text-ink'
                                    : 'border-transparent text-ink/80 hover:bg-hover'
                                }`}
                              >
                                <span
                                  className={`mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border text-[10.5px] font-semibold tabular-nums ${
                                    on
                                      ? 'border-accent bg-accent text-white'
                                      : 'border-line2 text-subink'
                                  }`}
                                >
                                  {on ? '✓' : i + 1}
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-[14px] leading-relaxed whitespace-pre-wrap">
                                    {point}
                                  </span>
                                  {/* Why the matcher judged as it did. Without this
                                      a pre-filled tick is just an assertion, and an
                                      unticked point looks like a bug rather than a
                                      missing word. */}
                                  {match && match.missed.length > 0 && (
                                    <span className="mt-0.5 block text-[11.5px] text-subink">
                                      {match.hit.length > 0
                                        ? `you wrote ${match.hit.join(', ')} — missing ${match.missed.join(', ')}`
                                        : `missing ${match.missed.join(', ')}`}
                                    </span>
                                  )}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </motion.div>
                  ) : typing ? (
                    <motion.div key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <textarea
                        autoFocus
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter is a newline here — the answer is several points,
                          // so submitting on Enter would cut people off mid-list.
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            // Must not reach the window handler. React flushes this
                            // state change synchronously, which re-registers that
                            // listener mid-event with revealed already true — and
                            // the same keypress then commits the card it has only
                            // just revealed.
                            e.stopPropagation();
                            check();
                          }
                        }}
                        placeholder="Write everything you remember…"
                        rows={4}
                        className="w-full resize-none bg-transparent px-1 text-[14px] leading-relaxed text-ink placeholder:text-subink/60 focus:outline-none"
                      />
                    </motion.div>
                  ) : (
                    <motion.button
                      key="prompt"
                      type="button"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      onClick={() => setRevealed(true)}
                      className="flex h-full min-h-[68px] w-full items-center justify-center text-[13.5px] text-subink hover:text-ink"
                    >
                      What do you remember? Tap or press Space to reveal.
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-5 flex items-center justify-center gap-2.5">
            {!revealed && (
              <button
                type="button"
                onClick={typing ? check : () => setRevealed(true)}
                disabled={typing && !typed.trim()}
                className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)] disabled:opacity-50"
              >
                {typing ? 'Check my answer' : 'Reveal'}
              </button>
            )}
            {!revealed && typing && (
              <button
                type="button"
                // An honest escape hatch: if it's gone, it's gone, and making
                // someone type nothing to prove it wastes their time.
                onClick={() => {
                  setMatches(null);
                  setTicked([]);
                  setRevealed(true);
                }}
                className="rounded-xl border border-line2 bg-panel px-4 py-2.5 text-[13.5px] text-subink hover:bg-hover hover:text-ink"
              >
                No idea
              </button>
            )}
            {revealed && single && (
              <>
                <button
                  type="button"
                  onClick={() => commit([])}
                  className="rounded-xl border border-line2 bg-panel px-5 py-2.5 text-[13.5px] font-medium text-subink hover:border-danger hover:bg-danger-bg hover:text-danger"
                >
                  ← Missed it
                </button>
                <button
                  type="button"
                  onClick={() => commit([0])}
                  className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]"
                >
                  Got it →
                </button>
              </>
            )}
            {revealed && !single && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setTicked(ticked.length === points.length ? [] : points.map((_, i) => i))
                  }
                  className="rounded-xl border border-line2 bg-panel px-4 py-2.5 text-[13.5px] text-subink hover:bg-hover hover:text-ink"
                >
                  {ticked.length === points.length ? 'Clear' : 'Tick all'}
                </button>
                <button
                  type="button"
                  onClick={() => commit(ticked)}
                  className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]"
                >
                  Next → <span className="tabular-nums opacity-80">{ticked.length}/{points.length}</span>
                </button>
              </>
            )}
          </div>

          <p className="mt-3 text-center text-[11.5px] text-subink/70">
            {!revealed && typing
              ? '⌘/Ctrl + Enter to check · Esc closes'
              : revealed && !single
              ? '1–9 tick a point · A all · → next · Esc closes'
              : 'Space reveals · ← missed · → got it · Esc closes'}
          </p>
        </div>
      </div>
    </div>
  );
}
