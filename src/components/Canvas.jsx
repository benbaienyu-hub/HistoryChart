import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  getRectOfNodes,
  getViewportForBounds,
} from 'reactflow';
import { useNodesState, useEdgesState } from 'reactflow';
import KnowledgeBlock from './KnowledgeBlock';
import SuggestedBlock from './SuggestedBlock';
import ShareDialog from './ShareDialog';
import GapPanel from './GapPanel';
import RelationDialog from './RelationDialog';
import GraphLevelMenu from './GraphLevelMenu';
import BlockDetail from './BlockDetail';
import StudyMode from './StudyMode';
import { describeAiStatus, expandTopic, fetchAiStatus, findGaps } from '../lib/aiFill';
import {
  ApiError,
  deleteImage,
  fetchCanvas,
  fetchReviews,
  saveCanvas,
  submitReviews,
  uploadImage,
} from '../lib/api';
import { serializeCanvas as serialize } from '../lib/canvasShape';
import { countDue } from '../lib/review';
import {
  MASTERY,
  MASTERY_ORDER,
  countLevels,
  idsAtLevel,
  masteryByBlock,
  withMastery,
} from '../lib/mastery';
import {
  canvasProgress,
  describeCoverage,
  describeMasteryScore,
  formatPct,
} from '../lib/progress';
import { categoryColor } from '../lib/categories';
import { appendPoints } from '../lib/gaps';
import { isSuggestionId, planInsertion, suggestionGraph, suggestionId } from '../lib/suggestions';
import { autoLayout } from '../lib/layout';
import { descendantIds, withVisibility } from '../lib/graph';
import { graphPlan } from '../lib/graphLevels';
import { STARTER_TOPICS } from '../lib/templates';
import { useTheme } from '../lib/theme';
import ThemeToggle from './ThemeToggle';

const nodeTypes = { knowledge: KnowledgeBlock, suggestion: SuggestedBlock };

const ROOT_SPACING = 400;
const CHILD_SPACING = 364;
const LEVEL_HEIGHT = 260;
const EDGE_STYLE = { stroke: 'var(--color-edge)', strokeWidth: 1.5 };
const RELATION_EDGE_STYLE = {
  stroke: 'var(--color-accent)',
  strokeOpacity: 0.55,
  strokeWidth: 1.5,
};
const HISTORY_LIMIT = 50;
const SAVE_DEBOUNCE_MS = 400;
// The gaps drawer and the toolbar both sit over the canvas, so the part of it you
// can actually see is smaller than the pane. Framing a suggestion has to aim at
// that, or it lands underneath one of them.
const GAP_PANEL_WIDTH = 340;
const TOOLBAR_HEIGHT = 57;

const NEW_BLOCK_FIELDS = {
  notes: '',
  date: '',
  category: 'none',
  unsure: false,
  aiFilled: false,
  aiCorrection: null,
  aiSuggested: false,
  isAddingChild: false,
  loading: false,
  collapsed: false,
};

// Structural (parent→child) edges and manual relation edges are stored as bare
// data and styled here, so a reload or an undo can't lose their appearance.
function styleEdge(edge) {
  if (edge.data?.manual) {
    return {
      ...edge,
      type: 'smoothstep',
      animated: false,
      style: RELATION_EDGE_STYLE,
      labelStyle: { fill: 'var(--color-accent)', fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: 'var(--color-panel)', fillOpacity: 0.92 },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
    };
  }
  return { ...edge, type: 'smoothstep', animated: true, style: EDGE_STYLE };
}

function makeEdge(sourceId, targetId) {
  return styleEdge({ id: `e-${sourceId}-${targetId}`, source: sourceId, target: targetId });
}

// How much graph "Make a graph" generates is chosen per-run from the depth menu
// — see src/lib/graphLevels.js for the counts and what each level costs.

