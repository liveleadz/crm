// Phase S: SLA evaluator. Runs every 5 minutes (vercel.json), iterates
// brands, and writes/clears `sla_violations` rows so /team can render
// open issues in the manager-alerts card.
//
// Two rules in v1:
//   - agent_idle: presence.status = 'idle' AND last_event_at is 30+
//     minutes old AND less than the 3-min staleness window from
//     `lib/presence.ts`. (Past staleness, the row is treated as
//     offline by the rest of the app — flagging that as idle would
//     be a false positive.)
//   - no_calls_active: presence.status in ('active','on_call') AND
//     last_session_started_at is 30+ minutes old AND the agent has
//     placed zero calls in the last 30 minutes. The session-age gate
//     keeps us from alerting an agent who just logged in.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IDLE_THRESHOLD_MS = 30 * 60_000;
const NO_CALLS_THRESHOLD_MS = 30 * 60_000;
// Mirrors lib/presence.ts STALE_MS — past this, status reads as offline.
const STALE_MS = 3 * 60 * 1000;

type Kind = 'agent_idle' | 'no_calls_active';
type Sb = ReturnType<typeof createAdminClient>;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const { data: brands, error: brandsErr } = await supabase
    .from('brands')
    .select('id');
  if (brandsErr) {
    return NextResponse.json({ ok: false, error: brandsErr.message }, { status: 500 });
  }

  const now = Date.now();
  const noCallsCutoffIso = new Date(now - NO_CALLS_THRESHOLD_MS).toISOString();

  let opened = 0;
  let bumped = 0;
  let cleared = 0;

  for (const brand of brands ?? []) {
    const [presenceRes, callsRes, openRes] = await Promise.all([
      supabase
        .from('member_presence')
        .select('member_id, status, last_event_at, last_session_started_at')
        .eq('brand_id', brand.id),
      supabase
        .from('calls')
        .select('member_id')
        .eq('brand_id', brand.id)
        .gte('started_at', noCallsCutoffIso),
      supabase
        .from('sla_violations')
        .select('id, member_id, kind')
        .eq('brand_id', brand.id),
    ]);

    const recentCallers = new Set<string>();
    for (const c of callsRes.data ?? []) {
      if (c.member_id) recentCallers.add(c.member_id);
    }

    // Compute the desired open set from current presence.
    const desired = new Map<
      string,
      { memberId: string; kind: Kind; minutes: number }
    >();
    for (const p of presenceRes.data ?? []) {
      if (!p.last_event_at) continue;
      const eventAge = now - new Date(p.last_event_at).getTime();
      if (eventAge >= STALE_MS) continue; // stale → treated as offline elsewhere; don't alert.

      if (p.status === 'idle' && eventAge >= IDLE_THRESHOLD_MS) {
        desired.set(`${p.member_id}:agent_idle`, {
          memberId: p.member_id,
          kind: 'agent_idle',
          minutes: Math.floor(eventAge / 60_000),
        });
        continue;
      }

      if (
        (p.status === 'active' || p.status === 'on_call') &&
        p.last_session_started_at
      ) {
        const sessionAge = now - new Date(p.last_session_started_at).getTime();
        if (sessionAge >= NO_CALLS_THRESHOLD_MS && !recentCallers.has(p.member_id)) {
          desired.set(`${p.member_id}:no_calls_active`, {
            memberId: p.member_id,
            kind: 'no_calls_active',
            minutes: Math.floor(NO_CALLS_THRESHOLD_MS / 60_000),
          });
        }
      }
    }

    // Reconcile against the open rows for this brand. Anything in
    // `desired` but not in DB → insert; anything in both → bump
    // last_seen_at; anything in DB but not desired → delete.
    const openByKey = new Map<string, { id: string; member_id: string; kind: string }>();
    for (const r of openRes.data ?? []) {
      openByKey.set(`${r.member_id}:${r.kind}`, r);
    }

    for (const [key, val] of desired) {
      const existing = openByKey.get(key);
      if (existing) {
        await supabase
          .from('sla_violations')
          .update({
            last_seen_at: new Date(now).toISOString(),
            detail: { minutes: val.minutes },
          })
          .eq('id', existing.id);
        bumped++;
      } else {
        await supabase.from('sla_violations').insert({
          brand_id: brand.id,
          member_id: val.memberId,
          kind: val.kind,
          detail: { minutes: val.minutes },
        });
        opened++;
      }
    }

    // Delete cleared violations.
    const idsToDelete: string[] = [];
    for (const [key, row] of openByKey) {
      if (!desired.has(key)) idsToDelete.push(row.id);
    }
    if (idsToDelete.length > 0) {
      await deleteByIds(supabase, idsToDelete);
      cleared += idsToDelete.length;
    }
  }

  return NextResponse.json({ ok: true, opened, bumped, cleared });
}

async function deleteByIds(supabase: Sb, ids: string[]) {
  // Chunked to keep the .in() bounded.
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    await supabase.from('sla_violations').delete().in('id', slice);
  }
}
