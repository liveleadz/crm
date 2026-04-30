'use client';

// Visual graph editor for a single automation. Wraps React Flow with our
// custom node + edge renderers, the right-side config panel, and a node
// picker that opens when a + button on an edge is clicked.
//
// Persistence is debounced (700ms after the last change). The header shows
// the saved state — see header-bar.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphEdge, GraphNode, WorkflowGraph } from '@/lib/automation-types';
import {
  ActionNode,
  BranchNode,
  EndNode,
  TriggerNode,
  WaitNode,
  setCanvasContext,
  type CanvasContext,
} from './nodes';
import { PlusEdge } from './plus-edge';
import { NodePicker } from './node-picker';
import { NodeConfigPanel } from './node-config-panel';
import { autoLayout } from './layout';

type Props = {
  initial: WorkflowGraph;
  ctx: CanvasContext;
  onChange: (graph: WorkflowGraph) => void;
};

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  branch: BranchNode,
  wait: WaitNode,
  end: EndNode,
};

const edgeTypes = { 'plus-edge': PlusEdge };

export function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ initial, ctx, onChange }: Props) {
  // React Flow state mirrors the graph but uses its own minimal node shape.
  // We round-trip through these adapters so the graph json stays clean.
  const initialLaid = useMemo(() => autoLayout(initial), [initial]);
  const [nodes, setNodes] = useState<Node[]>(() => initialLaid.nodes.map(toRfNode));
  const [edges, setEdges] = useState<Edge[]>(() =>
    initialLaid.edges.map((e) => toRfEdge(e, openPickerRef.bind(null))),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerEdgeId, setPickerEdgeId] = useState<string | null>(null);
  const rf = useRef<ReactFlowInstance | null>(null);

  // Static reference fed to plus-edges via their data prop.
  function openPickerRef(edgeId: string) {
    setPickerEdgeId(edgeId);
  }

  // Keep node renderers' canvas-context in sync (icons, summaries).
  useEffect(() => {
    setCanvasContext(ctx);
  }, [ctx]);

  // Re-derive the underlying graph + emit upstream whenever rf state moves.
  // Skips the very first emit (would be identical to initial). `onChange` is
  // held in a ref so unstable parent identities don't re-fire this effect —
  // that would cause a setState→render→effect→setState loop (React #185).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const firstEmit = useRef(true);
  useEffect(() => {
    if (firstEmit.current) {
      firstEmit.current = false;
      return;
    }
    const graph: WorkflowGraph = {
      nodes: nodes.map(fromRfNode),
      edges: edges.map(fromRfEdge),
    };
    onChangeRef.current(graph);
  }, [nodes, edges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );
  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) =>
      addEdge(
        {
          ...conn,
          type: 'plus-edge',
          data: edgeData(conn.sourceHandle ?? null, openPickerRef),
        },
        eds,
      ),
    );
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  function patchSelected(next: GraphNode) {
    setNodes((nds) =>
      nds.map((n) => (n.id === next.id ? { ...n, type: next.type, data: next.data } : n)),
    );
  }

  function deleteSelected() {
    if (!selectedId) return;
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setSelectedId(null);
  }

  // Insert a new node "in the middle" of an edge — split the edge into two
  // around the new node. The picker tells us what type of node to create.
  function insertOnEdge(rawNode: Omit<GraphNode, 'id' | 'position'>) {
    if (!pickerEdgeId) return;
    const edge = edges.find((e) => e.id === pickerEdgeId);
    if (!edge) {
      setPickerEdgeId(null);
      return;
    }
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode) {
      setPickerEdgeId(null);
      return;
    }
    const id = `n_${Math.random().toString(36).slice(2, 9)}`;
    const midX = (sourceNode.position.x + targetNode.position.x) / 2;
    const midY = (sourceNode.position.y + targetNode.position.y) / 2;
    const newNode: Node = {
      id,
      type: rawNode.type,
      position: { x: midX, y: midY },
      data: rawNode.data,
    };
    setNodes((nds) => [...nds, newNode]);
    setEdges((eds) => {
      const filtered = eds.filter((e) => e.id !== pickerEdgeId);
      return [
        ...filtered,
        {
          id: `${edge.source}->${id}`,
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? undefined,
          target: id,
          type: 'plus-edge',
          data: edgeData(edge.sourceHandle ?? null, openPickerRef),
        },
        {
          id: `${id}->${edge.target}`,
          source: id,
          target: edge.target,
          type: 'plus-edge',
          data: edgeData(null, openPickerRef),
        },
      ];
    });
    setPickerEdgeId(null);
    setSelectedId(id);
  }

  // The trigger node always has a single + handle (terminal edge case for
  // empty graphs). Render an explicit append button anchored to the canvas.
  const hasOutgoingFromTrigger = edges.some((e) => e.source === 'trigger');

  // Identify nodes whose downstream slot is empty so we can render an explicit
  // "+" toolbar below them. Branches are skipped here because each yes/no
  // handle has its own slot — we render a hint on the selected branch panel
  // instead. End nodes never need an appender.
  const leafNodeIds = useMemo(() => {
    const sourcesByNode = new Set(edges.map((e) => e.source));
    const out: string[] = [];
    for (const n of nodes) {
      if (!n.type) continue;
      if (n.type === 'end' || n.type === 'branch') continue;
      if (n.id === 'trigger') continue; // handled by hasOutgoingFromTrigger
      if (!sourcesByNode.has(n.id)) out.push(n.id);
    }
    return out;
  }, [nodes, edges]);

  function appendAfter(nodeId: string) {
    setPickerEdgeId(`__append_after__${nodeId}`);
  }
  function insertAfter(nodeId: string, rawNode: Omit<GraphNode, 'id' | 'position'>) {
    const source = nodes.find((n) => n.id === nodeId);
    if (!source) return;
    const id = `n_${Math.random().toString(36).slice(2, 9)}`;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: rawNode.type,
        position: { x: source.position.x, y: source.position.y + 160 },
        data: rawNode.data,
      },
    ]);
    setEdges((eds) => [
      ...eds,
      {
        id: `${nodeId}->${id}`,
        source: nodeId,
        target: id,
        type: 'plus-edge',
        data: edgeData(null, openPickerRef),
      },
    ]);
    setPickerEdgeId(null);
    setSelectedId(id);
  }
  function insertAfterTrigger(rawNode: Omit<GraphNode, 'id' | 'position'>) {
    insertAfter('trigger', rawNode);
  }
  function appendBelowTrigger() {
    appendAfter('trigger');
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'plus-edge', animated: true }}
        onNodeClick={(_, n) => setSelectedId(n.id)}
        onPaneClick={() => setSelectedId(null)}
        onInit={(inst) => {
          rf.current = inst;
          inst.fitView({ padding: 0.2, maxZoom: 0.85 });
        }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        {/* "+ append" toolbar attached to each leaf node, sits below the card. */}
        {leafNodeIds.map((id) => (
          <NodeToolbar
            key={`append-${id}`}
            nodeId={id}
            position={Position.Bottom}
            isVisible
            offset={6}
          >
            <button
              type="button"
              onClick={() => appendAfter(id)}
              className="grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-txt-2 shadow-sm transition-colors hover:border-teal hover:text-teal"
              aria-label="Add step"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
          </NodeToolbar>
        ))}
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => miniMapColor(n.type ?? 'action')}
          maskColor="rgba(0,0,0,0.05)"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        />
        <Controls
          showInteractive={false}
          position="bottom-left"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        />
      </ReactFlow>

      {!hasOutgoingFromTrigger && (
        <button
          type="button"
          onClick={appendBelowTrigger}
          className="absolute left-1/2 top-[200px] z-20 -translate-x-1/2 rounded-full border border-dashed border-line bg-canvas px-4 py-2 text-[12px] font-medium text-txt-2 shadow-sm hover:border-teal hover:text-teal"
        >
          + Add first step
        </button>
      )}

      {selectedNode && (
        <NodeConfigPanel
          node={fromRfNode(selectedNode)}
          ctx={ctx}
          onChange={patchSelected}
          onDelete={deleteSelected}
          onClose={() => setSelectedId(null)}
        />
      )}

      {pickerEdgeId && (
        <NodePicker
          ctx={ctx}
          onCancel={() => setPickerEdgeId(null)}
          onPick={(node) => {
            if (pickerEdgeId === '__append_trigger__') {
              insertAfterTrigger(node);
            } else if (pickerEdgeId.startsWith('__append_after__')) {
              insertAfter(pickerEdgeId.slice('__append_after__'.length), node);
            } else {
              insertOnEdge(node);
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adapters between our GraphNode/GraphEdge and React Flow's Node/Edge.
// ---------------------------------------------------------------------------

function toRfNode(n: GraphNode): Node {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
  };
}

function fromRfNode(n: Node): GraphNode {
  return {
    id: n.id,
    type: (n.type ?? 'action') as GraphNode['type'],
    position: n.position,
    data: n.data,
  } as GraphNode;
}

function toRfEdge(
  e: GraphEdge,
  open: (id: string) => void,
): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    type: 'plus-edge',
    data: edgeData(e.sourceHandle ?? null, open),
  };
}

function fromRfEdge(e: Edge): GraphEdge {
  const sh = e.sourceHandle as 'yes' | 'no' | undefined;
  const out: GraphEdge = {
    id: e.id,
    source: e.source,
    target: e.target,
  };
  if (sh) out.sourceHandle = sh;
  return out;
}

function edgeData(sourceHandle: string | null, openPicker: (id: string) => void) {
  return {
    onInsert: openPicker,
    label: sourceHandle === 'yes' ? 'Yes' : sourceHandle === 'no' ? 'No' : undefined,
    labelTone: sourceHandle === 'yes' ? 'yes' : sourceHandle === 'no' ? 'no' : undefined,
  };
}

function miniMapColor(type: string): string {
  switch (type) {
    case 'trigger':
      return '#0d9488';
    case 'action':
      return '#10b981';
    case 'branch':
      return '#8b5cf6';
    case 'wait':
      return '#f59e0b';
    case 'end':
      return '#94a3b8';
    default:
      return '#94a3b8';
  }
}
