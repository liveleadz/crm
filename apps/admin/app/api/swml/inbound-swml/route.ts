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
    })
    .select('id')
    .single();
  const callId = callRow?.id ?? null;

  // Dispatch any call_received automations (best-effort). Bell-style
  // notifications are NOT inserted here — that would alert the agent
  // about every inbound including ones they answer in real time. Missed-
  // call / voicemail notifications are inserted in the voicemail
  // webhook instead, which only fires when the call actually rolled to
  // voicemail.
  if (callId) {
    void runAutomations({
      trigger: 'call_received',
      brandId: numberRow.brand_id,
      callId,
      numberId: numberRow.id,
      leadId,
      fromNumber,
      toNumber: e164,
    }).catch((e) => {
      console.error('[inbound-swml:automations]', (e as Error).message);
    });
  }
  // Suppress unused warnings — these are kept for the voicemail-side
  // notification once we wire the missed-call path through that webhook.
  void leadName;
  void leadOwnerId;
  void targetMemberIds;

  // Compose the SWML response.
  //
  // 1. answer + a brief "connecting" cue so the caller knows the script
  //    is alive (vs. dead-air silence which is indistinguishable from a
  //    misconfigured webhook).
  // 2. connect to the routed subscribers via Call Fabric. We pass both
  //    /private/<reference> and /public/<reference> so the dispatch
  //    works regardless of which namespace the subscriber's default
  //    address landed in.
  // 3. On no-answer / refused, fall through to voicemail greeting (top-
  //    level `say` verb — `play.say.text` is NOT valid SWML and was
  //    the reason the previous fallback played silence) + record_call.
  // SWML's TTS goes through the `play` verb with a `say:` URL scheme. There
  // is NO top-level `say` action — passing one is silently ignored, which
  // is what made the call go dead-silent for 20s then hang up.
  // Record every call so the agent can replay it from /calls. The
  // record_call action runs against the inbound (caller) leg; when the
  // agent's leg connects via the connect verb below, the SDK side is
  // bridged into the same media path so audio from both ends is captured.
  // Voicemail uses its own record_call inside connect.result on no-answer.
  const sections: Array<Record<string, unknown>> = [
    { answer: {} },
  ];
  if (callId) {
    const recSig = signRecordingPath(callId);
    const recStatusUrl = `${getPublicAppUrl()}/api/swml/recording/${callId}/${recSig}`;
    sections.push({
      record_call: {
        format: 'mp3',
        stereo: true,
        direction: 'both',
        beep: false,
        status_url: recStatusUrl,
      },
    });
  }
  sections.push({ play: { url: 'say:Connecting your call.' } });

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
      // Connect bridges the caller to the agent. On no-answer / failure,
      // route to voicemail via connect.result so the voicemail prompt only
      // plays when nobody picked up. On a successful bridge, the call ends
      // when either side hangs up and we fall through to the final hangup
      // (NOT to voicemail) — fixing the bug where answered calls were
      // followed by the voicemail prompt + recording.
      const connectAction: Record<string, unknown> = {
        connect: {
          to: addresses.length === 1 ? addresses[0] : addresses,
          timeout: connectTimeout,
          from: fromNumber !== 'unknown' ? fromNumber : e164,
        },
      };
      if (voicemailActions.length > 0) {
        const failureBranch = { execute: voicemailActions };
        (connectAction.connect as Record<string, unknown>).result = {
          no_answer: failureBranch,
          failed: failureBranch,
          busy: failureBranch,
          canceled: failureBranch,
        };
      }
      sections.push(connectAction);
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

