import { PageHeader } from '@/components/page-header';
import { getActiveBrand } from '@/lib/active-brand';
import { loadNumbersWithHealth } from '@/lib/numbers';
import { NumbersManager } from '@/components/numbers/numbers-manager';
import { createServerClient } from '@leadpilot/db/server';

async function loadBrandMembers(brandId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('brand_members')
    .select('member_id, members!inner(id, full_name, email, mobile_phone)')
    .eq('brand_id', brandId);
  if (!data) return [];
  return data
    .map(
      (row) =>
        row.members as
          | {
              id: string;
              full_name: string | null;
              email: string;
              mobile_phone: string | null;
            }
          | null,
    )
    .filter(
      (m): m is { id: string; full_name: string | null; email: string; mobile_phone: string | null } =>
        !!m,
    );
}

async function loadAllInboundRoutes(brandId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('inbound_routes')
    .select('number_id, strategy, member_ids, ring_timeout_sec, voicemail_enabled, voicemail_greeting')
    .eq('brand_id', brandId);
  return data ?? [];
}

export default async function NumbersPage() {
  const active = await getActiveBrand();
  if (!active) {
    return (
      <>
        <PageHeader title="Numbers & Routing" subtitle="Phone numbers, A2P campaigns, routing" />
        <div className="p-6 text-[12.5px] text-txt-3">No active brand.</div>
      </>
    );
  }

  const [numbers, members, routes] = await Promise.all([
    loadNumbersWithHealth(active.id),
    loadBrandMembers(active.id),
    loadAllInboundRoutes(active.id),
  ]);

  const subtitle =
    numbers.length === 0
      ? 'Phone numbers, A2P campaigns, routing.'
      : `${numbers.length} number${numbers.length === 1 ? '' : 's'} · ${numbers.filter((n) => n.active).length} active`;

  return (
    <>
      <PageHeader title="Numbers & Routing" subtitle={subtitle} />
      <NumbersManager
        initial={numbers}
        members={members}
        initialRoutes={routes.map((r) => ({
          numberId: r.number_id,
          strategy: r.strategy as 'simul' | 'round_robin' | 'single',
          memberIds: (r.member_ids as string[] | null) ?? [],
          ringTimeoutSec: r.ring_timeout_sec,
          voicemailEnabled: r.voicemail_enabled,
          voicemailGreeting: r.voicemail_greeting,
        }))}
      />
    </>
  );
}
