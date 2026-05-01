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

import { createAdminClient } from '@leadpilot/db/admin';
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

type CallReceivedTrigger = {
  trigger: 'call_received';
  brandId: string;
  callId: string;
  leadId: string | null;
  // numberId of the LeadPilot number that was called (for filtering rules)
  numberId: string | null;
  fromNumber: string;
  toNumber: string;
};

type LeadCreatedTrigger = {
  trigger: 'lead_created';
  brandId: string;
  leadId: string;
  memberId: string | null;
  source: string | null;
};

type StageChangedTrigger = {
  trigger: 'stage_changed';
  brandId: string;
  leadId: string;
  memberId: string | null;
  fromStageId: string | null;
  toStageId: string | null;
};

type EmailReceivedTrigger = {
  trigger: 'email_received';
  brandId: string;
  leadId: string;
  memberId: string | null;
  threadId: string;
  messageId: string;
  fromAddr: string | null;
  subject: string | null;
};

type AppointmentBookedTrigger = {
  trigger: 'appointment_booked';
  brandId: string;
  leadId: string;
  memberId: string | null;
  appointmentId: string;
  startsAt: string;
};

export type AutomationTriggerInput =
  | DispositionTrigger
  | CallReceivedTrigger
  | LeadCreatedTrigger
  | StageChangedTrigger
  | EmailReceivedTrigger
  | AppointmentBookedTrigger;

type Row = {
  id: string;
  name: string;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
  mode: string;
  graph: WorkflowGraph | null;
};

export async function runAutomations(input: AutomationTriggerInput): Promise<void> {
  const supabase = createAdminClient();

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
    const ctxBase = buildCtx(input);
    if (row.mode === 'graph' && row.graph) {
      try {
        await startGraphRun({ automationId: row.id, graph: row.graph, ctx: ctxBase });
      } catch (e) {
        console.error('[automations:graph]', row.name, (e as Error).message);
      }
      continue;
    }

    // Simple mode — fast path. Each action runs independently; per-action
    // failures land in action_log but never abort the rest.
    for (const action of row.actions) {
      try {
        await executeAction(action, ctxBase);
        await logAction({
          brandId: ctxBase.brandId,
          automationId: row.id,
          leadId: ctxBase.leadId,
          triggerType: input.trigger,
          actionKind: action.kind,
          status: 'ok',
        });
      } catch (e) {
        console.error('[automations]', row.name, action.kind, (e as Error).message);
        await logAction({
          brandId: ctxBase.brandId,
          automationId: row.id,
          leadId: ctxBase.leadId,
          triggerType: input.trigger,
          actionKind: action.kind,
          status: 'failed',
          detail: { error: (e as Error).message.slice(0, 240) },
        });
      }
    }
  }
}

// Helper: append a row to action_log without ever throwing. Both modes call
// this; graph mode passes workflowRunId, simple mode leaves it null.
export async function logAction(input: {
  brandId: string;
  automationId: string;
  workflowRunId?: string | null;
  leadId: string | null;
  triggerType: string;
  actionKind: string;
  status: 'ok' | 'skipped' | 'failed';
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from('action_log').insert({
      brand_id: input.brandId,
      automation_id: input.automationId,
      workflow_run_id: input.workflowRunId ?? null,
      lead_id: input.leadId,
      trigger_type: input.triggerType,
      action_kind: input.actionKind,
      status: input.status,
      detail: (input.detail ?? null) as never,
    });
  } catch (e) {
    console.error('[action_log] insert failed', (e as Error).message);
  }
}

function buildCtx(input: AutomationTriggerInput) {
  const base = {
    brandId: input.brandId,
    leadId: 'leadId' in input ? input.leadId : null,
    memberId: 'memberId' in input ? input.memberId : null,
  };
  switch (input.trigger) {
    case 'disposition_set':
      return {
        ...base,
        trigger: {
          kind: input.trigger,
          disposition: input.disposition,
          callbackAt: input.callbackAt,
        },
      };
    case 'call_received':
      return {
        ...base,
        trigger: {
          kind: input.trigger,
          fromNumber: input.fromNumber,
          toNumber: input.toNumber,
          numberId: input.numberId,
        },
      };
    case 'lead_created':
      return {
        ...base,
        trigger: { kind: input.trigger, source: input.source ?? null },
      };
    case 'stage_changed':
      return {
        ...base,
        trigger: {
          kind: input.trigger,
          fromStageId: input.fromStageId,
          toStageId: input.toStageId,
        },
      };
    case 'email_received':
      return {
        ...base,
        trigger: {
          kind: input.trigger,
          threadId: input.threadId,
          messageId: input.messageId,
          fromAddr: input.fromAddr,
          subject: input.subject,
        },
      };
    case 'appointment_booked':
      return {
        ...base,
        trigger: {
          kind: input.trigger,
          appointmentId: input.appointmentId,
          startsAt: input.startsAt,
        },
      };
  }
}

function matches(config: Record<string, unknown>, input: AutomationTriggerInput): boolean {
  if (input.trigger === 'disposition_set') {
    const codes = config.codes;
    if (!Array.isArray(codes) || codes.length === 0) return false;
    return codes.includes(input.disposition);
  }
  if (input.trigger === 'call_received') {
    const numberIds = config.number_ids;
    if (Array.isArray(numberIds) && numberIds.length > 0) {
      return input.numberId !== null && numberIds.includes(input.numberId);
    }
    return true;
  }
  if (input.trigger === 'lead_created') {
    const sources = config.source_in;
    if (Array.isArray(sources) && sources.length > 0) {
      return input.source !== null && sources.includes(input.source);
    }
    return true;
  }
  if (input.trigger === 'stage_changed') {
    const toStages = config.to_stage_in;
    const fromStages = config.from_stage_in;
    if (Array.isArray(toStages) && toStages.length > 0) {
      if (!input.toStageId || !toStages.includes(input.toStageId)) return false;
    }
    if (Array.isArray(fromStages) && fromStages.length > 0) {
      if (!input.fromStageId || !fromStages.includes(input.fromStageId)) return false;
    }
    return true;
  }
  if (input.trigger === 'email_received' || input.trigger === 'appointment_booked') {
    return true;
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
      const supabase = createAdminClient();
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
      await logAction({
        brandId: automation.brandId,
        automationId: automation.id,
        leadId,
        triggerType: 'webhook_received',
        actionKind: action.kind,
        status: 'ok',
      });
    } catch (e) {
      console.error('[webhook]', automation.name, action.kind, (e as Error).message);
      await logAction({
        brandId: automation.brandId,
        automationId: automation.id,
        leadId,
        triggerType: 'webhook_received',
        actionKind: action.kind,
        status: 'failed',
        detail: { error: (e as Error).message.slice(0, 240) },
      });
    }
  }
}
