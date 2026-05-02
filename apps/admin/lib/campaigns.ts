import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type CampaignStatus = 'active' | 'paused' | 'archived';

export type Campaign = {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  scriptId: string | null;
  calendarId: string | null;
  defaultOwnerId: string | null;
  status: CampaignStatus;
  recentlyCalledMinutes: number;
  listIds: string[];
  agentIds: string[];
  createdAt: string;
};

type LoadCampaignsOpts = {
  // When set, only return campaigns this member is assigned to. Managers/admins
  // pass undefined (or call without opts) to see everything in the brand.
  forMemberId?: string;
  includeArchived?: boolean;
};

// PostgREST returns join rows as arrays of {field}-keyed objects.
type JoinedListRow = { list_id: string };
type JoinedAgentRow = { member_id: string };

function mapCampaign(row: {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  script_id: string | null;
  calendar_id: string | null;
  default_owner_id: string | null;
  status: string;
  recently_called_minutes: number;
  created_at: string;
  campaign_lists: JoinedListRow[] | null;
  campaign_agents: JoinedAgentRow[] | null;
}): Campaign {
  return {
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    description: row.description,
    scriptId: row.script_id,
    calendarId: row.calendar_id,
    defaultOwnerId: row.default_owner_id,
    status: row.status as CampaignStatus,
    recentlyCalledMinutes: row.recently_called_minutes,
    listIds: (row.campaign_lists ?? []).map((r) => r.list_id),
    agentIds: (row.campaign_agents ?? []).map((r) => r.member_id),
    createdAt: row.created_at,
  };
}

export async function loadCampaigns(
  brandId: string,
  opts: LoadCampaignsOpts = {},
): Promise<Campaign[]> {
  const supabase = await createServerClient();
  let q = supabase
    .from('campaigns')
    .select(
      'id, brand_id, name, description, script_id, calendar_id, default_owner_id, status, recently_called_minutes, created_at, campaign_lists(list_id), campaign_agents(member_id)',
    )
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });
  if (!opts.includeArchived) q = q.neq('status', 'archived');
  const { data } = await q;
  let rows = (data ?? []).map(mapCampaign);
  if (opts.forMemberId) {
    rows = rows.filter((c) => c.agentIds.includes(opts.forMemberId!));
  }
  return rows;
}

export async function loadCampaign(campaignId: string): Promise<Campaign | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('campaigns')
    .select(
      'id, brand_id, name, description, script_id, calendar_id, default_owner_id, status, recently_called_minutes, created_at, campaign_lists(list_id), campaign_agents(member_id)',
    )
    .eq('id', campaignId)
    .maybeSingle();
  return data ? mapCampaign(data) : null;
}

// True if the member is on campaign_agents OR holds a manager+ role in the
// campaign's brand. Used by dialer server actions to enforce hard-lock.
export async function assertAgentCanRunCampaign(
  campaignId: string,
  memberId: string,
): Promise<{ ok: true; campaign: Campaign } | { ok: false; reason: 'not_found' | 'forbidden' }> {
  const campaign = await loadCampaign(campaignId);
  if (!campaign) return { ok: false, reason: 'not_found' };
  if (campaign.agentIds.includes(memberId)) return { ok: true, campaign };
  const supabase = await createServerClient();
  const { data: bm } = await supabase
    .from('brand_members')
    .select('role')
    .eq('brand_id', campaign.brandId)
    .eq('member_id', memberId)
    .maybeSingle();
  const role = bm?.role;
  if (role === 'owner' || role === 'admin' || role === 'manager') {
    return { ok: true, campaign };
  }
  return { ok: false, reason: 'forbidden' };
}

export type ScriptRow = {
  id: string;
  name: string;
  body: string;
  subject: string | null;
};

// Load a campaign's script (kind='call'). Returns null if no script attached.
export async function loadCampaignScript(scriptId: string | null): Promise<ScriptRow | null> {
  if (!scriptId) return null;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('scripts')
    .select('id, name, body, subject')
    .eq('id', scriptId)
    .maybeSingle();
  return data;
}
