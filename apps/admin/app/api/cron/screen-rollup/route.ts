// Phase R backstop. `pingPresence` persists yesterday's seconds inline
// the moment an agent comes back the next day. This cron handles the
// case where they don't — the row sits at midnight with seconds_today
// > 0 and last_session_started_at on a prior brand-local day. We
// snapshot it into `member_screen_daily` and reset the live row.
//
// Hourly cadence is fine: it covers every brand timezone within the
// hour, and the read query is bounded (`seconds_today > 0`).

import { NextResponse } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function localDayKey(iso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(iso));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();

  // Pull every brand id + timezone in one shot. Brand counts are small.
  const { data: brands, error: brandsErr } = await supabase
    .from('brands')
    .select('id, timezone');
  if (brandsErr) {
    return NextResponse.json({ ok: false, error: brandsErr.message }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  let snapshotted = 0;

  for (const brand of brands ?? []) {
    const tz = brand.timezone || 'UTC';
    const todayKey = localDayKey(nowIso, tz);

    const { data: rows } = await supabase
      .from('member_presence')
      .select('member_id, seconds_today, last_session_started_at')
      .eq('brand_id', brand.id)
      .gt('seconds_today', 0);

    for (const row of rows ?? []) {
      if (!row.last_session_started_at) continue;
      const dayKey = localDayKey(row.last_session_started_at, tz);
      if (dayKey === todayKey) continue; // still today's session — nothing to roll.

      // Snapshot the prior day, then reset the live row. Order matters
      // (snapshot first) so a mid-loop crash never loses data.
      const { error: snapErr } = await supabase
        .from('member_screen_daily')
        .upsert(
          {
            brand_id: brand.id,
            member_id: row.member_id,
            day_local: dayKey,
            seconds_on_screen: row.seconds_today,
          },
          { onConflict: 'brand_id,member_id,day_local' },
        );
      if (snapErr) continue;

      await supabase
        .from('member_presence')
        .update({
          seconds_today: 0,
          last_session_started_at: nowIso,
        })
        .eq('brand_id', brand.id)
        .eq('member_id', row.member_id);

      snapshotted++;
    }
  }

  return NextResponse.json({ ok: true, snapshotted });
}
