// Issues a SignalWire Subscriber Access Token (SAT) for the current user.
// The browser uses this token to initialize the @signalwire/js client
// and place WebRTC calls into our SWML resource.
//
// Each member maps 1:1 to a SignalWire Subscriber via their email
// (`reference`). Subscribers are auto-provisioned on first request.
//
// Docs: https://signalwire.com/docs/apis/rest/subscribers/tokens/create-subscriber-token

import { NextResponse } from 'next/server';
import { createServerClient } from '@leadpilot/db/server';

export async function POST() {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const apiToken = process.env.SIGNALWIRE_TOKEN;
  const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
  if (!projectId || !apiToken || !spaceUrl) {
    return NextResponse.json(
      { error: 'SignalWire env not configured.' },
      { status: 500 },
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const cleanSpace = spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const endpoint = `https://${cleanSpace}/api/fabric/subscribers/tokens`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      reference: user.email.toLowerCase(),
      // Two-hour expiry is the API default; let the SDK refresh as needed.
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `SignalWire ${res.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const json = (await res.json()) as {
    subscriber_id?: string;
    token?: string;
    refresh_token?: string;
  };
  if (!json.token) {
    return NextResponse.json({ error: 'SignalWire returned no token.' }, { status: 502 });
  }

  return NextResponse.json({
    token: json.token,
    subscriberId: json.subscriber_id ?? null,
  });
}
