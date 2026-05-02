'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { loadLeadDetail } from '@/lib/leads';
import {
  applyMapping,
  type FieldMapping,
  type PhoneCountry,
} from '@/lib/leads-import';
import { runAutomations } from '@/lib/automation-engine';

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

  // Fire lead_created automations. Fire-and-forget; never blocks the UI.
  void runAutomations({
    trigger: 'lead_created',
    brandId: active.id,
    leadId: data.id,
    memberId: null,
    source: 'manual',
  });

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

  void runAutomations({
    trigger: 'lead_created',
    brandId: active.id,
    leadId: lead.id,
    memberId: null,
    source: 'manual',
  });

  revalidatePath('/calls');
  revalidatePath('/leads');
  return { ok: true, leadId: lead.id };
}

export async function moveLeadStage(leadId: string, stageId: string) {
  const supabase = await createServerClient();
  // Snapshot the prior stage so the trigger payload has both ends. RLS
  // scopes both reads and the update.
  const { data: prior } = await supabase
    .from('leads')
    .select('stage_id, brand_id')
    .eq('id', leadId)
    .maybeSingle();
  const { error } = await supabase
    .from('leads')
    .update({ stage_id: stageId, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) return { ok: false as const, error: error.message };

  if (prior?.brand_id && prior.stage_id !== stageId) {
    // Audit row — powers the pipeline report's entered/exited/dwell metrics.
    await supabase.from('lead_events').insert({
      brand_id: prior.brand_id,
      lead_id: leadId,
      type: 'stage_change',
      payload: {
        from_stage_id: prior.stage_id ?? null,
        to_stage_id: stageId,
      },
    });
    void runAutomations({
      trigger: 'stage_changed',
      brandId: prior.brand_id,
      leadId,
      memberId: null,
      fromStageId: prior.stage_id ?? null,
      toStageId: stageId,
    });
  }

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

// Inline edits from the lead detail drawer. Each field is optional; only
// the keys present in `input` are applied. RLS + brand_id keep this safe.
export async function updateLeadFields(input: {
  leadId: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand.' };
  type LeadPatch = {
    updated_at: string;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    email?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
  const patch: LeadPatch = { updated_at: new Date().toISOString() };
  const norm = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null ? null : v.trim() || null;
  if (input.firstName !== undefined) patch.first_name = norm(input.firstName);
  if (input.lastName !== undefined) patch.last_name = norm(input.lastName);
  if (input.phone !== undefined) patch.phone = norm(input.phone);
  if (input.email !== undefined) patch.email = norm(input.email);
  if (input.city !== undefined) patch.city = norm(input.city);
  if (input.state !== undefined) patch.state = norm(input.state);
  if (input.zip !== undefined) patch.zip = norm(input.zip);
  if (Object.keys(patch).length === 1) return { ok: true as const };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', input.leadId)
    .eq('brand_id', active.id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true as const };
}

// Single-lead owner assign used by the detail drawer. Mirrors
// bulkAssignLeadsOwner but for one row. ownerId=null clears the owner.
export async function setLeadOwner(input: { leadId: string; ownerId: string | null }) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('leads')
    .update({ owner_id: input.ownerId, updated_at: new Date().toISOString() })
    .eq('id', input.leadId)
    .eq('brand_id', active.id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  return { ok: true as const };
}

// Typeahead helper for the appointment dialog's lead picker. Searches
// name / phone / email; returns up to 10 matches scoped to the brand.
export async function searchLeads(input: { query: string }) {
  const active = await getActiveBrand();
  if (!active) return [] as { id: string; name: string; phone: string | null; email: string | null }[];
  const q = input.query.trim();
  if (!q) return [];
  const supabase = await createServerClient();
  const esc = q.replace(/[%,]/g, ' ');
  const pattern = `%${esc}%`;
  const { data } = await supabase
    .from('leads')
    .select('id, first_name, last_name, phone, email')
    .eq('brand_id', active.id)
    .or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`,
    )
    .order('updated_at', { ascending: false })
    .limit(10);
  return (data ?? []).map((l) => ({
    id: l.id,
    name: [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || l.phone || l.email || 'Unnamed',
    phone: l.phone,
    email: l.email,
  }));
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

  // Manual call logs end the call right away — fire call_ended automations.
  void runAutomations({
    trigger: 'call_ended',
    brandId: active.id,
    leadId: input.leadId,
    memberId: user.id,
    callId: call.id,
    direction: input.direction,
    durationSec: input.durationSec ?? null,
  });

  revalidatePath('/leads');
  revalidatePath('/dashboard');
  revalidatePath('/calls');
  return { ok: true as const, callId: call.id };
}

// Bulk import. Rows are pre-parsed CSV objects keyed by original headers.
// Mapping decides where each header goes (lead column / custom JSON / skip).
// Server-side dedup: skip rows whose normalized phone OR email already exists
// in this brand (caller can override with skipDedup=true).
//
// The whole body is wrapped in try/catch and ALWAYS returns a structured
// result. Any uncaught throw here would bubble out of the client's
// startTransition and surface as the page-scoped error boundary
// ("Import couldn't finish loading"), which is a terrible UX for a
// recoverable problem (e.g. transient supabase failure mid-import).
export async function importLeads(input: {
  rows: Record<string, string>[];
  mapping: FieldMapping;
  stageId: string | null;
  listName: string;
  skipDedup?: boolean;
  defaultCountry?: PhoneCountry;
  // Tag IDs applied to every inserted lead in addition to whatever the
  // CSV's "tags" column resolves to.
  extraTagIds?: string[];
}) {
  try {
    return await importLeadsInner(input);
  } catch (err) {
    console.error('[importLeads] unhandled error', err);
    const message =
      err instanceof Error ? err.message : 'Import failed unexpectedly';
    return { ok: false as const, error: message };
  }
}

async function importLeadsInner(input: {
  rows: Record<string, string>[];
  mapping: FieldMapping;
  stageId: string | null;
  listName: string;
  skipDedup?: boolean;
  defaultCountry?: PhoneCountry;
  extraTagIds?: string[];
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

  const mapped = input.rows.map((r) =>
    applyMapping(r, input.mapping, { defaultCountry: input.defaultCountry }),
  );
  const valid = mapped.filter((m) => m.errors.length === 0);
  const invalidCount = mapped.length - valid.length;

  // Per-row diagnostics — surfaces row index + every error/warning so the
  // wizard's done screen can show "Row 47: bad phone "abc"". Capped at
  // 200 entries to keep the action response bounded.
  const rowReports: { row: number; errors: string[]; warnings: string[] }[] = [];
  for (let i = 0; i < mapped.length; i += 1) {
    const m = mapped[i];
    if (!m) continue;
    if (m.errors.length === 0 && m.warnings.length === 0) continue;
    if (rowReports.length >= 200) break;
    // Header is row 1 in the source CSV; data starts at row 2.
    rowReports.push({ row: i + 2, errors: m.errors, warnings: m.warnings });
  }

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

    // Chunk the .in() lookups: at ~16 chars/phone a 5000-row CSV pushes
    // the URL well past Supabase's ~8KB request line limit. 500 per call
    // keeps each query under a few KB.
    const LOOKUP_CHUNK = 500;
    const existing = new Set<string>();
    for (let i = 0; i < phones.length; i += LOOKUP_CHUNK) {
      const slice = phones.slice(i, i + LOOKUP_CHUNK);
      const { data } = await supabase
        .from('leads')
        .select('phone')
        .eq('brand_id', active.id)
        .in('phone', slice);
      data?.forEach((d) => d.phone && existing.add(`p:${d.phone}`));
    }
    for (let i = 0; i < emails.length; i += LOOKUP_CHUNK) {
      const slice = emails.slice(i, i + LOOKUP_CHUNK);
      const { data } = await supabase
        .from('leads')
        .select('email')
        .eq('brand_id', active.id)
        .in('email', slice);
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
      rowReports,
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

  // Bulk tags applied to every inserted lead regardless of CSV content.
  // We re-verify the supplied tag IDs belong to this brand (RLS would
  // also reject cross-brand inserts, but failing fast keeps the row
  // count honest).
  const extraTagIds = Array.from(new Set((input.extraTagIds ?? []).filter(Boolean)));
  if (extraTagIds.length > 0 && insertedIds.length > 0) {
    const { data: ownTags } = await supabase
      .from('tags')
      .select('id')
      .eq('brand_id', active.id)
      .in('id', extraTagIds);
    const validIds = (ownTags ?? []).map((t) => t.id);
    if (validIds.length > 0) {
      const bulkLinks: { lead_id: string; tag_id: string; created_by: string }[] = [];
      for (const leadId of insertedIds) {
        for (const tagId of validIds) {
          bulkLinks.push({ lead_id: leadId, tag_id: tagId, created_by: user.id });
        }
      }
      const LINK_CHUNK = 1000;
      for (let i = 0; i < bulkLinks.length; i += LINK_CHUNK) {
        const { error: linkErr, count } = await supabase
          .from('lead_tags')
          .insert(bulkLinks.slice(i, i + LINK_CHUNK), { count: 'exact' });
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
    rowReports,
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
  // Snapshot prior stages so we can record an audit row per actual change.
  const { data: priors } = await supabase
    .from('leads')
    .select('id, stage_id')
    .in('id', ids)
    .eq('brand_id', active.id);
  const priorMap = new Map<string, string | null>(
    (priors ?? []).map((r) => [r.id, r.stage_id]),
  );

  const { error, count } = await supabase
    .from('leads')
    .update(
      { stage_id: input.stageId, updated_at: new Date().toISOString() },
      { count: 'exact' },
    )
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };

  // Audit rows for the leads whose stage actually changed. We deliberately
  // skip firing the stage_changed automation trigger here — bulk ops
  // bypass automations to avoid storms — but the audit still records the
  // movement for the pipeline report.
  const eventRows = Array.from(priorMap.entries())
    .filter(([, prior]) => prior !== input.stageId)
    .map(([leadId, prior]) => ({
      brand_id: active.id,
      lead_id: leadId,
      type: 'stage_change',
      payload: { from_stage_id: prior, to_stage_id: input.stageId },
    }));
  if (eventRows.length > 0) {
    await supabase.from('lead_events').insert(eventRows);
  }

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

// Assigns (or unassigns when ownerId is null) a single owner to all selected
// leads. We don't validate ownerId against brand membership here — the FK on
// leads.owner_id -> members enforces it implicitly, and the brand_id filter
// ensures the caller can only touch leads they already control.
export async function bulkAssignLeadsOwner(input: {
  ids: string[];
  ownerId: string | null;
}): Promise<BulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('leads')
    .update(
      { owner_id: input.ownerId, updated_at: new Date().toISOString() },
      { count: 'exact' },
    )
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true, count: count ?? 0 };
}
