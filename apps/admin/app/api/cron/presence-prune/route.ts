// Phase U: nightly cleanup of stale `member_presence` rows.
//
// Members who churn (or brands that go dark) leave their row sitting
// at last_event_at = months ago. The Live Floor and sidebar widget
// already treat anything older than ~3 minutes as offline, so the row
// has no functional purpose past 30 days. Deleting it keeps the table
// small without affecting any active session.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRUNE_AFTER_DAYS = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60_000).toISOString();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('member_presence')
    .delete()
    .lt('last_event_at', cutoff)
    .select('member_id');
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
}
