import 'server-only';

// Synchronous, fire-and-forget automation runner. Called immediately after
// the triggering server action persists its primary write (e.g. setDisposition
// finishes updating the calls row).
//
// Two modes per row:
//   simple  — fast path. actions[] runs in order using the user's RLS-scoped
//             client; per-action errors logged but not thrown.
//   graph   — dispatches to workflow-graph-engine.startGraphRun(), which
//             persists a workflow_runs row and walks the DAG (synchronous up
//             to the first wait node; cron resumes after that).
//
// Either mode must never block the primary write. All errors are caught.

import { createServerClient } from '@leadpilot/db/server';
import type { AutomationAction, WorkflowGraph } from '@/lib/automations';
import { startGraphRun, executeAction } from '@/lib/workflow-graph-engine';

type DispositionTrigger = {
  trigger: 'disposition_set';
  brandId: string;
  callId: string;
  leadId: string | null;
  memberId: string | null;
  disposition: string;
  callbackAt: string | null;
};

export type AutomationTriggerInput = DispositionTrigger;

type Row = {
  id: string;
  name: string;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
  mode: string;
  graph: WorkflowGraph | null;
};

export async function runAutomations(input: AutomationTriggerInput): Promise<void> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('automations')
    .select('id, name, trigger_config, actions, mode, graph')
    .eq('brand_id', input.brandId)
    .eq('trigger_type', input.trigger)
    .eq('is_enabled', true)
    .order('sort_order', { ascending: true });

  if (error || !data) return;

  const matched = (data as unknown as Row[]).filter((row) => matches(row.trigger_config, input));

  for (const row of matched) {
    if (row.mode === 'graph' && row.graph) {
      try {
        await startGraphRun({
          automationId: row.id,
          graph: row.graph,
          ctx: {
            brandId: input.brandId,
            leadId: input.leadId,
            memberId: input.memberId,
            trigger: {
              kind: input.trigger,
              disposition: input.disposition,
              callbackAt: input.callbackAt,
            },
          },
        });
      } catch (e) {
        console.error('[automations:graph]', row.name, (e as Error).message);
      }
      continue;
    }

    // Simple mode — fast path.
    for (const action of row.actions) {
      try {
        await executeAction(action, {
          brandId: input.brandId,
          leadId: input.leadId,
          memberId: input.memberId,
          trigger: {
            kind: input.trigger,
            disposition: input.disposition,
            callbackAt: input.callbackAt,
          },
        });
      } catch (e) {
        console.error('[automations]', row.name, action.kind, (e as Error).message);
      }
    }
  }
}

function matches(config: Record<string, unknown>, input: AutomationTriggerInput): boolean {
  if (input.trigger === 'disposition_set') {
    const codes = config.codes;
    if (!Array.isArray(codes) || codes.length === 0) return false;
    return codes.includes(input.disposition);
  }
  return false;
}
