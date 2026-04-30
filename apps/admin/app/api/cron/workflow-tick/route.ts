// Cron tick that resumes graph-mode automation runs whose wait timers fired.
//
// Scheduled by vercel.json at /apps/admin/vercel.json (1-minute cadence).
// Vercel Cron auto-injects an Authorization: Bearer ${CRON_SECRET} header
// when CRON_SECRET is set in env. Manual calls must include the same header.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { tickGraphRun } from '@/lib/workflow-graph-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH = 50;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  // Service-role client: cron runs without a user session, so RLS is bypassed
  // intentionally for the dispatcher query. Each run's actions still execute
  // through the engine's per-call createServerClient() which is RLS-scoped.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('id')
    .eq('status', 'waiting')
    .lte('next_run_at', new Date().toISOString())
    .not('automation_id', 'is', null)
    .order('next_run_at', { ascending: true })
    .limit(BATCH);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ids = (data ?? []).map((r) => r.id);
  for (const id of ids) {
    try {
      await tickGraphRun(id);
    } catch (e) {
      console.error('[cron:workflow-tick]', id, (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true, ticked: ids.length });
}
