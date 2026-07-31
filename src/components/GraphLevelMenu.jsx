import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GRAPH_LEVELS, graphPlan } from '../lib/graphLevels';

// The depth picker that drops out of "Make a graph". Each option states what it
// will actually build, because the difference between the three is a matter of
// size and cost, and guessing at that from the word "Advanced" is unfair.
export default function GraphLevelMenu({ open, onChoose, onClose, anchorRef }) {
  const ref = useRef(null);
  const firstRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    // Move focus into the menu so Escape and Tab behave the way a menu should.
    firstRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchorRef?.current?.focus();
      }
    }
    function onPointerDown(e) {
      if (ref.current?.contains(e.target)) return;
      // The toggle button is outside the menu, but a click on it is already
      // handled by its own onClick. Closing here too would make the second click
      // close and instantly reopen the menu.
      if (anchorRef?.current?.contains(e.target)) return;
      onClose();
    }

    window.addEventListener('keydown', onKeyDown);
    // Capture, because React Flow stops propagation on pointer events over the
    // pane and the menu would otherwise stay open when you click the canvas.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onClose, anchorRef]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="menu"
          aria-label="Graph depth"
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[290px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl"
        >
          <p className="border-b border-line px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-subink">
            How deep?
          </p>

          {GRAPH_LEVELS.map((level, i) => {
            const plan = graphPlan(level.key);
            return (
              <button
                key={level.key}
                ref={i === 0 ? firstRef : null}
                type="button"
                role="menuitem"
                onClick={() => onChoose(level.key)}
                className="block w-full border-b border-line px-3.5 py-2.5 text-left last:border-b-0 hover:bg-hover focus:bg-hover focus:outline-none"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">{level.label}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-subink">
                    {plan.blocks} blocks
                  </span>
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-subink">
                  {level.blurb}
                </span>
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
