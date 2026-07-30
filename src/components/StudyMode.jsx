import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { categoryColor, categoryLabel } from '../lib/categories';

// Deterministic shuffle so a session's order doesn't reshuffle on re-render.
function shuffle(list, seed) {
  const out = [...list];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildDeck(nodes, flaggedOnly, seed) {
  const usable = nodes.filter((n) => n.data.notes?.trim() && (!flaggedOnly || n.data.unsure));
  return shuffle(
    usable.map((n) => ({
      id: n.id,
      label: n.data.label,
      notes: n.data.notes,
      date: n.data.date,
      category: n.data.category,
      unsure: n.data.unsure,
    })),
    seed
  );
}

export default function StudyMode({ nodes, canvasTitle, onExit, onFinish }) {
  const [seed, setSeed] = useState(1);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [restrictTo, setRestrictTo] = useState(null);

  const deck = useMemo(() => {
    const full = buildDeck(nodes, flaggedOnly, seed);
    return restrictTo ? full.filter((c) => restrictTo.includes(c.id)) : full;
  }, [nodes, flaggedOnly, seed, restrictTo]);

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [missed, setMissed] = useState([]);
  const [gotCount, setGotCount] = useState(0);
  const [done, setDone] = useState(false);

  const flaggedCount = nodes.filter((n) => n.data.unsure && n.data.notes?.trim()).length;
  const card = deck[index];

  const restart = useCallback((opts = {}) => {
    setIndex(0);
    setRevealed(false);
    setMissed([]);
    setGotCount(0);
    setDone(false);
    if (opts.reshuffle) setSeed((s) => s + 1);
  }, []);

  const score = useCallback(
    (gotIt) => {
      if (!card) return;
      if (gotIt) setGotCount((c) => c + 1);
      else setMissed((m) => [...m, card]);

      if (index + 1 >= deck.length) {
        setDone(true);
        onFinish?.({ correct: gotIt ? gotCount + 1 : gotCount, total: deck.length });
      } else {
        setIndex((i) => i + 1);
        setRevealed(false);
      }
    },
    [card, index, deck.length, gotCount, onFinish]
  );

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        onExit();
        return;
      }
      if (done || !card) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        return;
      }
      if (!revealed) return;
      if (e.key === 'ArrowRight') score(true);
      if (e.key === 'ArrowLeft') score(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [revealed, card, done, score, onExit]);

  const header = (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onExit}
        className="rounded-full px-2 py-1.5 text-[13px] text-subink hover:bg-black/5 hover:text-ink"
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
              ? 'border-amber-400/50 bg-amber-400/15 text-amber-700'
              : 'border-black/10 text-subink hover:bg-black/5 hover:text-ink'
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
        <div className="border-b border-black/5 bg-white/60 px-5 py-3">{header}</div>
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
    const total = gotCount + missed.length;
    const pct = total ? Math.round((gotCount / total) * 100) : 0;
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-canvas/95 backdrop-blur-xl">
        <div className="border-b border-black/5 bg-white/60 px-5 py-3">{header}</div>
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-7 text-center shadow-[0_16px_48px_-16px_rgba(0,0,0,0.2)]"
          >
            <p className="text-[13px] font-medium uppercase tracking-wide text-subink">Session complete</p>
            <p className="mt-2 text-[44px] font-semibold leading-none tracking-tight text-ink">
              {gotCount}
              <span className="text-[24px] text-subink">/{total}</span>
            </p>
            <p className="mt-1.5 text-[13.5px] text-subink">{pct}% recalled</p>

            {missed.length > 0 && (
              <div className="mt-5 text-left">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
                  Worth another look
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {missed.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded-lg bg-black/[0.03] px-2.5 py-1.5"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: categoryColor(m.category) }}
                      />
                      <span className="truncate text-[12.5px] text-ink">{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2">
              {missed.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const ids = missed.map((m) => m.id);
                    setRestrictTo(ids);
                    restart();
                  }}
                  className="rounded-xl bg-accent py-2.5 text-[13.5px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]"
                >
                  Retry the {missed.length} I missed
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRestrictTo(null);
                  restart({ reshuffle: true });
                }}
                className="rounded-xl border border-black/10 py-2.5 text-[13.5px] text-subink hover:bg-black/5 hover:text-ink"
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
      <div className="border-b border-black/5 bg-white/60 px-5 py-3">{header}</div>

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

      <div className="flex flex-1 items-center justify-center px-6 py-6">
        <div className="w-full max-w-xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="rounded-3xl border border-black/5 bg-white p-7 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.2)]"
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
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
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

              <div className="mt-4 min-h-[92px] rounded-2xl border border-black/5 bg-black/[0.02] p-4">
                <AnimatePresence mode="wait">
                  {revealed ? (
                    <motion.p
                      key="answer"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink/90"
                    >
                      {card.notes}
                    </motion.p>
                  ) : (
                    <motion.button
                      key="prompt"
                      type="button"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      onClick={() => setRevealed(true)}
                      className="flex h-full min-h-[60px] w-full items-center justify-center text-[13.5px] text-subink hover:text-ink"
                    >
                      What do you remember? Tap or press Space to reveal.
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-5 flex items-center justify-center gap-2.5">
            {revealed ? (
              <>
                <button
                  type="button"
                  onClick={() => score(false)}
                  className="rounded-xl border border-black/10 bg-white px-5 py-2.5 text-[13.5px] font-medium text-subink hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                  ← Missed it
                </button>
                <button
                  type="button"
                  onClick={() => score(true)}
                  className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]"
                >
                  Got it →
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]"
              >
                Reveal
              </button>
            )}
          </div>

          <p className="mt-3 text-center text-[11.5px] text-subink/70">
            Space reveals · ← missed · → got it · Esc closes
          </p>
        </div>
      </div>
    </div>
  );
}
