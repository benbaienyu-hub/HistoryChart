import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { CATEGORIES, categoryColor, categoryLabel } from '../lib/categories';
import { hasImageFiles, imagesFromClipboard, imagesFromDataTransfer, sortImageFiles } from '../lib/imageFiles';
import { AddImageButton } from './BlockImages';

// The expanded view of one block, at roughly half the screen. It edits the same
// fields through the same handlers as the block itself — there is no separate
// draft state, so anything typed here is already saved and already undoable.
//
// It renders outside the React Flow viewport on purpose: inside, it would inherit
// the canvas transform and be scaled by the zoom level and clipped by the pane.
export default function BlockDetail({
  node,
  onClose,
  onNotesChange,
  onLabelChange,
  onFieldChange,
  onAddImages,
  onRemoveImage,
}) {
  const notesRef = useRef(null);
  const { id } = node;
  const {
    label,
    notes,
    date,
    category,
    unsure,
    aiFilled,
    aiCorrection,
    images = [],
    uploadingImages = 0,
  } = node.data;

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

              {onAddImages && (
                <AddImageButton
                  onFiles={(files) => onAddImages(id, sortImageFiles(files))}
                  title="Add an image"
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-subink hover:bg-hover hover:text-ink"
                >
                  <span>＋ Image</span>
                </AddImageButton>
              )}
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

        {/* One scrolling column: the notes grow to fit, and the pictures sit
            underneath them rather than competing for the same space. */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          onDragOver={(e) => {
            if (hasImageFiles(e.dataTransfer)) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!hasImageFiles(e.dataTransfer) || !onAddImages) return;
            e.preventDefault();
            onAddImages(id, imagesFromDataTransfer(e.dataTransfer));
          }}
        >
          <textarea
            ref={notesRef}
            value={notes}
            onChange={(e) => onNotesChange(id, e.target.value)}
            onPaste={(e) => {
              if (!onAddImages) return;
              const found = imagesFromClipboard(e.clipboardData);
              if (found.accepted.length === 0 && found.rejected.length === 0) return;
              e.preventDefault();
              onAddImages(id, found);
            }}
            placeholder="Write everything you know about this…"
            // flex-1 with a floor: fills the panel when there are no pictures,
            // and keeps a decent writing area when there are.
            className="min-h-[240px] w-full flex-1 resize-none bg-transparent px-6 py-5 text-[14.5px] leading-relaxed text-ink/90 placeholder:text-subink/60 focus:outline-none"
          />

          {(images.length > 0 || uploadingImages > 0) && (
            <div className="grid grid-cols-2 gap-3 px-6 pb-5">
              {images.map((image) => (
                <figure key={image.id} className="group/img relative">
                  {/* Full shape here, unlike the cropped strip on the block —
                      this is where you actually read a diagram. */}
                  <img
                    src={image.url}
                    alt={image.name}
                    className="w-full rounded-xl border border-line bg-sunken object-contain"
                  />
                  {onRemoveImage && (
                    <button
                      type="button"
                      onClick={() => onRemoveImage(id, image.id)}
                      aria-label={`Remove ${image.name}`}
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-[13px] leading-none text-white opacity-0 transition-opacity group-hover/img:opacity-100 hover:bg-danger"
                    >
                      ×
                    </button>
                  )}
                  <figcaption className="mt-1 truncate text-[11px] text-subink">
                    {image.name}
                  </figcaption>
                </figure>
              ))}
              {uploadingImages > 0 && (
                <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-line2 bg-sunken text-[12px] text-subink">
                  Uploading {uploadingImages} image{uploadingImages === 1 ? '' : 's'}…
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-2.5">
          <span className="text-[11.5px] text-subink">
            {aiFilled ? '✨ AI-filled — edit freely' : 'Saved as you type'}
          </span>
          <span className="text-[11.5px] tabular-nums text-subink/70">
            {notes.trim() ? `${notes.trim().split(/\s+/).length} words` : 'No notes yet'}
            {images.length > 0 &&
              ` · ${images.length} image${images.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
