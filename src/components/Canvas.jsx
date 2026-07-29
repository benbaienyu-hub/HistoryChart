import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls } from 'reactflow';
import { useNodesState, useEdgesState } from 'reactflow';
import KnowledgeBlock from './KnowledgeBlock';
import ShareDialog from './ShareDialog';
import { fillKnowledge } from '../lib/aiFill';
import { getCanvas, updateCanvas } from '../lib/canvasStore';

const nodeTypes = { knowledge: KnowledgeBlock };

const ROOT_SPACING = 330;
const CHILD_SPACING = 290;
const LEVEL_HEIGHT = 220;
const EDGE_STYLE = { stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1.5 };
const HISTORY_LIMIT = 50;

function makeEdge(sourceId, targetId) {
  return {
    id: `e-${sourceId}-${targetId}`,
    source: sourceId,
    target: targetId,
    type: 'smoothstep',
    animated: true,
    style: EDGE_STYLE,
  };
}

function getDescendantIds(id, nodesList) {
  const direct = nodesList.filter((n) => n.data.parentId === id).map((n) => n.id);
  return direct.reduce((acc, cid) => [...acc, cid, ...getDescendantIds(cid, nodesList)], []);
}

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
        parentId: n.data.parentId,
        isRoot: n.data.isRoot,
        aiFilled: n.data.aiFilled,
        aiCorrection: n.data.aiCorrection,
        aiSuggested: n.data.aiSuggested,
      },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      animated: e.animated,
      style: e.style,
    })),
  };
}

