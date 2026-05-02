import { PageHeader } from '@/components/page-header';
import { CampaignsList } from '@/components/campaigns/campaigns-list';
import { getActiveBrand } from '@/lib/active-brand';
import { loadCampaigns } from '@/lib/campaigns';
import { getCurrentBrandRole } from '@/lib/team';
import { createServerClient } from '@leadpilot/db/server';

async function loadMembers(brandId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('brand_members')
    .select('member_id, members!inner(id, full_name, email)')
    .eq('brand_id', brandId);
  if (!data) return [];
  return data
    .map((row) => row.members as { id: string; full_name: string | null; email: string } | null)
    .filter((m): m is { id: string; full_name: string | null; email: string } => !!m)
    .map((m) => ({ id: m.id, fullName: m.full_name, email: m.email }));
}

export default async function CampaignsPage() {
  const active = await getActiveBrand();
  if (!active) {
    return <PageHeader title="Campaigns" subtitle="No active brand selected." />;
  }

  const role = await getCurrentBrandRole(active.id);
  const canManage = role === 'owner' || role === 'admin' || role === 'manager';

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const myId = user?.id ?? null;

  const [campaigns, members] = await Promise.all([
    loadCampaigns(active.id, canManage || !myId ? {} : { forMemberId: myId }),
    loadMembers(active.id),
  ]);

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle={`${active.name} · power-dial workspaces`}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <CampaignsList initial={campaigns} members={members} canManage={canManage} />
        </div>
      </div>
    </>
  );
}
