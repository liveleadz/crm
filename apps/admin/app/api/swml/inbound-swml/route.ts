// SWML inbound endpoint — the canonical Call Fabric path. Configured as
// the Primary Request URL on a SignalWire "Script" resource (SWML
// flavor). Each brand phone number is routed to that Script in the
// SignalWire dashboard, so PSTN inbound flows here as JSON-aware SWML
// instead of the legacy LaML pipeline.
//
// Routing semantics match the LaML inbound route:
//   1. resolve the number_id by To
//   2. read the brand's inbound_routes config
//   3. pick targets by strategy (simul / round_robin / single)
//   4. lookup target members' emails (each email = a SAT-token
//      Subscriber `reference`)
//   5. SWML connect.to /private/<email> dispatches to whichever browsers
//      have that subscriber online via client.online({ incomingCallHandlers })
//   6. on no-answer / refused, fall through to record (voicemail)
//
// Responses are SignalWire SWML JSON ({ version, sections: { main: [...] }})
// served with content-type: application/json.

import { NextResponse, type NextRequest } from 'next/server';
import { after } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { signRecordingPath, signVoicemailPath } from '@/lib/dial-token';
import { getPublicAppUrl, toE164 } from '@/lib/dialer';
import { runAutomations } from '@/lib/automation-engine';
import { findSubscriberAudioAddress } from '@/lib/signalwire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function swml(payload: object) {
  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const HANGUP_SWML = {
  version: '1.0.0',
  sections: { main: [{ hangup: { reason: 'normal' } }] },
};

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);

  // Parse SignalWire's body. Compatibility-API style is form-encoded; the
  // newer SWML pipeline POSTs JSON. Try both.
  let body: Record<string, unknown> = {};
  const raw = await req.text().catch(() => '');
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      const params = new URLSearchParams(raw);
      params.forEach((v, k) => {
        body[k] = v;
      });
    }
  }

  // The To/From may be nested under `call` in SWML JSON or top-level in
  // form-encoded LaML-style.
  const callObj = (body.call ?? {}) as Record<string, unknown>;
  const toRaw =
    pick(body, ['To', 'to']) ??
    pick(callObj, ['to', 'to_number']) ??
    url.searchParams.get('To') ??
    url.searchParams.get('to');
  const fromRaw =
    pick(body, ['From', 'from', 'caller', 'caller_id_number']) ??
    pick(callObj, ['from', 'from_number', 'caller_id_number']) ??
    url.searchParams.get('From') ??
    url.searchParams.get('from');

  const e164 = toRaw ? toE164(toRaw) : null;
  // Server-side log so SignalWire's exact request shape is visible in
  // Vercel logs the first time a real call hits.
  console.log('[inbound-swml] hit', {
    ct: req.headers.get('content-type'),
    rawLen: raw.length,
    body: raw.slice(0, 400),
    parsedTo: toRaw,
    parsedFrom: fromRaw,
    resolvedE164: e164,
  });
  if (!e164) return swml(HANGUP_SWML);
  const fromNumber = fromRaw ? toE164(fromRaw) ?? fromRaw : 'unknown';

  const supabase = createAdminClient();

  const { data: numberRow } = await supabase
    .from('numbers')
    .select('id, brand_id')
    .eq('e164', e164)
    .maybeSingle();
  if (!numberRow) return swml(HANGUP_SWML);

  const { data: route } = await supabase
    .from('inbound_routes')
    .select(
      'strategy, member_ids, ring_timeout_sec, voicemail_enabled, voicemail_greeting, last_rung_member_id',
    )
    .eq('number_id', numberRow.id)
    .maybeSingle();

  const strategy = (route?.strategy ?? 'simul') as 'simul' | 'round_robin' | 'single';
  const targetMemberIds = pickTargetsForStrategy(
    strategy,
    route?.member_ids ?? [],
    route?.last_rung_member_id ?? null,
  );

  const ringEmails: string[] = [];
  let nextRotationMemberId: string | null = null;
  if (targetMemberIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, email')
      .in('id', targetMemberIds);
    const byId = new Map((members ?? []).map((m) => [m.id, m] as const));
    for (const id of targetMemberIds) {
      const m = byId.get(id);
      if (m?.email) {
        ringEmails.push(m.email.toLowerCase());
        if (strategy === 'round_robin' && !nextRotationMemberId) {
          nextRotationMemberId = id;
        }
      }
    }
  }
  if (strategy === 'round_robin' && nextRotationMemberId) {
    void supabase
      .from('inbound_routes')
      .update({ last_rung_member_id: nextRotationMemberId })
      .eq('number_id', numberRow.id);
  }

  // Lead match for attribution + popup data + missed-call notification.
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

  // SignalWire's call identifier. The same real call gets retried by
  // the platform when our response is slow or transient 5xxs, and each
  // retry hit this webhook with the SAME call_id. Without dedup, every
  // retry inserted a fresh `calls` row + a fresh "Missed call"
  // notification — that's how the Live Floor ended up showing 25
  // phantom rows for a single real inbound.
  const swCallId =
    pick(callObj, ['call_id', 'id']) ??
    pick(body, ['CallSid', 'call_id']) ??
    null;

  let callId: string | null = null;
  let isRetry = false;
  if (swCallId) {
    const { data: existing } = await supabase
      .from('calls')
      .select('id')
      .eq('brand_id', numberRow.brand_id)
      .eq('signalwire_call_id', swCallId)
      .maybeSingle();
    if (existing?.id) {
      callId = existing.id;
      isRetry = true;
    }
  }
  if (!callId) {
    const { data: callRow } = await supabase
      .from('calls')
      .insert({
        brand_id: numberRow.brand_id,
        number_id: numberRow.id,
        lead_id: leadId,
        direction: 'inbound',
        from_number: fromNumber,
        to_number: e164,
        started_at: new Date().toISOString(),
        signalwire_call_id: swCallId,
      })
      .select('id')
      .single();
    callId = callRow?.id ?? null;
  }

  // Insert a "Missed call" notification up-front for the assigned
  // members (and the lead owner if matched). claimRecentInboundCall
  // marks these as READ when the agent picks up — so the bell only ever
  // shows truly missed calls. Voicemail webhook updates the title
  // afterwards if a recording was left. Skipped on retries: the
  // first hit already inserted them.
  if (callId && !isRetry) {
    void notifyMissedCall({
      brandId: numberRow.brand_id,
      callId,
      leadId,
      leadName,
      leadOwnerId,
      ringMemberIds: targetMemberIds,
      fromNumber,
      toNumber: e164,
    });
    // The SWML response must return fast or SignalWire drops the call, so
    // we hand the automations off to `after()` — Next 15 keeps the lambda
    // alive until this Promise settles even though the HTTP response has
    // already been sent. This is the only correct shape on Vercel: plain
    // `void` lets the lambda terminate mid-run, killing in-flight work.
    after(
      runAutomations({
        trigger: 'call_received',
        brandId: numberRow.brand_id,
        callId,
        numberId: numberRow.id,
        leadId,
        fromNumber,
        toNumber: e164,
      }).catch((e) => {
        console.error('[inbound-swml:automations]', (e as Error).message);
      })
    );
  }

  // Compose the SWML response.
  //
  // Recording starts INSIDE the connect (record_call action runs after
  // bridge), so the agent's playback only contains the actual conversation
  // — no "Connecting your call" TTS, no waiting silence, no ring tones.
  // Voicemail uses its own record_call inside connect.result on no-answer.
  const sections: Array<Record<string, unknown>> = [
    { answer: {} },
    { play: { url: 'say:Connecting your call.' } },
  ];
  const recSig = callId ? signRecordingPath(callId) : null;
  const recStatusUrl =
    callId && recSig
      ? `${getPublicAppUrl()}/api/swml/recording/${callId}/${recSig}`
      : null;

  // Shorter timeout than configured so callers don't sit in silence too
  // long when no agent is online — voicemail kicks in faster.
  const connectTimeout = Math.min(route?.ring_timeout_sec ?? 25, 15);

  // Build the voicemail action list (only run when connect doesn't bridge).
  const voicemailActions: Array<Record<string, unknown>> = [];
  if ((route?.voicemail_enabled ?? true) && callId) {
    const greeting =
      route?.voicemail_greeting ??
      "You've reached us. We can't take your call right now — please leave a message after the tone.";
    const vmSig = signVoicemailPath(callId);
    const vmUrl = `${getPublicAppUrl()}/api/swml/voicemail/${callId}/${vmSig}`;
    voicemailActions.push({ play: { url: `say:${greeting}` } });
    voicemailActions.push({
      record_call: {
        format: 'mp3',
        beep: true,
        max_length: 180,
        end_silence_timeout: 5,
        status_url: vmUrl,
      },
    });
  }

  if (ringEmails.length > 0) {
    const lookups = await Promise.all(
      ringEmails.map((email) => findSubscriberAudioAddress(email)),
    );
    const addresses: string[] = [];
    ringEmails.forEach((email, i) => {
      const addr = lookups[i];
      if (addr) {
        addresses.push(addr);
      } else {
        const localPart = email.split('@')[0];
        if (localPart) addresses.push(`/private/${localPart}`);
      }
    });
    console.log('[inbound-swml] dispatching to', addresses);
    if (addresses.length > 0) {
      // Connect bridges the caller to the agent. record_call lives INSIDE
      // the connect so the recording only captures the bridge audio (no
      // ring tones / "connecting your call" prefix). On no-answer or
      // failure, route to voicemail via connect.result. On a successful
      // bridge, the call ends when either side hangs up and falls through
      // to the final hangup (NOT to voicemail).
      const connectInner: Record<string, unknown> = {
        to: addresses.length === 1 ? addresses[0] : addresses,
        timeout: connectTimeout,
        from: fromNumber !== 'unknown' ? fromNumber : e164,
      };
      if (recStatusUrl) {
        connectInner.record_call = {
          format: 'mp3',
          stereo: true,
          direction: 'both',
          beep: false,
          status_url: recStatusUrl,
        };
      }
      if (voicemailActions.length > 0) {
        const failureBranch = { execute: voicemailActions };
        connectInner.result = {
          no_answer: failureBranch,
          failed: failureBranch,
          busy: failureBranch,
          canceled: failureBranch,
        };
      }
      sections.push({ connect: connectInner });
    } else if (voicemailActions.length > 0) {
      // No targets at all — go straight to voicemail.
      sections.push(...voicemailActions);
    }
  } else if (voicemailActions.length > 0) {
    sections.push(...voicemailActions);
  }

  sections.push({ hangup: { reason: 'normal' } });
  return swml({ version: '1.0.0', sections: { main: sections } });
}

