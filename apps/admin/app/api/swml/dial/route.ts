// SWML callback for the WebRTC dialer.
//
// Configured as the Primary Request URL on the SignalWire SWML Webhook
// resource named `leadpilot-dialer`. When the browser dials
// `/private/leadpilot-dialer?t=<token>`, SignalWire fetches this URL
// (passing the call info, including the dialed address) and executes
// the SWML we return.
//
// We extract the signed dial token from the request, verify it,
// and respond with a <connect> action that bridges to the lead with
// the brand's caller-ID.

import { NextResponse, type NextRequest } from 'next/server';
import { verifyDialToken } from '@/lib/dial-token';

function jsonSwmlResponse(swml: object) {
  return new NextResponse(JSON.stringify(swml), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const HANGUP_SWML = {
  version: '1.0.0',
  sections: { main: [{ hangup: { reason: 'rejected' } }] },
};

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  // SignalWire passes the original dialed address (with our query params)
  // somewhere in the request. We accept the token from either:
  //   - direct query string on this URL, or
  //   - body fields like `call.to` containing the dial address.
  const url = new URL(req.url);
  let token = url.searchParams.get('t');

  if (!token) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      token = extractTokenFromBody(body);
    } catch {
      // not JSON; ignore
    }
  }

  if (!token) return jsonSwmlResponse(HANGUP_SWML);

  const payload = verifyDialToken(token);
  if (!payload) return jsonSwmlResponse(HANGUP_SWML);

  const swml = {
    version: '1.0.0',
    sections: {
      main: [
        {
          connect: {
            from: payload.from,
            to: payload.to,
            timeout: 25,
            answer_on_bridge: true,
          },
        },
      ],
    },
  };
  return jsonSwmlResponse(swml);
}

// Best-effort dig for our token in nested SignalWire webhook payloads.
function extractTokenFromBody(body: Record<string, unknown>): string | null {
  // Common shapes: { call: { to: '/private/leadpilot-dialer?t=...' } }
  // or { to: '...' }, or user_variables.{t}.
  const candidates: unknown[] = [];
  const call = body['call'];
  if (call && typeof call === 'object') {
    const c = call as Record<string, unknown>;
    candidates.push(c['to'], c['address']);
    const uv = c['user_variables'];
    if (uv && typeof uv === 'object') {
      candidates.push((uv as Record<string, unknown>)['t']);
    }
  }
  candidates.push(body['to'], body['address']);
  const uv = body['user_variables'];
  if (uv && typeof uv === 'object') {
    candidates.push((uv as Record<string, unknown>)['t']);
  }

  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    // Token might be the raw value, or embedded in a URL/path.
    const qIdx = c.indexOf('?');
    if (qIdx >= 0) {
      const params = new URLSearchParams(c.slice(qIdx + 1));
      const t = params.get('t');
      if (t) return t;
    }
    // Or the value itself looks like our token (body.sig).
    if (c.includes('.') && !c.includes('/')) return c;
  }
  return null;
}
