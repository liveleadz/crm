'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { getActiveBrand } from '@/lib/active-brand';
import { canManageTeam, getCurrentBrandRole } from '@/lib/team';
import { listMyCalendars as listGoogleCalendars } from '@/lib/calendar/google';

async function requireManager() {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const role = await getCurrentBrandRole(active.id);
  if (!canManageTeam(role)) return { ok: false as const, error: 'Forbidden' };
  return { ok: true as const, brandId: active.id };
}

function bump() {
  revalidatePath('/settings/calendars');
  revalidatePath('/calendar');
}

export async function createCalendar(input: {
  name: string;
  color?: string | null;
  ownerMemberId?: string | null;
  defaultDurationMin?: number;
}) {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: 'Name is required' };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('calendars')
    .insert({
      brand_id: guard.brandId,
      name,
      color: input.color?.trim() || null,
      owner_member_id: input.ownerMemberId ?? null,
      default_duration_min: input.defaultDurationMin ?? 30,
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'Insert failed' };
  }
  // Owner is implicitly a booker.
  if (input.ownerMemberId) {
    await supabase.from('calendar_members').upsert(
      {
        calendar_id: data.id,
        member_id: input.ownerMemberId,
        can_book: true,
        is_owner: true,
      },
      { onConflict: 'calendar_id,member_id' },
    );
  }
  bump();
  return { ok: true as const, id: data.id };
}

export async function updateCalendar(input: {
  id: string;
  name?: string;
  color?: string | null;
  ownerMemberId?: string | null;
  defaultDurationMin?: number;
  isActive?: boolean;
}) {
  const guard = await requireManager();
  if (!guard.ok) return guard;

  type Patch = {
    name?: string;
    color?: string | null;
    owner_member_id?: string | null;
    default_duration_min?: number;
    is_active?: boolean;
  };
  const patch: Patch = {};
  if (input.name !== undefined) {
    const t = input.name.trim();
    if (!t) return { ok: false as const, error: 'Name is required' };
    patch.name = t;
  }
  if (input.color !== undefined) patch.color = input.color?.trim() || null;
  if (input.ownerMemberId !== undefined) patch.owner_member_id = input.ownerMemberId;
  if (input.defaultDurationMin !== undefined) patch.default_duration_min = input.defaultDurationMin;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (Object.keys(patch).length === 0) return { ok: true as const };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('calendars')
    .update(patch)
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}

export async function deleteCalendar(input: { id: string }) {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('calendars')
    .delete()
    .eq('id', input.id)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}

// Replaces the full calendar_members assignment set in one transaction-ish op.
// The owner row is preserved by the action even if not present in memberIds.
export async function setCalendarMembers(input: { id: string; memberIds: string[] }) {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const { data: cal } = await supabase
    .from('calendars')
    .select('id, owner_member_id')
    .eq('id', input.id)
    .eq('brand_id', guard.brandId)
    .maybeSingle();
  if (!cal) return { ok: false as const, error: 'Calendar not found' };

  const desired = new Set(input.memberIds);
  if (cal.owner_member_id) desired.add(cal.owner_member_id);

  const { data: existing } = await supabase
    .from('calendar_members')
    .select('member_id')
    .eq('calendar_id', input.id);
  const existingIds = new Set((existing ?? []).map((r) => r.member_id));

  const toAdd = [...desired].filter((m) => !existingIds.has(m));
  const toRemove = [...existingIds].filter((m) => !desired.has(m));

  if (toAdd.length > 0) {
    const rows = toAdd.map((memberId) => ({
      calendar_id: input.id,
      member_id: memberId,
      can_book: true,
      is_owner: memberId === cal.owner_member_id,
    }));
    const { error } = await supabase.from('calendar_members').insert(rows);
    if (error) return { ok: false as const, error: error.message };
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('calendar_members')
      .delete()
      .eq('calendar_id', input.id)
      .in('member_id', toRemove);
    if (error) return { ok: false as const, error: error.message };
  }

  bump();
  return { ok: true as const };
}

// Lists external calendars the calendar's owner has access to. Used by the
// bind picker. Manager+ only because the calendar resource is brand-owned.
export async function listOwnerExternalCalendars(input: { calendarId: string }) {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const { data: cal } = await supabase
    .from('calendars')
    .select('id, owner_member_id')
    .eq('id', input.calendarId)
    .eq('brand_id', guard.brandId)
    .maybeSingle();
  if (!cal?.owner_member_id) return { ok: false as const, error: 'Calendar has no owner' };

  const admin = createAdminClient();
  const { data: m } = await admin
    .from('members')
    .select('email_provider, oauth_scopes')
    .eq('id', cal.owner_member_id)
    .maybeSingle();
  if (!m?.email_provider || !(m.oauth_scopes ?? []).includes('calendar')) {
    return { ok: false as const, error: 'Owner has not connected a calendar provider' };
  }

  if (m.email_provider !== 'google') {
    return { ok: false as const, error: `Unsupported provider: ${m.email_provider}` };
  }
  try {
    const items = await listGoogleCalendars(cal.owner_member_id);
    return {
      ok: true as const,
      provider: 'google' as const,
      items: items.map((i) => ({ id: i.id, name: i.summary, primary: !!i.primary })),
    };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

export async function bindCalendarToProvider(input: {
  calendarId: string;
  provider: 'google';
  extCalendarId: string;
}) {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  if (!input.extCalendarId.trim()) {
    return { ok: false as const, error: 'External calendar id required' };
  }
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('calendars')
    .update({
      ext_provider: input.provider,
      ext_calendar_id: input.extCalendarId,
      ext_sync_token: null,
      ext_last_sync_at: null,
    })
    .eq('id', input.calendarId)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}

export async function unbindCalendar(input: { calendarId: string }) {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('calendars')
    .update({
      ext_provider: null,
      ext_calendar_id: null,
      ext_sync_token: null,
      ext_last_sync_at: null,
    })
    .eq('id', input.calendarId)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}
