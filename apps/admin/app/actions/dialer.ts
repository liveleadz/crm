'use server';

// Server actions for the WebRTC dialer.
//
// prepareCall:
//   - validates the user, brand, and lead phone
//   - creates a `calls` row with no signalwire_call_id yet
//   - signs a short-lived dial token containing { callId, from, to, exp }
//   - returns the token + the SignalWire Fabric address for the dialer resource

import { revalidatePath } from 'next/cache';
import { getActiveBrand } from '@/lib/active-brand';
import {
  ensureLeadForCall,
  findBrandLeadByPhone,
  getMyProfile,
  getPublicAppUrl,
  toE164,
} from '@/lib/dialer';
import { pickOutboundNumber } from '@/lib/phone-pools';
import { signDialToken, signTransferPath } from '@/lib/dial-token';
import { redirectInProgressCall } from '@/lib/signalwire';
import { runAutomations } from '@/lib/automation-engine';
import {
  enqueueFollowups,
  loadFollowupForDisposition,
  type DispositionFollowup,
  type FollowupOverrides,
} from '@/lib/disposition-followups';
import { loadCampaign } from '@/lib/campaigns';
import { dialWindowCheck } from '@/lib/tcpa';
import { memberCanBookCalendar } from '@/lib/calendars';
import { pushAppointment } from '@/lib/calendar/sync';
import { createServerClient } from '@leadpilot/db/server';

type PrepareCallResult =
  | {
      ok: true;
      callId: string;
      fabricAddress: string;
      dialToken: string;
      from: string;
      to: string;
      brandName: string;
    }
  | { ok: false; code?: string; error: string };

// Address comes from the SignalWire SWML Webhook resource's default address.
// Confirmed via GET /api/fabric/resources/{id}/addresses on the
// `leadpilot-dialer` resource.
const FABRIC_ADDRESS = '/public/leadpilot-dialer';

