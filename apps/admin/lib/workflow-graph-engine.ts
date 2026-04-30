import 'server-only';

// Stateful graph engine for graph-mode automations.
//
// startGraphRun() creates a workflow_runs row and walks the DAG starting at
// the trigger. It executes action nodes synchronously and follows edges
// until it either:
//   - hits an end node / dead end          → status='completed'
//   - hits a wait node                     → status='waiting', next_run_at set
//   - throws an unrecoverable error        → status='failed'
//
// A Vercel cron pings /api/cron/workflow-tick every minute, which calls
// tickGraphRun() for each waiting run whose next_run_at is due. tickGraphRun
// continues from current_node_id past the wait and back into the same walk
// loop.
//
// Branch evaluation reads fresh lead state from the DB at evaluation time
// (lead may have changed since the trigger fired). Wait durations and edge
// targets are stored in the graph itself, not in run state, so editing a
// graph affects in-flight runs deterministically.

import { createServerClient } from '@leadpilot/db/server';
import type {
  AutomationAction,
  BranchCondition,
  BranchHandle,
  GraphEdge,
  GraphNode,
  WorkflowGraph,
} from './automation-types';

export type GraphRunContext = {
  brandId: string;
  leadId: string | null;
  memberId: string | null;
  // Trigger-supplied facts available to branches and actions.
  trigger: {
    kind: string;
    disposition?: string;
    callbackAt?: string | null;
  };
};

type StartInput = {
  automationId: string;
  graph: WorkflowGraph;
  ctx: GraphRunContext;
};

