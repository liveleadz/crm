import 'server-only';
// Outbound caller-ID rotation. A pool wraps one or more `numbers` rows
// under a strategy:
//   - round_robin: pick the member with the oldest last_used_at, then
//     update last_used_at so the next dial moves on.
//   - random:      weighted random pick by `weight`.
//   - sticky_lead: hash leadId → stable member. Falls back to round_robin
//     when no leadId is supplied (e.g. raw click-to-dial against a number).
//
// pickOutboundNumber() resolves which number to dial out from:
//   0. numbers.assigned_member_id == dialing agent  (per-agent number)
//   1. campaign.phone_pool_id  (if a campaignId is supplied + set)
//   2. brand.default_pool_id   (if set)
//   3. legacy fallback to the brand's oldest active number
// so brands without any pool/assignment configured keep the pre-Phase-I
// behavior.

import { createServerClient } from '@leadpilot/db/server';
import { getOutboundFromNumber, type OutboundFromNumber } from '@/lib/dialer';

export type PoolStrategy = 'round_robin' | 'random' | 'sticky_lead';

export type PhonePool = {
  id: string;
  brandId: string;
  name: string;
  strategy: PoolStrategy;
  numberCount: number;
};

export type PhonePoolMember = {
  numberId: string;
  e164: string;
  label: string | null;
  active: boolean;
  weight: number;
  lastUsedAt: string | null;
};

function parseStrategy(raw: string): PoolStrategy {
  return raw === 'random' || raw === 'sticky_lead' ? raw : 'round_robin';
}

export async function loadPools(brandId: string): Promise<PhonePool[]> {
  const supabase = await createServerClient();
  const { data: pools } = await supabase
    .from('phone_pools')
    .select('id, brand_id, name, strategy')
    .eq('brand_id', brandId)
    .order('name', { ascending: true });
  if (!pools || pools.length === 0) return [];
  const ids = pools.map((p) => p.id);
  const { data: links } = await supabase
    .from('phone_pool_numbers')
    .select('pool_id')
    .in('pool_id', ids);
  const counts = new Map<string, number>();
  for (const l of links ?? []) counts.set(l.pool_id, (counts.get(l.pool_id) ?? 0) + 1);
  return pools.map((p) => ({
    id: p.id,
    brandId: p.brand_id,
    name: p.name,
    strategy: parseStrategy(p.strategy),
    numberCount: counts.get(p.id) ?? 0,
  }));
}

export async function loadPoolMembers(poolId: string): Promise<PhonePoolMember[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('phone_pool_numbers')
    .select('number_id, weight, last_used_at, numbers(e164, label, active)')
    .eq('pool_id', poolId);
  if (!data) return [];
  return data.map((r) => {
    const n = r.numbers as { e164: string; label: string | null; active: boolean } | null;
    return {
      numberId: r.number_id,
      e164: n?.e164 ?? '',
      label: n?.label ?? null,
      active: !!n?.active,
      weight: r.weight,
      lastUsedAt: r.last_used_at,
    };
  });
}

// FNV-1a 32-bit. Stable hash for sticky_lead → number selection.
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

