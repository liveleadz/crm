// Authenticated proxy for SignalWire-hosted call recordings.
//
// Browsers can't authenticate to SignalWire directly (Basic auth would
// require shipping the project secret). Instead the <audio> element hits
// this route with the call id; we verify the user is a member of the
// call's brand (RLS does it automatically), then stream the recording
// from SignalWire with project-level Basic auth.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@leadpilot/db/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS scopes the row to brands the user belongs to.
  const { data: call, error } = await supabase
    .from('calls')
    .select('id, recording_url')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!call || !call.recording_url) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const swProject = process.env.SIGNALWIRE_PROJECT_ID;
  const swToken = process.env.SIGNALWIRE_TOKEN;
  if (!swProject || !swToken) {
    return NextResponse.json({ error: 'env missing' }, { status: 500 });
  }

  const upstream = await fetch(call.recording_url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${swProject}:${swToken}`).toString('base64')}`,
      // Forward range requests so the browser can seek.
      ...(req.headers.get('range') ? { Range: req.headers.get('range') as string } : {}),
    },
  });

  const headers = new Headers();
  const ct = upstream.headers.get('content-type') ?? 'audio/mpeg';
  headers.set('content-type', ct);
  const cl = upstream.headers.get('content-length');
  if (cl) headers.set('content-length', cl);
  const cr = upstream.headers.get('content-range');
  if (cr) headers.set('content-range', cr);
  const ar = upstream.headers.get('accept-ranges');
  if (ar) headers.set('accept-ranges', ar);
  headers.set('cache-control', 'private, max-age=86400');

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
