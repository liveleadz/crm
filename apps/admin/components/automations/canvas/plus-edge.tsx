'use client';

// Custom edge that draws a smooth path with a + button at its midpoint.
// Clicking the button opens the node picker, which inserts a new node
// between the edge's source and target.

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

export type PlusEdgeData = {
  onInsert: (edgeId: string) => void;
  label?: string;
  labelTone?: 'yes' | 'no';
};

export function PlusEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  } = props;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const d = data as PlusEdgeData | undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: 'rgb(var(--line-2))',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
        }}
        className="lp-flow-edge"
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="flex items-center gap-1.5"
        >
          {d?.label && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                d.labelTone === 'yes'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : d.labelTone === 'no'
                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    : 'bg-canvas text-txt-3'
              }`}
            >
              {d.label}
            </span>
          )}
          <button
            type="button"
            aria-label="Insert step"
            onClick={() => d?.onInsert(id)}
            className="grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-txt-2 shadow-sm transition-colors hover:border-teal hover:text-teal"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
