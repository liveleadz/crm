// SignalWire posts call status updates here. We map the status to a
// disposition and update the matching `calls` row by signalwire_call_id.
//
// URL contract: /api/laml/status?secret={LAML_WEBHOOK_SECRET}
// SignalWire form-encodes: CallSid, CallStatus, CallDuration, RecordingUrl…

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@leadpilot/db/types';

type CallStatus =
  | 'queued'
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'canceled'
  | 'failed';

const STATUS_TO_DISPOSITION: Record<
  CallStatus,
  Database['public']['Enums']['call_disposition'] | null
> = {
  queued: null,
  initiated: null,
  ringing: null,
  'in-progress': null,
  completed: 'connected',
  busy: 'busy',
  'no-answer': 'no_answer',
  canceled: 'failed',
  failed: 'failed',
};

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const expected = process.env.LAML_WEBHOOK_SECRET;
  if (!expected || searchParams.get('secret') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const form = await request.formData();
  const callSid = (form.get('CallSid') as string | null) ?? null;
  const status = (form.get('CallStatus') as CallStatus | null) ?? null;
  const duration = Number(form.get('CallDuration') ?? 0) || null;
  const recordingUrl = (form.get('RecordingUrl') as string | null) ?? null;
  if (!callSid || !status) {
    return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 });
  }

  // Service-role client: webhooks have no user session and need to bypass RLS
  // to update the call row regardless of which brand it belongs to.
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const update: {
    disposition?: Database['public']['Enums']['call_disposition'];
    duration_sec?: number;
    recording_url?: string;
    ended_at?: string;
  } = {};

  const disposition = STATUS_TO_DISPOSITION[status];
  if (disposition) update.disposition = disposition;
  if (duration) update.duration_sec = duration;
  if (recordingUrl) update.recording_url = recordingUrl;
  if (status === 'completed' || status === 'failed' || status === 'canceled' ||
      status === 'busy' || status === 'no-answer') {
    update.ended_at = new Date().toISOString();
  }

  if (Object.keys(update).length > 0) {
    await supabase.from('calls').update(update).eq('signalwire_call_id', callSid);
  }

  return NextResponse.json({ ok: true });
}
