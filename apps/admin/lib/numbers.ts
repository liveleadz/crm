// Server-only loaders for the Numbers & Routing page. Pulls the brand's
// `numbers` rows and decorates each with a small health summary computed
// from recent call + SMS activity. Health metrics now lean on SignalWire's
// per-call signals (sip_response, hangup_cause, STIR attestation) where
// available — those are populated by the /api/swml/call-status webhook.

import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type NumberRow = {
  id: string;
  e164: string;
  signalwireId: string | null;
  label: string | null;
  cnam: string | null;
  cnamCheckedAt: string | null;
  a2pCampaignId: string | null;
  active: boolean;
  createdAt: string;
  inboundConnectedAt: string | null;
};

export type AttestationMix = { A: number; B: number; C: number; unknown: number };

export type NumberHealth = {
  callsLast7d: number;
  smsLast7d: number;
  smsDeliveredLast7d: number;
  lastUsedAt: string | null;
  // Carrier-side block rate — share of recent calls that ended with a SIP
  // 603 / 487 or a hangup cause indicating the call was rejected by the
  // terminating network. The closest free proxy for "are carriers
  // labeling us spam" we can build without paying for a lookup API.
  blockedCalls: number;
  blockRate: number; // 0..1
  // STIR/SHAKEN attestation mix over the same window. A is full
  // attestation; B/C trigger spam labels on T-Mobile / AT&T / Verizon.
  attestation: AttestationMix;
  dominantAttestation: 'A' | 'B' | 'C' | 'unknown';
  // Self-derived risk derived from the signals above + raw call velocity.
  // The reputation lookup links on each row are still the ground truth.
  risk: 'low' | 'medium' | 'high';
  riskReasons: string[];
};

export type NumberWithHealth = NumberRow & { health: NumberHealth };

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// SIP response codes that strongly imply terminating-carrier rejection /
// spam-block. 603 ("Decline"), 607 ("Unwanted"), 608 ("Rejected"), 487
// ("Request Terminated") — with very short call duration the latter is a
// reliable spam-flag proxy too. We treat 480/486 as soft-blocks (busy /
// unavailable, sometimes carrier-set when a number is flagged).
const HARD_BLOCK_CODES = new Set([603, 607, 608]);
const SOFT_BLOCK_CODES = new Set([480, 486, 487]);

const HARD_BLOCK_CAUSES = new Set([
  'CALL_REJECTED',
  'INCOMING_CALL_BARRED',
  'NUMBER_CHANGED',
  'DESTINATION_OUT_OF_ORDER',
  'INVALID_NUMBER_FORMAT',
  'BLOCKED',
]);

