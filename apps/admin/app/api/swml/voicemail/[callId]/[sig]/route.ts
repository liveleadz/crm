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
  await supabase
    .from('calls')
    .update({
      recording_url: recordingUrl ?? null,
      duration_sec: Number.isFinite(duration) ? duration : null,
      ended_at: new Date().toISOString(),
      is_voicemail: true,
      disposition: 'voicemail',
    })
    .eq('id', callId);

  return NextResponse.json({ ok: true });
}

function pick(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}