export async function prepareCall(input: {
  toNumber: string;
  leadId?: string | null;
  campaignId?: string | null;
}): Promise<PrepareCallResult> {
  if (!process.env.LAML_WEBHOOK_SECRET) {
    return { ok: false, code: 'secret_missing', error: 'LAML_WEBHOOK_SECRET not configured.' };
  }

  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand selected.' };

  const to = toE164(input.toNumber);
  if (!to) return { ok: false, error: 'Enter a valid phone number.' };

  // TCPA soft block: if a campaign is supplied and opted-in, refuse the
  // dial when the lead's local clock is outside the configured window.
  // The toast text includes when the next window opens so the rep knows
  // to come back later instead of guessing.
  if (input.campaignId) {
    const campaign = await loadCampaign(input.campaignId);
    if (campaign && campaign.tcpaEnabled) {
      let leadState: string | null = null;
      if (input.leadId) {
        const sb = await createServerClient();
        const { data: lead } = await sb
          .from('leads')
          .select('state')
          .eq('id', input.leadId)
          .maybeSingle();
        leadState = lead?.state ?? null;
      }
      const check = dialWindowCheck({
        leadState,
        brandTimezone: active.timezone,
        policy: {
          enabled: campaign.tcpaEnabled,
          startMin: campaign.dialWindowStartMin,
          endMin: campaign.dialWindowEndMin,
          skipWeekends: campaign.skipWeekends,
        },
      });
      if (!check.ok) {
        const opens = new Date(check.nextOpenIso).toLocaleString();
        return {
          ok: false,
          code: 'tcpa_window',
          error: `${check.reason}. Next dial window opens ${opens}.`,
        };
      }
    }
  }

  // Per-lead attempt cap + per-disposition cooldown. These are brand-wide
  // guardrails — they apply to every manual / campaign dial, regardless of
  // whether the caller passed a campaign. Only checked when leadId is
  // known; ad-hoc number-only dials skip the lookup.
  if (input.leadId) {
    const sb = await createServerClient();
    const [{ data: brandCfg }, { data: dispRows }] = await Promise.all([
      sb.from('brands').select('max_dials_per_lead_per_day').eq('id', active.id).maybeSingle(),
      sb.from('dispositions').select('code, cooldown_minutes').eq('brand_id', active.id),
    ]);
    const dailyCap = brandCfg?.max_dials_per_lead_per_day ?? null;
    const cooldownByCode = new Map<string, number>();
    for (const d of dispRows ?? []) {
      if (d.cooldown_minutes && d.cooldown_minutes > 0) {
        cooldownByCode.set(d.code, d.cooldown_minutes);
      }
    }
    if (dailyCap || cooldownByCode.size > 0) {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const { data: dayCalls } = await sb
        .from('calls')
        .select('started_at, disposition')
        .eq('brand_id', active.id)
        .eq('lead_id', input.leadId)
        .gte('started_at', dayAgo);
      const calls = dayCalls ?? [];
      if (dailyCap && calls.length >= dailyCap) {
        return {
          ok: false,
          code: 'attempt_cap',
          error: `Daily attempt cap reached (${dailyCap}). Try again tomorrow.`,
        };
      }
      const now = Date.now();
      for (const c of calls) {
        const cdMin = c.disposition ? cooldownByCode.get(c.disposition) : undefined;
        if (!cdMin) continue;
        const startedMs = new Date(c.started_at).getTime();
        const remainingMs = cdMin * 60_000 - (now - startedMs);
        if (remainingMs > 0) {
          const mins = Math.ceil(remainingMs / 60_000);
          return {
            ok: false,
            code: 'cooldown',
            error: `Lead is in cooldown — wait ${mins} more minute${mins === 1 ? '' : 's'}.`,
          };
        }
      }
    }
  }

  const fromNumber = await pickOutboundNumber({
    brandId: active.id,
    campaignId: input.campaignId ?? null,
    leadId: input.leadId ?? null,
  });
  if (!fromNumber) {
    return {
      ok: false,
      code: 'no_brand_number',
      error: `No outbound number assigned to ${active.name}.`,
    };
  }

  const profile = await getMyProfile();
  if (!profile) return { ok: false, error: 'Not authenticated.' };

  // If the caller didn't pass an explicit leadId (keypad dial, dialer
  // entry from a non-lead surface, etc.), try to attribute the call to a
  // lead in this brand by phone. Without this the call row goes in with
  // lead_id=null and the disposition_set automations that depend on a
  // lead — most importantly the seeded "Sale → move to Won" rule — have
  // nothing to operate on (executeAction short-circuits leadBound
  // actions when ctx.leadId is null).
  let resolvedLeadId = input.leadId ?? null;
  if (!resolvedLeadId) {
    const match = await findBrandLeadByPhone(active.id, to);
    if (match) resolvedLeadId = match.id;
  }

  const supabase = await createServerClient();
  const { data: inserted, error: insertErr } = await supabase
    .from('calls')
    .insert({
      brand_id: active.id,
      lead_id: resolvedLeadId,
      member_id: profile.id,
      number_id: fromNumber.id,
      direction: 'outbound',
      from_number: fromNumber.e164,
      to_number: to,
      campaign_id: input.campaignId ?? null,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    return { ok: false, code: 'db_insert_failed', error: insertErr?.message ?? 'Could not log call.' };
  }

  const token = signDialToken({
    callId: inserted.id,
    from: fromNumber.e164,
    to,
    exp: Math.floor(Date.now() / 1000) + 60,
  });

  revalidatePath('/calls');
  return {
    ok: true,
    callId: inserted.id,
    // Token in the address as a fallback. The primary path is
    // userVariables on the dial() call, which we forward in the webhook
    // body — that one survives if SignalWire strips query strings.
    fabricAddress: `${FABRIC_ADDRESS}?channel=audio&t=${encodeURIComponent(token)}`,
    dialToken: token,
    from: fromNumber.e164,
    to,
    brandName: active.name,
  };
}

// Claim the most recent inbound call for the active brand for the current
// member. Used by the IncomingCallPopup to map an SDK invite back to our
// internal call row so disposition/note can be saved against the right
// call when the agent hangs up.
export async function claimRecentInboundCall(): Promise<
  | {
      ok: true;
      callId: string;
      fromNumber: string;
      toNumber: string;
      leadId: string | null;
      leadName: string | null;
    }
  | { ok: false; error: string }
> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const profile = await getMyProfile();
  if (!profile) return { ok: false, error: 'Not authenticated.' };
  const supabase = await createServerClient();
  const since = new Date(Date.now() - 120_000).toISOString();
  const { data: call } = await supabase
    .from('calls')
    .select('id, from_number, to_number, lead_id, leads(first_name, last_name)')
    .eq('brand_id', active.id)
    .eq('direction', 'inbound')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!call) return { ok: false, error: 'No recent inbound call.' };
  await supabase
    .from('calls')
    .update({ member_id: profile.id, needs_disposition: true })
    .eq('id', call.id);
  // Clear the "Missed call" notifications for THIS call across all
  // recipients — an answered call should never show as missed in the bell.
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('brand_id', active.id)
    .eq('kind', 'inbound_call')
    .contains('data', { call_id: call.id });
  const lead = call.leads as { first_name: string | null; last_name: string | null } | null;
  const leadName = lead
    ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
    : null;
  return {
    ok: true,
    callId: call.id,
    fromNumber: call.from_number,
    toNumber: call.to_number,
    leadId: call.lead_id,
    leadName,
  };
}