// The editor proper. It is handed an already-loaded canvas so all of its state can
// still be initialised synchronously — the loading lives in the wrapper below.
function CanvasEditor({ user, record, focusBlockId = null, onExit }) {
  const canvasId = record.id;
  const isOwner = record.role === 'owner';
  // A 'view' grant can study a canvas but not change it, so nothing is persisted.
  const canEdit = record.role === 'owner' || record.role === 'edit';
  const [saveError, setSaveError] = useState(null);
  // This user's schedule for this canvas, by block id. Fetched separately from the
  // canvas because it is per-person: a shared canvas has one set of notes and as
  // many schedules as it has readers.
  const [reviews, setReviews] = useState({});

  // Stable dispatchers: node.data callbacks are captured once at node-creation
  // time, so each wrapper forwards to whatever logic is current in the ref,
  // keeping old nodes from ever calling back into a stale closure.
  const handlersRef = useRef({});
  const stable = useRef({
    onNotesChange: (id, text) => handlersRef.current.onNotesChange(id, text),
    onLabelChange: (id, text) => handlersRef.current.onLabelChange(id, text),
    onFieldChange: (id, patch) => handlersRef.current.onFieldChange(id, patch),
    onStartAddChild: (id) => handlersRef.current.onStartAddChild(id),
    onSubmitChild: (id, text) => handlersRef.current.onSubmitChild(id, text),
    onCancelChild: (id) => handlersRef.current.onCancelChild(id),
    onToggleCollapse: (id) => handlersRef.current.onToggleCollapse(id),
    onExpand: (id) => handlersRef.current.onExpand(id),
    onAddImages: (id, files) => handlersRef.current.onAddImages(id, files),
    onRemoveImage: (id, imageId) => handlersRef.current.onRemoveImage(id, imageId),
    onCaptionChange: (id, imageId, text) =>
      handlersRef.current.onCaptionChange(id, imageId, text),
    onDelete: (id) => handlersRef.current.onDelete(id),
  }).current;

  // Same trick for the suggestion nodes: their data is built in a memo, so the
  // callbacks in it have to be stable or every ghost re-renders whenever
  // anything on the canvas moves.
  const suggestionActions = useRef({
    onOpen: (id) => handlersRef.current.onOpenSuggestion(id),
    onAccept: (gap) => handlersRef.current.onAcceptSuggestion(gap),
    onDismiss: (id) => handlersRef.current.onDismissSuggestion(id),
  }).current;

  const hydrate = useCallback(
    (list) => list.map((n) => ({ ...n, data: { ...n.data, isAddingChild: false, ...stable } })),
    [stable]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(hydrate(record?.nodes ?? []));
  const [edges, setEdges, onEdgesChange] = useEdgesState((record?.edges ?? []).map(styleEdge));
  const [title, setTitle] = useState(record?.title ?? 'Untitled canvas');
  const [editingTitle, setEditingTitle] = useState(false);
  const [addingChildId, setAddingChildId] = useState(null);
  const [searchValue, setSearchValue] = useState('');
  const [gapsOpen, setGapsOpen] = useState(false);
  // Seeded from the last stored scan, so reopening a canvas does not throw away
  // a review that has already been paid for — and so the suggestions are drawn
  // straight away rather than only after scanning again.
  const [gaps, setGaps] = useState(() => (Array.isArray(record?.gaps) ? record.gaps : []));
  const [gapsScannedAt, setGapsScannedAt] = useState(record?.gapsScannedAt ?? null);
  const [gapsBusy, setGapsBusy] = useState(false);
  const [gapError, setGapError] = useState(null);
  // Which gaps have been applied in this scan, so the button can say "Added ✓"
  // rather than silently doing it twice.
  const [filledGapIds, setFilledGapIds] = useState(() => new Set());
  // Suggestions turned down. Per scan, not stored: a scan is one opinion about
  // the canvas as it stands, and a later one looking at different notes has
  // every right to raise the same idea again.
  const [dismissedGapIds, setDismissedGapIds] = useState(() => new Set());
  const [openSuggestionId, setOpenSuggestionId] = useState(null);
  // React Flow is controlled here, and it keeps a node's measured size only by
  // sending a "dimensions" change back through onNodesChange for the app to
  // store. Ghosts are not in node state, so nothing caught those and they stayed
  // unmeasured — which React Flow renders as `visibility: hidden`, and which
  // makes it skip the edges attached to them. So they are measured here instead.
  const [ghostSizes, setGhostSizes] = useState({});
  const [showShare, setShowShare] = useState(false);
  // The dialog edits the grant list, and hands back the canvas the server
  // returned, so the list on screen is always what the server actually stored.
  const [shared, setShared] = useState(record);
  const [pendingRelation, setPendingRelation] = useState(null);
  const [editingRelation, setEditingRelation] = useState(null);
  const [studying, setStudying] = useState(false);
  // The whole status, not just a boolean: the button's tooltip has to say *why*
  // AI is unavailable, and "no key at all" and "this server wants your own key"
  // have different fixes.
  const [aiStatus, setAiStatus] = useState(null);
  const [graphProgress, setGraphProgress] = useState(null);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const levelButtonRef = useRef(null);
  const theme = useTheme();
  // These two React Flow props are passed to canvas/SVG attributes that
  // don't resolve CSS variables, so pick literals per theme.
  const dotColor = theme === 'dark' ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.12)';
  const maskColor = theme === 'dark' ? 'rgba(23,23,26,0.72)' : 'rgba(245,245,247,0.7)';

  // Re-checked on focus, not just at mount. Whether AI works can change while this
  // page sits open — a key added to the server and deployed, or one saved by this
  // account in another tab — and the old code cached the answer for the lifetime of
  // the tab, so it went on claiming there was no key until a full reload.
  useEffect(() => {
    let active = true;
    const check = (force) => {
      fetchAiStatus(force ? { force: true } : undefined).then((status) => {
        if (active) setAiStatus(status);
      });
    };

    check(false);
    const onFocus = () => check(true);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const aiReady = Boolean(aiStatus?.configured);

  // What React Flow actually renders: collapsed subtrees marked hidden, plus
  // per-node child/hidden counts for the collapse control.
  const visible = useMemo(() => withVisibility(nodes, edges), [nodes, edges]);
  // What studying has established, painted back onto the blocks. This is the
  // whole point of keeping review state in the canvas rather than only in study
  // mode: you come back from a session and the canvas has changed.
  const rendered = useMemo(() => withMastery(visible.nodes, reviews), [visible.nodes, reviews]);
  // The same two numbers the library shows, from the same rules — so a canvas
  // cannot disagree with its own card in the library.
  const progress = useMemo(
    () => canvasProgress({ nodes, gaps, reviews }),
    [nodes, gaps, reviews]
  );
  const masteryLevels = useMemo(() => masteryByBlock(nodes, reviews), [nodes, reviews]);
  const mastery = useMemo(() => countLevels(masteryLevels), [masteryLevels]);
  const studiedCount = mastery.weak + mastery.learning + mastery.mastered;
  // Cards with notes that the schedule says are ready, plus any never studied.
  const dueNow = useMemo(
    () => countDue(nodes.filter((n) => n.data.notes?.trim()), reviews),
    [nodes, reviews]
  );

  // Missing gaps, drawn on the canvas between the blocks they belong between.
  // Ghosts are derived from the scan and never enter node state, so they cannot
  // be saved, laid out by Tidy, or caught up in undo — none of which should
  // apply to something you have not accepted yet.
  const suggestions = useMemo(
    () => suggestionGraph(gaps, nodes, { dismissed: dismissedGapIds, accepted: filledGapIds }),
    [gaps, nodes, dismissedGapIds, filledGapIds]
  );

  const suggestionNodes = useMemo(
    () =>
      suggestions.nodes.map((node) => ({
        ...node,
        ...ghostSizes[node.id],
        // Keyed by gap id, not node id: everything the ghost hands back — open,
        // dismiss, accept — is about the gap, and `suggestion:` prefixed ids
        // only exist so a ghost cannot collide with a real block.
        data: { ...node.data, ...suggestionActions, open: node.data.gap.id === openSuggestionId },
      })),
    [suggestions.nodes, suggestionActions, openSuggestionId, ghostSizes]
  );

  // A suggestion is drawn the instant the scan answers — but "drawn" is no use if
  // it is off the side of the canvas or behind the gaps drawer, which is where a
  // new one usually lands on anything bigger than a screenful. So the first time
  // a scan's ghosts exist, the viewport moves to them.
  //
  // Framed with the blocks they sit between rather than on their own: the claim a
  // suggestion makes is about the two things it interrupts, and a close-up of the
  // dashed box alone shows none of that.
  const framedGhostIds = useRef(new Set());
  useEffect(() => {
    const fresh = suggestions.nodes.filter((n) => !framedGhostIds.current.has(n.id));
    if (fresh.length === 0 || !flowRef.current || !wrapperRef.current) return;
    // Wait for React Flow to measure them. Until it has, they have no size, and
    // the bounds would be computed from a point rather than a box.
    if (!fresh.every((n) => ghostSizes[n.id])) return;

    for (const node of suggestions.nodes) framedGhostIds.current.add(node.id);

    const wanted = new Set();
    for (const node of fresh) {
      wanted.add(node.id);
      if (node.data.gap.afterId) wanted.add(node.data.gap.afterId);
      if (node.data.gap.beforeId) wanted.add(node.data.gap.beforeId);
    }
    const shown = flowRef.current.getNodes().filter((n) => wanted.has(n.id));
    if (shown.length === 0) return;

    const pane = wrapperRef.current.getBoundingClientRect();
    const visibleWidth = Math.max(320, pane.width - (gapsOpen ? GAP_PANEL_WIDTH : 0));
    const visibleHeight = Math.max(240, pane.height - TOOLBAR_HEIGHT);
    const viewport = getViewportForBounds(
      getRectOfNodes(shown),
      visibleWidth,
      visibleHeight,
      0.2,
      1,
      0.22
    );
    // getViewportForBounds measures from the top-left of the area it was given,
    // which here starts below the toolbar.
    flowRef.current.setViewport(
      { x: viewport.x, y: viewport.y + TOOLBAR_HEIGHT, zoom: viewport.zoom },
      { duration: 650 }
    );
  }, [suggestions.nodes, ghostSizes, gapsOpen]);

  // Dimension changes for ghosts are kept here; everything else goes to node
  // state as before. Splitting them keeps a measurement of something that is not
  // on the canvas from ever reaching the canvas.
  const handleNodesChange = useCallback(
    (changes) => {
      const measured = changes.filter((c) => c.type === 'dimensions' && isSuggestionId(c.id));
      if (measured.length > 0) {
        setGhostSizes((prev) => {
          let next = prev;
          for (const change of measured) {
            const { width, height } = change.dimensions ?? {};
            if (!width || !height) continue;
            if (prev[change.id]?.width === width && prev[change.id]?.height === height) continue;
            if (next === prev) next = { ...prev };
            next[change.id] = { width, height };
          }
          return next;
        });
      }
      const rest = changes.filter((c) => !isSuggestionId(c.id));
      if (rest.length > 0) onNodesChange(rest);
    },
    [onNodesChange]
  );

  const flowNodes = useMemo(
    () => (suggestionNodes.length ? [...rendered, ...suggestionNodes] : rendered),
    [rendered, suggestionNodes]
  );
  const flowEdges = useMemo(
    () => (suggestions.edges.length ? [...visible.edges, ...suggestions.edges] : visible.edges),
    [visible.edges, suggestions.edges]
  );

  // From the rendered list rather than the raw one, so the expanded view carries
  // the mastery status too.
  const expandedNode = expandedId ? (rendered.find((n) => n.id === expandedId) ?? null) : null;

  // Always-current view of the graph, for closures that would otherwise go stale.
  const liveRef = useRef({ nodes, edges });
  liveRef.current = { nodes, edges };

  // Focusing a note or title on a node whose layout position lies outside the
  // viewport makes the browser scroll the pane — overflow:hidden still permits
  // programmatic scrolling — which drags the minimap and zoom controls out of
  // place and visually jerks the canvas. Snap it back whenever it happens.
  const wrapperRef = useRef(null);
  const flowRef = useRef(null);

  // Re-frame the canvas after the graph grows, so a block added off-screen
  // doesn't read as "nothing happened". fitView ignores nodes it hasn't
  // measured yet, and measurement lands a frame or two after the commit, so
  // wait for every node to have a width before framing.
  const refit = useCallback(() => {
    let attempts = 0;
    const run = () => {
      const instance = flowRef.current;
      if (!instance) return;
      if (!instance.getNodes().every((n) => n.width) && attempts++ < 20) {
        requestAnimationFrame(run);
        return;
      }
      // minZoom keeps text legible: a wide generated graph would otherwise
      // fit-to-screen at ~0.3 and become unreadable. Past that floor it
      // overflows and the user pans (or uses the minimap) instead.
      instance.fitView({ padding: 0.25, minZoom: 0.55, maxZoom: 1, duration: 400 });
    };
    requestAnimationFrame(run);
  }, []);

  useEffect(() => {
    const pane = wrapperRef.current?.querySelector('.react-flow');
    if (!pane) return;
    const reset = () => {
      if (pane.scrollLeft !== 0) pane.scrollLeft = 0;
      if (pane.scrollTop !== 0) pane.scrollTop = 0;
    };
    pane.addEventListener('scroll', reset, { passive: true });
    return () => pane.removeEventListener('scroll', reset);
  }, []);

  const past = useRef([]);
  const future = useRef([]);
  const coalesceKey = useRef(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(past.current.length > 0);
    setCanRedo(future.current.length > 0);
  }, []);

  // Snapshot the pre-change graph. `key` coalesces a run of edits to the same
  // field (typing in one note) into a single undo step; pass nothing for
  // discrete actions so they always get their own step.
  const pushHistory = useCallback(
    (key = null) => {
      if (key && coalesceKey.current === key) return;
      past.current.push(serialize(liveRef.current));
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      future.current = [];
      coalesceKey.current = key;
      syncHistoryFlags();
    },
    [syncHistoryFlags]
  );

  const restore = useCallback(
    (snapshot) => {
      setNodes(hydrate(snapshot.nodes));
      setEdges(snapshot.edges.map(styleEdge));
      setAddingChildId(null);
      coalesceKey.current = null;
    },
    [hydrate, setNodes, setEdges]
  );

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    future.current.push(serialize(liveRef.current));
    restore(past.current.pop());
    syncHistoryFlags();
  }, [restore, syncHistoryFlags]);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    past.current.push(serialize(liveRef.current));
    restore(future.current.pop());
    syncHistoryFlags();
  }, [restore, syncHistoryFlags]);

  handlersRef.current = {
    onNotesChange(id, text) {
      pushHistory(`notes:${id}`);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, notes: text, aiFilled: false } } : n
        )
      );
    },
    onLabelChange(id, text) {
      // Coalesced like notes: the expanded view binds straight to this on every
      // keystroke, so without a key each character would be its own undo step.
      pushHistory(`label:${id}`);
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: text } } : n))
      );
    },
    onFieldChange(id, patch) {
      // Typing a date coalesces like notes; toggles are discrete steps.
      pushHistory('date' in patch ? `date:${id}` : null);
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
      );
    },
    async onAddImages(id, { accepted, rejected }) {
      if (rejected.length > 0) setSaveError(rejected.join(' '));
      if (accepted.length === 0) return;

      // A counter rather than a boolean: dropping four files at once should show
      // four placeholders and clear them one at a time.
      const bump = (delta) =>
        setNodes((prev) =>
          prev.map((n) =>
            n.id === id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    uploadingImages: Math.max(0, (n.data.uploadingImages ?? 0) + delta),
                  },
                }
              : n
          )
        );

      bump(accepted.length);
      for (const file of accepted) {
        try {
          const image = await uploadImage(canvasId, file);
          // One history entry per image, so an accidental paste is one undo away.
          pushHistory(null);
          setNodes((prev) =>
            prev.map((n) =>
              n.id === id
                ? { ...n, data: { ...n.data, images: [...(n.data.images ?? []), image] } }
                : n
            )
          );
        } catch (problem) {
          setSaveError(problem.message);
        } finally {
          bump(-1);
        }
      }
    },
    onCaptionChange(id, imageId, text) {
      // Coalesced per image, like notes and titles: typing a caption should be one
      // undo step, not one per character.
      pushHistory(`caption:${imageId}`);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  images: (n.data.images ?? []).map((image) =>
                    image.id === imageId ? { ...image, caption: text } : image
                  ),
                },
              }
            : n
        )
      );
    },
    async onRemoveImage(id, imageId) {
      pushHistory(null);
      // Removed from the block first: the picture disappearing immediately is
      // what the click asked for, and a failed delete only leaves an unreferenced
      // file on the server rather than a broken block.
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id
            ? {
                ...n,
                data: { ...n.data, images: (n.data.images ?? []).filter((i) => i.id !== imageId) },
              }
            : n
        )
      );
      await deleteImage(imageId).catch(() => {});
    },
    onStartAddChild(id) {
      setAddingChildId((prev) => (prev === id ? null : id));
    },
    onCancelChild() {
      setAddingChildId(null);
    },
    onSubmitChild(parentId, label) {
      const parent = liveRef.current.nodes.find((n) => n.id === parentId);
      if (!parent) return;
      pushHistory();

      const siblings = liveRef.current.nodes.filter((n) => n.data.parentId === parentId);
      const newX = siblings.length
        ? Math.max(...siblings.map((s) => s.position.x)) + CHILD_SPACING
        : parent.position.x;
      const newId = crypto.randomUUID();

      setNodes((prev) => [
        ...prev,
        makeNode({ id: newId, x: newX, y: parent.position.y + LEVEL_HEIGHT, label, parentId }),
      ]);
      setEdges((prev) => [...prev, makeEdge(parentId, newId)]);
      setAddingChildId(null);
    },
    onExpand(id) {
      setExpandedId(id);
    },
    onToggleCollapse(id) {
      pushHistory();
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } } : n
        )
      );
    },
    onOpenSuggestion(id) {
      // One open at a time: two expanded ghosts on one canvas is two arguments
      // being made at once.
      setOpenSuggestionId((current) => (current === id ? null : id));
    },
    onAcceptSuggestion(gap) {
      handleAcceptSuggestion(gap);
    },
    onDismissSuggestion(id) {
      handleDismissSuggestion(id);
    },
    onDelete(id) {
      pushHistory();
      const removeIds = new Set([id, ...descendantIds(liveRef.current.nodes, id)]);
      setNodes((prev) => prev.filter((n) => !removeIds.has(n.id)));
      setEdges((prev) =>
        prev.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target))
      );
    },
  };

  // Re-frame once React has committed a newly added block — calling fitView
  // inline would still be looking at the previous node set.
  const blockCount = useRef(nodes.length);
  useEffect(() => {
    const grew = nodes.length > blockCount.current;
    blockCount.current = nodes.length;
    if (grew) refit();
  }, [nodes.length, refit]);

  // Reflect which node currently has its inline add-subtopic input open.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const shouldBeAdding = n.id === addingChildId;
        return n.data.isAddingChild === shouldBeAdding
          ? n
          : { ...n, data: { ...n.data, isAddingChild: shouldBeAdding } };
      })
    );
  }, [addingChildId, setNodes]);

  // Persist graph edits to the server, debounced: a request per keystroke would
  // be both slow and rude to the server, and the whole graph goes in each PUT.
  const saveTimer = useRef(null);
  // Whether this page has changes the server hasn't been told about yet.
  //
  // Without this, leaving or reloading a canvas writes whatever the page happens
  // to be holding — even when nothing was touched. On a canvas shared with someone
  // else that is destructive: a tab left open on an old version silently overwrites
  // the other person's edits the moment it closes. A save must be caused by an
  // edit, not by a page ending.
  const dirty = useRef(false);
  const seenFirstRender = useRef(false);

  const flushSave = useCallback(
    (options) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (!canEdit || !dirty.current) return;
      dirty.current = false;
      return saveCanvas(canvasId, serialize(liveRef.current), options)
        .then(() => setSaveError(null))
        .catch((problem) => {
          // Still unsaved, so the next flush must try again.
          dirty.current = true;
          // Silence here would be the worst outcome: the user keeps typing into a
          // canvas that is no longer being saved anywhere.
          setSaveError(
            problem instanceof ApiError && problem.status === 401
              ? 'You have been signed out — open the app again to keep your changes.'
              : problem.message
          );
        });
    },
    [canvasId, canEdit]
  );

  useEffect(() => {
    if (!canEdit) return;
    // The first run is the graph arriving from the server, which is by definition
    // already saved.
    if (!seenFirstRender.current) {
      seenFirstRender.current = true;
      return;
    }
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [nodes, edges, canEdit, flushSave]);

  // A debounce must never lose the tail of someone's typing, so force a write
  // whenever the canvas is about to stop being watched: leaving for Home
  // (unmount), hiding the tab, or closing it.
  useEffect(() => {
    // `keepalive` lets the request outlive the page: an ordinary fetch started
    // during pagehide is cancelled when the document goes away, which would lose
    // the last few seconds of typing.
    const flush = () => flushSave({ keepalive: true });
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flushSave({ keepalive: true });
    };
  }, [flushSave]);

  useEffect(() => {
    if (!canEdit) return;
    if (title === record.title) return;
    saveCanvas(canvasId, { title }).catch(() => {});
  }, [title, canvasId, canEdit, record.title]);

  useEffect(() => {
    let cancelled = false;
    fetchReviews(canvasId)
      .then((found) => {
        if (!cancelled) setReviews(found);
      })
      // A missing schedule is not worth an error: it just means nothing is
      // scheduled yet, and every card reads as due.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canvasId]);

  // Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo — but leave text fields alone so
  // the browser's own text undo keeps working while typing.
  useEffect(() => {
    function onKeyDown(e) {
      const key = e.key.toLowerCase();
      if (key !== 'z' || !(e.metaKey || e.ctrlKey)) return;

      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // The only place a block is built. `stable` last and NEW_BLOCK_FIELDS nowhere
  // else, so a new creation path cannot forget the dispatchers — a block without
  // them renders normally and then ignores every control on it, which is a
  // miserable thing to debug and has happened once already.
  const makeNode = useCallback(
    ({ id, x, y, label, parentId, extra = {} }) => ({
      id,
      type: 'knowledge',
      position: { x, y },
      data: {
        ...NEW_BLOCK_FIELDS,
        label,
        parentId,
        isRoot: parentId === null,
        ...extra,
        ...stable,
      },
    }),
    [stable]
  );

  function nextRootX() {
    const roots = liveRef.current.nodes.filter((n) => n.data.parentId === null);
    return roots.length ? Math.max(...roots.map((r) => r.position.x)) + ROOT_SPACING : 60;
  }

  // Enter in the search bar, and the starter chips, create an empty block and
  // nothing else. Deliberately no model call: the block is a blank page for the
  // user's own account of the topic. "Fill my knowledge" is what reviews that
  // account afterwards and adds the sub-topics they missed. Generating anything
  // here would be answering a question the user came to answer themselves.
  function addRootBlock(rawLabel) {
    const label = rawLabel.trim();
    if (!label) return;
    pushHistory();

    setNodes((prev) => [
      ...prev,
      makeNode({ id: crypto.randomUUID(), x: nextRootX(), y: 90, label, parentId: null }),
    ]);
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    if (!searchValue.trim()) return;
    addRootBlock(searchValue);
    setSearchValue('');
  }

  // "Make a graph": build a whole multi-level graph for one topic in a single
  // action — root with a summary, branches with their own summaries, and a
  // layer of leaves under each. One pushHistory() up front means the whole
  // thing collapses to a single undo step.
  async function handleMakeGraph(levelKey) {
    const topic = searchValue.trim();
    if (!topic || graphProgress) return;

    const plan = graphPlan(levelKey);
    setLevelMenuOpen(false);
    setSearchValue('');
    pushHistory();
    setGraphProgress({ done: 0, total: 1 });

    const rootId = crypto.randomUUID();
    const rootX = nextRootX();
    setNodes((prev) => [
      ...prev,
      makeNode({
        id: rootId,
        x: rootX,
        y: 90,
        label: topic,
        parentId: null,
        extra: { loading: true },
      }),
    ]);

    function failRoot(message) {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === rootId ? { ...n, data: { ...n.data, loading: false, aiCorrection: message } } : n
        )
      );
      setGraphProgress(null);
    }

    let root;
    try {
      root = await expandTopic({ topic, level: plan.key, maxSubtopics: plan.maxBranches });
    } catch (error) {
      failRoot(`Couldn’t build the graph: ${error.message}`);
      return;
    }

    // The model was asked for at most this many and told not to pad, so a thin
    // topic legitimately yields fewer. The slice is a backstop, not the policy.
    const branches = root.subtopics.slice(0, plan.maxBranches);
    setGraphProgress({ done: 1, total: 1 + branches.length });

    // Land the root's own content, then the branch shells so the user watches
    // the graph appear rather than staring at a spinner.
    const branchIds = branches.map(() => crypto.randomUUID());
    setNodes((prev) => [
      ...prev.map((n) =>
        n.id === rootId
          ? {
              ...n,
              data: {
                ...n.data,
                loading: false,
                notes: root.summary,
                aiFilled: Boolean(root.summary),
              },
            }
          : n
      ),
      // The branch's own detail line shows immediately, so the block says
      // something while its fuller summary is still being fetched.
      ...branches.map((branch, i) =>
        makeNode({
          id: branchIds[i],
          x: rootX + i * CHILD_SPACING,
          y: 90 + LEVEL_HEIGHT,
          label: branch.label,
          parentId: rootId,
          extra: { loading: true, notes: branch.detail, aiFilled: Boolean(branch.detail) },
        })
      ),
    ]);
    setEdges((prev) => [...prev, ...branchIds.map((id) => makeEdge(rootId, id))]);

    if (branches.length === 0) {
      setGraphProgress(null);
      refit();
      return;
    }

    // Expand each branch concurrently, patching the canvas as each lands.
    await Promise.all(
      branches.map(async (branch, i) => {
        const branchId = branchIds[i];
        let result;
        try {
          // The branch label alone is ambiguous: "Geography" under a graph about
          // Ethiopia must not come back as a definition of geography. The root
          // subject travels with the request, and governs the leaf details too,
          // since those come from this same response.
          result = await expandTopic({
            topic: branch.label,
            level: plan.key,
            context: [topic],
            maxSubtopics: plan.maxLeaves,
          });
        } catch {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === branchId ? { ...n, data: { ...n.data, loading: false } } : n
            )
          );
          setGraphProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          return;
        }

        // The third level comes from the branch's own response, which returns a
        // one-line detail alongside each sub-topic label. That is what lets the
        // leaves arrive with something in them without costing a request each.
        const leaves = result.subtopics.slice(0, plan.maxLeaves);
        const leafIds = leaves.map(() => crypto.randomUUID());

        setNodes((prev) => [
          ...prev.map((n) =>
            n.id === branchId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    loading: false,
                    // Keep the detail line if the fuller summary came back empty.
                    notes: result.summary || n.data.notes,
                    aiFilled: Boolean(result.summary || n.data.notes),
                  },
                }
              : n
          ),
          ...leaves.map((leaf, j) =>
            makeNode({
              id: leafIds[j],
              x: rootX + i * CHILD_SPACING + j * 40,
              y: 90 + LEVEL_HEIGHT * 2,
              label: leaf.label,
              parentId: branchId,
              extra: { notes: leaf.detail, aiFilled: Boolean(leaf.detail) },
            })
          ),
        ]);
        setEdges((prev) => [...prev, ...leafIds.map((id) => makeEdge(branchId, id))]);
        setGraphProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      })
    );

    // Leaves were dropped in roughly; tidy the whole forest once at the end.
    setNodes((prev) => autoLayout(prev));
    setGraphProgress(null);
    refit();
  }

  // Attach suggested subtopics as dashed "AI suggested" children of `parentId`,
  // skipping labels already on that branch.
  // "Find my gaps": one request for the whole canvas, answered with a list of holes
  // rather than with written notes. What happens to each hole is the user's choice —
  // see GapPanel for why the buttons are in the order they are.
  async function handleFindGaps() {
    setGapsOpen(true);
    setGapError(null);
    setGapsBusy(true);
    // Gap ids are built from the kind, position and title, so a rescan that finds
    // the same hole produces the same id. Without this, the second scan's
    // suggestions would be treated as ones already shown and never framed.
    framedGhostIds.current = new Set();
    try {
      const { gaps, scannedAt } = await findGaps({
        title,
        canvasId,
        nodes: liveRef.current.nodes.map((n) => ({ id: n.id, data: n.data })),
      });
      setGaps(gaps);
      setGapsScannedAt(scannedAt);
      // A fresh scan invalidates what was applied from the last one: the ids are
      // per-scan, and a gap you filled may legitimately come back if it is still
      // thin.
      setFilledGapIds(new Set());
      setDismissedGapIds(new Set());
      setOpenSuggestionId(null);
    } catch (error) {
      setGapError(error.message);
      if (error.code === 'NO_API_KEY') fetchAiStatus({ force: true }).then(setAiStatus);
    } finally {
      setGapsBusy(false);
    }
  }

  // Applying a gap appends points; it never rewrites what is there. For a
  // correction that is the whole point — the model is sometimes wrong about being
  // right, and deleting somebody's sentence on that basis is not this app's call.
  function handleFillGap(gap) {
    if (gap.fill.length === 0) return;

    if (gap.blockId) {
      pushHistory();
      setNodes((prev) =>
        prev.map((n) =>
          n.id === gap.blockId
            ? {
                ...n,
                data: {
                  ...n.data,
                  notes: appendPoints(n.data.notes, gap.fill),
                  aiFilled: true,
                },
              }
            : n
        )
      );
      setFilledGapIds((prev) => new Set(prev).add(gap.id));
      return;
    }

    // A gap belonging to no block is a subject the canvas never covers, so it
    // becomes a block of its own. Same code path as accepting its ghost — one
    // undo step, and filling from the panel cannot disagree with accepting on
    // the canvas about where the block lands or what it is wired to.
    handleAcceptSuggestion(gap);
  }

  // Accepting a suggestion: the ghost becomes a real block, at the place it was
  // already drawn, threaded into the chain it was drawn across.
  //
  // The re-parenting is the part worth being careful about. It only happens when
  // the two blocks the model named really are parent and child — then the new
  // block goes between them and the chain reads through it, which is the whole
  // promise of drawing it there. Any other pairing and it is added beside the
  // structure rather than rearranging one the user built.
  function handleAcceptSuggestion(gap) {
    const plan = planInsertion(gap, liveRef.current.nodes);
    const id = crypto.randomUUID();
    // Where the ghost is standing, so the block appears exactly where the
    // suggestion was. A gap with no ghost — dismissed, or one of the kinds that
    // never gets drawn — falls back to a column of its own on the right.
    const ghost = suggestions.nodes.find((n) => n.id === suggestionId(gap.id));
    const position = ghost?.position ?? besideTheRoots();
    pushHistory();

    setNodes((prev) => [
      ...prev.map((n) =>
        n.id === plan.reparent ? { ...n, data: { ...n.data, parentId: id, isRoot: false } } : n
      ),
      // Through makeNode, which is the only thing that attaches the shared
      // dispatchers. Built by hand, the block arrived with no onDelete, no
      // onNotesChange and no onExpand — every control on it dead until a reload
      // rehydrated it from the server.
      makeNode({
        id,
        x: position.x,
        y: position.y,
        label: gap.title,
        parentId: plan.parentId,
        extra: { notes: appendPoints('', gap.fill), aiFilled: true },
      }),
    ]);

    setEdges((prev) => {
      const kept = plan.unlink
        ? prev.filter(
            (e) => !(e.source === plan.unlink.source && e.target === plan.unlink.target)
          )
        : prev;
      const added = [];
      if (plan.parentId) added.push(makeEdge(plan.parentId, id));
      if (plan.reparent) added.push(makeEdge(id, plan.reparent));
      if (plan.relateTo) {
        added.push(
          styleEdge({
            id: `r-${id}-${plan.relateTo}`,
            source: id,
            target: plan.relateTo,
            label: 'leads to',
            data: { manual: true },
          })
        );
      }
      return [...kept, ...added];
    });

    setOpenSuggestionId(null);
    // Marked filled rather than dismissed: the panel should say "Added ✓" for
    // this gap, not quietly forget it existed.
    setFilledGapIds((prev) => new Set(prev).add(gap.id));
  }

  function besideTheRoots() {
    const roots = liveRef.current.nodes.filter((n) => n.data.parentId === null);
    if (roots.length === 0) return { x: 0, y: 0 };
    return { x: Math.max(...roots.map((n) => n.position.x)) + CHILD_SPACING, y: roots[0].position.y };
  }

  function handleDismissSuggestion(gapId) {
    setOpenSuggestionId((current) => (current === gapId ? null : current));
    setDismissedGapIds((prev) => new Set(prev).add(gapId));
  }

  // Arriving from a link that named a block — the weakest-blocks list on the home
  // screen — should land on that block, not merely on the canvas containing it.
  // Once, on the way in: re-running it would fight the person for control of the
  // viewport every time anything on the page changed.
  const landedRef = useRef(false);
  useEffect(() => {
    if (!focusBlockId || landedRef.current || !flowRef.current) return;
    if (!nodes.some((n) => n.id === focusBlockId)) return;
    landedRef.current = true;
    // A beat, so React Flow has finished its own fitView on mount before this
    // overrides it — otherwise the two animations race and it lands nowhere.
    const timer = setTimeout(() => handleJumpToBlock(focusBlockId), 260);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBlockId, nodes]);

  // Clicking the block name on a gap card brings it into view, which matters once
  // the canvas is bigger than the screen. Suggestions count: a missing gap's card
  // points at its ghost, which is somewhere out on the canvas by definition.
  function handleJumpToBlock(blockId) {
    const node =
      liveRef.current.nodes.find((n) => n.id === blockId) ??
      suggestions.nodes.find((n) => n.id === blockId);
    if (!node || !flowRef.current) return;
    flowRef.current.setCenter(node.position.x + 160, node.position.y + 120, {
      zoom: 1,
      duration: 400,
    });
  }

  const labelOf = useCallback(
    (id) => liveRef.current.nodes.find((n) => n.id === id)?.data.label ?? 'Block',
    []
  );

  function handleConnect(params) {
    const { source, target } = params;
    if (!source || !target || source === target) return;

    const duplicate = liveRef.current.edges.some(
      (e) =>
        e.data?.manual &&
        ((e.source === source && e.target === target) ||
          (e.source === target && e.target === source))
    );
    if (duplicate) return;

    setPendingRelation({ source, target });
  }

  function saveRelation(relationLabel) {
    const { source, target } = pendingRelation;
    pushHistory();
    setEdges((prev) => [
      ...prev,
      styleEdge({
        id: `r-${source}-${target}-${crypto.randomUUID().slice(0, 8)}`,
        source,
        target,
        label: relationLabel,
        data: { manual: true },
      }),
    ]);
    setPendingRelation(null);
  }

  function updateRelation(relationLabel) {
    pushHistory();
    setEdges((prev) =>
      prev.map((e) => (e.id === editingRelation.id ? styleEdge({ ...e, label: relationLabel }) : e))
    );
    setEditingRelation(null);
  }

  function removeRelation() {
    pushHistory();
    setEdges((prev) => prev.filter((e) => e.id !== editingRelation.id));
    setEditingRelation(null);
  }

  function handleAutoLayout() {
    if (nodes.length === 0) return;
    pushHistory();
    setNodes((prev) => autoLayout(prev));
    refit();
  }

  // Called with every card's grade when a session ends. Returns the new schedule
  // so the summary can say when things come back.
  async function handleStudyFinish(grades) {
    const correct = grades.reduce((sum, g) => sum + g.recalled, 0);
    const total = grades.reduce((sum, g) => sum + g.total, 0);
    // The score is canvas data and needs edit rights; the schedule is personal and
    // does not — studying a read-only canvas still builds your own schedule.
    if (canEdit) {
      saveCanvas(canvasId, { lastScore: { correct, total, at: Date.now() } }).catch(() => {});
    }
    try {
      const result = await submitReviews(
        canvasId,
        grades.map((g) => ({ blockId: g.id, recalled: g.recalled, total: g.total }))
      );
      setReviews(result.reviews ?? {});
      return result.updated ?? [];
    } catch {
      return null;
    }
  }

  return (
    <div ref={wrapperRef} className="relative h-screen w-screen overflow-hidden bg-canvas">
      {(saveError || !canEdit) && (
        <div className="absolute inset-x-0 top-[57px] z-20 px-4 py-2">
          <p
            className={`mx-auto max-w-2xl rounded-xl px-3 py-2 text-center text-[12.5px] ${
              saveError
                ? 'border border-danger/30 bg-danger-bg text-danger'
                : 'border border-line2 bg-sunken text-subink'
            }`}
          >
            {saveError ?? 'View only — this canvas was shared with you to read, not to edit.'}
          </p>
        </div>
      )}

      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-4 py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={onExit}
          title="Back to home"
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-[13px] text-subink hover:bg-hover hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3.5L5.5 8l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Home
        </button>

        {editingTitle ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (!title.trim()) setTitle('Untitled canvas');
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
            className="w-[180px] shrink-0 rounded-lg border border-accent/40 bg-panel px-2 py-1 text-[14px] font-semibold text-ink focus:outline-none"
          />
        ) : isOwner ? (
          <button
            type="button"
            onClick={() => setEditingTitle(true)}
            title="Rename canvas"
            className="max-w-[180px] shrink-0 truncate rounded-lg px-2 py-1 text-left text-[14px] font-semibold text-ink hover:bg-hover"
          >
            {title}
          </button>
        ) : (
          <span
            title={`Shared by ${record.ownerEmail}`}
            className="max-w-[180px] shrink-0 truncate px-2 py-1 text-[14px] font-semibold text-ink"
          >
            {title}
          </span>
        )}

        <form
          onSubmit={handleSearchSubmit}
          className="mx-auto flex w-full max-w-md items-center gap-2 rounded-full border border-line bg-sunken py-1 pl-3.5 pr-1 focus-within:border-accent/30 focus-within:bg-surface"
        >
          <svg className="h-4 w-4 shrink-0 text-subink" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Explore a topic…"
            title="Enter adds one empty block for you to fill in. “Make a graph” generates a whole tree instead."
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-subink/70 focus:outline-none"
          />
          <div className="relative shrink-0">
            <motion.button
              ref={levelButtonRef}
              type="button"
              onClick={() => setLevelMenuOpen((v) => !v)}
              disabled={!searchValue.trim() || !aiReady || Boolean(graphProgress)}
              aria-haspopup="menu"
              aria-expanded={levelMenuOpen}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              title={
                aiReady
                  ? 'Generate a full multi-level graph — choose how deep'
                  : 'Needs an OpenAI API key — see .env.example'
              }
              className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_1px_4px_rgba(0,113,227,0.3)] transition-opacity disabled:cursor-not-allowed disabled:bg-subink/25 disabled:shadow-none"
            >
              {graphProgress ? (
                `Building ${graphProgress.done}/${graphProgress.total}…`
              ) : (
                <>
                  ✦ Make a graph
                  <motion.svg
                    width="9"
                    height="9"
                    viewBox="0 0 10 10"
                    fill="none"
                    animate={{ rotate: levelMenuOpen ? 180 : 0 }}
                    transition={{ duration: 0.16 }}
                  >
                    <path
                      d="M2 3.5L5 6.5l3-3"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </motion.svg>
                </>
              )}
            </motion.button>

            <GraphLevelMenu
              open={levelMenuOpen && !graphProgress}
              onChoose={handleMakeGraph}
              onClose={() => setLevelMenuOpen(false)}
              anchorRef={levelButtonRef}
            />
          </div>
        </form>

        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-sunken p-0.5">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="flex h-7 w-7 items-center justify-center rounded-full text-subink hover:bg-panel hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8h7a3 3 0 010 6H7M3 8l3-3M3 8l3 3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            className="flex h-7 w-7 items-center justify-center rounded-full text-subink hover:bg-panel hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M13 8H6a3 3 0 000 6h3M13 8l-3-3M13 8l-3 3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={handleAutoLayout}
          disabled={nodes.length === 0}
          title="Tidy up the layout"
          className="shrink-0 rounded-full border border-line2 px-3 py-2 text-[13px] text-subink hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          Tidy
        </button>

        <button
          type="button"
          onClick={() => setStudying(true)}
          disabled={nodes.length === 0}
          title={dueNow > 0 ? `${dueNow} cards due for review` : 'Study this canvas'}
          className="shrink-0 rounded-full border border-line2 px-3 py-2 text-[13px] text-subink hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          Study
          {/* The count is the nudge. Without it the schedule exists but nothing
              ever tells you to act on it. */}
          {dueNow > 0 && (
            <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[11px] font-medium tabular-nums text-white">
              {dueNow}
            </span>
          )}
        </button>

        <ThemeToggle />

        {isOwner && (
          <button
            type="button"
            onClick={() => setShowShare(true)}
            className="shrink-0 rounded-full border border-line2 px-3 py-2 text-[13px] text-subink hover:bg-hover hover:text-ink"
          >
            Share
          </button>
        )}

        <button
          type="button"
          onClick={handleFindGaps}
          disabled={gapsBusy || nodes.length === 0}
          title={describeAiStatus(aiStatus)}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {gapsBusy ? 'Reading…' : '🔍 Find my gaps'}
          {!aiReady && <span className="ml-1.5 opacity-70">(no key)</span>}
        </button>
      </div>

      {/* The bridge between the two halves of the app. It appears only once
          something has actually been studied — before that it would be a row of
          zeroes explaining a feature you have not used. Each count is a button:
          seeing that four blocks are weak and then having to go and reconstruct
          which four in the study setup is the exact seam this is meant to close. */}
      {(progress.coverage || studiedCount > 0) && (
        <div
          className={`absolute left-4 z-10 flex items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-1 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.18)] backdrop-blur-xl ${
            saveError || !canEdit ? 'top-[104px]' : 'top-[69px]'
          }`}
        >
          {/* The two headline numbers, then the breakdown you can act on. They
              answer different questions — how much is written down, and how much
              of it you can actually produce — and averaging them into one bar
              would tell somebody who has written everything and studied nothing
              the same thing as somebody in the opposite position. */}
          {progress.coverage && (
            <span
              title={describeCoverage(progress.coverage, { scanned: progress.scanned })}
              className="whitespace-nowrap px-2 py-1 text-[12px]"
            >
              {/* Dimmed until a scan, for the same reason as in the library: with
                  no scan it can only see the blocks you left empty. */}
              <span
                className={`font-semibold tabular-nums ${
                  progress.scanned ? 'text-ink' : 'text-subink'
                }`}
              >
                {formatPct(progress.coverage)}
              </span>{' '}
              <span className={progress.scanned ? 'text-subink' : 'text-subink/70'}>coverage</span>
            </span>
          )}
          {progress.mastery && (
            <span
              title={describeMasteryScore(progress.mastery)}
              className="whitespace-nowrap px-2 py-1 text-[12px]"
            >
              <span className="font-semibold tabular-nums text-ink">
                {formatPct(progress.mastery)}
              </span>{' '}
              <span className="text-subink">mastery</span>
            </span>
          )}

          {studiedCount > 0 && <span className="mx-0.5 h-4 w-px bg-line2" />}

          {MASTERY_ORDER.filter((key) => mastery[key] > 0).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setStudying({
                  label: MASTERY[key].label.toLowerCase(),
                  ids: idsAtLevel(nodes, reviews, key),
                })
              }
              title={`Study the ${mastery[key]} ${MASTERY[key].label.toLowerCase()} ${
                mastery[key] === 1 ? 'block' : 'blocks'
              } — ${MASTERY[key].detail}`}
              className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] transition-colors hover:bg-hover"
            >
              <span className={`h-2 w-2 rounded-full ${MASTERY[key].bar}`} />
              <span className="font-medium tabular-nums text-ink">{mastery[key]}</span>
              <span className="text-subink">{MASTERY[key].label.toLowerCase()}</span>
            </button>
          ))}
        </div>
      )}

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-6">
          <p className="text-[15px] text-subink">Search a topic above to start your canvas</p>
          <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-subink/70">
            or try one of these
          </p>
          <div className="pointer-events-auto mt-2.5 flex max-w-lg flex-wrap justify-center gap-2">
            {STARTER_TOPICS.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => addRootBlock(topic)}
                className="rounded-full border border-line2 bg-surface px-3 py-1.5 text-[12.5px] text-subink transition-colors hover:border-accent/30 hover:bg-panel hover:text-ink"
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
      )}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onEdgeClick={(_, edge) => {
          if (edge.data?.manual) setEditingRelation(edge);
        }}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.5}
        defaultEdgeOptions={{ type: 'smoothstep', style: EDGE_STYLE }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color={dotColor} />
        <Controls
          showInteractive={false}
          className="rounded-xl! border! border-line! bg-surface! shadow-lg! backdrop-blur-xl!"
        />
        {nodes.length > 2 && (
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={0}
            nodeBorderRadius={3}
            nodeColor={(n) => categoryColor(n.data?.category)}
            maskColor={maskColor}
            className="rounded-xl! border! border-line! bg-surface! shadow-lg!"
          />
        )}
      </ReactFlow>

      <AnimatePresence>
        {gapsOpen && (
          <GapPanel
            gaps={gaps}
            busy={gapsBusy}
            error={gapError}
            filledIds={filledGapIds}
            dismissedIds={dismissedGapIds}
            scannedAt={gapsScannedAt}
            onFill={handleFillGap}
            onJump={handleJumpToBlock}
            onRescan={handleFindGaps}
            onClose={() => setGapsOpen(false)}
          />
        )}
      </AnimatePresence>

      {showShare && (
        <ShareDialog
          canvas={shared}
          currentUser={user}
          onClose={() => setShowShare(false)}
          onChanged={setShared}
        />
      )}

      {pendingRelation && (
        <RelationDialog
          sourceLabel={labelOf(pendingRelation.source)}
          targetLabel={labelOf(pendingRelation.target)}
          onSave={saveRelation}
          onCancel={() => setPendingRelation(null)}
        />
      )}

      {editingRelation && (
        <RelationDialog
          sourceLabel={labelOf(editingRelation.source)}
          targetLabel={labelOf(editingRelation.target)}
          initialLabel={editingRelation.label}
          onSave={updateRelation}
          onDelete={removeRelation}
          onCancel={() => setEditingRelation(null)}
        />
      )}

      {expandedNode && (
        <BlockDetail
          node={expandedNode}
          onClose={() => setExpandedId(null)}
          onNotesChange={stable.onNotesChange}
          onLabelChange={stable.onLabelChange}
          onFieldChange={stable.onFieldChange}
          onAddImages={canEdit ? stable.onAddImages : undefined}
          onRemoveImage={canEdit ? stable.onRemoveImage : undefined}
          onCaptionChange={canEdit ? stable.onCaptionChange : undefined}
        />
      )}

      {studying && (
        <StudyMode
          nodes={nodes}
          canvasTitle={title}
          reviews={reviews}
          // Set only when a mastery count was clicked: the question "what am I
          // studying" is already answered, so that session skips the setup screen.
          focus={studying === true ? null : studying}
          onExit={() => setStudying(false)}
          onFinish={handleStudyFinish}
        />
      )}
    </div>
  );
}


