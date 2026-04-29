// SWML callback for the WebRTC dialer.
//
// Configured as the Primary Request URL on the SignalWire SWML Webhook
// resource named `leadpilot-dialer`. When the browser dials
// `/public/leadpilot-dialer?channel=audio` (with the dial token in
// userVariables), SignalWire POSTs this URL with call info, then executes
// the SWML we return.
//
// We extract the signed dial token, verify it, and respond with a
// `record_call` action followed by `connect` to bridge the lead with the
// brand's caller-ID. The recording status callback hits
// /api/swml/recording with a separately-signed token so we can update the
// `calls` row when the recording is ready.

import { NextResponse, type NextRequest } from 'next/server';
import { signRecordingToken, verifyDialToken } from '@/lib/dial-token';
import { getPublicAppUrl } from '@/lib/dialer';

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

  let parsedBody: unknown = null;
  const rawBody = await req.text();
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
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
  }

  let token = url.searchParams.get('t');
  if (!token && parsedBody && typeof parsedBody === 'object') {
    token = extractTokenFromBody(parsedBody as Record<string, unknown>);
  }
  if (!token) return jsonSwmlResponse(HANGUP_SWML);

  const payload = verifyDialToken(token);
  if (!payload) return jsonSwmlResponse(HANGUP_SWML);

  // We don't have brand_id in the dial token, but the recording route
  // verifies the call row matches its own RLS check by callId, so brand
  // lookup happens there. We only need callId in the recording token.
  const recToken = signRecordingToken({
    callId: payload.callId,
    brandId: '',
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 6, // 6h to allow for slow recordings
  });

  const statusUrl = `${getPublicAppUrl()}/api/swml/recording?t=${encodeURIComponent(recToken)}`;

  // Answer the WebRTC leg explicitly first — otherwise record_call runs
  // before the call is answered (because connect.answer_on_bridge defers
  // answer until the PSTN leg picks up) and the script aborts. Once we
  // answer ourselves, record_call has live media, then connect bridges
  // to the PSTN with a ringback so the agent still hears it ring.
  return jsonSwmlResponse({
    version: '1.0.0',
    sections: {
      main: [
        { answer: {} },
        {
          record_call: {
            format: 'mp3',
            stereo: true,
            direction: 'both',
            status_url: statusUrl,
            beep: false,
          },
        },
        {
          connect: {
            from: payload.from,
            to: payload.to,
            timeout: 25,
            ringback: ['%(2000,4000,440,480)'],
          },
        },
      ],
    },
  });
}

function extractTokenFromBody(body: Record<string, unknown>): string | null {
  const candidates: unknown[] = [];

  candidates.push(body['t'], body['token']);

  const uv = body['user_variables'];
  if (uv && typeof uv === 'object') {
    const o = uv as Record<string, unknown>;
    candidates.push(o['t'], o['token']);
  }

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
