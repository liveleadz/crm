'use server';

// CRUD actions for per-brand automations. Owner/admin only — RLS enforces
// at the database layer; we still gate `getActiveBrand()` so we never
// operate on the wrong brand.

import { revalidatePath } from 'next/cache';
import { getActiveBrand } from '@/lib/active-brand';
import { createServerClient } from '@leadpilot/db/server';
import type { Json } from '@leadpilot/db/types';
import type { AutomationAction, AutomationMode, WorkflowGraph } from '@/lib/automations';
import { linearizeGraph } from '@/lib/automations';

type Result = { ok: true; id?: string } | { ok: false; error: string };

const KNOWN_ACTION_KINDS = new Set([
  'move_stage',
  'mark_dnc',
  'add_tag',
  'create_task',
  'send_email',
  'send_sms',
  'send_notification',
  'http_request',
  'update_lead_field',
]);

function validateActions(actions: unknown): actions is AutomationAction[] {
  if (!Array.isArray(actions)) return false;
  return actions.every((a) => {
    if (!a || typeof a !== 'object') return false;
    const k = (a as { kind?: unknown }).kind;
    return typeof k === 'string' && KNOWN_ACTION_KINDS.has(k);
  });
}

function generateWebhookToken(): string {
  // 32-char hex; collision rate is negligible. We index unique partial in
  // SQL to prevent any pathological collision at insert time.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createAutomation(input: {
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actions: AutomationAction[];
}): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!validateActions(input.actions)) return { ok: false, error: 'Invalid actions.' };
  if (input.actions.length === 0) return { ok: false, error: 'Add at least one action.' };

  const supabase = await createServerClient();
  const { data: maxRow } = await supabase
    .from('automations')
    .select('sort_order')
    .eq('brand_id', active.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 10;

  const { data, error } = await supabase
    .from('automations')
    .insert({
      brand_id: active.id,
      name,
      description: input.description?.trim() || null,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig as unknown as Json,
      actions: input.actions as unknown as Json,
      sort_order: nextSort,
      webhook_token: input.triggerType === 'webhook_received' ? generateWebhookToken() : null,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath('/workflows');
  return { ok: true, id: data.id };
}

export async function updateAutomation(input: {
  id: string;
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actions: AutomationAction[];
}): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!validateActions(input.actions)) return { ok: false, error: 'Invalid actions.' };
  if (input.actions.length === 0) return { ok: false, error: 'Add at least one action.' };

  const supabase = await createServerClient();
  // Generate a token on first switch into webhook_received if the row doesn't
  // already have one. We don't drop the token when switching back so the URL
  // can be reused if the user toggles trigger types.
  let webhookTokenPatch: { webhook_token: string } | undefined;
  if (input.triggerType === 'webhook_received') {
    const { data: row } = await supabase
      .from('automations')
      .select('webhook_token')
      .eq('id', input.id)
      .maybeSingle();
    if (!row?.webhook_token) {
      webhookTokenPatch = { webhook_token: generateWebhookToken() };
    }
  }
  const { error } = await supabase
    .from('automations')
    .update({
      name,
      description: input.description?.trim() || null,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig as unknown as Json,
      actions: input.actions as unknown as Json,
      ...(webhookTokenPatch ?? {}),
    })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  revalidatePath(`/workflows/${input.id}`);
  return { ok: true };
}

export async function regenerateWebhookToken(input: { id: string }): Promise<Result> {
  const supabase = await createServerClient();
  const token = generateWebhookToken();
  const { error } = await supabase
    .from('automations')
    .update({ webhook_token: token })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/workflows/${input.id}`);
  return { ok: true };
}

export async function setAutomationEnabled(input: {
  id: string;
  enabled: boolean;
}): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('automations')
    .update({ is_enabled: input.enabled })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true };
}

export async function deleteAutomation(input: { id: string }): Promise<Result> {
  const supabase = await createServerClient();
  // System automations are deletable too — they're seeded once and managers
  // can prune anything they don't want. The is_system flag is informational
  // (drives the "default" badge in the UI).
  const { error } = await supabase.from('automations').delete().eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Graph mode
// ---------------------------------------------------------------------------

function validateGraph(graph: unknown): graph is WorkflowGraph {
  if (!graph || typeof graph !== 'object') return false;
  const g = graph as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return false;
  // Must have exactly one trigger.
  const triggers = g.nodes.filter(
    (n) => n && typeof n === 'object' && (n as { type?: unknown }).type === 'trigger',
  );
  if (triggers.length !== 1) return false;
  const ids = new Set(g.nodes.map((n) => (n as { id: string }).id));
  for (const e of g.edges) {
    if (!e || typeof e !== 'object') return false;
    const edge = e as { source?: string; target?: string };
    if (!edge.source || !edge.target) return false;
    if (!ids.has(edge.source) || !ids.has(edge.target)) return false;
  }
  return true;
}

export async function saveAutomationGraph(input: {
  id: string;
  graph: WorkflowGraph;
}): Promise<Result> {
  if (!validateGraph(input.graph)) return { ok: false, error: 'Invalid graph.' };

  // Linearize the graph into actions[] for back-compat readouts. If the graph
  // has branches/waits the trail stops at the first one — that's fine, the
  // list view shows a "Visual" badge for graph-mode rules anyway.
  const flat = linearizeGraph(input.graph);

  // Mirror the trigger node's type onto automations.trigger_type so the
  // dispatcher's index-based filter (brand_id, trigger_type) remains accurate.
  const triggerNode = input.graph.nodes.find((n) => n.type === 'trigger');
  const triggerType =
    triggerNode && triggerNode.type === 'trigger' ? triggerNode.data.trigger_type : null;
  const triggerConfig =
    triggerNode && triggerNode.type === 'trigger' ? triggerNode.data.trigger_config : null;

  const supabase = await createServerClient();

  // If the trigger is webhook_received and the row doesn't have a token yet,
  // mint one as part of the same write so the URL is available immediately.
  let webhookTokenPatch: { webhook_token: string } | undefined;
  if (triggerType === 'webhook_received') {
    const { data: row } = await supabase
      .from('automations')
      .select('webhook_token')
      .eq('id', input.id)
      .maybeSingle();
    if (!row?.webhook_token) {
      webhookTokenPatch = { webhook_token: generateWebhookToken() };
    }
  }

  const { error } = await supabase
    .from('automations')
    .update({
      mode: 'graph',
      graph: input.graph as unknown as Json,
      actions: flat as unknown as Json,
      ...(triggerType ? { trigger_type: triggerType } : {}),
      ...(triggerConfig ? { trigger_config: triggerConfig as unknown as Json } : {}),
      ...(webhookTokenPatch ?? {}),
    })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  revalidatePath(`/workflows/${input.id}`);
  return { ok: true };
}

export async function setAutomationMode(input: {
  id: string;
  mode: AutomationMode;
}): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('automations')
    .update({ mode: input.mode })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  revalidatePath(`/workflows/${input.id}`);
  return { ok: true };
}

export async function renameAutomation(input: { id: string; name: string }): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  const supabase = await createServerClient();
  const { error } = await supabase.from('automations').update({ name }).eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true };
}

export async function reorderAutomations(input: { ids: string[] }): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const supabase = await createServerClient();
  for (let i = 0; i < input.ids.length; i++) {
    const id = input.ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from('automations')
      .update({ sort_order: (i + 1) * 10 })
      .eq('id', id)
      .eq('brand_id', active.id);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/workflows');
  return { ok: true };
}
