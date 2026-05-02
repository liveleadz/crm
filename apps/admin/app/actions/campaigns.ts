'use server';

// Server actions for the campaign manager. Manager+ (owner/admin/manager)
// can mutate; agents can read-only via RLS. Each action revalidates the
// pages the campaign affects (list, detail, agent dashboard).

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import type { Database } from '@leadpilot/db';
import { getActiveBrand } from '@/lib/active-brand';
import { getCurrentBrandRole } from '@/lib/team';
import type { CampaignStatus } from '@/lib/campaigns';

type CampaignUpdate = Database['public']['Tables']['campaigns']['Update'];

type ActionResult<T = void> = T extends void
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

async function requireManager() {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const role = await getCurrentBrandRole(active.id);
  if (role !== 'owner' && role !== 'admin' && role !== 'manager') {
    return { ok: false as const, error: 'Forbidden' };
  }
  return { ok: true as const, brandId: active.id };
}

function bump(campaignId?: string) {
  revalidatePath('/campaigns');
  revalidatePath('/dashboard');
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
}

export async function createCampaign(input: {
  name: string;
  description?: string | null;
  scriptId?: string | null;
  calendarId?: string | null;
  defaultOwnerId?: string | null;
  recentlyCalledMinutes?: number;
}): Promise<ActionResult<{ id: string }>> {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required' };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      brand_id: guard.brandId,
      name,
      description: input.description?.trim() || null,
      script_id: input.scriptId ?? null,
      calendar_id: input.calendarId ?? null,
      default_owner_id: input.defaultOwnerId ?? null,
      recently_called_minutes: input.recentlyCalledMinutes ?? 240,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed' };
  bump(data.id);
  return { ok: true, data: { id: data.id } };
}

export async function updateCampaign(input: {
  id: string;
  name?: string;
  description?: string | null;
  status?: CampaignStatus;
  scriptId?: string | null;
  calendarId?: string | null;
  defaultOwnerId?: string | null;
  phonePoolId?: string | null;
  recentlyCalledMinutes?: number;
  tcpaEnabled?: boolean;
  dialWindowStartMin?: number;
  dialWindowEndMin?: number;
  skipWeekends?: boolean;
}): Promise<ActionResult> {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const patch: CampaignUpdate = {};
  if (typeof input.name === 'string') {
    const n = input.name.trim();
    if (!n) return { ok: false, error: 'Name cannot be empty' };
    patch.name = n;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.status) patch.status = input.status;
  if (input.scriptId !== undefined) patch.script_id = input.scriptId;
  if (input.calendarId !== undefined) patch.calendar_id = input.calendarId;
  if (input.defaultOwnerId !== undefined) patch.default_owner_id = input.defaultOwnerId;
  if (input.phonePoolId !== undefined) patch.phone_pool_id = input.phonePoolId;
  if (typeof input.recentlyCalledMinutes === 'number') {
    patch.recently_called_minutes = Math.max(0, Math.floor(input.recentlyCalledMinutes));
  }
  if (input.tcpaEnabled !== undefined) patch.tcpa_enabled = input.tcpaEnabled;
  if (typeof input.dialWindowStartMin === 'number') {
    patch.dial_window_start_min = clampMinute(input.dialWindowStartMin);
  }
  if (typeof input.dialWindowEndMin === 'number') {
    patch.dial_window_end_min = clampMinute(input.dialWindowEndMin);
  }
  if (input.skipWeekends !== undefined) patch.skip_weekends = input.skipWeekends;
  // If both ends were touched, ensure end > start (otherwise the window
  // is empty and every dial would be blocked — the editor should already
  // prevent this but the server is the last line of defense).
  if (
    typeof patch.dial_window_start_min === 'number' &&
    typeof patch.dial_window_end_min === 'number' &&
    patch.dial_window_end_min <= patch.dial_window_start_min
  ) {
    return { ok: false, error: 'Dial window end must be after start.' };
  }
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from('campaigns').update(patch).eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  bump(input.id);
  return { ok: true };
}

function clampMinute(v: number): number {
  return Math.max(0, Math.min(1440, Math.floor(v)));
}