// Loads the canvas, then hands it to the editor. Splitting these apart keeps the
// editor's state initialisation synchronous — it can read record.nodes directly
// instead of every piece of state needing a "not loaded yet" case.
export default function Canvas({ user, canvasId, focusBlockId = null, onExit, onMissing }) {
  const [record, setRecord] = useState(null);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setProblem(null);
    fetchCanvas(canvasId)
      .then((canvas) => {
        if (!cancelled) setRecord(canvas);
      })
      .catch((error) => {
        if (cancelled) return;
        // A canvas that has been deleted or un-shared answers 404. That is not an
        // error worth a screen — just go back to the library.
        if (error instanceof ApiError && error.status === 404) onMissing?.();
        else setProblem(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [canvasId, onMissing]);

  if (problem) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
        <p className="text-[14px] text-ink">Couldn’t open this canvas.</p>
        <p className="max-w-sm text-[13px] leading-snug text-subink">{problem}</p>
        <button
          type="button"
          onClick={onExit}
          className="mt-2 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white"
        >
          Back to home
        </button>
      </div>
    );
  }

  if (!record) return <div className="min-h-screen bg-canvas" />;

  // Keyed on the id so switching canvases remounts rather than trying to
  // reconcile one graph's state onto another's.
  return (
    <CanvasEditor
      key={record.id}
      user={user}
      record={record}
      focusBlockId={focusBlockId}
      onExit={onExit}
    />
  );
}
