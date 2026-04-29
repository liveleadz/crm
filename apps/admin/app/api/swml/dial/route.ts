// SWML callback for the WebRTC dialer.
//
// Configured as the Primary Request URL on the SignalWire SWML Webhook
// resource named `leadpilot-dialer`. When the browser dials
// `/public/leadpilot-dialer?channel=audio` (with the token in
// userVariables), SignalWire fetches this URL with call info and our
// userVariables in the body, then executes the SWML we return.
//
// We extract the signed dial token from the request, verify it,
// and respond with a <connect> action that bridges to the lead with
// the brand's caller-ID.
//
// Every hit is also persisted to the `swml_debug` table so we can
// inspect what SignalWire actually sends. Remove the debug write once
// /dialer-v2 is verified.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
  const url = new URL(req.url);

  // Capture everything: SignalWire may send JSON, form-encoded, or
  // something else entirely depending on the resource configuration.
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  const rawBody = await req.text();
  let parsedBody: unknown = null;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    // Try urlencoded.
    try {
      const params = new URLSearchParams(rawBody);
      const obj: Record<string, string> = {};
      params.forEach((v, k) => {
        obj[k] = v;
      });
      parsedBody = Object.keys(obj).length ? obj : null;
    } catch {
      parsedBody = null;
    }
  }

  // Try to find the token in any plausible location.
  let token = url.searchParams.get('t');
  if (!token && parsedBody && typeof parsedBody === 'object') {
    token = extractTokenFromBody(parsedBody as Record<string, unknown>);
  }

  const responseSwml = (() => {
    if (!token) return HANGUP_SWML;
    const payload = verifyDialToken(token);
    if (!payload) return HANGUP_SWML;
    return {
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
  })();

  // Fire-and-forget debug write. Service-role bypass on RLS.
  void writeDebug({
    method: req.method,
    url: req.url,
    query,
    headers,
    body: parsedBody,
    bodyText: rawBody.length ? rawBody.slice(0, 8000) : null,
    response: responseSwml,
  });

  return jsonSwmlResponse(responseSwml);
}

async function writeDebug(row: {
  method: string;
  url: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  bodyText: string | null;
  response: unknown;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    await sb.from('swml_debug').insert({
      method: row.method,
      url: row.url,
      query: row.query,
      headers: row.headers,
      body: row.body,
      body_text: row.bodyText,
      response: row.response,
    });
  } catch {
    // Don't let debug logging break the SWML response.
  }
}

function extractTokenFromBody(body: Record<string, unknown>): string | null {
  const candidates: unknown[] = [];

  // Direct fields the dial() call may surface as.
  candidates.push(body['t'], body['token']);

  // Nested under user_variables (Call Fabric's documented forwarding).
  const uv = body['user_variables'];
  if (uv && typeof uv === 'object') {
    const o = uv as Record<string, unknown>;
    candidates.push(o['t'], o['token']);
  }

  // Nested under call.user_variables / call.userVariables.
  const call = body['call'];
  if (call && typeof call === 'object') {
    const c = call as Record<string, unknown>;
    candidates.push(c['t'], c['token']);
    candidates.push(c['to'], c['address']);
    for (const key of ['user_variables', 'userVariables']) {
      const o = c[key];
      if (o && typeof o === 'object') {
        const oo = o as Record<string, unknown>;
        candidates.push(oo['t'], oo['token']);
      }
    }
  }

  // The dialed address may be present somewhere with our query string.
  candidates.push(body['to'], body['address']);

  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    const qIdx = c.indexOf('?');
    if (qIdx >= 0) {
      const params = new URLSearchParams(c.slice(qIdx + 1));
      const t = params.get('t');
      if (t) return t;
    }
    if (c.includes('.') && !c.includes('/')) return c;
  }
  return null;
}
