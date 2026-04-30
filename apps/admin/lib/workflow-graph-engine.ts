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
  WaitNodeData,
  WorkflowGraph,
} from './automation-types';
import { buildVars, renderTemplate, type TemplateVars } from './automation-templates';

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
  // Optional payload from incoming webhook triggers; available to templates
  // as {{webhook.body.<json-path>}}.
  webhook?: {
    body?: unknown;
    headers?: Record<string, string>;
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
      const due = resolveWaitUntil(node.data, ctx);
      // Skip the suspend hop entirely if the resolved wait has already
      // elapsed (e.g. callback_at is in the past) — keeps things responsive.
      if (due.getTime() <= Date.now()) {
        const next: GraphEdge | null = nextEdge(graph, node.id, null);
        cursor = next ? next.target : null;
        continue;
      }
      await supabase
        .from('workflow_runs')
        .update({ status: 'waiting', next_run_at: due.toISOString(), current_node_id: node.id })
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
  const supabase = await createServerClient();

  // Lead-bound actions silently no-op when there's no lead (e.g. webhook
  // trigger that didn't resolve to a lead). The "lead-free" actions —
  // send_notification with role broadcast, http_request — fall through.
  const leadBound = new Set([
    'move_stage',
    'mark_dnc',
    'add_tag',
    'create_task',
    'update_lead_field',
  ]);
  if (leadBound.has(action.kind) && !ctx.leadId) return;

  // Build template vars once per action; reused by send_email/sms/notif/http
  // and update_lead_field. Reads fresh lead so updates ripple between steps.
  const vars = await buildActionVars(ctx);

  switch (action.kind) {
    case 'move_stage': {
      await supabase.from('leads').update({ stage_id: action.stage_id }).eq('id', ctx.leadId!);
      return;
    }
    case 'mark_dnc': {
      await supabase.from('leads').update({ do_not_call: true }).eq('id', ctx.leadId!);
      return;
    }
    case 'add_tag': {
      await supabase
        .from('lead_tags')
        .upsert(
          { lead_id: ctx.leadId!, tag_id: action.tag_id },
          { onConflict: 'lead_id,tag_id', ignoreDuplicates: true },
        );
      return;
    }
    case 'create_task': {
      const dueAt = resolveDueAt(action, ctx);
      await supabase.from('tasks').insert({
        brand_id: ctx.brandId,
        lead_id: ctx.leadId!,
        assignee_id: action.assign_to_caller ? ctx.memberId : null,
        title: renderTemplate(action.title, vars),
        kind: action.task_kind ?? 'other',
        due_at: dueAt,
      });
      return;
    }

    case 'send_email': {
      const lead = vars.lead as Record<string, string>;
      const to =
        action.to === 'literal' ? renderTemplate(action.literal_to ?? '', vars) : (lead.email ?? '');
      if (!to) {
        await supabase.from('message_outbox').insert({
          brand_id: ctx.brandId,
          lead_id: ctx.leadId,
          channel: 'email',
          to_addr: '(missing)',
          subject: renderTemplate(action.subject, vars),
          body: renderTemplate(action.body, vars),
          status: 'skipped',
          error: 'no recipient resolved',
        });
        return;
      }
      await supabase.from('message_outbox').insert({
        brand_id: ctx.brandId,
        lead_id: ctx.leadId,
        channel: 'email',
        to_addr: to,
        subject: renderTemplate(action.subject, vars),
        body: renderTemplate(action.body, vars),
        status: 'queued',
      });
      return;
    }

    case 'send_sms': {
      const lead = vars.lead as Record<string, string>;
      const to =
        action.to === 'literal' ? renderTemplate(action.literal_to ?? '', vars) : (lead.phone ?? '');
      if (!to) {
        await supabase.from('message_outbox').insert({
          brand_id: ctx.brandId,
          lead_id: ctx.leadId,
          channel: 'sms',
          to_addr: '(missing)',
          body: renderTemplate(action.body, vars),
          status: 'skipped',
          error: 'no recipient resolved',
        });
        return;
      }
      await supabase.from('message_outbox').insert({
        brand_id: ctx.brandId,
        lead_id: ctx.leadId,
        channel: 'sms',
        to_addr: to,
        body: renderTemplate(action.body, vars),
        status: 'queued',
      });
      return;
    }

    case 'send_notification': {
      // Resolve to a recipient_member_id OR a recipient_role broadcast row.
      let recipient_member_id: string | null = null;
      let recipient_role: string | null = null;
      if (action.recipient_kind === 'caller') recipient_member_id = ctx.memberId;
      else if (action.recipient_kind === 'lead_owner' && ctx.leadId) {
        const { data: lead } = await supabase
          .from('leads')
          .select('owner_id')
          .eq('id', ctx.leadId)
          .maybeSingle();
        recipient_member_id = lead?.owner_id ?? null;
      } else if (action.recipient_kind === 'role') {
        recipient_role = action.role ?? null;
      } else if (action.recipient_kind === 'member') {
        recipient_member_id = action.member_id ?? null;
      }
      if (!recipient_member_id && !recipient_role) return; // nothing to deliver to
      await supabase.from('notifications').insert({
        brand_id: ctx.brandId,
        recipient_member_id,
        recipient_role: recipient_role as
          | 'owner'
          | 'admin'
          | 'manager'
          | 'agent'
          | 'viewer'
          | null,
        kind: 'workflow',
        title: renderTemplate(action.title, vars),
        body: action.body ? renderTemplate(action.body, vars) : null,
        link_url: action.link_url ? renderTemplate(action.link_url, vars) : null,
        data: { lead_id: ctx.leadId },
      });
      return;
    }

    case 'http_request': {
      const url = renderTemplate(action.url, vars);
      if (!isAllowedUrl(url)) {
        console.warn('[graph-engine] blocked http_request to', url);
        return;
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      for (const h of action.headers ?? []) {
        if (h.key) headers[h.key] = renderTemplate(h.value, vars);
      }
      const renderedBody = action.body_template
        ? renderTemplate(action.body_template, vars)
        : undefined;
      await fetchWithRetry(action.method, url, headers, renderedBody);
      return;
    }

    case 'update_lead_field': {
      const value = renderTemplate(action.value, vars);
      if (action.field.startsWith('custom.')) {
        const key = action.field.slice('custom.'.length);
        if (!key) return;
        // Merge into existing custom jsonb without dropping siblings.
        const { data: lead } = await supabase
          .from('leads')
          .select('custom')
          .eq('id', ctx.leadId!)
          .maybeSingle();
        const merged = {
          ...((lead?.custom as Record<string, unknown>) ?? {}),
          [key]: value,
        };
        await supabase
          .from('leads')
          .update({ custom: merged as unknown as never })
          .eq('id', ctx.leadId!);
        return;
      }
      // Whitelist scalar fields. Anything else is silently rejected so the
      // engine can't be coerced into modifying ownership/RLS columns. The
      // dynamic key is a TS challenge for Supabase's typed update; cast to
      // an opaque shape since the runtime is fine.
      const ALLOWED = new Set(['first_name', 'last_name', 'email', 'phone', 'notes']);
      if (!ALLOWED.has(action.field)) return;
      const patch: Record<string, string> = { [action.field]: value };
      await supabase
        .from('leads')
        .update(patch as unknown as never)
        .eq('id', ctx.leadId!);
      return;
    }
  }
}

// Builds the template variable bag using a fresh read of the lead. Engine-only
// helper; keeps action handlers tiny.
async function buildActionVars(ctx: GraphRunContext): Promise<TemplateVars> {
  const supabase = await createServerClient();
  let lead: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    stage_id?: string | null;
  } | null = null;
  let stageName: string | null = null;
  if (ctx.leadId) {
    const { data } = await supabase
      .from('leads')
      .select('first_name, last_name, email, phone, stage_id')
      .eq('id', ctx.leadId)
      .maybeSingle();
    lead = data;
    if (data?.stage_id) {
      const { data: s } = await supabase
        .from('stages')
        .select('name')
        .eq('id', data.stage_id)
        .maybeSingle();
      stageName = s?.name ?? null;
    }
  }
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name')
    .eq('id', ctx.brandId)
    .maybeSingle();

  return buildVars({
    lead: {
      first_name: lead?.first_name ?? null,
      last_name: lead?.last_name ?? null,
      full_name: [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || null,
      email: lead?.email ?? null,
      phone: lead?.phone ?? null,
      stage: stageName,
    },
    brand: { id: brand?.id ?? ctx.brandId, name: brand?.name ?? null },
    trigger: {
      kind: ctx.trigger.kind,
      disposition: ctx.trigger.disposition ?? null,
      callback_at: ctx.trigger.callbackAt ?? null,
    },
    webhook: ctx.webhook ?? {},
  });
}

// Block obvious SSRF targets. Cheap textual check; production-safe enough for
// the v1 webhook action since users self-author their workflows.
function isAllowedUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0') return false;
    if (host.endsWith('.local')) return false;
    if (
      host.startsWith('10.') ||
      host.startsWith('127.') ||
      host.startsWith('169.254.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchWithRetry(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body && method !== 'GET' ? body : undefined,
        signal: AbortSignal.timeout(5_000),
      });
      // Retry once on 5xx; success or 4xx terminates immediately.
      if (res.status >= 500 && attempt === 0) continue;
      return;
    } catch (e) {
      if (attempt === 1) {
        console.warn('[graph-engine] http_request failed', url, (e as Error).message);
        return;
      }
    }
  }
}

function resolveWaitUntil(data: WaitNodeData, ctx: GraphRunContext): Date {
  const mode = (data as { mode?: string }).mode ?? 'fixed_minutes';
  if (mode === 'until_callback_time') {
    const at = ctx.trigger.callbackAt;
    return at ? new Date(at) : new Date();
  }
  if (mode === 'until_datetime') {
    const iso = (data as { iso_at?: string }).iso_at;
    if (!iso) return new Date();
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (mode === 'business_days') {
    const days = Math.max(0, (data as { days?: number }).days ?? 0);
    return addBusinessDays(new Date(), days);
  }
  // fixed_minutes (default)
  const minutes = Math.max(0, (data as { duration_minutes?: number }).duration_minutes ?? 0);
  return new Date(Date.now() + minutes * 60_000);
}

// Naive business-day adder: skips Sat/Sun, lands at 9am UTC of the target
// day. Brand timezone awareness can be added later (brands.timezone column).
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  d.setUTCHours(13, 0, 0, 0); // ~9am Eastern in winter; close enough for v1
  return d;
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
