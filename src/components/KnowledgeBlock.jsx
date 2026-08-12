import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { AnimatePresence, motion } from 'framer-motion';
import { categoryColor, categoryLabel } from '../lib/categories';
import { hasImageFiles, imagesFromClipboard, imagesFromDataTransfer } from '../lib/imageFiles';
import { ImageStrip } from './BlockImages';
import BlockMenu from './BlockMenu';

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
    collapsed,
    childCount = 0,
    hiddenCount = 0,
    isAddingChild,
    images = [],
    uploadingImages = 0,
    onAddImages,
    onRemoveImage,
    onNotesChange,
    onLabelChange,
    onFieldChange,
    onStartAddChild,
    onSubmitChild,
    onCancelChild,
    onToggleCollapse,
    onExpand,
    onDelete,
  } = data;

  const [childText, setChildText] = useState('');
  const childInputRef = useRef(null);

  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(label);
  const labelInputRef = useRef(null);

  // Highlighted while a file is being dragged over the block, so it is obvious
  // where the picture is about to land.
  const [dropping, setDropping] = useState(false);

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

  function handleDrop(e) {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropping(false);
    onAddImages?.(id, imagesFromDataTransfer(e.dataTransfer));
  }

  // Paste is the one that matters most in practice: a screenshot goes from the
  // clipboard into the right block without ever becoming a file on disk.
  function handlePaste(e) {
    const found = imagesFromClipboard(e.clipboardData);
    if (found.accepted.length === 0 && found.rejected.length === 0) return;
    e.preventDefault();
    onAddImages?.(id, found);
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.55, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className={`group relative w-[320px] rounded-2xl border px-4 py-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-8px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_32px_-8px_rgba(0,0,0,0.2)] ${
        aiSuggested
          ? 'border-dashed border-accent/40 bg-accent-soft/70'
          : 'border-line bg-surface'
      } ${unsure ? 'ring-2 ring-warn-line' : ''} ${
        dropping ? 'ring-2 ring-accent' : ''
      }`}
      onDragOver={(e) => {
        if (!hasImageFiles(e.dataTransfer)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer actually leaves the block: moving between its
        // children fires dragleave too, which would flicker the highlight.
        if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false);
      }}
      onDrop={handleDrop}
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

      {/* Two controls, not five. "Open larger" stays its own button because it is
          what you reach for while reading; everything you do while *editing* is
          behind the ⋯. */}
      <div className="nodrag absolute right-2 top-2.5 flex items-center gap-0.5">
        {unsure && (
          // A state, not a control — clearing it is a menu item. The block also
          // carries a warning-coloured ring, but that reads as selection to anyone
          // who hasn't seen it before, so the flag says what it is.
          <span
            title="Flagged as “not sure”"
            className="mr-0.5 flex h-5 items-center rounded-full bg-warn-bg px-1.5 text-[10.5px] font-bold text-warn"
          >
            ?
          </span>
        )}
        <button
          type="button"
          onClick={() => onExpand(id)}
          title="Open larger"
          aria-label="Open larger"
          className="flex h-5 w-5 items-center justify-center rounded-full text-subink/50 hover:bg-hover hover:text-ink"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <BlockMenu
          id={id}
          category={category}
          unsure={unsure}
          onFieldChange={onFieldChange}
          onRename={startLabelEdit}
          onAddImages={onAddImages}
          onDelete={onDelete}
        />
      </div>

      {aiSuggested && (
        <span className="mb-1 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
          AI suggested
        </span>
      )}

      <div className="flex items-start gap-2.5">
        {/* An indicator, not a control. Choosing a category is a menu item now: a
            2.5px dot is a poor click target and gave no hint that it was one. */}
        <span
          title={`Category: ${categoryLabel(category)}`}
          className="mt-1.5 block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: categoryColor(category) }}
        />

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
              className="truncate pr-12 text-[15.5px] font-semibold leading-tight text-ink"
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

      <ImageStrip
        images={images}
        uploading={uploadingImages}
        onOpen={() => onExpand(id)}
        onRemove={onRemoveImage ? (imageId) => onRemoveImage(id, imageId) : undefined}
      />

      {/* `nowheel` is React Flow's opt-out: without it the canvas swallows the
          wheel event to zoom, so a trackpad two-finger scroll over long notes
          zoomed the graph instead of scrolling the text, leaving the scrollbar as
          the only way to read past the third line. */}
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(id, e.target.value)}
        placeholder={loading ? 'Researching…' : 'Add notes…'}
        onPaste={handlePaste}
        // Generated notes arrive as 2–4 dot points, most of which wrap, so four
        // rows put nearly every block behind a scroll on arrival.
        rows={6}
        className={`nodrag nowheel mt-2 w-full resize-y rounded-lg border px-2 py-1.5 text-[13px] leading-relaxed text-ink/90 placeholder:text-subink/60 focus:outline-none focus:ring-1 focus:ring-accent/30 ${
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

      <div className="absolute -bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1">
        {childCount > 0 && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => onToggleCollapse(id)}
            title={
              collapsed
                ? `Expand ${hiddenCount} hidden ${hiddenCount === 1 ? 'block' : 'blocks'}`
                : 'Collapse this branch'
            }
            className={`nodrag flex h-5 items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-semibold tabular-nums shadow-sm ${
              collapsed
                ? 'border-accent bg-accent text-white'
                : 'border-line2 bg-panel text-subink hover:text-ink'
            }`}
          >
            <motion.svg
              width="9"
              height="9"
              viewBox="0 0 10 10"
              fill="none"
              animate={{ rotate: collapsed ? -90 : 0 }}
              transition={{ duration: 0.18 }}
            >
              <path
                d="M2 3.5L5 6.5l3-3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.svg>
            {collapsed && hiddenCount > 0 && <span>{hiddenCount}</span>}
          </motion.button>
        )}

        <motion.button
          type="button"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => onStartAddChild(id)}
          title="Add subtopic"
          className="nodrag flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white shadow-[0_2px_6px_rgba(0,113,227,0.45)]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M5 0v10M0 5h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </motion.button>
      </div>

      <Handle type="source" position={Position.Bottom} style={anchorStyle} />
    </motion.div>
  );
}

export default memo(KnowledgeBlock);
