// Public LaML callback for outbound bridge calls. SignalWire fetches this
// after the agent's leg connects; we return XML telling SignalWire to dial
// the lead with our brand caller-ID.
//
// URL contract: /api/laml/dial?to={leadE164}&from={brandE164}&secret={LAML_WEBHOOK_SECRET}
//
// SignalWire will sign requests with X-Twilio-Signature, but for MVP we
// validate a shared secret in the query string. Replace with HMAC verify
// before letting non-test numbers hit this.

import { NextResponse, type NextRequest } from 'next/server';

function xmlResponse(xml: string) {
  return new NextResponse(xml, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const expected = process.env.LAML_WEBHOOK_SECRET;
  if (!expected || searchParams.get('secret') !== expected) {
    return xmlResponse('<Response><Hangup/></Response>');
  }
  const to = searchParams.get('to');
  const from = searchParams.get('from');
  if (!to || !from) {
    return xmlResponse('<Response><Hangup/></Response>');
  }
  // Bridge agent's leg to the lead. record-from-answer captures only the
  // talking portion; Supabase recording rows get linked via status webhook.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXml(from)}" timeout="25" record="record-from-answer" answerOnBridge="true">
    <Number>${escapeXml(to)}</Number>
  </Dial>
</Response>`;
  return xmlResponse(xml);
}
