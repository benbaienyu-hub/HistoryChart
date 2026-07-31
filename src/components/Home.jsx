import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import {
  canvasesOwnedBy,
  canvasesSharedWith,
  createCanvas,
  deleteCanvas,
  updateCanvas,
} from '../lib/canvasStore';
import { categoryColor } from '../lib/categories';
import { buildTemplateGraph, listTemplates } from '../lib/templates';
import ShareDialog from './ShareDialog';
import ThemeToggle from './ThemeToggle';

const NODE_W = 280;
const NODE_H = 150;

// A real miniature of the graph, so a card actually tells you what's inside.
function GraphThumbnail({ nodes, edges }) {
  if (nodes.length === 0) {
    return (
      <div className="flex h-[68px] items-center justify-center rounded-xl bg-canvas">
        <span className="text-[11.5px] text-subink/60">Empty canvas</span>
      </div>
    );
  }

  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) + NODE_W - minX;
  const height = Math.max(...ys) + NODE_H - minY;
  const pad = 40;
  const at = (n) => ({ x: n.position.x - minX, y: n.position.y - minY });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="h-[68px] overflow-hidden rounded-xl bg-canvas">
      <svg
        viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
      >
        {edges.map((e) => {
          const source = byId.get(e.source);
          const target = byId.get(e.target);
          if (!source || !target) return null;
          const a = at(source);
          const b = at(target);
          return (
            <line
              key={e.id}
              x1={a.x + NODE_W / 2}
              y1={a.y + NODE_H / 2}
              x2={b.x + NODE_W / 2}
              y2={b.y + NODE_H / 2}
              stroke="var(--color-edge)"
              strokeWidth={6}
            />
          );
        })}
        {nodes.map((n) => {
          const p = at(n);
          return (
            <rect
              key={n.id}
              x={p.x}
              y={p.y}
              width={NODE_W}
              height={NODE_H}
              rx={24}
              fill={categoryColor(n.data?.category)}
              opacity={0.85}
            />
          );
        })}
      </svg>
    </div>
  );
}

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
      className="group flex flex-col rounded-2xl border border-line bg-surface p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-shadow hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_32px_-12px_rgba(0,0,0,0.2)]"
    >
      <button type="button" onClick={() => onOpen(canvas.id)} className="mb-3 block w-full text-left">
        <GraphThumbnail nodes={canvas.nodes} edges={canvas.edges} />
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
          className="w-full rounded-lg border border-accent/40 bg-panel px-2 py-1 text-[14px] font-semibold text-ink focus:outline-none"
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
          Last studied {canvas.lastScore.correct}/{canvas.lastScore.total} points
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
            className="rounded-lg px-2 py-1 text-[11.5px] text-subink hover:bg-hover hover:text-ink"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => actions.onShare(canvas)}
            className="rounded-lg px-2 py-1 text-[11.5px] text-subink hover:bg-hover hover:text-ink"
          >
            Share
            {(canvas.sharedWith ?? []).length > 0 && ` (${canvas.sharedWith.length})`}
          </button>
          <button
            type="button"
            onClick={() => actions.onDelete(canvas)}
            className="ml-auto rounded-lg px-2 py-1 text-[11.5px] text-subink hover:bg-danger-bg hover:text-danger"
          >
            Delete
          </button>
        </div>
      )}
    </motion.div>
  );
}

function CardGrid({ children }) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

