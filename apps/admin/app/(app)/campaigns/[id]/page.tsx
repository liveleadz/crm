import { notFound } from 'next/navigation';
import { CampaignEditor } from '@/components/campaigns/campaign-editor';
import { PageHeader } from '@/components/page-header';
import { getActiveBrand } from '@/lib/active-brand';
import { loadCampaign } from '@/lib/campaigns';
import { loadFollowupsForBrand } from '@/lib/disposition-followups';
import { loadDispositions } from '@/lib/dispositions';
import { loadKanban } from '@/lib/leads';
import { loadCampaignLists, loadLists } from '@/lib/lists';
import { loadPools, type PhonePool } from '@/lib/phone-pools';
import { loadBrandTagsWithCounts } from '@/lib/tags';
import { getCurrentBrandRole } from '@/lib/team';
import { getMyProfile } from '@/lib/dialer';
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

async function loadCallScripts(brandId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('scripts')
    .select('id, name, subject')
    .eq('brand_id', brandId)
    .eq('kind', 'call')
    .order('updated_at', { ascending: false });
  return data ?? [];
}

async function loadCalendars(brandId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('calendars')
    .select('id, name')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .order('name');
  return data ?? [];
}

async function loadRecentCalls(campaignId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('calls')
    .select(
      'id, started_at, disposition, duration_sec, leads(first_name, last_name), members!calls_member_id_fkey(full_name, email)',
    )
    .eq('campaign_id', campaignId)
    .order('started_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((c) => {
    const lead = c.leads as { first_name: string | null; last_name: string | null } | null;
    const member = c.members as { full_name: string | null; email: string } | null;
    return {
      id: c.id,
      startedAt: c.started_at,
      disposition: c.disposition,
      durationSec: c.duration_sec,
      leadName: lead
        ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
        : null,
      memberName: member?.full_name ?? member?.email ?? null,
    };
  });
}

async function loadRecentAppointments(campaignId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, title, status, leads(first_name, last_name)')
    .eq('campaign_id', campaignId)
    .order('starts_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((a) => {
    const lead = a.leads as { first_name: string | null; last_name: string | null } | null;
    return {
      id: a.id,
      startsAt: a.starts_at,
      title: a.title,
      status: a.status ?? 'scheduled',
      leadName: lead
        ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
        : null,
    };
  });
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveBrand();
  if (!active) notFound();
  const campaign = await loadCampaign(id);
  if (!campaign || campaign.brandId !== active.id) notFound();

  const role = await getCurrentBrandRole(active.id);
  const canManage = role === 'owner' || role === 'admin' || role === 'manager';

  // Hard-lock: agents/viewers can only open campaigns they're assigned to.
  if (!canManage) {
    const profile = await getMyProfile();
    if (!profile || !campaign.agentIds.includes(profile.id)) notFound();
  }

  // Layer-3 read scoping for agents:
  //  - scripts / calendars: row-level RLS (migration 0043) already
  //    filters these to "campaign-attached" / "assigned + bookable"
  //    for non-managers, so we keep calling the same loaders.
  //  - lists: lead_lists is brand-wide-readable for agents (so they
  //    can filter their own leads UI) — we explicitly slim the
  //    campaign editor's view here to "lists this campaign uses".
  //  - pools: numbers/phone_pools are manager+ reads (0043) and the
  //    loader returns [] for agents under RLS; bypass the call.
  const [
    scripts,
    calendars,
    members,
    lists,
    dispositions,
    followups,
    calls,
    appointments,
    pools,
    kanban,
    tags,
  ] = await Promise.all([
    loadCallScripts(active.id),
    loadCalendars(active.id),
    loadMembers(active.id),
    canManage ? loadLists(active.id) : loadCampaignLists(active.id, id),
    loadDispositions(active.id),
    loadFollowupsForBrand(active.id, id),
    loadRecentCalls(id),
    loadRecentAppointments(id),
    canManage ? loadPools(active.id) : Promise.resolve<PhonePool[]>([]),
    loadKanban(active.id),
    loadBrandTagsWithCounts(active.id),
  ]);

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`Campaign · ${active.name}${canManage ? '' : ' · read-only'}`}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <CampaignEditor
            campaign={campaign}
            scripts={scripts}
            calendars={calendars}
            members={members}
            pools={pools.map((p) => ({ id: p.id, name: p.name, numberCount: p.numberCount }))}
            lists={lists.map((l) => ({
              id: l.id,
              name: l.name,
              source: l.source,
              count: l.count,
            }))}
            dispositions={dispositions.map((d) => ({
              id: d.id,
              code: d.code,
              label: d.label,
              tone: d.tone,
            }))}
            followups={followups}
            stages={kanban.stages.map((s) => ({ id: s.id, name: s.name }))}
            tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
            recentCalls={calls}
            recentAppointments={appointments}
            canManage={canManage}
            brandTimezone={active.timezone}
          />
        </div>
      </div>
    </>
  );
}
