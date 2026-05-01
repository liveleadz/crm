// Cron route: pull external calendar updates for every active externally-bound
// calendar that hasn't been synced in the last 50s. Mirrors the auth pattern
// from outbox-drain (Vercel auto-injects Authorization: Bearer ${CRON_SECRET}).

import { NextResponse } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { pullCalendar } from '@/lib/calendar/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH = 25;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - 50_000).toISOString();
  const { data: rows, error } = await supabase
    .from('calendars')
    .select('id, ext_last_sync_at')
    .eq('is_active', true)
    .not('ext_provider', 'is', null)
    .or(`ext_last_sync_at.is.null,ext_last_sync_at.lt.${cutoff}`)
    .order('ext_last_sync_at', { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const calendars = rows ?? [];
  if (calendars.length === 0) {
    return NextResponse.json({ ok: true, pulled: 0 });
  }

  let upserts = 0;
  let removes = 0;
  let failed = 0;
  for (const c of calendars) {
    try {
      const r = await pullCalendar(c.id);
      upserts += r.upserts;
      removes += r.removes;
    } catch (e) {
      failed += 1;
      console.error('[cron.calendar-pull]', c.id, (e as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    pulled: calendars.length,
    upserts,
    removes,
    failed,
  });
}
