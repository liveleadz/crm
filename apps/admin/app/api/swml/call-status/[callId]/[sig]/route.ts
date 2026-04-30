// Receives the call-status callback fired by `connect.status_url` in the
// SWML response. Captures the SIP response code, hangup cause, and (when
// SignalWire surfaces it) the STIR/SHAKEN attestation level so the Numbers
// page can score outbound deliverability without a paid lookup API.
//
// Path-signed with signCallStatusPath() so the webhook stays stateless.
// The body shape is whatever SignalWire posts on call completion — we look
// across a few common shapes (LAML, Relay, raw form-urlencoded) so the
// route is robust to small SignalWire format drift.

import { NextResponse, type NextRequest } from 'next/server';
import { verifyCallStatusPath } from '@/lib/dial-token';
import { createAdminClient } from '@leadpilot/db/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ callId: string; sig: string }> },
) {
  const { callId, sig } = await params;
  if (!verifyCallStatusPath(callId, sig)) {
    return NextResponse.json({ ok: false, error: 'bad sig' }, { status: 401 });
  }

  // Body parsing — SignalWire SWML status callbacks land as
  // application/x-www-form-urlencoded most commonly, but Relay payloads
  // sometimes arrive as JSON. Take both.
  let body: Record<string, unknown> = {};
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      body = (await req.json()) as Record<string, unknown>;
    } else {
      const text = await req.text();
      const params = new URLSearchParams(text);
      params.forEach((value, key) => {
        body[key] = value;
      });
    }
  } catch {
    /* fall through with empty body */
  }

  const sipResponse = pickInt(body, [
    'SipResponseCode',
    'sip_response_code',
    'sip_status',
    'sip_response',
    'response_code',
  ]);
  const hangupCause = pickString(body, [
    'HangupCause',
    'hangup_cause',
    'CallStatusCallbackEvent',
    'call_state',
    'reason',
    'EndReason',
    'end_reason',
  ]);
  const stir = normalizeAttestation(
    pickString(body, [
      'StirAttestation',
      'stir_attestation',
      'verstat',
      'StirVerstat',
      'attestation',
    ]),
  );

  const supabase = createAdminClient();
  const patch: {
    sip_response?: number | null;
    hangup_cause?: string | null;
    stir_attestation?: 'A' | 'B' | 'C' | null;
  } = {};
  if (sipResponse !== null) patch.sip_response = sipResponse;
  if (hangupCause) patch.hangup_cause = hangupCause;
  if (stir) patch.stir_attestation = stir;

  if (Object.keys(patch).length > 0) {
    await supabase.from('calls').update(patch).eq('id', callId);
  }

  return NextResponse.json({ ok: true });
}

function pickInt(body: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string') {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickString(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function normalizeAttestation(raw: string | null): 'A' | 'B' | 'C' | null {
  if (!raw) return null;
  const v = raw.toUpperCase();
  if (v === 'A' || v === 'B' || v === 'C') return v;
  // Verstat-style strings: "TN-Validation-Passed" → A, "TN-Validation-Passed-A" → A,
  // "Tn-Validation-Failed" → C-ish; map best-effort.
  if (v.includes('PASSED-A') || v.endsWith('-A')) return 'A';
  if (v.includes('PASSED-B') || v.endsWith('-B')) return 'B';
  if (v.includes('PASSED-C') || v.endsWith('-C')) return 'C';
  if (v.includes('FAILED')) return 'C';
  if (v.includes('PASSED')) return 'A';
  return null;
}
