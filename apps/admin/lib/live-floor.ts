import 'server-only';

// Phase O: Live Floor data layer.
//
// Three loaders backing the manager-only `/live` page:
//  - `loadActiveCalls` — calls in progress right now (started_at not
//    null AND ended_at null), joined to lead + member + campaign for
//    the card UI.
//  - `loadAgentSnapshots` — one row per brand member: presence dot,
//    today's call counts (calls / connects / appointments) sourced
//    from the same disposition-category math as the reports page.
//  - `loadBrandPulse` — last-90-min calls bucketed in 5-min slices,
//    plus a brand-wide KPI row, for the trend strip.

import { createServerClient } from '@leadpilot/db/server';
import { CONNECTED_CATEGORIES, loadCategoryByCode } from './dispositions';
import { loadBrandPresence, type PresenceStatus } from './presence';

export type ActiveCall = {
  callId: string;
  startedAt: string;
  direction: 'inbound' | 'outbound';
  fromNumber: string;
  toNumber: string;
  // Lead may be null for inbound calls from unknown numbers.
  leadId: string | null;
  leadName: string | null;
  leadCity: string | null;
  leadState: string | null;
  memberId: string | null;
  memberName: string | null;
  memberEmail: string | null;
  campaignId: string | null;
  campaignName: string | null;
};

// Calls with `ended_at IS NULL` are treated as in-progress, but a row
// that was never closed (dropped webhook, crashed dialer leg, seed data)
// would otherwise sit on the floor forever — and its elapsed timer
// would tick into the thousands of hours. Anything older than this
// window is presumed dead and excluded.
//
// 30 min is well past the duration of a normal sales call. The Live
// Floor cleared up materially when this dropped from 2h to 30m: phantom
// rows (webhook retries with no idempotency, dropped status callbacks)
// stop crowding the grid for an hour-plus. The janitor cron uses the
// same horizon so durations on the closed phantoms match what the floor
// considered "expired".
const ACTIVE_CALL_MAX_AGE_MS = 30 * 60 * 1000;

export async function loadActiveCalls(brandId: string): Promise<ActiveCall[]> {
  const supabase = await createServerClient();
  const sinceIso = new Date(Date.now() - ACTIVE_CALL_MAX_AGE_MS).toISOString();
  const { data: calls } = await supabase
    .from('calls')
    .select(
      'id, started_at, direction, from_number, to_number, lead_id, member_id, campaign_id',
    )
    .eq('brand_id', brandId)
    .is('ended_at', null)
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(100);
  const rows = calls ?? [];
  if (rows.length === 0) return [];

  const leadIds = Array.from(new Set(rows.map((r) => r.lead_id).filter((x): x is string => !!x)));
  const memberIds = Array.from(new Set(rows.map((r) => r.member_id).filter((x): x is string => !!x)));
  const campaignIds = Array.from(
    new Set(rows.map((r) => r.campaign_id).filter((x): x is string => !!x)),
  );

  // Three small parallel lookups so we don't N+1 the page render.
  const [leadsRes, membersRes, campaignsRes] = await Promise.all([
    leadIds.length > 0
      ? supabase
          .from('leads')
          .select('id, first_name, last_name, city, state')
          .in('id', leadIds)
      : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null; city: string | null; state: string | null }> }),
    memberIds.length > 0
      ? supabase.from('members').select('id, full_name, email').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string }> }),
    campaignIds.length > 0
      ? supabase.from('campaigns').select('id, name').in('id', campaignIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const leadById = new Map((leadsRes.data ?? []).map((l) => [l.id, l]));
  const memberById = new Map((membersRes.data ?? []).map((m) => [m.id, m]));
  const campaignById = new Map((campaignsRes.data ?? []).map((c) => [c.id, c]));

  return rows.map((r) => {
    const lead = r.lead_id ? leadById.get(r.lead_id) : undefined;
    const member = r.member_id ? memberById.get(r.member_id) : undefined;
    const campaign = r.campaign_id ? campaignById.get(r.campaign_id) : undefined;
    const leadName = lead
      ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
      : null;
    return {
      callId: r.id,
      startedAt: r.started_at,
      direction: r.direction as 'inbound' | 'outbound',
      fromNumber: r.from_number,
      toNumber: r.to_number,
      leadId: r.lead_id,
      leadName,
      leadCity: lead?.city ?? null,
      leadState: lead?.state ?? null,
      memberId: r.member_id,
      memberName: member?.full_name?.trim() || member?.email || null,
      memberEmail: member?.email ?? null,
      campaignId: r.campaign_id,
      campaignName: campaign?.name ?? null,
    };
  });
}

export type AgentSnapshot = {
  memberId: string;
  name: string;
  email: string;
  role: string;
  presence: PresenceStatus;
  secondsToday: number;
  callsToday: number;
  connectsToday: number;
  appointmentsToday: number;
  // Active call for this agent right now, if any. Lets the agent grid
  // surface "currently calling X for Campaign Y" in-line.
  currentCall: ActiveCall | null;
};

