'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { APPT_STATUSES, type AppointmentStatus } from '@/lib/appointments';

function isStatus(value: string): value is AppointmentStatus {
  return (APPT_STATUSES as readonly string[]).includes(value);
}

export async function createAppointment(input: {
  leadId: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  notes?: string | null;
  memberId?: string | null;
  status?: AppointmentStatus;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand.' };
  const title = input.title.trim();
  if (!title) return { ok: false as const, error: 'Title is required.' };
  if (!input.startsAt) return { ok: false as const, error: 'Start time is required.' };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated.' };

  // Confirm the lead belongs to the active brand to prevent cross-brand inserts.
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('id', input.leadId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!lead) return { ok: false as const, error: 'Lead not found.' };

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      brand_id: active.id,
      lead_id: input.leadId,
      member_id: input.memberId ?? user.id,
      title,
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      status: input.status ?? 'scheduled',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed.' };

  await supabase.from('lead_events').insert({
    brand_id: active.id,
    lead_id: input.leadId,
    member_id: user.id,
    type: 'appointment_scheduled',
    payload: { appointment_id: data.id, starts_at: input.startsAt, title },
  });

  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  revalidatePath('/leads');
  return { ok: true as const, id: data.id };
}

export async function updateAppointment(input: {
  id: string;
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  location?: string | null;
  notes?: string | null;
  memberId?: string | null;
  status?: AppointmentStatus;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand.' };
  type AppointmentPatch = {
    title?: string;
    starts_at?: string;
    ends_at?: string | null;
    location?: string | null;
    notes?: string | null;
    member_id?: string | null;
    status?: AppointmentStatus;
  };
  const patch: AppointmentPatch = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) return { ok: false as const, error: 'Title is required.' };
    patch.title = t;
  }
  if (input.startsAt !== undefined) patch.starts_at = input.startsAt;
  if (input.endsAt !== undefined) patch.ends_at = input.endsAt;
  if (input.location !== undefined) patch.location = input.location?.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.memberId !== undefined) patch.member_id = input.memberId;
  if (input.status !== undefined) {
    if (!isStatus(input.status)) return { ok: false as const, error: 'Invalid status.' };
    patch.status = input.status;
  }
  if (Object.keys(patch).length === 0) return { ok: true as const };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('appointments')
    .update(patch)
    .eq('id', input.id)
    .eq('brand_id', active.id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  revalidatePath('/leads');
  return { ok: true as const };
}

export async function setAppointmentStatus(input: {
  id: string;
  status: AppointmentStatus;
}) {
  return updateAppointment({ id: input.id, status: input.status });
}

export async function deleteAppointment(input: { id: string }) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', input.id)
    .eq('brand_id', active.id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  revalidatePath('/leads');
  return { ok: true as const };
}
