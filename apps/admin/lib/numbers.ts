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

  const health = new Map<string, NumberHealth>();
  for (const id of ids) {
    health.set(id, {
      callsLast7d: 0,
      callsConnectedLast7d: 0,
      successRate: 0,
      smsLast7d: 0,
      smsDeliveredLast7d: 0,
      lastUsedAt: null,
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
  }

  return numbers.map((n) => ({
    ...n,
    health: health.get(n.id) ?? {
      callsLast7d: 0,
      callsConnectedLast7d: 0,
      successRate: 0,
      smsLast7d: 0,
      smsDeliveredLast7d: 0,
      lastUsedAt: null,
    },
  }));
}
