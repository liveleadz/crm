'use client';

// Custom React Flow node renderers for the workflow canvas. Five node types:
// trigger, action, branch, wait, end. Each renders a card with handles for
// edges and shows a one-line summary derived from the node's data so the
// canvas is readable at a glance without opening the right-side panel.

import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { describeAction, describeBranch } from '@/lib/automation-types';
import type {
  AutomationAction,
  BranchCondition,
  GraphNode,
} from '@/lib/automation-types';

export type CanvasContext = {
  stages: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  dispositions: { code: string; label: string }[];
};

// React Flow's NodeProps generic carries our GraphNode shape so node-specific
// data fields are correctly typed in each renderer.
type NodeData<T extends GraphNode['type']> = Extract<GraphNode, { type: T }>['data'];

const HANDLE_BASE =
  '!h-2.5 !w-2.5 !border !border-line !bg-surface hover:!border-teal hover:!bg-teal';

// Wraps the canvas context onto each node renderer via a module-level setter
// because React Flow nodeTypes is registered by reference and can't take
// extra props. The editor sets ctx once on mount.
let CTX: CanvasContext = { stages: [], tags: [], dispositions: [] };
export function setCanvasContext(ctx: CanvasContext) {
  CTX = ctx;
}

function Card({
  selected,
  accent,
  icon,
  title,
  subtitle,
  children,
}: {
  selected?: boolean;
  accent: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`w-[240px] rounded-xl border bg-surface px-3 py-2.5 shadow-sm transition-shadow ${
        selected ? 'border-teal ring-2 ring-teal/30' : 'border-line hover:shadow-md'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`grid h-7 w-7 place-items-center rounded-lg ${accent}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-txt-3">
            {title}
          </div>
          {subtitle && <div className="truncate text-[12.5px] text-txt-1">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function TriggerNode({ data, selected }: NodeProps & { data: NodeData<'trigger'> }) {
  const summary = describeTrigger(data.trigger_type, data.trigger_config, CTX.dispositions);
  return (
    <>
      <Card
        selected={selected}
        accent="bg-teal/15 text-teal"
        title="Trigger"
        subtitle={summary}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" strokeLinejoin="round" />
          </svg>
        }
      />
      <Handle type="source" position={Position.Bottom} className={HANDLE_BASE} />
    </>
  );
}

export function ActionNode({ data, selected }: NodeProps & { data: NodeData<'action'> }) {
  const summary = describeAction(data.action as AutomationAction, {
    stages: CTX.stages,
    tags: CTX.tags,
  });
  return (
    <>
      <Handle type="target" position={Position.Top} className={HANDLE_BASE} />
      <Card
        selected={selected}
        accent="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        title={titleForAction(data.action.kind)}
        subtitle={summary}
        icon={iconForAction(data.action.kind)}
      />
      <Handle type="source" position={Position.Bottom} className={HANDLE_BASE} />
    </>
  );
}

export function BranchNode({ data, selected }: NodeProps & { data: NodeData<'branch'> }) {
  const summary = describeBranch(data.condition as BranchCondition, CTX);
  return (
    <>
      <Handle type="target" position={Position.Top} className={HANDLE_BASE} />
      <Card
        selected={selected}
        accent="bg-violet-500/15 text-violet-600 dark:text-violet-400"
        title="Condition"
        subtitle={summary}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M8 6h8M8 12h8M8 18h8" strokeLinecap="round" />
          </svg>
        }
      >
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px] font-semibold">
          <div className="rounded-md bg-emerald-500/10 py-1 text-center text-emerald-600 dark:text-emerald-400">
            Yes
          </div>
          <div className="rounded-md bg-rose-500/10 py-1 text-center text-rose-600 dark:text-rose-400">
            No
          </div>
        </div>
      </Card>
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{ left: '30%' }}
        className={HANDLE_BASE}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        style={{ left: '70%' }}
        className={HANDLE_BASE}
      />
    </>
  );
}

export function WaitNode({ data, selected }: NodeProps & { data: NodeData<'wait'> }) {
  const minutes = data.duration_minutes ?? 0;
  return (
    <>
      <Handle type="target" position={Position.Top} className={HANDLE_BASE} />
      <Card
        selected={selected}
        accent="bg-amber-500/15 text-amber-600 dark:text-amber-400"
        title="Wait"
        subtitle={formatDuration(minutes)}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
        }
      />
      <Handle type="source" position={Position.Bottom} className={HANDLE_BASE} />
    </>
  );
}

export function EndNode({ selected }: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Top} className={HANDLE_BASE} />
      <div
        className={`grid h-9 min-w-[80px] place-items-center rounded-full px-4 text-[11px] font-semibold uppercase tracking-wide ${
          selected
            ? 'border-2 border-teal bg-canvas text-teal'
            : 'border border-line bg-canvas text-txt-3'
        }`}
      >
        End
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function describeTrigger(
  kind: string,
  cfg: Record<string, unknown>,
  dispositions: { code: string; label: string }[],
): string {
  if (kind === 'disposition_set') {
    const codes = Array.isArray(cfg.codes) ? (cfg.codes as string[]) : [];
    const labels = codes.map((c) => dispositions.find((d) => d.code === c)?.label ?? c);
    return labels.length === 0 ? 'When disposition is set' : `When disposition is ${labels.join(', ')}`;
  }
  return `Trigger: ${kind}`;
}

function titleForAction(kind: AutomationAction['kind']): string {
  switch (kind) {
    case 'move_stage':
      return 'Move stage';
    case 'mark_dnc':
      return 'Mark DNC';
    case 'add_tag':
      return 'Add tag';
    case 'create_task':
      return 'Create task';
  }
}

function iconForAction(kind: AutomationAction['kind']): React.ReactNode {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5 };
  switch (kind) {
    case 'move_stage':
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'mark_dnc':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M5 5l14 14" />
        </svg>
      );
    case 'add_tag':
      return (
        <svg {...common}>
          <path d="M20.59 13.41L13.42 20.58a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      );
    case 'create_task':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M9 11l3 3L22 4" />
        </svg>
      );
  }
}

function formatDuration(minutes: number): string {
  if (!minutes) return 'No delay';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} hr`;
  return `${h}h ${m}m`;
}
