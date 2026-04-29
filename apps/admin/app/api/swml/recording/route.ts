// SignalWire `record_call` status callback.
//
// Configured as the status_url on the record_call SWML action returned by
// /api/swml/dial. SignalWire POSTs us a payload describing the recording
// state (recording, paused, finished, error, no_input). On `finished` we:
//   1. Persist the recording URL + duration on the `calls` row.
//   2. Kick off Whisper transcription in the background.
//
// Auth: the status URL contains a HMAC-signed RecordingTokenPayload
// (callId, exp). We never trust call-id from the body alone.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRecordingToken } from '@/lib/dial-token';
import { transcribeRecording } from '@/lib/transcribe';

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 401 });
  const payload = verifyRecordingToken(token);
  if (!payload) return NextResponse.json({ error: 'bad token' }, { status: 401 });

  // Capture both JSON and form-encoded bodies — SignalWire varies.
  const raw = await req.text();
  const data = parseBody(raw);

  // We only act on the terminal "finished" event. Other events (recording,
  // paused) we ack with 200 and ignore.
  const state = pickString(data, ['state', 'event', 'status']);
  if (state && state !== 'finished') {
    return NextResponse.json({ ok: true, ignored: state });
  }

  const recordingUrl = pickString(data, ['url', 'recording_url', 'media_url']);
  const recordingSid = pickString(data, ['sid', 'recording_sid', 'control_id']);
  const durationStr = pickString(data, ['duration', 'duration_sec', 'recording_duration']);
  const duration = durationStr ? Math.round(Number(durationStr)) : null;

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    return NextResponse.json({ error: 'env missing' }, { status: 500 });
  }
  const admin = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  await admin
    .from('calls')
    .update({
      recording_url: recordingUrl ?? null,
      recording_sid: recordingSid ?? null,
      recording_duration_sec: Number.isFinite(duration) ? duration : null,
      transcript_status: recordingUrl ? 'pending' : 'skipped',
    })
    .eq('id', payload.callId);

  // Fire-and-forget transcription. We respond 200 to SignalWire
  // immediately so it doesn't retry while we wait on Whisper.
  if (recordingUrl) {
    void runTranscription(payload.callId, recordingUrl);
  }

  return NextResponse.json({ ok: true });
}

async function runTranscription(callId: string, recordingUrl: string) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return;
  const admin = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  // SignalWire recordings can take a few seconds to be fetchable after
  // the finished event. Give it a brief grace period.
  await new Promise((r) => setTimeout(r, 3000));

  const result = await transcribeRecording(recordingUrl);
  if (result.ok) {
    await admin
      .from('calls')
      .update({ transcript: result.text, transcript_status: 'ready' })
      .eq('id', callId);
  } else {
    await admin
      .from('calls')
      .update({
        transcript_status: result.reason === 'no_key' ? 'skipped' : 'failed',
      })
      .eq('id', callId);
  }
}

function parseBody(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') return flatten(j as Record<string, unknown>);
  } catch {
    // fall through to form-encoded
  }
  try {
    const params = new URLSearchParams(raw);
    const obj: Record<string, unknown> = {};
    params.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  } catch {
    return {};
  }
}

// Lift one level of nested objects so pickString can find values
// regardless of whether SignalWire nests them under `params`, `recording`, etc.
function flatten(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        if (out[k] === undefined) out[k] = vv;
      }
    }
  }
  return out;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}
