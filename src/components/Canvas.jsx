import { useMemo, useRef } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls } from 'reactflow';
import { useNodesState, useEdgesState } from 'reactflow';
import { getRoots, getChildren, hasChildren } from '../data/historyData';
import HistoryNode from './HistoryNode';

const nodeTypes = { history: HistoryNode };

const ROOT_SPACING = 300;
const CHILD_SPACING = 260;
const LEVEL_HEIGHT = 190;

const EDGE_STYLE = { stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1.5 };

function getDescendantIds(id) {
  const direct = getChildren(id).map((c) => c.id);
  return direct.reduce((acc, childId) => [...acc, childId, ...getDescendantIds(childId)], []);
}

function buildNode(item, position, extra, onToggle) {
  return {
    id: item.id,
    type: 'history',
    position,
    data: {
      ...item,
      expandable: hasChildren(item.id),
      onToggle,
      ...extra,
    },
  };
}

export default function Canvas() {
  const roots = useMemo(() => getRoots(), []);

  // A stable dispatcher whose body always reads the latest `nodes`/`setNodes`,
  // so nodes created long ago never call back into a stale closure.
  const handleToggleRef = useRef(() => {});
  const stableToggle = useRef((id) => handleToggleRef.current(id)).current;

  const [nodes, setNodes, onNodesChange] = useNodesState(
    roots.map((item, i) =>
      buildNode(item, { x: i * ROOT_SPACING, y: 40 }, { isRoot: true, expanded: false }, stableToggle)
    )
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  handleToggleRef.current = function handleToggle(id) {
    const parent = nodes.find((n) => n.id === id);
    if (!parent) return;
    const alreadyExpanded = nodes.some((n) => n.data.parentId === id);

    if (alreadyExpanded) {
      const removeIds = new Set(getDescendantIds(id));
      setNodes((prev) =>
        prev
          .filter((n) => !removeIds.has(n.id))
          .map((n) => (n.id === id ? { ...n, data: { ...n.data, expanded: false } } : n))
      );
      setEdges((prev) => prev.filter((e) => !removeIds.has(e.target)));
      return;
    }

    const children = getChildren(id);
    if (children.length === 0) return;

    const totalWidth = (children.length - 1) * CHILD_SPACING;
    const startX = parent.position.x - totalWidth / 2;
    const newNodes = children.map((child, i) =>
      buildNode(
        child,
        { x: startX + i * CHILD_SPACING, y: parent.position.y + LEVEL_HEIGHT },
        { isRoot: false, expanded: false },
        stableToggle
      )
    );
    const newEdges = children.map((child) => ({
      id: `e-${id}-${child.id}`,
      source: id,
      target: child.id,
      type: 'smoothstep',
      animated: true,
      style: EDGE_STYLE,
    }));

    setNodes((prev) =>
      prev
        .map((n) => (n.id === id ? { ...n, data: { ...n.data, expanded: true } } : n))
        .concat(newNodes)
    );
    setEdges((prev) => [...prev, ...newEdges]);
  };

  return (
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
  );
}
