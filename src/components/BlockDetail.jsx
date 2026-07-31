import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { CATEGORIES, categoryColor, categoryLabel } from '../lib/categories';

// The expanded view of one block, at roughly half the screen. It edits the same
// fields through the same handlers as the block itself — there is no separate
// draft state, so anything typed here is already saved and already undoable.
//
// It renders outside the React Flow viewport on purpose: inside, it would inherit
// the canvas transform and be scaled by the zoom level and clipped by the pane.
export default function BlockDetail({ node, onClose, onNotesChange, onLabelChange, onFieldChange }) {
  const notesRef = useRef(null);
  const { id } = node;
  const { label, notes, date, category, unsure, aiFilled, aiCorrection } = node.data;

  useEffect(() => {
    notesRef.current?.focus();
    const el = notesRef.current;
    // Caret at the end rather than the start: the point of opening this is
    // usually to carry on writing.
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, [id]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="flex h-[min(720px,82vh)] w-[min(980px,74vw)] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_24px_64px_-16px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {/* A block with no title is unreadable on the canvas, where there is
                no placeholder to fall back on — so restore one on blur. */}
            <input
              value={label}
              onChange={(e) => onLabelChange(id, e.target.value)}
              onBlur={() => {
                if (!label.trim()) onLabelChange(id, 'Untitled block');
              }}
              placeholder="Untitled block"
              aria-label="Block title"
              className="w-full bg-transparent text-[22px] font-semibold leading-tight tracking-tight text-ink placeholder:text-subink/50 focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={date ?? ''}
                onChange={(e) => onFieldChange(id, { date: e.target.value })}
                placeholder="Add a date…"
                aria-label="Date"
                className="w-[150px] rounded-lg border border-line bg-sunken px-2 py-1 text-[12px] font-medium uppercase tracking-wide text-subink placeholder:normal-case placeholder:tracking-normal focus:border-accent/40 focus:outline-none"
              />

              <select
                value={category ?? 'none'}
                onChange={(e) => onFieldChange(id, { category: e.target.value })}
                aria-label="Category"
                className="rounded-lg border border-line bg-sunken py-1 pl-2 pr-1 text-[12px] text-subink focus:border-accent/40 focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: categoryColor(category) }}
                title={categoryLabel(category)}
              />

              <button
                type="button"
                onClick={() => onFieldChange(id, { unsure: !unsure })}
                className={`rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
                  unsure
                    ? 'border-warn-line bg-warn-bg text-warn'
                    : 'border-line text-subink hover:bg-hover hover:text-ink'
                }`}
              >
                {unsure ? '? Flagged as unsure' : 'Mark as unsure'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-subink hover:bg-hover hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {aiCorrection && (
          <p className="border-b border-warn-line bg-warn-bg px-6 py-2.5 text-[12.5px] leading-snug text-warn">
            ⚠️ {aiCorrection}
          </p>
        )}

        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => onNotesChange(id, e.target.value)}
          placeholder="Write everything you know about this…"
          className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 text-[14.5px] leading-relaxed text-ink/90 placeholder:text-subink/60 focus:outline-none"
        />

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-2.5">
          <span className="text-[11.5px] text-subink">
            {aiFilled ? '✨ AI-filled — edit freely' : 'Saved as you type'}
          </span>
          <span className="text-[11.5px] tabular-nums text-subink/70">
            {notes.trim() ? `${notes.trim().split(/\s+/).length} words` : 'No notes yet'}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
