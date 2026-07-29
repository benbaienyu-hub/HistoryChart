import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { AnimatePresence, motion } from 'framer-motion';

const handleStyle = {
  width: 6,
  height: 6,
  background: 'rgba(0,0,0,0.18)',
  border: 'none',
  pointerEvents: 'none',
};

function KnowledgeBlock({ data, id }) {
  const {
    label,
    notes,
    isRoot,
    aiFilled,
    aiCorrection,
    aiSuggested,
    isAddingChild,
    onNotesChange,
    onLabelChange,
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

  useEffect(() => {
    if (isAddingChild) childInputRef.current?.focus();
  }, [isAddingChild]);

  useEffect(() => {
    if (editingLabel) {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    }
  }, [editingLabel]);

  function startLabelEdit() {
    setLabelDraft(label);
    setEditingLabel(true);
  }

  function commitLabel() {
    const next = labelDraft.trim();
    if (next && next !== label) onLabelChange(id, next);
    setEditingLabel(false);
  }

  function submitChild(e) {
    e.preventDefault();
    const text = childText.trim();
    if (!text) return;
    onSubmitChild(id, text);
    setChildText('');
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.55, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className={`group relative w-[260px] rounded-2xl border px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-8px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_32px_-8px_rgba(0,0,0,0.2)] ${
        aiSuggested
          ? 'border-dashed border-accent/40 bg-accent-soft/70'
          : 'border-black/5 bg-white/85'
      }`}
    >
      {!isRoot && <Handle type="target" position={Position.Top} style={handleStyle} />}

      <div className="nodrag absolute right-2 top-2.5 hidden items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          onClick={startLabelEdit}
          title="Rename"
          className="flex h-5 w-5 items-center justify-center rounded-full text-subink/50 hover:bg-black/5 hover:text-ink"
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
          className="flex h-5 w-5 items-center justify-center rounded-full text-subink/50 hover:bg-black/5 hover:text-ink"
        >
          ×
        </button>
      </div>

      {aiSuggested && (
        <span className="mb-1 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
          AI suggested
        </span>
      )}

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
          className="nodrag w-full rounded-lg border border-accent/40 bg-white px-2 py-1 text-[15px] font-semibold leading-tight text-ink focus:outline-none focus:ring-2 focus:ring-accent/15"
        />
      ) : (
        <p
          onDoubleClick={startLabelEdit}
          title="Double-click to rename"
          className="truncate pr-10 text-[15px] font-semibold leading-tight text-ink"
        >
          {label}
        </p>
      )}

      <textarea
        value={notes}
        onChange={(e) => onNotesChange(id, e.target.value)}
        placeholder="Add notes…"
        rows={3}
        className={`nodrag mt-2 w-full resize-none rounded-lg border px-2 py-1.5 text-[12.5px] leading-snug text-ink/90 placeholder:text-subink/60 focus:outline-none focus:ring-1 focus:ring-accent/30 ${
          aiFilled ? 'border-accent/30 bg-accent-soft' : 'border-black/5 bg-black/[0.02] focus:border-accent/40'
        }`}
      />
      {aiFilled && (
        <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-accent">
          ✨ AI-filled — edit anytime
        </p>
      )}

      {aiCorrection && (
        <p className="mt-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11.5px] leading-snug text-amber-700">
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
              className="w-full rounded-lg border border-accent/30 bg-white px-2 py-1 text-[12.5px] text-ink focus:outline-none"
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

      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </motion.div>
  );
}

export default memo(KnowledgeBlock);