async function pickFromPool(
  poolId: string,
  strategy: PoolStrategy,
  leadId: string | null,
): Promise<OutboundFromNumber | null> {
  const supabase = await createServerClient();
  const { data: rows } = await supabase
    .from('phone_pool_numbers')
    .select('number_id, weight, last_used_at, numbers(id, e164, label, active)')
    .eq('pool_id', poolId);
  if (!rows || rows.length === 0) return null;

  type Member = {
    numberId: string;
    e164: string;
    label: string | null;
    weight: number;
    lastUsedAt: string | null;
  };
  const members: Member[] = rows
    .map((r) => {
      const n = r.numbers as { id: string; e164: string; label: string | null; active: boolean } | null;
      if (!n || !n.active) return null;
      return {
        numberId: r.number_id,
        e164: n.e164,
        label: n.label,
        weight: Math.max(1, r.weight),
        lastUsedAt: r.last_used_at,
      };
    })
    .filter((v): v is Member => v !== null);
  if (members.length === 0) return null;

  // Length checked above (early return) — pick is always assigned.
  let pick: Member = members[0]!;
  if (strategy === 'sticky_lead' && leadId) {
    pick = members[hashStr(leadId) % members.length]!;
  } else if (strategy === 'random') {
    const total = members.reduce((sum, m) => sum + m.weight, 0);
    let roll = Math.random() * total;
    pick = members[members.length - 1]!;
    for (const m of members) {
      roll -= m.weight;
      if (roll <= 0) {
        pick = m;
        break;
      }
    }
  } else {
    // round_robin (default + sticky_lead fallback): oldest last_used_at first,
    // NULLs (never used) before any timestamp.
    pick = [...members].sort((a, b) => {
      if (a.lastUsedAt === b.lastUsedAt) return 0;
      if (a.lastUsedAt === null) return -1;
      if (b.lastUsedAt === null) return 1;
      return a.lastUsedAt < b.lastUsedAt ? -1 : 1;
    })[0]!;
  }

  // Stamp last_used_at so the next round_robin advances. For random /
  // sticky_lead this is informational only.
  await supabase
    .from('phone_pool_numbers')
    .update({ last_used_at: new Date().toISOString() })
    .eq('pool_id', poolId)
    .eq('number_id', pick.numberId);

  return { id: pick.numberId, e164: pick.e164, label: pick.label };
}

export async function pickOutboundNumber(input: {
  brandId: string;
  campaignId?: string | null;
  leadId?: string | null;
  /**
   * The dialing agent's member id. When set, an active number assigned
   * to this member in the brand wins over campaign / brand pools.
   * Configured per-number in the /numbers admin UI.
   */
  memberId?: string | null;
}): Promise<OutboundFromNumber | null> {
  const supabase = await createServerClient();

  // 0. Member-assigned number (highest priority). Lets a brand give
  // each agent their own outbound caller-ID without juggling pools.
  // No-op when nothing is assigned, so brands relying on pools are
  // unchanged.
  if (input.memberId) {
    const { data: assigned } = await supabase
      .from('numbers')
      .select('id, e164, label, active')
      .eq('brand_id', input.brandId)
      .eq('assigned_member_id', input.memberId)
      .eq('active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (assigned?.id) {
      return { id: assigned.id, e164: assigned.e164, label: assigned.label };
    }
  }

  // 1. Campaign-level pool override.
  if (input.campaignId) {
    const { data: c } = await supabase
      .from('campaigns')
      .select('phone_pool_id')
      .eq('id', input.campaignId)
      .maybeSingle();
    if (c?.phone_pool_id) {
      const { data: pool } = await supabase
        .from('phone_pools')
        .select('strategy')
        .eq('id', c.phone_pool_id)
        .maybeSingle();
      if (pool) {
        const picked = await pickFromPool(
          c.phone_pool_id,
          parseStrategy(pool.strategy),
          input.leadId ?? null,
        );
        if (picked) return picked;
      }
    }
  }

  // 2. Brand default pool.
  const { data: brand } = await supabase
    .from('brands')
    .select('default_pool_id')
    .eq('id', input.brandId)
    .maybeSingle();
  if (brand?.default_pool_id) {
    const { data: pool } = await supabase
      .from('phone_pools')
      .select('strategy')
      .eq('id', brand.default_pool_id)
      .maybeSingle();
    if (pool) {
      const picked = await pickFromPool(
        brand.default_pool_id,
        parseStrategy(pool.strategy),
        input.leadId ?? null,
      );
      if (picked) return picked;
    }
  }

  // 3. Legacy fallback — first active number for the brand.
  return getOutboundFromNumber(input.brandId);
}
