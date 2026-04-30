// Server-only loaders for the Numbers & Routing page. Pulls the brand's
// `numbers` rows and decorates each with a small health summary computed
// from recent call + SMS activity.

import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type NumberRow = {
  id: string;
  e164: string;
  signalwireId: string | null;
  label: string | null;
  a2pCampaignId: string | null;
  active: boolean;
  createdAt: string;
};

export type NumberHealth = {
  callsLast7d: number;
  callsConnectedLast7d: number;
  successRate: number; // 0..1, NaN-safe
  smsLast7d: number;
  smsDeliveredLast7d: number;
  lastUsedAt: string | null;
  // Heuristic spam-risk score derived from our own call data. There's no
  // truly free programmatic API for "spam likely" reputation — Hiya, TNS,
  // First Orion all gate it behind paid plans — so we approximate with the
  // signals we already have. The risk_check buttons on each row link to the
  // free consumer-facing lookup tools for a real ground-truth check.
  risk: 'low' | 'medium' | 'high';
  riskReasons: string[];
};

export type NumberWithHealth = NumberRow & { health: NumberHealth };

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function loadNumbersWithHealth(brandId: string): Promise<NumberWithHealth[]> {
  const supabase = await createServerClient();

  const { data: rows } = await supabase
    .from('numbers')
    .select('id, e164, signalwire_id, label, a2p_campaign_id, active, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  if (!rows || rows.length === 0) return [];

  const numbers: NumberRow[] = rows.map((r) => ({
    id: r.id,
    e164: r.e164,
    signalwireId: r.signalwire_id,
    label: r.label,
    a2pCampaignId: r.a2p_campaign_id,
    active: r.active,
    createdAt: r.created_at,
  }));

  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const ids = numbers.map((n) => n.id);

  // Pull the slim columns we need; aggregate client-side. Cheaper than running
  // four separate count queries per number.
  const [calls, sms] = await Promise.all([
    supabase
      .from('calls')
      .select('number_id, disposition, started_at')
      .in('number_id', ids)
      .gte('started_at', since),
    supabase
      .from('sms')
      .select('number_id, status, created_at')
      .in('number_id', ids)
      .gte('created_at', since),
  ]);

  // Also fetch the absolute most-recent call/sms per number (regardless of
  // window) so "last used" reflects reality even on quiet weeks.
  const [lastCalls, lastSms] = await Promise.all([
    supabase
      .from('calls')
      .select('number_id, started_at')
      .in('number_id', ids)
      .order('started_at', { ascending: false }),
    supabase
      .from('sms')
      .select('number_id, created_at')
      .in('number_id', ids)
      .order('created_at', { ascending: false }),
  ]);

  // Track per-number raw counters; risk score is derived once at the end.
  type Counters = NumberHealth & { wrongOrDnc: number };
  const health = new Map<string, Counters>();
  for (const id of ids) {
    health.set(id, {
      callsLast7d: 0,
      callsConnectedLast7d: 0,
      successRate: 0,
      smsLast7d: 0,
      smsDeliveredLast7d: 0,
      lastUsedAt: null,
      risk: 'low',
      riskReasons: [],
      wrongOrDnc: 0,
    });
  }

  for (const c of calls.data ?? []) {
    const h = health.get(c.number_id as string);
    if (!h) continue;
    h.callsLast7d++;
    // "Connected" buckets — anything that resulted in a real conversation or
    // a clear sale outcome counts toward success.
    if (c.disposition === 'connected' || c.disposition === 'sale' || c.disposition === 'callback') {
      h.callsConnectedLast7d++;
    }
    if (c.disposition === 'wrong_number' || c.disposition === 'do_not_call') {
      h.wrongOrDnc++;
    }
  }
  for (const s of sms.data ?? []) {
    const h = health.get(s.number_id as string);
    if (!h) continue;
    h.smsLast7d++;
    if (s.status === 'delivered' || s.status === 'sent') h.smsDeliveredLast7d++;
  }
  for (const c of lastCalls.data ?? []) {
    const h = health.get(c.number_id as string);
    if (!h) continue;
    if (!h.lastUsedAt || (c.started_at && c.started_at > h.lastUsedAt)) {
      h.lastUsedAt = c.started_at as string | null;
    }
  }
  for (const s of lastSms.data ?? []) {
    const h = health.get(s.number_id as string);
    if (!h) continue;
    if (!h.lastUsedAt || (s.created_at && s.created_at > h.lastUsedAt)) {
      h.lastUsedAt = s.created_at as string | null;
    }
  }

  for (const h of health.values()) {
    h.successRate = h.callsLast7d > 0 ? h.callsConnectedLast7d / h.callsLast7d : 0;

    // Risk heuristic — public lookup tools own the real spam-database flags;
    // here we just surface the signals carriers themselves use to flag
    // numbers (velocity + low-quality dispositions), so authors know which
    // numbers to spot-check first.
    //
    // Carrier flagging triggers we approximate:
    //  - Velocity: > 50 dials/day average over the window (350 in 7d).
    //  - Conversion: connect rate < 10% over 50+ calls.
    //  - List hygiene: > 20% wrong-number / DNC dispositions.
    const reasons: string[] = [];
    const dailyAvg = h.callsLast7d / 7;
    if (dailyAvg >= 50) {
      reasons.push(`High daily volume (${Math.round(dailyAvg)}/day)`);
    } else if (dailyAvg >= 25) {
      reasons.push(`Elevated daily volume (${Math.round(dailyAvg)}/day)`);
    }
    if (h.callsLast7d >= 50 && h.successRate < 0.1) {
      reasons.push(`Low connect rate (${Math.round(h.successRate * 100)}%)`);
    }
    const wrongRate = h.callsLast7d > 0 ? h.wrongOrDnc / h.callsLast7d : 0;
    if (h.callsLast7d >= 20 && wrongRate > 0.2) {
      reasons.push(`High wrong-number / DNC rate (${Math.round(wrongRate * 100)}%)`);
    }
    h.risk = reasons.length === 0 ? 'low' : reasons.length >= 2 || dailyAvg >= 50 ? 'high' : 'medium';
    h.riskReasons = reasons;
  }

  return numbers.map((n) => {
    const counter = health.get(n.id);
    if (!counter) {
      return {
        ...n,
        health: {
          callsLast7d: 0,
          callsConnectedLast7d: 0,
          successRate: 0,
          smsLast7d: 0,
          smsDeliveredLast7d: 0,
          lastUsedAt: null,
          risk: 'low' as const,
          riskReasons: [],
        },
      };
    }
    // Strip the internal counter before returning.
    const { wrongOrDnc: _ignored, ...rest } = counter;
    void _ignored;
    return { ...n, health: rest };
  });
}
