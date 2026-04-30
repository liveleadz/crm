// Polled by the topbar bell every 30s to refresh badge count + dropdown.
// RLS-scoped — only returns rows the current member can see (their own
// or role broadcasts within their brand).

import { NextResponse } from 'next/server';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const brand = await getActiveBrand();
  if (!brand) return NextResponse.json({ ok: false, items: [], unread: 0 }, { status: 401 });

  const supabase = await createServerClient();
  const { data } = await supabase
    .from('notifications')
    .select('id, kind, title, body, link_url, data, read_at, created_at')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const items = data ?? [];
  const unread = items.filter((r) => !r.read_at).length;
  return NextResponse.json({ ok: true, items, unread });
}