function EmptyState({ title, body, action, secondary }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-line2 bg-surface px-6 py-14 text-center">
      <p className="text-[14px] text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] leading-snug text-subink">{body}</p>
      {(action || secondary) && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)]"
            >
              {action.label}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              className="rounded-full border border-line2 px-4 py-2 text-[13px] text-subink hover:bg-hover hover:text-ink"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Home({ user, onOpenCanvas, onSignOut }) {
  // Bumping this re-renders, which re-reads the store below after a mutation.
  const [, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [sharing, setSharing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [tab, setTab] = useState('mine');

  const owned = canvasesOwnedBy(user.email);
  const shared = canvasesSharedWith(user.email);
  const templates = listTemplates();

  const TABS = [
    {
      key: 'mine',
      label: 'Your canvases',
      count: owned.length,
      blurb: 'Pick up where you left off, or start something new.',
      hint: 'Canvases you own',
    },
    {
      key: 'shared',
      label: 'Shared with me',
      count: shared.length,
      blurb: 'Canvases other people gave you access to.',
      hint: 'Canvases shared with your email',
    },
    {
      key: 'examples',
      label: 'Examples',
      count: templates.length,
      blurb: 'Pre-built canvases you can edit, extend, or study straight away.',
      hint: 'Starter canvases',
    },
  ];
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  function handleNew() {
    const canvas = createCanvas({ ownerEmail: user.email });
    onOpenCanvas(canvas.id);
  }

  function handleUseTemplate(key) {
    const graph = buildTemplateGraph(key);
    if (!graph) return;
    const canvas = createCanvas({
      ownerEmail: user.email,
      title: graph.title,
      nodes: graph.nodes,
      edges: graph.edges,
    });
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
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-surface px-6 py-3 backdrop-blur-xl">
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">Lacuna</h1>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <span className="hidden text-[12.5px] text-subink sm:block">{user.email}</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-[12px] font-semibold text-accent">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-full border border-line2 px-3 py-1.5 text-[12.5px] text-subink hover:bg-hover hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
        <nav className="sticky top-[61px] hidden h-fit w-48 shrink-0 md:block">
          {TABS.map(({ key, label, count, hint }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                title={hint}
                className={`mb-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13.5px] transition-colors ${
                  active
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-subink hover:bg-hover hover:text-ink'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span
                  className={`shrink-0 rounded-full px-1.5 text-[11px] tabular-nums ${
                    active ? 'bg-accent/15 text-accent' : 'bg-sunken text-subink'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={handleNew}
            className="mt-3 w-full rounded-xl bg-accent px-3 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)]"
          >
            + New canvas
          </button>
        </nav>

        <main className="min-w-0 flex-1">
          {/* Tab strip for narrow screens, where the sidebar is hidden. */}
          <div className="mb-5 flex gap-1.5 overflow-x-auto md:hidden">
            {TABS.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] ${
                  tab === key
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'border border-line2 text-subink'
                }`}
              >
                {label} {count}
              </button>
            ))}
          </div>

          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight text-ink">{active.label}</h2>
              <p className="mt-0.5 text-[13px] text-subink">{active.blurb}</p>
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleNew}
              className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)] md:hidden"
            >
              + New canvas
            </motion.button>
          </div>

          {tab === 'mine' &&
            (owned.length === 0 ? (
              <EmptyState
                title="No canvases yet"
                body="Start blank and search a topic to drop your first block — or open one of the examples to see what a finished canvas looks like."
                action={{ label: '+ New canvas', onClick: handleNew }}
                secondary={{ label: 'Browse examples', onClick: () => setTab('examples') }}
              />
            ) : (
              <CardGrid>
                {owned.map((canvas, i) => (
                  <CanvasCard
                    key={canvas.id}
                    canvas={canvas}
                    index={i}
                    onOpen={onOpenCanvas}
                    actions={ownedActions}
                  />
                ))}
              </CardGrid>
            ))}

          {tab === 'shared' &&
            (shared.length === 0 ? (
              <EmptyState
                title="Nothing shared with you yet"
                body="When someone shares a canvas with your email, it shows up here. Sharing currently works between profiles in this same browser — it doesn’t send an invite email."
              />
            ) : (
              <CardGrid>
                {shared.map((canvas, i) => (
                  <CanvasCard
                    key={canvas.id}
                    canvas={canvas}
                    index={i}
                    onOpen={onOpenCanvas}
                    actions={{ readOnly: true }}
                  />
                ))}
              </CardGrid>
            ))}

          {tab === 'examples' && (
            <CardGrid>
              {listTemplates().map((template, i) => {
                const preview = buildTemplateGraph(template.key);
                return (
                  <motion.button
                    key={template.key}
                    type="button"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i * 0.04, 0.24),
                      type: 'spring',
                      stiffness: 240,
                      damping: 24,
                    }}
                    whileHover={{ y: -2 }}
                    onClick={() => handleUseTemplate(template.key)}
                    className="flex flex-col rounded-2xl border border-dashed border-line2 bg-surface p-4 text-left transition-colors hover:border-accent/40"
                  >
                    <GraphThumbnail nodes={preview.nodes} edges={preview.edges} />
                    <p className="mt-3 text-[14px] font-semibold text-ink">{template.title}</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-subink">
                      {template.blurb}
                    </p>
                    <p className="mt-1.5 text-[11.5px] font-medium text-accent">
                      Open {template.blockCount} blocks →
                    </p>
                  </motion.button>
                );
              })}
            </CardGrid>
          )}
        </main>
      </div>

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
            className="w-full max-w-[360px] rounded-3xl border border-line bg-panel p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.3)]"
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
                className="rounded-xl border border-line2 px-3.5 py-2 text-[13px] text-subink hover:bg-hover hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirmed}
                className="rounded-xl bg-danger px-3.5 py-2 text-[13px] font-medium text-white"
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
