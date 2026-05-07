-- 0041 — Fix RLS recursion introduced by 0040.
--
-- The leads_select and campaigns_read policies in 0040 reference
-- campaign_lists / campaign_agents in EXISTS subqueries. Those tables
-- in turn have RLS policies (from 0027) that EXISTS back into
-- campaigns. Postgres detects the cycle and aborts every query that
-- hits either leads or campaigns with:
--   ERROR: 42P17: infinite recursion detected in policy for
--   relation "campaigns"
--
-- The owner's dashboard then catches the error and renders 0 leads,
-- empty recent-calls list, etc.
--
-- Fix: pull the campaign-agent / campaign-list lookups into
-- SECURITY DEFINER functions so they read the underlying tables
-- without re-entering RLS.

create or replace function current_member_campaign_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select campaign_id
  from campaign_agents
  where member_id = auth.uid();
$$;

grant execute on function current_member_campaign_ids() to authenticated;

create or replace function current_member_visible_list_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select cl.list_id
  from campaign_lists cl
  where cl.campaign_id in (
    select campaign_id
    from campaign_agents
    where member_id = auth.uid()
  );
$$;

grant execute on function current_member_visible_list_ids() to authenticated;

-- Re-create leads_select using the helpers (no recursion).
drop policy if exists leads_select on leads;

create policy leads_select on leads for select to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or owner_id = (select auth.uid())
      or list_id in (select current_member_visible_list_ids())
    )
  );

-- Re-create campaigns_read using the helper.
drop policy if exists campaigns_read on campaigns;

create policy campaigns_read on campaigns for select to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or id in (select current_member_campaign_ids())
    )
  );
