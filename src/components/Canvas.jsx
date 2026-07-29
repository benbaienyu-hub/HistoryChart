import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls } from 'reactflow';
import { useNodesState, useEdgesState } from 'reactflow';
import KnowledgeBlock from './KnowledgeBlock';
import { fillKnowledge } from '../lib/aiFill';

const nodeTypes = { knowledge: KnowledgeBlock };

const ROOT_SPACING = 330;
const CHILD_SPACING = 290;
const LEVEL_HEIGHT = 220;
const EDGE_STYLE = { stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1.5 };
const STORAGE_KEY = 'historychart:canvas:v1';

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nodes: [], edges: [] };
    const parsed = JSON.parse(raw);
    return { nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
  } catch {
    return { nodes: [], edges: [] };
  }
}

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

export default function Canvas() {
  const initial = useMemo(() => loadInitial(), []);

  // Stable dispatchers: node.data callbacks are captured once at node-creation
  // time, so each wrapper forwards to whatever logic is current in the ref,
  // keeping old nodes from ever calling back into a stale closure.
  const handlersRef = useRef({});
  const stable = useRef({
    onNotesChange: (id, text) => handlersRef.current.onNotesChange(id, text),
    onStartAddChild: (id) => handlersRef.current.onStartAddChild(id),
    onSubmitChild: (id, text) => handlersRef.current.onSubmitChild(id, text),
    onCancelChild: (id) => handlersRef.current.onCancelChild(id),
    onDelete: (id) => handlersRef.current.onDelete(id),
  }).current;

  const [nodes, setNodes, onNodesChange] = useNodesState(
    initial.nodes.map((n) => ({ ...n, data: { ...n.data, isAddingChild: false, ...stable } }))
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [addingChildId, setAddingChildId] = useState(null);
  const [searchValue, setSearchValue] = useState('');
  const [isFilling, setIsFilling] = useState(false);

  handlersRef.current = {
    onNotesChange(id, text) {
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, notes: text, aiFilled: false } } : n))
      );
    },
    onStartAddChild(id) {
      setAddingChildId((prev) => (prev === id ? null : id));
    },
    onCancelChild() {
      setAddingChildId(null);
    },
    onSubmitChild(parentId, label) {
      const parent = nodes.find((n) => n.id === parentId);
      if (!parent) return;
      const siblings = nodes.filter((n) => n.data.parentId === parentId);
      const newX = siblings.length
        ? Math.max(...siblings.map((s) => s.position.x)) + CHILD_SPACING
        : parent.position.x;
      const newId = crypto.randomUUID();
      const newNode = {
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
      };
      setNodes((prev) => [...prev, newNode]);
      setEdges((prev) => [...prev, makeEdge(parentId, newId)]);
      setAddingChildId(null);
    },
    onDelete(id) {
      const removeIds = new Set([id, ...getDescendantIds(id, nodes)]);
      setNodes((prev) => prev.filter((n) => !removeIds.has(n.id)));
      setEdges((prev) => prev.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target)));
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

  // Persist notes/blocks/edges (not transient UI state or callback refs).
  useEffect(() => {
    const serializable = {
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  }, [nodes, edges]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    const label = searchValue.trim();
    if (!label) return;

    const roots = nodes.filter((n) => n.data.parentId === null);
    const newX = roots.length ? Math.max(...roots.map((r) => r.position.x)) + ROOT_SPACING : 60;
    const newId = crypto.randomUUID();
    const newNode = {
      id: newId,
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
    };
    setNodes((prev) => [...prev, newNode]);
    setSearchValue('');
  }

  async function handleFillKnowledge() {
    setIsFilling(true);
    const roots = nodes.filter((n) => n.data.parentId === null);

    for (const root of roots) {
      const childCount = nodes.filter((n) => n.data.parentId === root.id).length;
      const result = await fillKnowledge({ notes: root.data.notes, childCount });

      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== root.id) return n;
          return {
            ...n,
            data: {
              ...n.data,
              notes: result.filledNotes ?? n.data.notes,
              aiFilled: result.filledNotes ? true : n.data.aiFilled,
              aiCorrection: result.correction ?? n.data.aiCorrection,
            },
          };
        })
      );

      if (result.suggestedSubtopic) {
        const siblings = nodes.filter((n) => n.data.parentId === root.id);
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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-4 border-b border-black/5 bg-white/70 px-6 py-3 backdrop-blur-xl">
        <h1 className="shrink-0 text-[17px] font-semibold tracking-tight text-ink">HistoryChart</h1>

        <form
          onSubmit={handleSearchSubmit}
          className="mx-auto flex w-full max-w-md items-center gap-2 rounded-full border border-black/5 bg-black/[0.03] px-3.5 py-2"
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
    </div>
  );
}