export async function startGraphRun({
  automationId,
  graph,
  ctx,
}: StartInput): Promise<void> {
  const trigger = graph.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('workflow_runs')
    .insert({
      automation_id: automationId,
      brand_id: ctx.brandId,
      lead_id: ctx.leadId,
      current_node_id: trigger.id,
      state: { ctx } as unknown as never,
      status: 'running',
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[graph-engine] start failed', error?.message);
    return;
  }

  await walkFrom(data.id, trigger.id, graph, ctx);
}

export async function tickGraphRun(runId: string): Promise<void> {
  const supabase = await createServerClient();
  const { data: run } = await supabase
    .from('workflow_runs')
    .select('id, automation_id, current_node_id, state, status')
    .eq('id', runId)
    .maybeSingle();
  if (!run || run.status !== 'waiting' || !run.automation_id || !run.current_node_id) return;

  const { data: auto } = await supabase
    .from('automations')
    .select('graph')
    .eq('id', run.automation_id)
    .maybeSingle();
  if (!auto?.graph) {
    await supabase.from('workflow_runs').update({ status: 'failed' }).eq('id', runId);
    return;
  }

  const graph = auto.graph as unknown as WorkflowGraph;
  const ctx = ((run.state as { ctx?: GraphRunContext })?.ctx ?? null) as GraphRunContext | null;
  if (!ctx) {
    await supabase.from('workflow_runs').update({ status: 'failed' }).eq('id', runId);
    return;
  }

  // Resume = move to the wait node's first downstream neighbor.
  const next = nextEdge(graph, run.current_node_id, null);
  if (!next) {
    await markCompleted(runId);
    return;
  }
  await supabase
    .from('workflow_runs')
    .update({ status: 'running', current_node_id: next.target })
    .eq('id', runId);
  await walkFrom(runId, next.target, graph, ctx);
}

// Walks downstream from `nodeId`, executing each node, until end/wait/fail.
async function walkFrom(
  runId: string,
  nodeId: string,
  graph: WorkflowGraph,
  ctx: GraphRunContext,
): Promise<void> {
  const supabase = await createServerClient();
  let cursor: string | null = nodeId;
  const visited = new Set<string>();

  while (cursor) {
    if (visited.has(cursor)) {
      await markFailed(runId, `cycle detected at ${cursor}`);
      return;
    }
    visited.add(cursor);

    const node: GraphNode | undefined = graph.nodes.find((n) => n.id === cursor);
    if (!node) {
      await markFailed(runId, `missing node ${cursor}`);
      return;
    }

    await supabase
      .from('workflow_runs')
      .update({ current_node_id: node.id })
      .eq('id', runId);

    if (node.type === 'end') {
      await markCompleted(runId);
      return;
    }

    if (node.type === 'trigger') {
      const next: GraphEdge | null = nextEdge(graph, node.id, null);
      cursor = next ? next.target : null;
      continue;
    }

    if (node.type === 'wait') {
      const minutes = Math.max(0, node.data.duration_minutes || 0);
      const due = new Date(Date.now() + minutes * 60_000).toISOString();
      await supabase
        .from('workflow_runs')
        .update({ status: 'waiting', next_run_at: due, current_node_id: node.id })
        .eq('id', runId);
      return;
    }

    if (node.type === 'action') {
      try {
        await executeAction(node.data.action, ctx);
      } catch (e) {
        await markFailed(runId, (e as Error).message);
        return;
      }
      const next: GraphEdge | null = nextEdge(graph, node.id, null);
      cursor = next ? next.target : null;
      continue;
    }

    if (node.type === 'branch') {
      let handle: BranchHandle;
      try {
        handle = await evaluateBranch(node.data.condition, ctx);
      } catch (e) {
        await markFailed(runId, (e as Error).message);
        return;
      }
      const next: GraphEdge | null = nextEdge(graph, node.id, handle);
      cursor = next ? next.target : null;
      continue;
    }

    cursor = null;
  }

  await markCompleted(runId);
}

function nextEdge(graph: WorkflowGraph, nodeId: string, handle: BranchHandle | null): GraphEdge | null {
  if (handle) {
    return graph.edges.find((e) => e.source === nodeId && e.sourceHandle === handle) ?? null;
  }
  return graph.edges.find((e) => e.source === nodeId && !e.sourceHandle) ?? null;
}

async function markCompleted(runId: string): Promise<void> {
  const supabase = await createServerClient();
  await supabase
    .from('workflow_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString() })
    .eq('id', runId);
}

async function markFailed(runId: string, reason: string): Promise<void> {
  const supabase = await createServerClient();
  await supabase
    .from('workflow_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      state: { error: reason } as unknown as never,
    })
    .eq('id', runId);
  console.error('[graph-engine] failed', runId, reason);
}

// ---------------------------------------------------------------------------
// Branch evaluation
// ---------------------------------------------------------------------------

async function evaluateBranch(cond: BranchCondition, ctx: GraphRunContext): Promise<BranchHandle> {
  if (cond.kind === 'disposition_equals') {
    const code = ctx.trigger.disposition;
    return code && cond.codes.includes(code) ? 'yes' : 'no';
  }

  if (!ctx.leadId) return 'none';

  const supabase = await createServerClient();

  if (cond.kind === 'lead_in_stage') {
    const { data } = await supabase
      .from('leads')
      .select('stage_id')
      .eq('id', ctx.leadId)
      .maybeSingle();
    return data?.stage_id === cond.stage_id ? 'yes' : 'no';
  }

  if (cond.kind === 'lead_field_equals') {
    const { data } = await supabase
      .from('leads')
      .select('do_not_call')
      .eq('id', ctx.leadId)
      .maybeSingle();
    if (!data) return 'none';
    return data.do_not_call === cond.value ? 'yes' : 'no';
  }

  if (cond.kind === 'lead_has_tag') {
    const { data } = await supabase
      .from('lead_tags')
      .select('tag_id')
      .eq('lead_id', ctx.leadId)
      .eq('tag_id', cond.tag_id)
      .maybeSingle();
    return data ? 'yes' : 'no';
  }

  return 'none';
}

// ---------------------------------------------------------------------------
// Action execution (shared with simple-mode engine)
// ---------------------------------------------------------------------------

export async function executeAction(action: AutomationAction, ctx: GraphRunContext): Promise<void> {
  if (!ctx.leadId) return;
  const supabase = await createServerClient();

  switch (action.kind) {
    case 'move_stage': {
      await supabase.from('leads').update({ stage_id: action.stage_id }).eq('id', ctx.leadId);
      return;
    }
    case 'mark_dnc': {
      await supabase.from('leads').update({ do_not_call: true }).eq('id', ctx.leadId);
      return;
    }
    case 'add_tag': {
      await supabase
        .from('lead_tags')
        .upsert(
          { lead_id: ctx.leadId, tag_id: action.tag_id },
          { onConflict: 'lead_id,tag_id', ignoreDuplicates: true },
        );
      return;
    }
    case 'create_task': {
      const dueAt = resolveDueAt(action, ctx);
      await supabase.from('tasks').insert({
        brand_id: ctx.brandId,
        lead_id: ctx.leadId,
        assignee_id: action.assign_to_caller ? ctx.memberId : null,
        title: action.title,
        kind: action.task_kind ?? 'other',
        due_at: dueAt,
      });
      return;
    }
  }
}

function resolveDueAt(
  action: Extract<AutomationAction, { kind: 'create_task' }>,
  ctx: GraphRunContext,
): string | null {
  if (action.use_callback_at && ctx.trigger.callbackAt) return ctx.trigger.callbackAt;
  if (typeof action.due_in_minutes === 'number') {
    return new Date(Date.now() + action.due_in_minutes * 60_000).toISOString();
  }
  return null;
}
