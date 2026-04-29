// Admin-only inspector for the swml_debug table. Returns the most recent
// SignalWire SWML webhook calls so we can see what payload shape they
// actually use. Remove once /dialer-v2 is verified.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@leadpilot/db/server';

const ALLOWED_EMAILS = new Set(['hello@liveleadz.com', 'hello@buyersignals.io']);

export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email || !ALLOWED_EMAILS.has(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    return NextResponse.json({ error: 'env missing' }, { status: 500 });
  }
  const admin = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from('swml_debug')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}
