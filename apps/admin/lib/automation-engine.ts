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

// ---------------------------------------------------------------------------
// Webhook-triggered runs
// ---------------------------------------------------------------------------
//
// Entry point for `webhook_received` automations. Called from the public
// /api/webhooks/automation/[token] route. The route resolves the automation
// via the unique webhook_token, then hands it off here so all the engine
// niceties (graph execution, simple-mode fallback, error capture) are shared
// with the disposition-driven path.

export type WebhookRunInput = {
  automation: {
    id: string;
    name: string;
    mode: string;
    actions: AutomationAction[];
    graph: WorkflowGraph | null;
    brandId: string;
  };
  body: unknown;
  headers: Record<string, string>;
};

export async function runWebhookAutomation(input: WebhookRunInput): Promise<void> {
  const { automation, body, headers } = input;

  // If the body carries a lead_id and it belongs to the same brand, surface
  // it through ctx.leadId so lead-bound actions (move_stage, send_email to
  // lead, etc.) work out of the box.
  let leadId: string | null = null;
  if (typeof body === 'object' && body !== null) {
    const candidate = (body as { lead_id?: unknown }).lead_id;
    if (typeof candidate === 'string' && candidate.length > 0) {
      const supabase = await createServerClient();
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('id', candidate)
        .eq('brand_id', automation.brandId)
        .maybeSingle();
      if (lead) leadId = lead.id;
    }
  }

  const ctx = {
    brandId: automation.brandId,
    leadId,
    memberId: null,
    trigger: { kind: 'webhook_received' as const },
    webhook: { body, headers },
  };

  if (automation.mode === 'graph' && automation.graph) {
    try {
      await startGraphRun({ automationId: automation.id, graph: automation.graph, ctx });
    } catch (e) {
      console.error('[webhook:graph]', automation.name, (e as Error).message);
    }
    return;
  }

  // Simple mode fallback — actions[] in order.
  for (const action of automation.actions) {
    try {
      await executeAction(action, ctx);
    } catch (e) {
      console.error('[webhook]', automation.name, action.kind, (e as Error).message);
    }
  }
}
