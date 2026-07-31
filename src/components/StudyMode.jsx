import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { categoryColor, categoryLabel } from '../lib/categories';
import { buildDeck, flaggedCardCount, gradeCard, sessionTally } from '../lib/deck';

export default function StudyMode({ nodes, canvasTitle, onExit, onFinish }) {
  const [seed, setSeed] = useState(1);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [restrictTo, setRestrictTo] = useState(null);

  const deck = useMemo(
    () => buildDeck(nodes, { flaggedOnly, seed, restrictTo }),
    [nodes, flaggedOnly, seed, restrictTo]
  );

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // Which points of the current card the user says they had. Grading is a
  // fraction, not a verdict, so this is the whole answer to "how did I do".
  const [ticked, setTicked] = useState([]);
  const [grades, setGrades] = useState([]);
  const [done, setDone] = useState(false);

  const flaggedCount = flaggedCardCount(nodes);
  const card = deck[index];
  // Memoised so the key handler's deps don't churn on every render — the empty
  // fallback would otherwise be a new array each time.
  const points = useMemo(() => card?.points ?? [], [card]);
  const single = points.length === 1;

  const restart = useCallback((opts = {}) => {
    setIndex(0);
    setRevealed(false);
    setTicked([]);
    setGrades([]);
    setDone(false);
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
        const tally = sessionTally(next);
        onFinish?.({ correct: tally.recalled, total: tally.total });
      } else {
        setIndex((i) => i + 1);
        setRevealed(false);
        setTicked([]);
      }
    },
    [card, grades, index, deck.length, onFinish]
  );

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        onExit();
        return;
      }
      if (done || !card) return;
      if (!revealed) {
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
  }, [revealed, card, done, commit, onExit, ticked, points, toggle]);

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
              </p>

              <div className="mt-4 min-h-[92px] rounded-2xl border border-line bg-sunken p-3">
                <AnimatePresence mode="wait">
                  {revealed ? (
                    <motion.div key="answer" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
                        Tick what you had
                      </p>
                      <ul className="space-y-1">
                        {points.map((point, i) => {
                          const on = ticked.includes(i);
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
                                <span className="text-[14px] leading-relaxed whitespace-pre-wrap">
                                  {point}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
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
                onClick={() => setRevealed(true)}
                className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]"
              >
                Reveal
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
            {revealed && !single
              ? '1–9 tick a point · A all · → next · Esc closes'
              : 'Space reveals · ← missed · → got it · Esc closes'}
          </p>
        </div>
      </div>
    </div>
  );
}
