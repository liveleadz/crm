'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { loadLeadDetail } from '@/lib/leads';
import { applyMapping, type FieldMapping } from '@/lib/leads-import';

export async function createLead(input: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  stageId?: string | null;
  notes?: string | null;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };

  const firstName = input.firstName?.trim() || null;
  const lastName = input.lastName?.trim() || null;
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim() || null;
  if (!firstName && !lastName && !phone && !email) {
    return { ok: false as const, error: 'Provide at least a name, phone, or email.' };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('leads')
    .insert({
      brand_id: active.id,
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      zip: input.zip?.trim() || null,
      stage_id: input.stageId ?? null,
      notes: input.notes?.trim() || null,
      source: 'manual',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed' };

  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true as const, leadId: data.id };
}

// Quick "Create contact" flow from /calls. Pulls phone + best-effort
// name fields from the call row, creates a lead, and stamps the lead_id
// back onto the call so the row jumps from "Unknown" to the new contact.
export async function createLeadFromCall(input: { callId: string }): Promise<
  | { ok: true; leadId: string }
  | { ok: false; error: string }
> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { data: call } = await supabase
    .from('calls')
    .select('id, brand_id, direction, from_number, to_number, lead_id')
    .eq('id', input.callId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!call) return { ok: false, error: 'Call not found.' };
  if (call.lead_id) {
    return { ok: false, error: 'Call already linked to a lead.' };
  }
  // Use the OTHER side of the call as the lead's phone — for inbound the
  // caller is the lead; for outbound the dialed number is the lead.
  const leadPhone =
    call.direction === 'inbound' ? call.from_number : call.to_number;
  if (!leadPhone) return { ok: false, error: 'No phone on call to create from.' };

  const { data: lead, error: insertErr } = await supabase
    .from('leads')
    .insert({
      brand_id: active.id,
      phone: leadPhone,
      source: 'manual',
    })
    .select('id')
    .single();
  if (insertErr || !lead) {
    return { ok: false, error: insertErr?.message ?? 'Could not create lead.' };
  }

  // Backfill the call row + any earlier calls from the same number so the
  // contact's history is complete from the start.
  await supabase
    .from('calls')
    .update({ lead_id: lead.id })
    .eq('brand_id', active.id)
    .or(`from_number.eq.${leadPhone},to_number.eq.${leadPhone}`)
    .is('lead_id', null);

  revalidatePath('/calls');
  revalidatePath('/leads');
  return { ok: true, leadId: lead.id };
}

