'use server';

// CRUD actions for per-brand automations. Owner/admin only — RLS
// enforces at the DB layer (migration 0013); this layer adds explicit
// role checks so we surface a clean "Forbidden" instead of an empty
// affected-rows result, and adds brand_id filters so a stray id can't
// mutate cross-brand.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@leadpilot/db/server';
import { requireBrandRole } from '@/lib/team';
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
  'create_contact',
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
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!validateActions(input.actions)) return { ok: false, error: 'Invalid actions.' };
  if (input.actions.length === 0) return { ok: false, error: 'Add at least one action.' };

  const supabase = await createServerClient();
  const { data: maxRow } = await supabase
    .from('automations')
    .select('sort_order')
    .eq('brand_id', guard.brandId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 10;

  const { data, error } = await supabase
    .from('automations')
    .insert({
      brand_id: guard.brandId,
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

// Canvas-first creation. Drops the row immediately with a *truly empty*
// graph (no trigger node yet) and redirects server-side to the editor.
// The redirect saves the client-side router round-trip — the response
// arrives already pointed at the new workflow, which makes the click feel
// instant. Trigger picking happens inside the canvas via "+ Add first
// step".
export async function createBlankAutomation(input?: {
  triggerType?: string;
}): Promise<Result | never> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;

  // The placeholder trigger_type just keeps the dispatcher's index-based
  // filter sane until the user picks one in the canvas. The matches() call
  // returns false on empty config, so the row never fires until configured.
  const triggerType = input?.triggerType ?? 'disposition_set';

  const supabase = await createServerClient();
  const { data: maxRow } = await supabase
    .from('automations')
    .select('sort_order')
    .eq('brand_id', guard.brandId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 10;

  // Truly empty graph — no trigger node. The canvas starts blank with a
  // single "+ Add first step" pill; that picker is where the trigger gets
  // chosen.
  const blankGraph: WorkflowGraph = { nodes: [], edges: [] };

  const { data, error } = await supabase
    .from('automations')
    .insert({
      brand_id: guard.brandId,
      name: 'Untitled workflow',
      description: null,
      trigger_type: triggerType,
      trigger_config: {} as unknown as Json,
      actions: [] as unknown as Json,
      sort_order: nextSort,
      mode: 'graph',
      graph: blankGraph as unknown as Json,
      webhook_token: triggerType === 'webhook_received' ? generateWebhookToken() : null,
      is_enabled: false, // start disabled — author has nothing wired up yet
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };

  revalidatePath('/workflows');
  // Server-side redirect — Next.js converts this into a navigation in the
  // server-action response so the browser doesn't have to do a separate
  // router.push round trip. Result: button feels instant.
  redirect(`/workflows/${data.id}`);
}

export async function updateAutomation(input: {
  id: string;
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actions: AutomationAction[];
}): Promise<Result> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;

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
      .eq('brand_id', guard.brandId)
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
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  revalidatePath(`/workflows/${input.id}`);
  return { ok: true };
}

export async function regenerateWebhookToken(input: { id: string }): Promise<Result> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const token = generateWebhookToken();
  const { error } = await supabase
    .from('automations')
    .update({ webhook_token: token })
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/workflows/${input.id}`);
  return { ok: true };
}

export async function setAutomationEnabled(input: {
  id: string;
  enabled: boolean;
}): Promise<Result> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('automations')
    .update({ is_enabled: input.enabled })
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true };
}

export async function deleteAutomation(input: { id: string }): Promise<Result> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  // System automations are deletable too — they're seeded once and managers
  // can prune anything they don't want. The is_system flag is informational
  // (drives the "default" badge in the UI).
  const { error } = await supabase
    .from('automations')
    .delete()
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
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
  // Empty graph is valid — represents a brand-new workflow that hasn't
  // chosen a trigger yet. Once any nodes exist, at most one of them may
  // be a trigger.
  const triggers = g.nodes.filter(
    (n) => n && typeof n === 'object' && (n as { type?: unknown }).type === 'trigger',
  );
  if (triggers.length > 1) return false;
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
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;
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
      .eq('brand_id', guard.brandId)
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
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  revalidatePath(`/workflows/${input.id}`);
  return { ok: true };
}

export async function setAutomationMode(input: {
  id: string;
  mode: AutomationMode;
}): Promise<Result> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('automations')
    .update({ mode: input.mode })
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  revalidatePath(`/workflows/${input.id}`);
  return { ok: true };
}

export async function renameAutomation(input: { id: string; name: string }): Promise<Result> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('automations')
    .update({ name })
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

type BulkResult = { ok: true; count: number } | { ok: false; error: string };

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export async function bulkDeleteAutomations(input: { ids: string[] }): Promise<BulkResult> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('automations')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true, count: count ?? 0 };
}

export async function bulkSetAutomationsEnabled(input: {
  ids: string[];
  enabled: boolean;
}): Promise<BulkResult> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('automations')
    .update({ is_enabled: input.enabled }, { count: 'exact' })
    .in('id', ids)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true, count: count ?? 0 };
}

export async function reorderAutomations(input: { ids: string[] }): Promise<Result> {
  const guard = await requireBrandRole('admin');
  if (!guard.ok) return guard;

  const supabase = await createServerClient();
  for (let i = 0; i < input.ids.length; i++) {
    const id = input.ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from('automations')
      .update({ sort_order: (i + 1) * 10 })
      .eq('id', id)
      .eq('brand_id', guard.brandId);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/workflows');
  return { ok: true };
}
