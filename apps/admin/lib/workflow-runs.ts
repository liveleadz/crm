// Server-only loader for the Runs tab on the automation editor. Returns the
// most-recent workflow_runs rows for an automation, decorated with the lead's
// name (when scoped to a lead) and the human-readable label of the node the
// run is parked on / failed at.

import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import {
  describeAction,
  describeBranch,
  describeWait,
  describeTrigger,
  type AutomationAction,
  type BranchCondition,
  type GraphNode,
  type WaitNodeData,
  type WorkflowGraph,
} from './automation-types';

export type WorkflowRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export type WorkflowRunRow = {
  id: string;
  status: WorkflowRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  currentNodeId: string | null;
  currentNodeLabel: string;
  error: string | null;
  // Lead pulled in for context when the run was scoped to one. May be null
  // for webhook-triggered runs that didn't resolve a lead.
  lead: { id: string; name: string; phone: string | null } | null;
  // Trigger context captured at start time — useful for debugging.
  triggerKind: string | null;
  triggerDisposition: string | null;
};

export async function loadRecentWorkflowRuns(
  automationId: string,
  limit = 50,
): Promise<WorkflowRunRow[]> {
  const supabase = await createServerClient();

  const [runsRes, autoRes] = await Promise.all([
    supabase
      .from('workflow_runs')
      .select('id, status, started_at, finished_at, next_run_at, current_node_id, state, lead_id')
      .eq('automation_id', automationId)
      .order('started_at', { ascending: false })
      .limit(limit),
    supabase
      .from('automations')
      .select('graph')
      .eq('id', automationId)
      .maybeSingle(),
  ]);

  const runs = runsRes.data ?? [];
  if (runs.length === 0) return [];

  // Resolve lead names in one query rather than N+1.
  const leadIds = Array.from(
    new Set(runs.map((r) => r.lead_id).filter((id): id is string => !!id)),
  );
  const leadById = new Map<string, { id: string; first_name: string | null; last_name: string | null; phone: string | null }>();
  if (leadIds.length > 0) {
    const { data } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone')
      .in('id', leadIds);
    for (const l of data ?? []) leadById.set(l.id, l);
  }

  const graph = (autoRes.data?.graph ?? null) as WorkflowGraph | null;
  const nodeById = new Map<string, GraphNode>();
  if (graph?.nodes) {
    for (const n of graph.nodes) nodeById.set(n.id, n);
  }

  return runs.map((r): WorkflowRunRow => {
    const state = (r.state as { ctx?: { trigger?: { kind?: string; disposition?: string } }; error?: string } | null) ?? null;
    const lead = r.lead_id ? leadById.get(r.lead_id) ?? null : null;
    const node = r.current_node_id ? nodeById.get(r.current_node_id) ?? null : null;

    return {
      id: r.id,
      status: r.status as WorkflowRunStatus,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      nextRunAt: r.next_run_at,
      currentNodeId: r.current_node_id,
      currentNodeLabel: labelForNode(node),
      error: state?.error ?? null,
      lead: lead
        ? {
            id: lead.id,
            name:
              [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
              lead.phone ||
              'Unnamed lead',
            phone: lead.phone,
          }
        : null,
      triggerKind: state?.ctx?.trigger?.kind ?? null,
      triggerDisposition: state?.ctx?.trigger?.disposition ?? null,
    };
  });
}

function labelForNode(node: GraphNode | null): string {
  if (!node) return '—';
  switch (node.type) {
    case 'trigger':
      return describeTrigger(node.data.trigger_type, node.data.trigger_config, []);
    case 'action':
      return describeAction(node.data.action as AutomationAction, { stages: [], tags: [] });
    case 'branch':
      return describeBranch(node.data.condition as BranchCondition, {
        stages: [],
        tags: [],
        dispositions: [],
      });
    case 'wait':
      return describeWait(node.data as WaitNodeData);
    case 'end':
      return 'End';
    default:
      return 'Step';
  }
}