export default function Canvas({ user, canvasId, onExit }) {
  const record = useMemo(() => getCanvas(canvasId), [canvasId]);
  const isOwner = record?.ownerEmail === user.email;

  // Stable dispatchers: node.data callbacks are captured once at node-creation
  // time, so each wrapper forwards to whatever logic is current in the ref,
  // keeping old nodes from ever calling back into a stale closure.
  const handlersRef = useRef({});
  const stable = useRef({
    onNotesChange: (id, text) => handlersRef.current.onNotesChange(id, text),
    onLabelChange: (id, text) => handlersRef.current.onLabelChange(id, text),
    onStartAddChild: (id) => handlersRef.current.onStartAddChild(id),
    onSubmitChild: (id, text) => handlersRef.current.onSubmitChild(id, text),
    onCancelChild: (id) => handlersRef.current.onCancelChild(id),
    onDelete: (id) => handlersRef.current.onDelete(id),
  }).current;

  const hydrate = useCallback(
    (list) => list.map((n) => ({ ...n, data: { ...n.data, isAddingChild: false, ...stable } })),
    [stable]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(hydrate(record?.nodes ?? []));
  const [edges, setEdges, onEdgesChange] = useEdgesState(record?.edges ?? []);
  const [title, setTitle] = useState(record?.title ?? 'Untitled canvas');
  const [editingTitle, setEditingTitle] = useState(false);
  const [addingChildId, setAddingChildId] = useState(null);
  const [searchValue, setSearchValue] = useState('');
  const [isFilling, setIsFilling] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // Bumping this re-renders so the dialog re-reads the canvas's share list.
  const [, setShareVersion] = useState(0);

  // Always-current view of the graph, for closures that would otherwise go stale.
  const liveRef = useRef({ nodes, edges });
  liveRef.current = { nodes, edges };

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
      setEdges(snapshot.edges);
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
      pushHistory();
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: text } } : n))
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
            label,
            notes: '',
            parentId,
            isRoot: false,
            aiFilled: false,
            aiCorrection: null,
            aiSuggested: false,
            isAddingChild: false,
            ...stable,
          },
        },
      ]);
      setEdges((prev) => [...prev, makeEdge(parentId, newId)]);
      setAddingChildId(null);
    },
    onDelete(id) {
      pushHistory();
      const removeIds = new Set([id, ...getDescendantIds(id, liveRef.current.nodes)]);
      setNodes((prev) => prev.filter((n) => !removeIds.has(n.id)));
      setEdges((prev) =>
        prev.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target))
      );
    },
  };

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

  // Persist graph edits back to the stored canvas.
  useEffect(() => {
    if (!record) return;
    updateCanvas(canvasId, serialize({ nodes, edges }));
  }, [nodes, edges, canvasId, record]);

  useEffect(() => {
    if (!record) return;
    updateCanvas(canvasId, { title });
  }, [title, canvasId, record]);

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

  function handleSearchSubmit(e) {
    e.preventDefault();
    const label = searchValue.trim();
    if (!label) return;
    pushHistory();

    const roots = liveRef.current.nodes.filter((n) => n.data.parentId === null);
    const newX = roots.length ? Math.max(...roots.map((r) => r.position.x)) + ROOT_SPACING : 60;

    setNodes((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type: 'knowledge',
        position: { x: newX, y: 90 },
        data: {
          label,
          notes: '',
          parentId: null,
          isRoot: true,
          aiFilled: false,
          aiCorrection: null,
          aiSuggested: false,
          isAddingChild: false,
          ...stable,
        },
      },
    ]);
    setSearchValue('');
  }

  async function handleFillKnowledge() {
    setIsFilling(true);
    pushHistory();
    const roots = liveRef.current.nodes.filter((n) => n.data.parentId === null);

    for (const root of roots) {
      const childCount = liveRef.current.nodes.filter((n) => n.data.parentId === root.id).length;
      const result = await fillKnowledge({ notes: root.data.notes, childCount });

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

      if (result.suggestedSubtopic) {
        const siblings = liveRef.current.nodes.filter((n) => n.data.parentId === root.id);
        const newX = siblings.length
          ? Math.max(...siblings.map((s) => s.position.x)) + CHILD_SPACING
          : root.position.x;
        const newId = crypto.randomUUID();
        setNodes((prev) => [
          ...prev,
          {
            id: newId,
            type: 'knowledge',
            position: { x: newX, y: root.position.y + LEVEL_HEIGHT },
            data: {
              label: result.suggestedSubtopic,
              notes: '',
              parentId: root.id,
              isRoot: false,
              aiFilled: false,
              aiCorrection: null,
              aiSuggested: true,
              isAddingChild: false,
              ...stable,
            },
          },
        ]);
        setEdges((prev) => [...prev, makeEdge(root.id, newId)]);
      }
    }

    setIsFilling(false);
  }

  if (!record) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas">
        <p className="text-[14px] text-ink">This canvas no longer exists.</p>
        <button
          type="button"
          onClick={onExit}
          className="rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white"
        >
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b border-black/5 bg-white/70 px-4 py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={onExit}
          title="Back to home"
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-[13px] text-subink hover:bg-black/5 hover:text-ink"
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
            className="w-[180px] shrink-0 rounded-lg border border-accent/40 bg-white px-2 py-1 text-[14px] font-semibold text-ink focus:outline-none"
          />
        ) : isOwner ? (
          <button
            type="button"
            onClick={() => setEditingTitle(true)}
            title="Rename canvas"
            className="max-w-[180px] shrink-0 truncate rounded-lg px-2 py-1 text-left text-[14px] font-semibold text-ink hover:bg-black/5"
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
          className="mx-auto flex w-full max-w-sm items-center gap-2 rounded-full border border-black/5 bg-black/[0.03] px-3.5 py-2"
        >
          <svg className="h-4 w-4 shrink-0 text-subink" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Explore a topic…"
            className="w-full bg-transparent text-[13.5px] text-ink placeholder:text-subink/70 focus:outline-none"
          />
        </form>

        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-black/5 bg-black/[0.03] p-0.5">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="flex h-7 w-7 items-center justify-center rounded-full text-subink hover:bg-white hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
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
            className="flex h-7 w-7 items-center justify-center rounded-full text-subink hover:bg-white hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
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

        {isOwner && (
          <button
            type="button"
            onClick={() => setShowShare(true)}
            className="shrink-0 rounded-full border border-black/10 px-3 py-2 text-[13px] text-subink hover:bg-black/5 hover:text-ink"
          >
            Share
          </button>
        )}

        <button
          type="button"
          onClick={handleFillKnowledge}
          disabled={isFilling || nodes.length === 0}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isFilling ? 'Filling…' : '✨ Fill my knowledge'}
        </button>
      </div>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-[15px] text-subink">Search a topic above to start your canvas</p>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.15}
        maxZoom={1.5}
        defaultEdgeOptions={{ type: 'smoothstep', style: EDGE_STYLE }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(0,0,0,0.12)" />
        <Controls
          showInteractive={false}
          className="rounded-xl! border! border-black/5! bg-white/85! shadow-lg! backdrop-blur-xl!"
        />
      </ReactFlow>

      {showShare && (
        <ShareDialog
          canvas={getCanvas(canvasId) ?? record}
          currentUser={user}
          onClose={() => setShowShare(false)}
          onChanged={() => setShareVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
