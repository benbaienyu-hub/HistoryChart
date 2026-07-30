import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { AnimatePresence, motion } from 'framer-motion';
import { CATEGORIES, categoryColor, categoryLabel } from '../lib/categories';

// Top/bottom handles only anchor the parent→child tree edges, so they ignore
// pointer events (they used to swallow clicks meant for the "+" button).
// Left/right are the interactive ones used to draw labelled relations.
const anchorStyle = {
  width: 6,
  height: 6,
  background: 'var(--color-edge)',
  border: 'none',
  pointerEvents: 'none',
};

const relationHandleClass =
  'h-2.5! w-2.5! border-2! border-panel! bg-subink/40! opacity-0! transition-opacity group-hover:opacity-100! hover:bg-accent!';

function KnowledgeBlock({ data, id }) {
  const {
    label,
    notes,
    date,
    category,
    unsure,
    isRoot,
    aiFilled,
    aiCorrection,
    aiSuggested,
    loading,
    isAddingChild,
    onNotesChange,
    onLabelChange,
    onFieldChange,
    onStartAddChild,
    onSubmitChild,
    onCancelChild,
    onDelete,
  } = data;

  const [childText, setChildText] = useState('');
  const childInputRef = useRef(null);

  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(label);
  const labelInputRef = useRef(null);

  const [showPalette, setShowPalette] = useState(false);

  useEffect(() => {
    if (isAddingChild) childInputRef.current?.focus();
  }, [isAddingChild]);

  useEffect(() => {
    if (editingLabel) {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    }
  }, [editingLabel]);

  function submitChild(e) {
    e.preventDefault();
    const text = childText.trim();
    if (!text) return;
    onSubmitChild(id, text);
    setChildText('');
  }

  function startLabelEdit() {
    setLabelDraft(label);
    setEditingLabel(true);
  }

  function commitLabel() {
    const next = labelDraft.trim();
    if (next && next !== label) onLabelChange(id, next);
    setEditingLabel(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.55, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className={`group relative w-[280px] rounded-2xl border px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-8px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_32px_-8px_rgba(0,0,0,0.2)] ${
        aiSuggested
          ? 'border-dashed border-accent/40 bg-accent-soft/70'
          : 'border-line bg-surface'
      } ${unsure ? 'ring-2 ring-warn-line' : ''}`}
    >
      {!isRoot && <Handle type="target" position={Position.Top} style={anchorStyle} />}

      <Handle
        type="target"
        id="left"
        position={Position.Left}
        className={relationHandleClass}
        title="Drag to connect"
      />
      <Handle
        type="source"
        id="right"
        position={Position.Right}
        className={relationHandleClass}
        title="Drag to connect"
      />

      <div className="nodrag absolute right-2 top-2.5 flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onFieldChange(id, { unsure: !unsure })}
          title={unsure ? 'Clear “not sure” flag' : 'Mark as “not sure”'}
          className={`h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
            unsure
              ? 'flex bg-warn-bg text-warn'
              : 'hidden text-subink/50 hover:bg-hover hover:text-ink group-hover:flex'
          }`}
        >
          ?
        </button>
        <button
          type="button"
          onClick={startLabelEdit}
          title="Rename"
          className="hidden h-5 w-5 items-center justify-center rounded-full text-subink/50 hover:bg-hover hover:text-ink group-hover:flex"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path
              d="M11.5 2.5l2 2-7.5 7.5-2.5.5.5-2.5 7.5-7.5z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onDelete(id)}
          title="Delete"
          className="hidden h-5 w-5 items-center justify-center rounded-full text-subink/50 hover:bg-hover hover:text-ink group-hover:flex"
        >
          ×
        </button>
      </div>

      {aiSuggested && (
        <span className="mb-1 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
          AI suggested
        </span>
      )}

      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowPalette((v) => !v)}
            title={`Category: ${categoryLabel(category)}`}
            className="nodrag mt-1.5 block h-2.5 w-2.5 rounded-full ring-offset-1 transition-transform hover:scale-125"
            style={{ backgroundColor: categoryColor(category) }}
          />
          <AnimatePresence>
            {showPalette && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="nodrag absolute left-0 top-6 z-50 w-[132px] rounded-xl border border-line2 bg-panel p-1.5 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.25)]"
              >
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      onFieldChange(id, { category: c.key });
                      setShowPalette(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] hover:bg-hover ${
                      (category ?? 'none') === c.key ? 'text-ink' : 'text-subink'
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    {c.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="min-w-0 flex-1">
          {editingLabel ? (
            <input
              ref={labelInputRef}
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitLabel();
                }
                if (e.key === 'Escape') setEditingLabel(false);
              }}
              className="nodrag w-full rounded-lg border border-accent/40 bg-panel px-2 py-1 text-[15px] font-semibold leading-tight text-ink focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          ) : (
            <p
              onDoubleClick={startLabelEdit}
              title="Double-click to rename"
              className="truncate pr-14 text-[15px] font-semibold leading-tight text-ink"
            >
              {label}
            </p>
          )}

          <input
            value={date ?? ''}
            onChange={(e) => onFieldChange(id, { date: e.target.value })}
            placeholder="Add date…"
            className={`nodrag mt-0.5 w-full bg-transparent text-[11.5px] font-medium uppercase tracking-wide text-subink placeholder:normal-case placeholder:tracking-normal placeholder:text-subink/45 focus:outline-none ${
              date ? '' : 'opacity-0 focus:opacity-100 group-hover:opacity-100'
            }`}
          />
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => onNotesChange(id, e.target.value)}
        placeholder={loading ? 'Researching…' : 'Add notes…'}
        rows={3}
        className={`nodrag mt-2 w-full resize-none rounded-lg border px-2 py-1.5 text-[12.5px] leading-snug text-ink/90 placeholder:text-subink/60 focus:outline-none focus:ring-1 focus:ring-accent/30 ${
          aiFilled
            ? 'border-accent/30 bg-accent-soft'
            : 'border-line bg-sunken focus:border-accent/40'
        }`}
      />
      {loading && (
        <p className="mt-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-accent">
          <motion.span
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="h-1.5 w-1.5 rounded-full bg-accent"
          />
          Researching…
        </p>
      )}

      {aiFilled && !loading && (
        <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-accent">
          ✨ AI-filled — edit anytime
        </p>
      )}

      {aiCorrection && (
        <p className="mt-1.5 rounded-lg border border-warn-line bg-warn-bg px-2 py-1 text-[11.5px] leading-snug text-warn">
          ⚠️ {aiCorrection}
        </p>
      )}

      <AnimatePresence initial={false}>
        {isAddingChild && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={submitChild}
            className="nodrag mt-2 overflow-hidden"
          >
            <input
              ref={childInputRef}
              value={childText}
              onChange={(e) => setChildText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancelChild(id);
              }}
              onBlur={() => {
                if (!childText.trim()) onCancelChild(id);
              }}
              placeholder="Subtopic name…"
              className="w-full rounded-lg border border-accent/30 bg-panel px-2 py-1 text-[12.5px] text-ink focus:outline-none"
            />
          </motion.form>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => onStartAddChild(id)}
        title="Add subtopic"
        className="nodrag absolute -bottom-2.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-white shadow-[0_2px_6px_rgba(0,113,227,0.45)]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M5 0v10M0 5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </motion.button>

      <Handle type="source" position={Position.Bottom} style={anchorStyle} />
    </motion.div>
  );
}

export default memo(KnowledgeBlock);
