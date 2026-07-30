import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const PRESETS = ['caused', 'led to', 'part of', 'influenced', 'contradicts', 'happened during'];

export default function RelationDialog({ sourceLabel, targetLabel, initialLabel, onSave, onDelete, onCancel }) {
  const [value, setValue] = useState(initialLabel ?? '');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function save(e) {
    e?.preventDefault();
    onSave(value.trim() || 'relates to');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-6 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        className="w-full max-w-[400px] rounded-3xl border border-black/5 bg-white p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.3)]"
      >
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">
          {onDelete ? 'Edit connection' : 'How are these related?'}
        </h2>
        <p className="mt-1 text-[12.5px] leading-snug text-subink">
          <span className="font-medium text-ink">{sourceLabel}</span> →{' '}
          <span className="font-medium text-ink">{targetLabel}</span>
        </p>

        <form onSubmit={save} className="mt-4">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
            }}
            placeholder="relates to"
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-[13.5px] text-ink placeholder:text-subink/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
          />

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setValue(p)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                  value === p
                    ? 'border-accent/40 bg-accent-soft text-accent'
                    : 'border-black/10 text-subink hover:bg-black/[0.03] hover:text-ink'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="mr-auto rounded-xl px-3 py-2 text-[13px] text-subink hover:bg-red-50 hover:text-red-600"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-black/10 px-3.5 py-2 text-[13px] text-subink hover:bg-black/5 hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-accent px-3.5 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]"
            >
              Save
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
