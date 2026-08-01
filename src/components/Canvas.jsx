import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import ReactFlow, { Background, BackgroundVariant, Controls, MiniMap } from 'reactflow';
import { useNodesState, useEdgesState } from 'reactflow';
import KnowledgeBlock from './KnowledgeBlock';
import ShareDialog from './ShareDialog';
import RelationDialog from './RelationDialog';
import GraphLevelMenu from './GraphLevelMenu';
import BlockDetail from './BlockDetail';
import StudyMode from './StudyMode';
import { expandTopic, fillKnowledge, isAiConfigured } from '../lib/aiFill';
import { ApiError, fetchCanvas, saveCanvas } from '../lib/api';
import { categoryColor } from '../lib/categories';
import { autoLayout } from '../lib/layout';
import { descendantIds, withVisibility } from '../lib/graph';
import { graphPlan } from '../lib/graphLevels';
import { STARTER_TOPICS } from '../lib/templates';
import { useTheme } from '../lib/theme';
import ThemeToggle from './ThemeToggle';

const nodeTypes = { knowledge: KnowledgeBlock };

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

// Strip React callbacks and transient UI flags so a graph can be stored in
// localStorage or pushed onto the undo stack.
function serialize({ nodes, edges }) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        label: n.data.label,
        notes: n.data.notes,
        date: n.data.date ?? '',
        category: n.data.category ?? 'none',
        unsure: Boolean(n.data.unsure),
        parentId: n.data.parentId,
        isRoot: n.data.isRoot,
        aiFilled: n.data.aiFilled,
        aiCorrection: n.data.aiCorrection,
        aiSuggested: n.data.aiSuggested,
        collapsed: Boolean(n.data.collapsed),
      },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label ?? undefined,
      data: e.data ?? undefined,
    })),
  };
}

// The editor proper. It is handed an already-loaded canvas so all of its state can
// still be initialised synchronously — the loading lives in the wrapper below.
function CanvasEditor({ user, record, onExit }) {
  const canvasId = record.id;
  const isOwner = record.role === 'owner';
  // A 'view' grant can study a canvas but not change it, so nothing is persisted.
  const canEdit = record.role === 'owner' || record.role === 'edit';
  const [saveError, setSaveError] = useState(null);

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
    onDelete: (id) => handlersRef.current.onDelete(id),
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
  const [isFilling, setIsFilling] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // The dialog edits the grant list, and hands back the canvas the server
  // returned, so the list on screen is always what the server actually stored.
  const [shared, setShared] = useState(record);
  const [pendingRelation, setPendingRelation] = useState(null);
  const [editingRelation, setEditingRelation] = useState(null);
  const [studying, setStudying] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [graphProgress, setGraphProgress] = useState(null);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const levelButtonRef = useRef(null);
  const theme = useTheme();
  // These two React Flow props are passed to canvas/SVG attributes that
  // don't resolve CSS variables, so pick literals per theme.
  const dotColor = theme === 'dark' ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.12)';
  const maskColor = theme === 'dark' ? 'rgba(23,23,26,0.72)' : 'rgba(245,245,247,0.7)';

  useEffect(() => {
    let active = true;
    isAiConfigured().then((ready) => {
      if (active) setAiReady(ready);
    });
    return () => {
      active = false;
    };
  }, []);

  // What React Flow actually renders: collapsed subtrees marked hidden, plus
  // per-node child/hidden counts for the collapse control.
  const visible = useMemo(() => withVisibility(nodes, edges), [nodes, edges]);

  const expandedNode = expandedId ? (nodes.find((n) => n.id === expandedId) ?? null) : null;

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
        {
          id: newId,
          type: 'knowledge',
          position: { x: newX, y: parent.position.y + LEVEL_HEIGHT },
          data: {
            ...NEW_BLOCK_FIELDS,
            label,
            parentId,
            isRoot: false,
            ...stable,
          },
        },
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
  function appendSuggestions(parentId, subtopics) {
    if (subtopics.length === 0) return;
    const parent = liveRef.current.nodes.find((n) => n.id === parentId);
    if (!parent) return;

    const siblings = liveRef.current.nodes.filter((n) => n.data.parentId === parentId);
    const taken = new Set(siblings.map((s) => s.data.label.toLowerCase()));
    const fresh = subtopics.filter((s) => !taken.has(s.label.toLowerCase()));
    if (fresh.length === 0) return;

    let nextX = siblings.length
      ? Math.max(...siblings.map((s) => s.position.x)) + CHILD_SPACING
      : parent.position.x;

    const created = fresh.map(({ label, detail }) => {
      const node = {
        id: crypto.randomUUID(),
        type: 'knowledge',
        position: { x: nextX, y: parent.position.y + LEVEL_HEIGHT },
        data: {
          ...NEW_BLOCK_FIELDS,
          label,
          notes: detail,
          aiFilled: Boolean(detail),
          parentId,
          isRoot: false,
          aiSuggested: true,
          ...stable,
        },
      };
      nextX += CHILD_SPACING;
      return node;
    });

    setNodes((prev) => [...prev, ...created]);
    setEdges((prev) => [...prev, ...created.map((n) => makeEdge(parentId, n.id))]);
  }

  async function handleFillKnowledge() {
    setIsFilling(true);
    pushHistory();
    const roots = liveRef.current.nodes.filter((n) => n.data.parentId === null);

    for (const root of roots) {
      const childLabels = liveRef.current.nodes
        .filter((n) => n.data.parentId === root.id)
        .map((n) => n.data.label);

      let result;
      try {
        result = await fillKnowledge({
          topic: root.data.label,
          notes: root.data.notes,
          childLabels,
        });
      } catch (error) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === root.id
              ? { ...n, data: { ...n.data, aiCorrection: `Couldn’t reach AI: ${error.message}` } }
              : n
          )
        );
        continue;
      }

      setNodes((prev) =>
        prev.map((n) =>
          n.id === root.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  notes: result.filledNotes ?? n.data.notes,
                  aiFilled: result.filledNotes ? true : n.data.aiFilled,
                  aiCorrection: result.correction ?? n.data.aiCorrection,
                },
              }
            : n
        )
      );

      appendSuggestions(root.id, result.suggestedSubtopics);
    }

    setIsFilling(false);
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

  function handleStudyFinish({ correct, total }) {
    if (!canEdit) return;
    saveCanvas(canvasId, { lastScore: { correct, total, at: Date.now() } }).catch(() => {});
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
          className="shrink-0 rounded-full border border-line2 px-3 py-2 text-[13px] text-subink hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          Study
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
          onClick={handleFillKnowledge}
          disabled={isFilling || nodes.length === 0}
          title={
            aiReady
              ? 'Review notes with AI and suggest what’s missing'
              : 'No OPENAI_API_KEY set — will insert placeholders. See .env.example'
          }
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isFilling ? 'Thinking…' : '✨ Fill my knowledge'}
          {!aiReady && <span className="ml-1.5 opacity-70">(no key)</span>}
        </button>
      </div>

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
        nodes={visible.nodes}
        edges={visible.edges}
        onNodesChange={onNodesChange}
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
        />
      )}

      {studying && (
        <StudyMode
          nodes={nodes}
          canvasTitle={title}
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
export default function Canvas({ user, canvasId, onExit, onMissing }) {
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
  return <CanvasEditor key={record.id} user={user} record={record} onExit={onExit} />;
}