export async function loadNumbersWithHealth(brandId: string): Promise<NumberWithHealth[]> {
  const supabase = await createServerClient();

  const { data: rows } = await supabase
    .from('numbers')
    .select(
      'id, e164, signalwire_id, label, cnam, cnam_checked_at, a2p_campaign_id, active, created_at, inbound_connected_at',
    )
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  if (!rows || rows.length === 0) return [];

  const numbers: NumberRow[] = rows.map((r) => ({
    id: r.id,
    e164: r.e164,
    signalwireId: r.signalwire_id,
    label: r.label,
    cnam: r.cnam,
    cnamCheckedAt: r.cnam_checked_at,
    a2pCampaignId: r.a2p_campaign_id,
    active: r.active,
    createdAt: r.created_at,
    inboundConnectedAt: r.inbound_connected_at,
  }));

  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const ids = numbers.map((n) => n.id);

  const [calls, sms] = await Promise.all([
    supabase
      .from('calls')
      .select(
        'number_id, disposition, started_at, ended_at, duration_sec, hangup_cause, sip_response, stir_attestation',
      )
      .in('number_id', ids)
      .gte('started_at', since),
    supabase
      .from('sms')
      .select('number_id, status, created_at')
      .in('number_id', ids)
      .gte('created_at', since),
  ]);

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

  type Counters = NumberHealth;
  const health = new Map<string, Counters>();
  for (const id of ids) {
    health.set(id, {
      callsLast7d: 0,
      smsLast7d: 0,
      smsDeliveredLast7d: 0,
      lastUsedAt: null,
      blockedCalls: 0,
      blockRate: 0,
      attestation: { A: 0, B: 0, C: 0, unknown: 0 },
      dominantAttestation: 'unknown',
      risk: 'low',
      riskReasons: [],
    });
  }

  for (const c of calls.data ?? []) {
    const h = health.get(c.number_id as string);
    if (!h) continue;
    h.callsLast7d++;

    // Carrier-block heuristic — hard block codes always count, soft block
    // codes count only when paired with very short duration (<3s) which
    // correlates with carrier-side rejection (vs. an actual user decline).
    const sip = typeof c.sip_response === 'number' ? c.sip_response : null;
    const cause =
      typeof c.hangup_cause === 'string' ? c.hangup_cause.toUpperCase() : null;
    const dur = typeof c.duration_sec === 'number' ? c.duration_sec : null;
    const isHardBlock =
      (sip !== null && HARD_BLOCK_CODES.has(sip)) ||
      (cause !== null && HARD_BLOCK_CAUSES.has(cause));
    const isSoftBlock =
      sip !== null && SOFT_BLOCK_CODES.has(sip) && dur !== null && dur < 3;
    if (isHardBlock || isSoftBlock) h.blockedCalls++;

    // STIR attestation roll-up.
    const stir = c.stir_attestation as 'A' | 'B' | 'C' | null;
    if (stir === 'A') h.attestation.A++;
    else if (stir === 'B') h.attestation.B++;
    else if (stir === 'C') h.attestation.C++;
    else h.attestation.unknown++;
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

  // Final pass — risk score derived from signals that actually correlate
  // with how carriers treat the number.
  for (const h of health.values()) {
    h.blockRate = h.callsLast7d > 0 ? h.blockedCalls / h.callsLast7d : 0;

    const att = h.attestation;
    const totalAtt = att.A + att.B + att.C;
    if (totalAtt > 0) {
      h.dominantAttestation =
        att.A >= att.B && att.A >= att.C ? 'A' : att.B >= att.C ? 'B' : 'C';
    } else {
      h.dominantAttestation = 'unknown';
    }

    const reasons: string[] = [];
    // Block-rate is the strongest signal. Anything > 5% over 30+ calls is
    // a hard yellow flag; > 12% gets a red flag.
    if (h.callsLast7d >= 30 && h.blockRate >= 0.12) {
      reasons.push(`Carrier block rate ${Math.round(h.blockRate * 100)}%`);
    } else if (h.callsLast7d >= 30 && h.blockRate >= 0.05) {
      reasons.push(`Elevated block rate ${Math.round(h.blockRate * 100)}%`);
    }
    // STIR attestation < A on most calls means terminating carriers will
    // downgrade the call — usually shows up as "Suspected Spam" labels.
    if (totalAtt >= 10) {
      const aShare = att.A / totalAtt;
      if (aShare < 0.5) {
        reasons.push(`Low STIR-A share (${Math.round(aShare * 100)}%)`);
      }
    }
    // Velocity is still a useful tripwire — carriers throttle high-volume
    // single-number outbound aggressively.
    const dailyAvg = h.callsLast7d / 7;
    if (dailyAvg >= 50) {
      reasons.push(`High daily volume (${Math.round(dailyAvg)}/day)`);
    }

    h.risk =
      reasons.length === 0
        ? 'low'
        : reasons.some((r) => r.startsWith('Carrier block rate')) || reasons.length >= 2
          ? 'high'
          : 'medium';
    h.riskReasons = reasons;
  }

  return numbers.map((n) => ({
    ...n,
    health:
      health.get(n.id) ??
      ({
        callsLast7d: 0,
        smsLast7d: 0,
        smsDeliveredLast7d: 0,
        lastUsedAt: null,
        blockedCalls: 0,
        blockRate: 0,
        attestation: { A: 0, B: 0, C: 0, unknown: 0 },
        dominantAttestation: 'unknown',
        risk: 'low' as const,
        riskReasons: [],
      } satisfies NumberHealth),
  }));
}