function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickTargetsForStrategy(
  strategy: 'simul' | 'round_robin' | 'single',
  memberIds: string[],
  lastRung: string | null,
): string[] {
  if (memberIds.length === 0) return [];
  if (strategy === 'simul') return memberIds;
  if (strategy === 'single') return [memberIds[0]!];
  const lastIdx = lastRung ? memberIds.indexOf(lastRung) : -1;
  const start = lastIdx >= 0 ? (lastIdx + 1) % memberIds.length : 0;
  return [memberIds[start]!];
}

// Insert "Missed call" notifications for the routed members + lead owner.
// claimRecentInboundCall marks them as read when the agent answers, so the
// bell badge only accumulates rows for actually missed inbound. The
// voicemail webhook updates the row text if a recording is left.
async function notifyMissedCall(input: {
  brandId: string;
  callId: string;
  leadId: string | null;
  leadName: string | null;
  leadOwnerId: string | null;
  ringMemberIds: string[];
  fromNumber: string;
  toNumber: string;
}) {
  const supabase = createAdminClient();
  try {
    const recipients = new Set<string>(input.ringMemberIds);
    if (input.leadOwnerId) recipients.add(input.leadOwnerId);
    if (recipients.size === 0) return;
    const who = input.leadName || input.fromNumber;
    const rows = Array.from(recipients).map((memberId) => ({
      brand_id: input.brandId,
      recipient_member_id: memberId,
      kind: 'inbound_call',
      title: `Missed call from ${who}`,
      body: `${input.fromNumber} → ${input.toNumber}`,
      link_url: input.leadId ? `/leads/${input.leadId}` : `/calls`,
      data: {
        call_id: input.callId,
        lead_id: input.leadId,
        lead_name: input.leadName,
        from_number: input.fromNumber,
        to_number: input.toNumber,
      },
    }));
    await supabase.from('notifications').insert(rows);
  } catch (e) {
    console.error('[inbound-swml:notify]', (e as Error).message);
  }
}

