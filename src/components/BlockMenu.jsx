import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CATEGORIES, categoryColor, categoryLabel } from '../lib/categories';
import { AddImageButton } from './BlockImages';
import { sortImageFiles } from '../lib/imageFiles';

// Everything you can do to a block, behind one "⋯".
//
// A block used to carry five icons in its top-right corner, three of them
// appearing only on hover, plus a colour dot at the top-left that opened a palette.
// Six affordances competing for a 320px card, most of them invisible until you
// happened to hover the right pixel. This is the same set of actions, discoverable
// in one place, with the block's face left to its actual content.
//
// "Open larger" is deliberately NOT in here. It is the one thing you reach for
// while reading rather than while editing, and burying a frequent action behind a
// menu to tidy the rare ones is the wrong trade.

const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover';
const ICON = 'h-3.5 w-3.5 shrink-0 text-subink';

export default function BlockMenu({ id, category, unsure, onFieldChange, onRename, onAddImages, onDelete }) {
  const [open, setOpen] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const wrapper = useRef(null);

  // Closed by clicking anywhere else or pressing Escape. The old palette had
  // neither, so it sat open until you clicked the dot a second time.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event) {
      if (!wrapper.current?.contains(event.target)) close();
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        // Stopped, or the canvas takes Escape as "deselect" too.
        event.stopPropagation();
        close();
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setShowCategories(false);
  }

  // Every item closes the menu after acting: leaving it open over the block hides
  // the thing you just changed.
  function act(fn) {
    return () => {
      close();
      fn();
    };
  }

  return (
    <div ref={wrapper} className="nodrag relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        title="Block options"
        aria-label="Block options"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-5 w-5 items-center justify-center rounded-full hover:bg-hover hover:text-ink ${
          open ? 'bg-hover text-ink' : 'text-subink/50'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3.2" cy="8" r="1.35" />
          <circle cx="8" cy="8" r="1.35" />
          <circle cx="12.8" cy="8" r="1.35" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.12 }}
            role="menu"
            // Right-aligned: the trigger sits in the corner, so a left-aligned menu
            // would hang off the edge of the block.
            className="absolute right-0 top-6 z-50 w-[172px] rounded-xl border border-line2 bg-panel p-1 shadow-[0_10px_28px_-8px_rgba(0,0,0,0.3)]"
          >
            {showCategories ? (
              <>
                <button type="button" onClick={() => setShowCategories(false)} className={`${ITEM} text-subink`}>
                  <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M9.5 4L5.5 8l4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Category
                </button>
                <div className="my-1 h-px bg-line" />
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="menuitem"
                    onClick={act(() => onFieldChange(id, { category: c.key }))}
                    className={`${ITEM} ${(category ?? 'none') === c.key ? 'font-medium' : ''}`}
                  >
                    <span
                      className="ml-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    {c.label}
                    {(category ?? 'none') === c.key && (
                      <span className="ml-auto text-[11px] text-accent">✓</span>
                    )}
                  </button>
                ))}
              </>
            ) : (
              <>
                <button type="button" role="menuitem" onClick={act(onRename)} className={ITEM}>
                  <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M11.5 2.5l2 2-7.5 7.5-2.5.5.5-2.5 7.5-7.5z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Rename
                </button>

                {/* AddImageButton owns the hidden file input, so it is reused here
                    rather than reimplemented as a menu row. */}
                <AddImageButton
                  title="Add an image"
                  className={ITEM}
                  onFiles={(files) => {
                    close();
                    onAddImages?.(id, sortImageFiles(files));
                  }}
                >
                  <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="1.9" y="3.2" width="12.2" height="9.6" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="5.9" cy="6.7" r="1.15" fill="currentColor" />
                    <path
                      d="M2.6 11.4l3.2-2.7 2.5 2.1 2.3-2 2.8 2.4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Add image
                </AddImageButton>

                <button
                  type="button"
                  role="menuitem"
                  onClick={act(() => onFieldChange(id, { unsure: !unsure }))}
                  className={ITEM}
                >
                  <span className={`${ICON} text-center text-[12px] font-bold leading-none`}>?</span>
                  {unsure ? 'Clear “not sure”' : 'Mark “not sure”'}
                </button>

                {/* Named, with the current value beside it. A row reading only
                    "Event" leaves you to guess whether it is a label or a verb. */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setShowCategories(true)}
                  className={ITEM}
                >
                  <span
                    className="ml-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColor(category) }}
                  />
                  Category
                  <span className="ml-auto flex items-center gap-1 text-[11.5px] text-subink">
                    {categoryLabel(category)}
                    <span className="text-subink/70">›</span>
                  </span>
                </button>

                <div className="my-1 h-px bg-line" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={act(() => onDelete(id))}
                  className={`${ITEM} text-danger hover:bg-danger-bg`}
                >
                  <span className={`${ICON} text-center text-[13px] leading-none text-danger`}>×</span>
                  Delete block
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
