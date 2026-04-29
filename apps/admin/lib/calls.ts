import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type CallRow = {
  id: string;
  startedAt: string;
  direction: 'inbound' | 'outbound';
  disposition: string | null;
  durationSec: number | null;
  fromNumber: string;
  toNumber: string;
  leadId: string | null;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadPhone: string | null;
};

export async function loadCalls(brandId: string, limit = 200): Promise<CallRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('calls')
    .select(
      'id, started_at, direction, disposition, duration_sec, from_number, to_number, lead_id, leads(first_name, last_name, phone)',
    )
    .eq('brand_id', brandId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (!data) return [];
  return data.map((c) => {
    const lead = c.leads as
      | { first_name: string | null; last_name: string | null; phone: string | null }
      | null;
    return {
      id: c.id,
      startedAt: c.started_at,
      direction: c.direction,
      disposition: c.disposition,
      durationSec: c.duration_sec,
      fromNumber: c.from_number,
      toNumber: c.to_number,
      leadId: c.lead_id,
      leadFirstName: lead?.first_name ?? null,
      leadLastName: lead?.last_name ?? null,
      leadPhone: lead?.phone ?? null,
    };
  });
}
