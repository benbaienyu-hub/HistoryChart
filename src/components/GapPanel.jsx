import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GAP_KINDS, describeGaps } from '../lib/gaps';

// The result of "Find my gaps": a list of holes, each with three ways to respond.
//
// The order of the buttons is the argument the app is making. "Test me" comes
// first because retrieval is what actually moves something into memory; "Hint"
// second, for when you want to get there yourself with a push; "Fill gap" last,
// because being handed the answer is the option that teaches least. It is still
// there — sometimes you just want the fact written down — but it is not the default.

const ACTION =
  'rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-40';

function KindBadge({ kind }) {
  const meta = GAP_KINDS[kind];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-subink">
      <span aria-hidden="true">{meta.emoji}</span>
      {meta.label}
    </span>
  );
}

function Gap({ gap, onFill, onJump, filled }) {
  // One open action at a time per gap: showing a hint and a question and an answer
  // all at once is just the answer with extra steps.
  const [showing, setShowing] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const meta = GAP_KINDS[gap.kind];

  function toggle(which) {
    setRevealed(false);
    setShowing((current) => (current === which ? null : which));
  }

  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <KindBadge kind={gap.kind} />
        {gap.blockLabel ? (
          <button
            type="button"
            onClick={() => onJump?.(gap.blockId)}
            title="Show this block on the canvas"
            className="max-w-[45%] truncate text-[11px] text-subink hover:text-accent hover:underline"
          >
            {gap.blockLabel}
          </button>
        ) : (
          <span className="text-[11px] text-subink/70">whole canvas</span>
        )}
      </div>

      <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-ink">{gap.title}</p>
      {gap.detail && <p className="mt-1 text-[12.5px] leading-snug text-subink">{gap.detail}</p>}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => toggle('test')}
          disabled={!gap.question}
          className={`${ACTION} ${
            showing === 'test'
              ? 'border-accent bg-accent text-white'
              : 'border-line2 text-ink hover:bg-hover'
          }`}
        >
          Test me
        </button>
        <button
          type="button"
          onClick={() => toggle('hint')}
          disabled={!gap.hint}
          className={`${ACTION} ${
            showing === 'hint'
              ? 'border-accent bg-accent text-white'
              : 'border-line2 text-ink hover:bg-hover'
          }`}
        >
          Hint
        </button>
        <button
          type="button"
          onClick={() => onFill(gap)}
          disabled={filled || gap.fill.length === 0}
          className={`${ACTION} border-line2 text-subink hover:bg-hover hover:text-ink`}
        >
          {filled ? 'Added ✓' : meta.fillLabel}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showing === 'hint' && (
          <motion.p
            key="hint"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden rounded-lg bg-sunken px-2.5 py-2 text-[12.5px] leading-snug text-ink/90"
          >
            {gap.hint}
          </motion.p>
        )}

        {showing === 'test' && (
          <motion.div
            key="test"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden rounded-lg bg-sunken px-2.5 py-2"
          >
            <p className="text-[12.5px] font-medium leading-snug text-ink">{gap.question}</p>
            {revealed ? (
              <p className="mt-1.5 border-t border-line pt-1.5 text-[12.5px] leading-snug text-ink/90">
                {gap.answer}
              </p>
            ) : (
              // Answer behind a click, always. An answer visible beside its question
              // is not a test of anything.
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="mt-1.5 text-[11.5px] font-medium text-accent hover:underline"
              >
                Show answer
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {filled && gap.kind === 'incorrect' && (
        // Never silently rewriting somebody's sentence — including one a model
        // believes is wrong, since it is sometimes wrong about that.
        <p className="mt-2 text-[11px] leading-snug text-subink">
          The correction was added to the block. Delete the line it replaces yourself.
        </p>
      )}
    </li>
  );
}

export default function GapPanel({ gaps, busy, error, filledIds, onFill, onJump, onRescan, onClose }) {
  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="absolute right-0 top-0 z-30 flex h-full w-[340px] flex-col border-l border-line bg-panel/95 backdrop-blur-xl"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight text-ink">Your gaps</h2>
          <p className="mt-0.5 text-[11.5px] text-subink">
            {busy ? 'Reading your canvas…' : describeGaps(gaps)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full px-2 py-1 text-[13px] text-subink hover:bg-hover hover:text-ink"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && (
          <p className="rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-[12.5px] leading-snug text-ink">
            {error}
          </p>
        )}

        {busy && !error && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ opacity: [0.35, 0.7, 0.35] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }}
                className="h-[86px] rounded-xl bg-sunken"
              />
            ))}
          </div>
        )}

        {!busy && !error && gaps.length === 0 && (
          <div className="px-1 py-6 text-center">
            <p className="text-[13px] font-medium text-ink">Nothing obvious is missing.</p>
            <p className="mt-1.5 text-[12px] leading-snug text-subink">
              That is a real answer, not a failure — these notes hold up. Add more detail and
              scan again when you have written more.
            </p>
          </div>
        )}

        {!busy && gaps.length > 0 && (
          <ul className="space-y-2">
            {gaps.map((gap) => (
              <Gap
                key={gap.id}
                gap={gap}
                filled={filledIds.has(gap.id)}
                onFill={onFill}
                onJump={onJump}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-line px-4 py-2.5">
        <button
          type="button"
          onClick={onRescan}
          disabled={busy}
          className="w-full rounded-xl border border-line2 py-2 text-[12.5px] font-medium text-subink hover:bg-hover hover:text-ink disabled:opacity-50"
        >
          {busy ? 'Scanning…' : 'Scan again'}
        </button>
      </footer>
    </motion.aside>
  );
}