export async function attachSignalwireCallId(input: {
  callId: string;
  signalwireCallId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('calls')
    .update({ signalwire_call_id: input.signalwireCallId })
    .eq('id', input.callId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Blind transfer of an in-flight call. Replaces the running SWML on the
// parent CallSid with a `connect` to the typed target — the lead leg
// drops, then the brand caller-ID re-bridges to the transfer target.
// Agent's WebRTC leg ends as the parent script exits.
//
// Honest behavior: this is a blind transfer (not warm). The agent does
// NOT introduce the new party. We log a `lead_events` row so the
// timeline shows who initiated the transfer.
export async function transferCall(input: {
  callId: string;
  targetE164: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = toE164(input.targetE164);
  if (!target) return { ok: false, error: 'Enter a valid phone number.' };

  const profile = await getMyProfile();
  if (!profile) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createServerClient();
  // RLS ensures the agent can only transfer their own (or manager-visible)
  // calls. We need the SignalWire CallSid to issue the redirect.
  const { data: call, error } = await supabase
    .from('calls')
    .select('id, brand_id, lead_id, signalwire_call_id, member_id')
    .eq('id', input.callId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!call) return { ok: false, error: 'Call not found.' };
  if (!call.signalwire_call_id) {
    return { ok: false, error: 'Call is not connected yet.' };
  }

  const sig = signTransferPath(call.id, target);
  const newUrl = `${getPublicAppUrl()}/api/swml/transfer/${call.id}/${sig}?to=${encodeURIComponent(target)}`;
  const res = await redirectInProgressCall({
    signalwireCallId: call.signalwire_call_id,
    newUrl,
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: res.error };

  // Best-effort timeline note. RLS on lead_events permits self-inserts;
  // failing here must not break the transfer.
  if (call.lead_id) {
    await supabase
      .from('lead_events')
      .insert({
        brand_id: call.brand_id,
        lead_id: call.lead_id,
        member_id: profile.id,
        type: 'call_transferred',
        payload: { call_id: call.id, to: target },
      })
      .then(() => undefined, () => undefined);
  }

  return { ok: true };
}

export async function markCallEnded(input: {
  callId: string;
  durationSec?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { data: row, error } = await supabase
    .from('calls')
    .update({
      ended_at: new Date().toISOString(),
      duration_sec: input.durationSec ?? null,
    })
    .eq('id', input.callId)
    .select('brand_id, lead_id, member_id, direction')
    .single();
  if (error) return { ok: false, error: error.message };

  // Fan out call_ended automations. Awaited so the engine actually runs to
  // completion before this serverless invocation returns — `void` here meant
  // Vercel could (and did) terminate the lambda mid-run, leaving workflow_runs
  // never inserted and outbox/log rows missing. The engine swallows its own
  // errors so awaiting can't fail the disposition save.
  if (row && (row.direction === 'inbound' || row.direction === 'outbound')) {
    await runAutomations({
      trigger: 'call_ended',
      brandId: row.brand_id,
      leadId: row.lead_id,
      memberId: row.member_id,
      callId: input.callId,
      direction: row.direction,
      durationSec: input.durationSec ?? null,
    });
  }

  revalidatePath('/calls');
  return { ok: true };
}

// Disposition codes are now data — managers configure them per brand
// in /settings. We keep the string permissive here; existing rows with
// the old hardcoded codes (connected, callback, etc.) remain valid.
export async function setDisposition(input: {
  callId: string;
  disposition: string;
  note?: string | null;
  callbackAt?: string | null; // ISO timestamp when disposition === 'callback'
  campaignId?: string | null; // attribution if the call started ad-hoc
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const callbackAt =
    input.disposition === 'callback' ? input.callbackAt ?? null : null;
  // We patch campaign_id only when the caller passes it explicitly so we
  // don't accidentally null out an existing attribution.
  const patch: {
    disposition: string;
    note: string | null;
    callback_at: string | null;
    needs_disposition: boolean;
    campaign_id?: string | null;
  } = {
    disposition: input.disposition,
    note: input.note?.trim() ? input.note.trim() : null,
    callback_at: callbackAt,
    needs_disposition: false,
  };
  if (input.campaignId !== undefined) patch.campaign_id = input.campaignId;
  const { data: row, error } = await supabase
    .from('calls')
    .update(patch)
    .eq('id', input.callId)
    .select('brand_id, lead_id, member_id, campaign_id')
    .single();
  if (error) return { ok: false, error: error.message };

  // Fan out to user-defined automations. Best-effort: a misbehaving rule
  // must never reject the disposition save.
  if (row) {
    // Materialize a lead if the call still has none — every seeded
    // disposition_set rule (Sale, DNC, Wrong number, Not interested,
    // Callback) is leadBound and short-circuits without ctx.leadId.
    // Auto-creating here means dialing a brand-new number then
    // dispositioning it as Sale will both produce the contact and run
    // the "Sale → move to Won" automation in a single step.
    const resolvedLeadId = row.lead_id ?? (await ensureLeadForCall(input.callId));

    await runAutomations({
      trigger: 'disposition_set',
      brandId: row.brand_id,
      callId: input.callId,
      leadId: resolvedLeadId,
      memberId: row.member_id,
      disposition: input.disposition,
      callbackAt,
    });
  }

  revalidatePath('/calls');
  revalidatePath('/leads');
  revalidatePath('/tasks');
  return { ok: true };
}

// Fetch the resolved follow-up template for the disposition picker.
// Returns null if neither a campaign override nor a brand default exists.
// stageName/tagNames are resolved here so the picker can show a readable
// "Will also: → Closed Won + tag(VIP)" preview without a second round-trip.
export type ResolvedDispositionFollowup = {
  followup: DispositionFollowup;
  stageName: string | null;
  tagNames: string[];
};

export async function getFollowupForDisposition(input: {
  campaignId: string | null;
  dispositionId: string;
}): Promise<ResolvedDispositionFollowup | null> {
  const active = await getActiveBrand();
  if (!active) return null;
  const followup = await loadFollowupForDisposition(
    active.id,
    input.campaignId,
    input.dispositionId,
  );
  if (!followup) return null;
  let stageName: string | null = null;
  let tagNames: string[] = [];
  if (followup.moveStageId || followup.addTagIds.length > 0) {
    const supabase = await createServerClient();
    const [stageRes, tagRes] = await Promise.all([
      followup.moveStageId
        ? supabase.from('stages').select('name').eq('id', followup.moveStageId).maybeSingle()
        : Promise.resolve({ data: null }),
      followup.addTagIds.length > 0
        ? supabase.from('tags').select('id, name').in('id', followup.addTagIds)
        : Promise.resolve({ data: [] }),
    ]);
    stageName = (stageRes.data as { name: string } | null)?.name ?? null;
    tagNames = ((tagRes.data ?? []) as { id: string; name: string }[]).map((t) => t.name);
  }
  return { followup, stageName, tagNames };
}

// Direct path for the disposition dialog: enqueue email/SMS/task follow-ups
// for a call. Separate from runAutomations() — reps don't need to build a
// workflow to get a "thanks for chatting" email out the door.
export async function sendDispositionFollowups(input: {
  callId: string;
  campaignId: string | null;
  dispositionId: string;
  overrides?: FollowupOverrides;
}): Promise<
  | {
      ok: true;
      enqueued: { email: boolean; sms: boolean; task: boolean };
    }
  | { ok: false; error: string }
> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const profile = await getMyProfile();
  if (!profile) return { ok: false, error: 'Not authenticated.' };
  const supabase = await createServerClient();
  const { data: call } = await supabase
    .from('calls')
    .select('lead_id, brand_id')
    .eq('id', input.callId)
    .maybeSingle();
  if (!call) return { ok: false, error: 'Call not found.' };
  if (!call.lead_id) return { ok: true, enqueued: { email: false, sms: false, task: false } };
  const result = await enqueueFollowups({
    brandId: call.brand_id,
    leadId: call.lead_id,
    callId: input.callId,
    campaignId: input.campaignId,
    dispositionId: input.dispositionId,
    memberId: profile.id,
    overrides: input.overrides,
  });
  return {
    ok: true,
    enqueued: { email: !!result.email, sms: !!result.sms, task: !!result.task },
  };
}

// Bulk re-disposition for the /calls list. Applies a single disposition
// code to many calls at once — useful for cleaning up a batch of "needs
// disposition" rows or correcting a misclick. Note + callback_at are not
// settable in bulk mode (would conflict per-row); they're cleared so the
// new disposition isn't paired with a stale note.
export async function bulkSetDispositions(input: {
  callIds: string[];
  disposition: string;
}): Promise<
  | { ok: true; updated: number }
  | { ok: false; error: string }
> {
  if (input.callIds.length === 0) {
    return { ok: false, error: 'No calls selected.' };
  }
  if (!input.disposition) {
    return { ok: false, error: 'Pick a disposition first.' };
  }
  const supabase = await createServerClient();
  // Brand scope is enforced by RLS on `calls`; we just update by id list.
  const { data: rows, error } = await supabase
    .from('calls')
    .update({
      disposition: input.disposition,
      callback_at: null,
      needs_disposition: false,
    })
    .in('id', input.callIds)
    .select('id, brand_id, lead_id, member_id');
  if (error) return { ok: false, error: error.message };
  const updated = rows?.length ?? 0;

  // Fan out automations per row, best-effort. Same auto-create-lead
  // safety net as the single setDisposition path so bulk-applying Sale
  // (or any other rule with leadBound actions) works on calls that
  // came in lead-less.
  if (rows && rows.length > 0) {
    await Promise.all(
      rows.map(async (r) => {
        const resolvedLeadId = r.lead_id ?? (await ensureLeadForCall(r.id));
        return runAutomations({
          trigger: 'disposition_set',
          brandId: r.brand_id,
          callId: r.id,
          leadId: resolvedLeadId,
          memberId: r.member_id,
          disposition: input.disposition,
          callbackAt: null,
        }).catch(() => undefined);
      }),
    );
  }

  revalidatePath('/calls');
  revalidatePath('/leads');
  revalidatePath('/tasks');
  return { ok: true, updated };
}

// Book an appointment straight from the dialer. The campaign supplies the
// calendar + default owner, so the rep just picks date/time/title.
export async function bookAppointmentFromCall(input: {
  callId: string;
  leadId: string;
  campaignId: string;
  startsAt: string; // ISO
  endsAt?: string | null;
  title: string;
  notes?: string | null;
}): Promise<{ ok: true; appointmentId: string } | { ok: false; error: string }> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const profile = await getMyProfile();
  if (!profile) return { ok: false, error: 'Not authenticated.' };
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Title is required.' };
  if (!input.startsAt) return { ok: false, error: 'Start time is required.' };

  const campaign = await loadCampaign(input.campaignId);
  if (!campaign || campaign.brandId !== active.id) {
    return { ok: false, error: 'Campaign not found.' };
  }
  if (!campaign.calendarId) {
    return { ok: false, error: 'Campaign has no calendar configured.' };
  }
  const ownerId = campaign.defaultOwnerId ?? profile.id;
  const allowed = await memberCanBookCalendar(active.id, campaign.calendarId, ownerId);
  if (!allowed) return { ok: false, error: 'Owner cannot book this calendar.' };

  const supabase = await createServerClient();
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('id', input.leadId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!lead) return { ok: false, error: 'Lead not found.' };

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      brand_id: active.id,
      lead_id: input.leadId,
      member_id: ownerId,
      calendar_id: campaign.calendarId,
      campaign_id: campaign.id,
      title,
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      notes: input.notes?.trim() || null,
      status: 'scheduled',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };

  await supabase.from('lead_events').insert({
    brand_id: active.id,
    lead_id: input.leadId,
    member_id: profile.id,
    type: 'appointment_scheduled',
    payload: {
      appointment_id: data.id,
      starts_at: input.startsAt,
      title,
      campaign_id: campaign.id,
      call_id: input.callId,
    },
  });

  // Best-effort external push.
  void pushAppointment(data.id);

  // Awaited so the engine actually runs to completion before this serverless
  // invocation returns — `void` here meant Vercel could (and did) terminate
  // the lambda mid-run, leaving workflow_runs never inserted. The engine
  // swallows its own errors so awaiting can't fail the appointment save.
  await runAutomations({
    trigger: 'appointment_booked',
    brandId: active.id,
    leadId: input.leadId,
    memberId: profile.id,
    appointmentId: data.id,
    startsAt: input.startsAt,
  });

  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  revalidatePath(`/leads/${input.leadId}`);
  return { ok: true, appointmentId: data.id };
}
