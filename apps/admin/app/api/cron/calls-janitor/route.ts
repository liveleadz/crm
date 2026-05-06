// Calls janitor — every 5 minutes, close any call row whose
// `started_at` is older than 2 hours and whose `ended_at` is still
// null. These are orphans: dropped Twilio webhooks, crashed dialer
// legs, or seed rows. Left alone they:
//   - flood the Live Floor active-calls grid with phantom calls,
//   - hold member presence in `on_call`,
//   - skew today's call duration totals.
// Closing them stamps `ended_at = started_at + 2h` (the same horizon
// the Live Floor uses to treat a row as in-progress), and computes a
// duration_sec so reports stay sane.
//
// The 2h cap matches `ACTIVE_CALL_MAX_AGE_MS` in lib/live-floor.ts.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const STALE_DURATION_SEC = STALE_AFTER_MS / 1000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const cutoffIso = cutoff.toISOString();

  // Pull the candidate set first so we can stamp ended_at = started_at
  // + 2h per row (rather than `now()` which would inflate durations).
  const { data: stale, error: selErr } = await supabase
    .from('calls')
    .select('id, started_at')
    .is('ended_at', null)
    .lt('started_at', cutoffIso)
    .limit(1000);

  if (selErr) {
    return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 });
  }

  const rows = stale ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, closed: 0 });
  }

  let closed = 0;
  let lastError: string | null = null;
  for (const row of rows) {
    const startedMs = new Date(row.started_at).getTime();
    const endedIso = new Date(startedMs + STALE_AFTER_MS).toISOString();
    const { error: updErr } = await supabase
      .from('calls')
      .update({
        ended_at: endedIso,
        duration_sec: STALE_DURATION_SEC,
      })
      .eq('id', row.id)
      .is('ended_at', null);
    if (updErr) {
      lastError = updErr.message;
      continue;
    }
    closed += 1;
  }

  return NextResponse.json({ ok: true, closed, scanned: rows.length, lastError });
}
