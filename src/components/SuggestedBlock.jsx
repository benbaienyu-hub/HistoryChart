import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { AnimatePresence, motion } from 'framer-motion';
import { describePlacement } from '../lib/suggestions';

// A gap, drawn where it belongs.
//
// Dashed and translucent because it is not yours yet — the canvas should read at
// a glance as "these are your blocks, and this is a question someone is asking
// about them". Nothing about it is editable, and it cannot be dragged or
// connected: it is a proposal, and pretending otherwise would make it look like
// a block you had already accepted.
//
// It opens in place rather than into a dialog. The whole argument for drawing
// suggestions on the canvas is that position carries meaning, and a modal over
// the top hides exactly the thing you are being asked to judge.

const anchorStyle = {
  width: 6,
  height: 6,
  background: 'var(--color-accent)',
  opacity: 0.45,
  border: 'none',
  pointerEvents: 'none',
};

const ACTION =
  'rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-40';

function SuggestedBlock({ data }) {
  const { gap, open, onOpen, onAccept, onDismiss } = data;
  const [testing, setTesting] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 240, damping: 22 }}
      className={`nodrag rounded-2xl border-2 border-dashed border-accent/45 bg-accent-soft/50 backdrop-blur-sm transition-shadow ${
        open ? 'w-[300px] p-3.5 shadow-[0_12px_32px_-12px_rgba(0,113,227,0.45)]' : 'w-[220px] p-3'
      }`}
    >
      <Handle type="target" position={Position.Top} style={anchorStyle} />
      <Handle type="source" position={Position.Bottom} style={anchorStyle} />

      <button
        type="button"
        onClick={() => onOpen(gap.id)}
        className="block w-full text-left"
        title={open ? 'Collapse' : 'Why does Lacuna think this is missing?'}
      >
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          <span aria-hidden="true">🔴</span>
          Suggested
        </span>
        <span className="mt-1 block text-[13.5px] font-semibold leading-snug text-ink">
          {gap.title}
          {!open && <span className="text-accent">&nbsp;?</span>}
        </span>
        {/* Where it is being proposed, in words. The arrows say it too, but only
            if both ends are on screen. */}
        <span className="mt-1 block text-[11px] leading-snug text-subink">
          {describePlacement(gap)}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {gap.detail && (
              <p className="mt-2.5 border-t border-accent/20 pt-2.5 text-[12.5px] leading-snug text-ink/90">
                {gap.detail}
              </p>
            )}

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onAccept(gap)}
                disabled={gap.fill.length === 0}
                className={`${ACTION} border-accent bg-accent text-white hover:opacity-90`}
              >
                Add to canvas
              </button>
              <button
                type="button"
                onClick={() => {
                  setRevealed(false);
                  setTesting((v) => !v);
                }}
                disabled={!gap.question}
                className={`${ACTION} ${
                  testing ? 'border-accent text-accent' : 'border-line2 text-ink hover:bg-hover'
                }`}
              >
                Test me
              </button>
              <button
                type="button"
                onClick={() => onDismiss(gap.id)}
                className={`${ACTION} border-line2 text-subink hover:bg-hover hover:text-ink`}
              >
                Dismiss
              </button>
            </div>

            <AnimatePresence initial={false}>
              {testing && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 overflow-hidden rounded-lg bg-panel/80 px-2.5 py-2"
                >
                  <p className="text-[12.5px] font-medium leading-snug text-ink">{gap.question}</p>
                  {revealed ? (
                    <p className="mt-1.5 border-t border-line pt-1.5 text-[12.5px] leading-snug text-ink/90">
                      {gap.answer}
                    </p>
                  ) : (
                    // Same rule as everywhere else: the answer is behind a click.
                    // Answering a question you can already see is not a test.
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default memo(SuggestedBlock);