export async function loadAgentSnapshots(brandId: string): Promise<AgentSnapshot[]> {
  const supabase = await createServerClient();

  // Members of this brand. Inactive members are filtered out; their
  // presence rows are stale anyway and they don't dial.
  const { data: bm } = await supabase
    .from('brand_members')
    .select('member_id, role, members!inner(id, full_name, email)')
    .eq('brand_id', brandId)
    .eq('is_active', true);
  const members = (bm ?? []).map((row) => ({
    memberId: row.member_id,
    role: row.role,
    fullName: row.members?.full_name ?? null,
    email: row.members?.email ?? '',
  }));
  if (members.length === 0) return [];

  // Today's calls (since brand-local midnight isn't trivial to compute
  // server-side without the brand's tz; use UTC-ish "last 24h" as a
  // close-enough proxy for the live floor).
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [callsRes, presenceRows, activeCalls, categoryFor] = await Promise.all([
    supabase
      .from('calls')
      .select('member_id, disposition')
      .eq('brand_id', brandId)
      .gte('started_at', sinceIso)
      .limit(50_000),
    loadBrandPresence(brandId),
    loadActiveCalls(brandId),
    loadCategoryByCode(brandId),
  ]);

  type Agg = { calls: number; connects: number; appts: number };
  const aggByMember = new Map<string, Agg>();
  for (const r of callsRes.data ?? []) {
    if (!r.member_id) continue;
    const a = aggByMember.get(r.member_id) ?? { calls: 0, connects: 0, appts: 0 };
    a.calls += 1;
    const cat = categoryFor(r.disposition);
    if (CONNECTED_CATEGORIES.has(cat)) a.connects += 1;
    if (cat === 'appointment_set') a.appts += 1;
    aggByMember.set(r.member_id, a);
  }

  const presenceByMember = new Map(presenceRows.map((p) => [p.memberId, p]));
  const activeByMember = new Map<string, ActiveCall>();
  for (const c of activeCalls) {
    if (c.memberId) activeByMember.set(c.memberId, c);
  }

  return members
    .map((m): AgentSnapshot => {
      const agg = aggByMember.get(m.memberId) ?? { calls: 0, connects: 0, appts: 0 };
      const p = presenceByMember.get(m.memberId);
      return {
        memberId: m.memberId,
        name: m.fullName?.trim() || m.email || 'Unknown agent',
        email: m.email,
        role: m.role,
        presence: p?.status ?? 'offline',
        secondsToday: p?.secondsToday ?? 0,
        callsToday: agg.calls,
        connectsToday: agg.connects,
        appointmentsToday: agg.appts,
        currentCall: activeByMember.get(m.memberId) ?? null,
      };
    })
    .sort((a, b) => {
      // On-call agents bubble to the top, then active, then idle, then
      // offline. Inside each presence bucket sort by call volume desc.
      const order: Record<PresenceStatus, number> = {
        on_call: 0,
        active: 1,
        idle: 2,
        offline: 3,
      };
      const d = order[a.presence] - order[b.presence];
      if (d !== 0) return d;
      return b.callsToday - a.callsToday;
    });
}

// 5-min buckets, last 90 minutes. Index 0 = oldest, last = newest. Each
// bucket carries calls + connects so the strip can render two stacked
// bars.
export type PulseBucket = {
  startMs: number;
  calls: number;
  connects: number;
};

export type BrandPulse = {
  buckets: PulseBucket[];
  totals: {
    calls: number;
    connects: number;
    voicemails: number;
    appointments: number;
  };
};

const BUCKET_MS = 5 * 60 * 1000;
const WINDOW_MS = 90 * 60 * 1000;

export async function loadBrandPulse(brandId: string): Promise<BrandPulse> {
  const supabase = await createServerClient();
  const sinceMs = Date.now() - WINDOW_MS;
  const sinceIso = new Date(sinceMs).toISOString();

  const [callsRes, categoryFor] = await Promise.all([
    supabase
      .from('calls')
      .select('disposition, started_at')
      .eq('brand_id', brandId)
      .gte('started_at', sinceIso)
      .limit(10_000),
    loadCategoryByCode(brandId),
  ]);

  const bucketCount = Math.ceil(WINDOW_MS / BUCKET_MS);
  const buckets: PulseBucket[] = [];
  for (let i = 0; i < bucketCount; i += 1) {
    buckets.push({ startMs: sinceMs + i * BUCKET_MS, calls: 0, connects: 0 });
  }

  let totalCalls = 0;
  let totalConnects = 0;
  let totalVoicemails = 0;
  let totalAppointments = 0;
  for (const r of callsRes.data ?? []) {
    const ms = new Date(r.started_at).getTime();
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((ms - sinceMs) / BUCKET_MS)));
    const bucket = buckets[idx];
    if (!bucket) continue;
    bucket.calls += 1;
    totalCalls += 1;
    const cat = categoryFor(r.disposition);
    if (CONNECTED_CATEGORIES.has(cat)) {
      bucket.connects += 1;
      totalConnects += 1;
    }
    if (cat === 'voicemail') totalVoicemails += 1;
    if (cat === 'appointment_set') totalAppointments += 1;
  }

  return {
    buckets,
    totals: {
      calls: totalCalls,
      connects: totalConnects,
      voicemails: totalVoicemails,
      appointments: totalAppointments,
    },
  };
}
