// Inbound call handler for brand-owned numbers. SignalWire posts here when a
// PSTN call hits a number — we look up the per-number routing config, ring
// the assigned members' mobile_phones in parallel, and fall through to a
// voicemail recording if no one answers in the configured timeout.
//
// SignalWire's SWML connect supports a "from"-list as a parallel-dial array
// when you pass an array of destinations. The first leg to answer wins.
//
// One row gets inserted into `calls` per inbound call so the call list and
// per-number health metrics see it. The voicemail callback (separate signed
// path) updates the row with the recording URL when the recording finishes.

import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { signVoicemailPath } from '@/lib/dial-token';
import { getPublicAppUrl, toE164 } from '@/lib/dialer';
import { runAutomations } from '@/lib/automation-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SignalWire's IncomingPhoneNumber voice_url runs the LaML pipeline, which
// expects XML responses (Twilio-compatible). Returning SWML JSON here would
// silently fail. Helpers below build LaML responses.
function laml(xml: string) {
  return new NextResponse(xml, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

const HANGUP_LAML = `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  return handle(req, ctx);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  return handle(req, ctx);
}

async function handle(req: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  const { number } = await ctx.params;
  // The path segment is the destination E.164 (or sanitized; we re-normalize).
  const e164 = toE164(decodeURIComponent(number));
  if (!e164) return laml(HANGUP_LAML);

  // Caller's number — try a few common SWML/LaML field shapes.
  const url = new URL(req.url);
  let parsedBody: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) {
      try {
        parsedBody = JSON.parse(raw);
      } catch {
        const params = new URLSearchParams(raw);
        params.forEach((v, k) => {
          parsedBody[k] = v;
        });
      }
    }
  } catch {
    /* ignore */
  }
  const callerRaw = pickString(parsedBody, ['From', 'from', 'caller', 'caller_id_number']) ??
    url.searchParams.get('From') ??
    url.searchParams.get('from') ??
    null;
  const fromNumber = callerRaw ? toE164(callerRaw) ?? callerRaw : 'unknown';

  const supabase = createAdminClient();

  // Resolve the receiving number row, plus its routing config and brand.
  const { data: numberRow } = await supabase
    .from('numbers')
    .select('id, brand_id')
    .eq('e164', e164)
    .maybeSingle();
  if (!numberRow) return laml(HANGUP_LAML);

  const { data: route } = await supabase
    .from('inbound_routes')
    .select(
      'strategy, member_ids, ring_timeout_sec, voicemail_enabled, voicemail_greeting, last_rung_member_id',
    )
    .eq('number_id', numberRow.id)
    .maybeSingle();

  // Resolve which member IDs to ring based on strategy. Strategy semantics:
  //   simul       — ring everyone in member_ids in parallel
  //   round_robin — advance from last_rung_member_id, ring just the next one
  //   single      — ring only the first member in the list
  const allMemberIds = route?.member_ids ?? [];
  const strategy = (route?.strategy ?? 'simul') as 'simul' | 'round_robin' | 'single';
  const targetMemberIds = pickTargetsForStrategy(
    strategy,
    allMemberIds,
    route?.last_rung_member_id ?? null,
  );

  // Fetch mobile_phones for just the chosen targets. Drop members without
  // a mobile_phone — we have nothing to ring.
  const ringNumbers: string[] = [];
  let nextRotationMemberId: string | null = null;
  if (targetMemberIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, mobile_phone')
      .in('id', targetMemberIds);
    const byId = new Map((members ?? []).map((m) => [m.id, m] as const));
    // Preserve target order so round_robin / single ring the chosen one.
    for (const id of targetMemberIds) {
      const m = byId.get(id);
      if (m?.mobile_phone) {
        const n = toE164(m.mobile_phone);
        if (n) {
          ringNumbers.push(n);
          if (strategy === 'round_robin' && !nextRotationMemberId) {
            nextRotationMemberId = id;
          }
        }
      }
    }
  }

  // Persist the new rotation pointer for round_robin so the next inbound
  // call advances. Best-effort — don't block on the write.
  if (strategy === 'round_robin' && nextRotationMemberId) {
    void supabase
      .from('inbound_routes')
      .update({ last_rung_member_id: nextRotationMemberId })
      .eq('number_id', numberRow.id);
  }

  // Try to attribute the call to a known lead (by phone). Brand-scoped.
  let leadId: string | null = null;
  let leadName: string | null = null;
  let leadOwnerId: string | null = null;
  if (fromNumber !== 'unknown') {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, first_name, last_name, owner_id')
      .eq('brand_id', numberRow.brand_id)
      .eq('phone', fromNumber)
      .maybeSingle();
    leadId = lead?.id ?? null;
    if (lead) {
      leadName = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null;
      leadOwnerId = lead.owner_id ?? null;
    }
  }

  // Insert the calls row up-front so the recording callback can target it.
  const { data: call } = await supabase
    .from('calls')
    .insert({
      brand_id: numberRow.brand_id,
      number_id: numberRow.id,
      lead_id: leadId,
      direction: 'inbound',
      from_number: fromNumber,
      to_number: e164,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  const callId = call?.id ?? null;

  // Side effects (notifications + automation dispatch) run after the SWML
  // is composed so they never delay the response. Errors are swallowed —
  // never block the call.
  if (callId) {
    void notifyAndDispatch({
      brandId: numberRow.brand_id,
      callId,
      numberId: numberRow.id,
      leadId,
      leadName,
      leadOwnerId,
      ringMemberIds: targetMemberIds,
      fromNumber,
      toNumber: e164,
    });
  }

  // No voicemail enabled = polite hangup. Still record the inbound call
  // we already inserted (above) so the brand sees the missed attempt.
  if (!(route?.voicemail_enabled ?? true)) {
    return laml(HANGUP_LAML);
  }

  // Build LaML XML response.
  //
  // In-browser ringing: drop the caller into a conference room named
  // inbound-<callId>. The notification we insert via notifyAndDispatch
  // streams over Supabase realtime to the routed members' browsers; the
  // IncomingCallProvider shows a popup with Answer/Reject. On Answer the
  // agent's WebRTC leg joins the same conference and the bridge forms.
  // If the ring timeout elapses without an answer, execution falls
  // through to the voicemail flow below.
  void ringNumbers;
  void nextRotationMemberId;
  const verbs: string[] = [];
  const conferenceName = callId ? `inbound-${callId}` : null;
  const ring = route?.ring_timeout_sec ?? 25;

  if (conferenceName && targetMemberIds.length > 0) {
    verbs.push(
      `<Dial timeout="${ring}" answerOnBridge="true">` +
        `<Conference startConferenceOnEnter="false" endConferenceOnExit="true" beep="false">` +
        escapeXml(conferenceName) +
        `</Conference></Dial>`,
    );
  }

  if ((route?.voicemail_enabled ?? true) && callId) {
    const greeting =
      route?.voicemail_greeting ??
      "You've reached us. We can't take your call right now — please leave a message after the tone.";
    const vmSig = signVoicemailPath(callId);
    const vmUrl = `${getPublicAppUrl()}/api/swml/voicemail/${callId}/${vmSig}`;
    verbs.push(`<Say>${escapeXml(greeting)}</Say>`);
    verbs.push(
      `<Record action="${escapeXml(vmUrl)}" method="POST" maxLength="180" finishOnKey="#" playBeep="true" timeout="5"/>`,
    );
  }

  verbs.push('<Hangup/>');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${verbs.join('')}</Response>`;
  return laml(xml);
}

// Returns the ordered list of member IDs to ring for this call based on
// strategy. For round_robin we start at the member AFTER last_rung_member_id
// (wrapping), giving exactly one target per call. Empty input returns empty.
function pickTargetsForStrategy(
  strategy: 'simul' | 'round_robin' | 'single',
  memberIds: string[],
  lastRung: string | null,
): string[] {
  if (memberIds.length === 0) return [];
  if (strategy === 'simul') return memberIds;
  if (strategy === 'single') return [memberIds[0]!];
  // round_robin
  const lastIdx = lastRung ? memberIds.indexOf(lastRung) : -1;
  const start = lastIdx >= 0 ? (lastIdx + 1) % memberIds.length : 0;
  return [memberIds[start]!];
}

function pickString(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

// Notify all routed members + the lead owner (deduped) about the inbound
// call so each browser sees the answer/reject popup, and dispatch any
// call_received automations. Best-effort — never block the call.
async function notifyAndDispatch(input: {
  brandId: string;
  callId: string;
  numberId: string;
  leadId: string | null;
  leadName: string | null;
  leadOwnerId: string | null;
  ringMemberIds: string[];
  fromNumber: string;
  toNumber: string;
}) {
  const supabase = createAdminClient();
  try {
    // Union of routed members and the lead owner (matched lead's owner gets
    // a popup even if they aren't on the rotation).
    const recipients = new Set<string>(input.ringMemberIds);
    if (input.leadOwnerId) recipients.add(input.leadOwnerId);
    if (recipients.size > 0) {
      const who = input.leadName || input.fromNumber;
      const conferenceName = `inbound-${input.callId}`;
      const rows = Array.from(recipients).map((memberId) => ({
        brand_id: input.brandId,
        recipient_member_id: memberId,
        kind: 'inbound_call',
        title: `Inbound call from ${who}`,
        body: `${input.fromNumber} → ${input.toNumber}`,
        link_url: input.leadId ? `/leads/${input.leadId}` : `/calls`,
        data: {
          call_id: input.callId,
          lead_id: input.leadId,
          lead_name: input.leadName,
          from_number: input.fromNumber,
          to_number: input.toNumber,
          conference_name: conferenceName,
        },
      }));
      await supabase.from('notifications').insert(rows);
    }
  } catch (e) {
    console.error('[inbound:notify]', (e as Error).message);
  }
  try {
    await runAutomations({
      trigger: 'call_received',
      brandId: input.brandId,
      callId: input.callId,
      numberId: input.numberId,
      leadId: input.leadId,
      fromNumber: input.fromNumber,
      toNumber: input.toNumber,
    });
  } catch (e) {
    console.error('[inbound:automations]', (e as Error).message);
  }
}
