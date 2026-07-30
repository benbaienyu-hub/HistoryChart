import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import {
  canvasesOwnedBy,
  canvasesSharedWith,
  createCanvas,
  deleteCanvas,
  updateCanvas,
} from '../lib/canvasStore';
import ShareDialog from './ShareDialog';

function formatUpdated(ts) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function CanvasCard({ canvas, index, onOpen, actions }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(canvas.title);

  function commit() {
    const next = draft.trim();
    if (next && next !== canvas.title) actions.onRename(canvas.id, next);
    setRenaming(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.24), type: 'spring', stiffness: 240, damping: 24 }}
      className="group flex flex-col rounded-2xl border border-black/5 bg-white/85 p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-shadow hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_32px_-12px_rgba(0,0,0,0.2)]"
    >
      <button type="button" onClick={() => onOpen(canvas.id)} className="mb-3 block text-left">
        <div className="flex h-[68px] items-center justify-center rounded-xl bg-canvas">
          <div className="flex items-end gap-1">
            {[10, 20, 14, 26, 16].map((h, i) => (
              <span
                key={i}
                className="w-1.5 rounded-full bg-accent/25"
                style={{ height: h, opacity: canvas.nodes.length ? 1 : 0.35 }}
              />
            ))}
          </div>
        </div>
      </button>

      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(canvas.title);
              setRenaming(false);
            }
          }}
          className="w-full rounded-lg border border-accent/40 bg-white px-2 py-1 text-[14px] font-semibold text-ink focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => onOpen(canvas.id)}
          className="truncate text-left text-[14px] font-semibold text-ink"
        >
          {canvas.title}
        </button>
      )}

      <p className="mt-0.5 text-[11.5px] text-subink">
        {canvas.nodes.length} {canvas.nodes.length === 1 ? 'block' : 'blocks'} ·{' '}
        {formatUpdated(canvas.updatedAt)}
        {actions.readOnly && ` · from ${canvas.ownerEmail}`}
      </p>

      {canvas.lastScore && (
        <p className="mt-1 text-[11.5px] text-accent">
          Last studied {canvas.lastScore.correct}/{canvas.lastScore.total}
        </p>
      )}

      {!actions.readOnly && (
        <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => {
              setDraft(canvas.title);
              setRenaming(true);
            }}
            className="rounded-lg px-2 py-1 text-[11.5px] text-subink hover:bg-black/5 hover:text-ink"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => actions.onShare(canvas)}
            className="rounded-lg px-2 py-1 text-[11.5px] text-subink hover:bg-black/5 hover:text-ink"
          >
            Share
            {(canvas.sharedWith ?? []).length > 0 && ` (${canvas.sharedWith.length})`}
          </button>
          <button
            type="button"
            onClick={() => actions.onDelete(canvas)}
            className="ml-auto rounded-lg px-2 py-1 text-[11.5px] text-subink hover:bg-red-50 hover:text-red-600"
          >
            Delete
          </button>
        </div>
      )}
    </motion.div>
  );
}

export default function Home({ user, onOpenCanvas, onSignOut }) {
  // Bumping this re-renders, which re-reads the store below after a mutation.
  const [, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [sharing, setSharing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const owned = canvasesOwnedBy(user.email);
  const shared = canvasesSharedWith(user.email);

  function handleNew() {
    const canvas = createCanvas({ ownerEmail: user.email });
    onOpenCanvas(canvas.id);
  }

  function handleRename(id, title) {
    updateCanvas(id, { title });
    refresh();
  }

  function handleDeleteConfirmed() {
    deleteCanvas(confirmDelete.id);
    setConfirmDelete(null);
    refresh();
  }

  const ownedActions = {
    onRename: handleRename,
    onShare: (canvas) => setSharing(canvas),
    onDelete: (canvas) => setConfirmDelete(canvas),
    readOnly: false,
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-black/5 bg-white/70 px-6 py-3 backdrop-blur-xl">
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">HistoryChart</h1>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[12.5px] text-subink sm:block">{user.email}</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-[12px] font-semibold text-accent">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-full border border-black/10 px-3 py-1.5 text-[12.5px] text-subink hover:bg-black/5 hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-ink">Your canvases</h2>
            <p className="mt-0.5 text-[13px] text-subink">
              Pick up where you left off, or start something new.
            </p>
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleNew}
            className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)]"
          >
            + New canvas
          </motion.button>
        </div>

        {owned.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-white/50 px-6 py-14 text-center">
            <p className="text-[14px] text-ink">No canvases yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] leading-snug text-subink">
              Create one, search a topic to drop your first block, then let “Fill my knowledge”
              check your work.
            </p>
            <button
              type="button"
              onClick={handleNew}
              className="mt-4 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)]"
            >
              + New canvas
            </button>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {owned.map((canvas, i) => (
              <CanvasCard
                key={canvas.id}
                canvas={canvas}
                index={i}
                onOpen={onOpenCanvas}
                actions={ownedActions}
              />
            ))}
          </div>
        )}

        {shared.length > 0 && (
          <section className="mt-12">
            <h2 className="text-[22px] font-semibold tracking-tight text-ink">Shared with you</h2>
            <p className="mt-0.5 text-[13px] text-subink">
              Canvases other people on this device gave you access to.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shared.map((canvas, i) => (
                <CanvasCard
                  key={canvas.id}
                  canvas={canvas}
                  index={i}
                  onOpen={onOpenCanvas}
                  actions={{ readOnly: true }}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      {sharing && (
        <ShareDialog
          canvas={owned.find((c) => c.id === sharing.id) ?? sharing}
          currentUser={user}
          onClose={() => setSharing(null)}
          onChanged={refresh}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-6 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-[360px] rounded-3xl border border-black/5 bg-white p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.3)]"
          >
            <h2 className="text-[16px] font-semibold text-ink">Delete this canvas?</h2>
            <p className="mt-1.5 text-[13px] leading-snug text-subink">
              “{confirmDelete.title}” and its {confirmDelete.nodes.length} block
              {confirmDelete.nodes.length === 1 ? '' : 's'} will be permanently removed. This
              can’t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border border-black/10 px-3.5 py-2 text-[13px] text-subink hover:bg-black/5 hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirmed}
                className="rounded-xl bg-red-600 px-3.5 py-2 text-[13px] font-medium text-white"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
