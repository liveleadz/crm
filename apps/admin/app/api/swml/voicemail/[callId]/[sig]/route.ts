// Voicemail recording callback — SignalWire posts here when an inbound
// call's record_call section finishes. We mark the calls row as a
// voicemail and stamp the recording URL.
//
// Path-signed with signVoicemailPath(); separate namespace from the
// standard recording sig so a leak can't be cross-replayed.

import { NextResponse, type NextRequest } from 'next/server';
import { verifyVoicemailPath } from '@/lib/dial-token';
import { createAdminClient } from '@leadpilot/db/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ callId: string; sig: string }> },
) {
  const { callId, sig } = await params;
  if (!verifyVoicemailPath(callId, sig)) {
    return NextResponse.json({ ok: false, error: 'bad sig' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  const ct = req.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) {
      body = (await req.json()) as Record<string, unknown>;
    } else {
      const params = new URLSearchParams(await req.text());
      params.forEach((v, k) => {
        body[k] = v;
      });
    }
  } catch {
    /* ignore */
  }

  const recordingUrl = pick(body, ['RecordingUrl', 'recording_url', 'url']);
  const durationRaw = pick(body, ['RecordingDuration', 'duration_sec', 'duration']);
  const duration = durationRaw ? Number.parseInt(durationRaw, 10) : null;

  const supabase = createAdminClient();
  // Stamp recording on the call row, return the row so we can use its
  // brand_id + lead for the missed-call notification.
  const { data: callRow } = await supabase
    .from('calls')
    .update({
      recording_url: recordingUrl ?? null,
      duration_sec: Number.isFinite(duration) ? duration : null,
      ended_at: new Date().toISOString(),
      is_voicemail: true,
      disposition: 'voicemail',
    })
    .eq('id', callId)
    .select(
      'brand_id, lead_id, from_number, to_number, leads(first_name, last_name, owner_id)',
    )
    .maybeSingle();

  // Insert a "Missed call" bell notification for the matched lead's
  // owner. Answered calls never roll to this webhook, so we only ping
  // when the call actually went to voicemail — that fixes the bug
  // where every inbound (including the ones we picked up) was producing
  // a "received an inbound call" notification.
  if (callRow) {
    const lead = callRow.leads as
      | { first_name: string | null; last_name: string | null; owner_id: string | null }
      | null;
    const ownerId = lead?.owner_id ?? null;
    if (ownerId) {
      const leadName = lead
        ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
        : null;
      const who = leadName || callRow.from_number;
      try {
        await supabase.from('notifications').insert({
          brand_id: callRow.brand_id,
          recipient_member_id: ownerId,
          kind: 'inbound_call',
          title: `Missed call from ${who}`,
          body: `${callRow.from_number} → ${callRow.to_number} · voicemail recorded`,
          link_url: callRow.lead_id ? `/leads/${callRow.lead_id}` : `/calls`,
          data: {
            call_id: callId,
            lead_id: callRow.lead_id,
            from_number: callRow.from_number,
            to_number: callRow.to_number,
            is_voicemail: true,
          },
        });
      } catch (e) {
        console.error('[voicemail:notify]', (e as Error).message);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

function pick(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}