export async function archiveCampaign(input: { id: string }): Promise<ActionResult> {
  return updateCampaign({ id: input.id, status: 'archived' });
}

export async function setCampaignLists(input: {
  campaignId: string;
  listIds: string[];
}): Promise<ActionResult> {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  // Replace the whole set: delete missing + upsert new. Simpler than diffing
  // and the row count is small (handful of lists per campaign).
  const { error: delErr } = await supabase
    .from('campaign_lists')
    .delete()
    .eq('campaign_id', input.campaignId);
  if (delErr) return { ok: false, error: delErr.message };
  if (input.listIds.length > 0) {
    const rows = input.listIds.map((list_id) => ({ campaign_id: input.campaignId, list_id }));
    const { error: insErr } = await supabase.from('campaign_lists').insert(rows);
    if (insErr) return { ok: false, error: insErr.message };
  }
  bump(input.campaignId);
  return { ok: true };
}

export async function setCampaignAgents(input: {
  campaignId: string;
  memberIds: string[];
}): Promise<ActionResult> {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const { error: delErr } = await supabase
    .from('campaign_agents')
    .delete()
    .eq('campaign_id', input.campaignId);
  if (delErr) return { ok: false, error: delErr.message };
  if (input.memberIds.length > 0) {
    const rows = input.memberIds.map((member_id) => ({
      campaign_id: input.campaignId,
      member_id,
    }));
    const { error: insErr } = await supabase.from('campaign_agents').insert(rows);
    if (insErr) return { ok: false, error: insErr.message };
  }
  bump(input.campaignId);
  return { ok: true };
}

export type FollowupInput = {
  // null campaignId = brand default
  campaignId: string | null;
  dispositionId: string;
  enabled: boolean;
  sendEmail: boolean;
  emailSubject?: string | null;
  emailBody?: string | null;
  sendSms: boolean;
  smsBody?: string | null;
  createTask: boolean;
  taskTitle?: string | null;
  taskDueMinutes?: number | null;
};

export async function upsertFollowup(input: FollowupInput): Promise<ActionResult> {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  // Unique partial indexes split brand-default vs campaign-override, so we
  // can't use a single onConflict. Look up existing first, then update or
  // insert.
  let existingId: string | null = null;
  if (input.campaignId) {
    const { data } = await supabase
      .from('disposition_followups')
      .select('id')
      .eq('campaign_id', input.campaignId)
      .eq('disposition_id', input.dispositionId)
      .maybeSingle();
    existingId = data?.id ?? null;
  } else {
    const { data } = await supabase
      .from('disposition_followups')
      .select('id')
      .eq('brand_id', guard.brandId)
      .is('campaign_id', null)
      .eq('disposition_id', input.dispositionId)
      .maybeSingle();
    existingId = data?.id ?? null;
  }
  const row = {
    brand_id: guard.brandId,
    campaign_id: input.campaignId,
    disposition_id: input.dispositionId,
    enabled: input.enabled,
    send_email: input.sendEmail,
    email_subject: input.emailSubject ?? null,
    email_body: input.emailBody ?? null,
    send_sms: input.sendSms,
    sms_body: input.smsBody ?? null,
    create_task: input.createTask,
    task_title: input.taskTitle ?? null,
    task_due_minutes: input.taskDueMinutes ?? null,
  };
  if (existingId) {
    const { error } = await supabase.from('disposition_followups').update(row).eq('id', existingId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from('disposition_followups').insert(row);
    if (error) return { ok: false, error: error.message };
  }
  if (input.campaignId) bump(input.campaignId);
  else revalidatePath('/settings');
  return { ok: true };
}

export async function clearFollowup(input: {
  campaignId: string | null;
  dispositionId: string;
}): Promise<ActionResult> {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  let q = supabase
    .from('disposition_followups')
    .delete()
    .eq('disposition_id', input.dispositionId);
  if (input.campaignId) {
    q = q.eq('campaign_id', input.campaignId);
  } else {
    q = q.eq('brand_id', guard.brandId).is('campaign_id', null);
  }
  const { error } = await q;
  if (error) return { ok: false, error: error.message };
  if (input.campaignId) bump(input.campaignId);
  else revalidatePath('/settings');
  return { ok: true };
}
