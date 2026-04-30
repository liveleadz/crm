// Pure layout helpers for the workflow canvas. v1 uses a simple top-down
// stacker: the trigger sits at the top, each downstream chain of edges drops
// 140px per node. Branch outputs fan out horizontally (yes left, no right,
// none far right). Cycles are not supported (caller must guarantee a DAG).

import type { GraphEdge, GraphNode, WorkflowGraph } from '@/lib/automation-types';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 100;
const VERTICAL_GAP = 60;
const HORIZONTAL_GAP = 60;

export function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  const trigger = graph.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return graph;

  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e);
    outgoing.set(e.source, list);
  }

  const positions = new Map<string, { x: number; y: number }>();
  // Recursive: returns the horizontal width consumed by the subtree so we
  // can center the parent above its children.
  function place(nodeId: string, depth: number, leftX: number, seen: Set<string>): number {
    if (seen.has(nodeId)) return 0;
    seen.add(nodeId);
    const edges = outgoing.get(nodeId) ?? [];
    if (edges.length === 0) {
      positions.set(nodeId, { x: leftX, y: depth * (NODE_HEIGHT + VERTICAL_GAP) });
      return NODE_WIDTH;
    }
    if (edges.length === 1) {
      const childWidth = place(edges[0]!.target, depth + 1, leftX, seen);
      positions.set(nodeId, {
        x: leftX + (Math.max(childWidth, NODE_WIDTH) - NODE_WIDTH) / 2,
        y: depth * (NODE_HEIGHT + VERTICAL_GAP),
      });
      return Math.max(childWidth, NODE_WIDTH);
    }
    // Branch: fan out
    let cursor = leftX;
    let totalWidth = 0;
    const childWidths: number[] = [];
    for (const edge of edges) {
      const w = place(edge.target, depth + 1, cursor, seen);
      childWidths.push(w);
      cursor += w + HORIZONTAL_GAP;
      totalWidth += w + HORIZONTAL_GAP;
    }
    totalWidth = Math.max(NODE_WIDTH, totalWidth - HORIZONTAL_GAP);
    positions.set(nodeId, {
      x: leftX + (totalWidth - NODE_WIDTH) / 2,
      y: depth * (NODE_HEIGHT + VERTICAL_GAP),
    });
    return totalWidth;
  }

  place(trigger.id, 0, 0, new Set());

  const positioned: GraphNode[] = graph.nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? n.position ?? { x: 0, y: 0 },
  }));

  // Add 80px padding on the left so the leftmost node isn't flush against
  // the canvas edge. Fall through to byId so unreachable nodes keep their
  // existing positions.
  for (const n of positioned) {
    if (positions.has(n.id)) {
      n.position = { x: n.position.x + 80, y: n.position.y + 40 };
    }
  }

  void byId;
  return { nodes: positioned, edges: graph.edges };
}

export function emptyGraph(triggerType: string, triggerConfig: Record<string, unknown>): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        position: { x: 320, y: 80 },
        data: { trigger_type: triggerType, trigger_config: triggerConfig },
      },
    ],
    edges: [],
  };
}
