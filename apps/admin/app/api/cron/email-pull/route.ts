// Cron route: pull inbound Gmail history for every member who has the
// 'email' OAuth scope. Mirrors the auth pattern from outbox-drain
// (Vercel auto-injects Authorization: Bearer ${CRON_SECRET}).

import { NextResponse } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { pullForMember } from '@/lib/email/sync';

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
  // Members with email scope. Pick those whose checkpoint is null or
  // older than 50s so we always make forward progress without piling up
  // duplicate work on a slow tick.
  const cutoff = new Date(Date.now() - 50_000).toISOString();
  const { data: members, error } = await supabase
    .from('members')
    .select('id, oauth_scopes, email_sync_state(last_synced_at)')
    .eq('email_provider', 'google')
    .contains('oauth_scopes', ['email'])
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const eligible = (members ?? []).filter((m) => {
    const state = Array.isArray(m.email_sync_state)
      ? m.email_sync_state[0]
      : m.email_sync_state;
    const last = state?.last_synced_at as string | undefined | null;
    return !last || last < cutoff;
  });

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const m of eligible) {
    try {
      const r = await pullForMember(m.id);
      inserted += r.inserted;
      skipped += r.skipped;
      // Double-pass: if the first pull surfaced new messages, run one
      // more delta immediately to catch mail that landed mid-pull. We
      // bypass the 5s debounce here so the retry actually runs.
      if (r.inserted > 0) {
        const r2 = await pullForMember(m.id, { force: true });
        inserted += r2.inserted;
        skipped += r2.skipped;
      }
    } catch (e) {
      failed += 1;
      console.error('[cron.email-pull]', m.id, (e as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    pulled: eligible.length,
    inserted,
    skipped,
    failed,
  });
}