export async function moveLeadStage(leadId: string, stageId: string) {
  const supabase = await createServerClient();
  // RLS scopes the update; if the user can't access the lead the row count is 0.
  const { error } = await supabase
    .from('leads')
    .update({ stage_id: stageId, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true as const };
}

export async function getLeadDetail(leadId: string) {
  const active = await getActiveBrand();
  if (!active) return null;
  return loadLeadDetail(leadId, active.id);
}

export async function updateLeadNotes(leadId: string, notes: string) {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('leads')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  return { ok: true as const };
}

export type CallDirection = 'outbound' | 'inbound';
export type CallDisposition =
  | 'connected'
  | 'voicemail'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'wrong_number'
  | 'do_not_call'
  | 'callback'
  | 'sale'
  | 'not_interested';

export async function logCall(input: {
  leadId: string;
  direction: CallDirection;
  disposition: CallDisposition;
  durationSec?: number | null;
  notes?: string | null;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  // Fetch lead phone to use as the counterparty number for manual logs.
  const { data: lead } = await supabase
    .from('leads')
    .select('phone')
    .eq('id', input.leadId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!lead) return { ok: false as const, error: 'Lead not found' };

  const leadNumber = lead.phone ?? 'manual';
  const startedAt = new Date();
  const endedAt =
    input.durationSec && input.durationSec > 0
      ? new Date(startedAt.getTime() + input.durationSec * 1000).toISOString()
      : null;

  const { data: call, error } = await supabase
    .from('calls')
    .insert({
      brand_id: active.id,
      lead_id: input.leadId,
      member_id: user.id,
      direction: input.direction,
      disposition: input.disposition,
      duration_sec: input.durationSec ?? null,
      from_number: input.direction === 'outbound' ? 'manual' : leadNumber,
      to_number: input.direction === 'outbound' ? leadNumber : 'manual',
      started_at: startedAt.toISOString(),
      ended_at: endedAt,
      transcript: input.notes ?? null,
    })
    .select('id')
    .single();
  if (error || !call) return { ok: false as const, error: error?.message ?? 'Insert failed' };

  await supabase.from('lead_events').insert({
    brand_id: active.id,
    lead_id: input.leadId,
    member_id: user.id,
    type: 'call_logged',
    payload: {
      call_id: call.id,
      direction: input.direction,
      disposition: input.disposition,
      duration_sec: input.durationSec ?? null,
    },
  });

  await supabase
    .from('leads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.leadId);

  revalidatePath('/leads');
  revalidatePath('/dashboard');
  revalidatePath('/calls');
  return { ok: true as const, callId: call.id };
}

// Bulk import. Rows are pre-parsed CSV objects keyed by original headers.
// Mapping decides where each header goes (lead column / custom JSON / skip).
// Server-side dedup: skip rows whose normalized phone OR email already exists
// in this brand (caller can override with skipDedup=true).
export async function importLeads(input: {
  rows: Record<string, string>[];
  mapping: FieldMapping;
  stageId: string | null;
  listName: string;
  skipDedup?: boolean;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const listName = input.listName.trim();
  if (!listName) return { ok: false as const, error: 'List name is required' };

  const mapped = input.rows.map((r) => applyMapping(r, input.mapping));
  const valid = mapped.filter((m) => m.errors.length === 0);
  const invalidCount = mapped.length - valid.length;

  if (valid.length === 0) {
    return {
      ok: false as const,
      error: `No valid rows out of ${mapped.length}. Check field mapping and row data.`,
    };
  }

  // Dedup against existing leads in this brand.
  let skippedDuplicate = 0;
  let toInsert = valid;
  if (!input.skipDedup) {
    const phones = valid.map((v) => v.phone).filter((p): p is string => !!p);
    const emails = valid.map((v) => v.email).filter((e): e is string => !!e);

    const existing = new Set<string>();
    if (phones.length > 0) {
      const { data } = await supabase
        .from('leads')
        .select('phone')
        .eq('brand_id', active.id)
        .in('phone', phones);
      data?.forEach((d) => d.phone && existing.add(`p:${d.phone}`));
    }
    if (emails.length > 0) {
      const { data } = await supabase
        .from('leads')
        .select('email')
        .eq('brand_id', active.id)
        .in('email', emails);
      data?.forEach((d) => d.email && existing.add(`e:${d.email}`));
    }

    toInsert = valid.filter((v) => {
      const dupPhone = v.phone && existing.has(`p:${v.phone}`);
      const dupEmail = v.email && existing.has(`e:${v.email}`);
      if (dupPhone || dupEmail) {
        skippedDuplicate += 1;
        return false;
      }
      return true;
    });
  }

  if (toInsert.length === 0) {
    return {
      ok: true as const,
      inserted: 0,
      listId: null,
      invalid: invalidCount,
      skippedDuplicate,
      errors: mapped.flatMap((m) => (m.errors[0] ? [m.errors[0]] : [])).slice(0, 50),
    };
  }

  // Create the list row first so we can stamp list_id on every inserted lead.
  // Disambiguate name if it collides with an existing list for this brand.
  let finalName = listName;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data: clash } = await supabase
      .from('lead_lists')
      .select('id')
      .eq('brand_id', active.id)
      .ilike('name', finalName)
      .maybeSingle();
    if (!clash) break;
    finalName = `${listName} (${attempt + 2})`;
  }

  const { data: list, error: listErr } = await supabase
    .from('lead_lists')
    .insert({
      brand_id: active.id,
      name: finalName,
      source: 'import' as const,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (listErr || !list) {
    return { ok: false as const, error: listErr?.message ?? 'List create failed' };
  }

  const payload = toInsert.map((m) => ({
    brand_id: active.id,
    stage_id: input.stageId,
    list_id: list.id,
    source: 'csv' as const,
    first_name: m.first_name,
    last_name: m.last_name,
    email: m.email,
    phone: m.phone,
    city: m.city,
    state: m.state,
    zip: m.zip,
    notes: m.notes,
    custom: m.custom,
  }));

  // Chunk inserts at 500 rows. Capture inserted ids in input order so we can
  // attach tags to the right rows below.
  const CHUNK = 500;
  let inserted = 0;
  const insertedIds: string[] = [];
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { data: rows, error, count } = await supabase
      .from('leads')
      .insert(slice, { count: 'exact' })
      .select('id');
    if (error) {
      return {
        ok: false as const,
        error: `Insert failed at row ${i + 1}: ${error.message}`,
        inserted,
      };
    }
    inserted += count ?? slice.length;
    if (rows) for (const r of rows) insertedIds.push(r.id);
  }

  // Tag attachment. Resolve every unique tag name across imported rows to a
  // tag row (creating new ones with a deterministic palette color), then bulk
  // insert lead_tags links. Failures here don't roll back leads — surfaced as
  // counts in the result.
  let tagsCreated = 0;
  let tagAttachments = 0;
  const allTagNames = new Set<string>();
  for (const m of toInsert) for (const t of m.tags) allTagNames.add(t);
  if (allTagNames.size > 0 && insertedIds.length === toInsert.length) {
    const PALETTE = ['teal', 'blue', 'amber', 'rose', 'purple', 'green', 'orange', 'pink', 'slate'];
    const pickColor = (seed: string) => {
      let h = 0;
      for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      return PALETTE[h % PALETTE.length] ?? 'slate';
    };

    // Look up which names already exist (case-insensitive) for this brand.
    const names = Array.from(allTagNames);
    const lowered = names.map((n) => n.toLowerCase());
    const { data: existing } = await supabase
      .from('tags')
      .select('id, name')
      .eq('brand_id', active.id);
    const idByLower = new Map<string, string>();
    for (const e of existing ?? []) {
      if (lowered.includes(e.name.toLowerCase())) idByLower.set(e.name.toLowerCase(), e.id);
    }

    // Insert any missing tags in one shot.
    const toCreate = names.filter((n) => !idByLower.has(n.toLowerCase()));
    if (toCreate.length > 0) {
      const { data: created } = await supabase
        .from('tags')
        .insert(
          toCreate.map((n) => ({
            brand_id: active.id,
            name: n,
            color: pickColor(n),
            created_by: user.id,
          })),
        )
        .select('id, name');
      for (const c of created ?? []) {
        idByLower.set(c.name.toLowerCase(), c.id);
        tagsCreated += 1;
      }
    }

    // Build lead_tags rows from the captured insertedIds in order.
    const links: { lead_id: string; tag_id: string; created_by: string }[] = [];
    for (let i = 0; i < toInsert.length; i += 1) {
      const leadId = insertedIds[i];
      const m = toInsert[i];
      if (!leadId || !m) continue;
      for (const name of m.tags) {
        const tagId = idByLower.get(name.toLowerCase());
        if (tagId) links.push({ lead_id: leadId, tag_id: tagId, created_by: user.id });
      }
    }
    if (links.length > 0) {
      const LINK_CHUNK = 1000;
      for (let i = 0; i < links.length; i += LINK_CHUNK) {
        const { error: linkErr, count } = await supabase
          .from('lead_tags')
          .insert(links.slice(i, i + LINK_CHUNK), { count: 'exact' });
        if (!linkErr) tagAttachments += count ?? 0;
      }
    }
  }

  revalidatePath('/leads');
  revalidatePath('/dashboard');

  return {
    ok: true as const,
    inserted,
    listId: list.id,
    listName: finalName,
    invalid: invalidCount,
    skippedDuplicate,
    tagsCreated,
    tagAttachments,
    errors: mapped.flatMap((m) => (m.errors[0] ? [m.errors[0]] : [])).slice(0, 50),
  };
}

export async function setLeadConsent(
  leadId: string,
  consent: { doNotCall?: boolean; doNotEmail?: boolean },
) {
  const supabase = await createServerClient();
  const patch: { updated_at: string; do_not_call?: boolean; do_not_email?: boolean } = {
    updated_at: new Date().toISOString(),
  };
  if (consent.doNotCall !== undefined) patch.do_not_call = consent.doNotCall;
  if (consent.doNotEmail !== undefined) patch.do_not_email = consent.doNotEmail;
  const { error } = await supabase.from('leads').update(patch).eq('id', leadId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------
//
// All bulk-* actions are brand-scoped via RLS plus an explicit brand_id check
// so a malicious caller can't pass IDs from another brand. They return the
// effective row count so the UI can give meaningful feedback.

type BulkResult = { ok: true; count: number } | { ok: false; error: string };

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export async function bulkDeleteLeads(input: { ids: string[] }): Promise<BulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('leads')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true, count: count ?? 0 };
}

export async function bulkMoveLeadsStage(input: {
  ids: string[];
  stageId: string;
}): Promise<BulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('leads')
    .update(
      { stage_id: input.stageId, updated_at: new Date().toISOString() },
      { count: 'exact' },
    )
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true, count: count ?? 0 };
}

export async function bulkSetLeadsConsent(input: {
  ids: string[];
  doNotCall?: boolean;
  doNotEmail?: boolean;
}): Promise<BulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const patch: { updated_at: string; do_not_call?: boolean; do_not_email?: boolean } = {
    updated_at: new Date().toISOString(),
  };
  if (input.doNotCall !== undefined) patch.do_not_call = input.doNotCall;
  if (input.doNotEmail !== undefined) patch.do_not_email = input.doNotEmail;
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('leads')
    .update(patch, { count: 'exact' })
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/leads');
  return { ok: true, count: count ?? 0 };
}

export async function bulkAddTagToLeads(input: {
  ids: string[];
  tagId: string;
}): Promise<BulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  // Confirm every id belongs to the active brand before inserting junction rows.
  const { data: scoped } = await supabase
    .from('leads')
    .select('id')
    .in('id', ids)
    .eq('brand_id', active.id);
  const allowed = (scoped ?? []).map((r) => r.id);
  if (allowed.length === 0) return { ok: true, count: 0 };
  const rows = allowed.map((leadId) => ({ lead_id: leadId, tag_id: input.tagId }));
  const { error } = await supabase
    .from('lead_tags')
    .upsert(rows, { onConflict: 'lead_id,tag_id', ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/leads');
  return { ok: true, count: allowed.length };
}

export async function bulkRemoveTagFromLeads(input: {
  ids: string[];
  tagId: string;
}): Promise<BulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('lead_tags')
    .delete({ count: 'exact' })
    .in('lead_id', ids)
    .eq('tag_id', input.tagId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/leads');
  return { ok: true, count: count ?? 0 };
}
