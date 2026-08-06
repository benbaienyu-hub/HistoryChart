import { motion } from 'framer-motion';

// The screen between clicking Study and seeing a card. It exists because there
// are now two real choices — what to study and how to answer — and picking for
// the user would be guessing. It also makes both features discoverable: nobody
// finds a typing mode that is hidden behind a keyboard shortcut.

function Option({ selected, onSelect, title, detail, badge, disabled }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        selected
          ? 'border-accent bg-accent-soft'
          : 'border-line2 hover:border-line hover:bg-hover'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-accent bg-accent' : 'border-line2'
        }`}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`text-[13.5px] font-medium ${selected ? 'text-accent' : 'text-ink'}`}>
            {title}
          </span>
          {badge !== undefined && (
            <span className="rounded-full bg-sunken px-1.5 text-[11px] tabular-nums text-subink">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-subink">{detail}</span>
      </span>
    </button>
  );
}

export default function StudySetup({
  canvasTitle,
  totalCards,
  dueCount,
  flaggedCount,
  scope,
  mode,
  onScope,
  onMode,
  onStart,
  onExit,
}) {
  const nothingDue = dueCount === 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas/95 backdrop-blur-xl">
      <div className="border-b border-line bg-surface px-5 py-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onExit}
            className="rounded-full px-2 py-1.5 text-[13px] text-subink hover:bg-hover hover:text-ink"
          >
            ✕ Close
          </button>
          <p className="min-w-0 truncate text-[13px] font-medium text-ink">{canvasTitle}</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="w-full max-w-md rounded-3xl border border-line bg-panel p-6 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.2)]"
        >
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">Study</h2>
          <p className="mt-0.5 text-[13px] text-subink">
            {totalCards} card{totalCards === 1 ? '' : 's'} on this canvas.
          </p>

          <p className="mt-5 mb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
            What
          </p>
          <div className="space-y-1.5">
            <Option
              selected={scope === 'due'}
              onSelect={() => onScope('due')}
              title="Due now"
              badge={dueCount}
              disabled={nothingDue}
              detail={
                nothingDue
                  ? 'Nothing is due — everything here has been reviewed recently.'
                  : 'Cards you have never seen, plus the ones the schedule says are ready.'
              }
            />
            <Option
              selected={scope === 'all'}
              onSelect={() => onScope('all')}
              title="Everything"
              badge={totalCards}
              detail="Every card, due or not. Still counts towards the schedule."
            />
            {flaggedCount > 0 && (
              <Option
                selected={scope === 'flagged'}
                onSelect={() => onScope('flagged')}
                title="Flagged only"
                badge={flaggedCount}
                detail="Just the blocks you marked as unsure."
              />
            )}
          </div>

          <p className="mt-5 mb-2 text-[11px] font-medium uppercase tracking-wide text-subink/80">
            How
          </p>
          <div className="space-y-1.5">
            <Option
              selected={mode === 'check'}
              onSelect={() => onMode('check')}
              title="Self-check"
              detail="Recall it in your head, reveal, and tick what you had. Fast."
            />
            <Option
              selected={mode === 'type'}
              onSelect={() => onMode('type')}
              title="Type the answer"
              // The honest sell: this mode is harder, and that is the point.
              detail="Write what you remember first, and it marks itself against your points. Slower, and much harder to kid yourself."
            />
          </div>

          <button
            type="button"
            onClick={onStart}
            className="mt-6 w-full rounded-xl bg-accent py-2.5 text-[14px] font-medium text-white shadow-[0_2px_10px_rgba(0,113,227,0.35)]"
          >
            Start
          </button>
        </motion.div>
      </div>
    </div>
  );
}
