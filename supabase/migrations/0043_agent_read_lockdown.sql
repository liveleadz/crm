-- 0043 — Agent read lockdown.
--
-- 0042 split read/write on the brand-wide config tables so agents can
-- still see what they need to dial (stages, tags, scripts, lists,
-- custom_fields, calendars, numbers, etc.) but only manager+ can
-- mutate. Reads are still wide-open via is_brand_member() on tables
-- agents have no business querying. This migration locks down those
-- reads in two buckets:
--
--   Bucket A — Manager+ only. No agent UI consumes them today (verified
--   by code audit on 2026-05-08):
--     numbers, inbound_routes, workflows, automations,
--     import_presets, phone_pools, phone_pool_numbers, audit_log
--
--   Bucket B — Scoped reads. Agents see only their slice:
--     scripts          - only scripts attached to campaigns the agent
--                        is on (via campaigns.script_id +
--                        campaign_agents.member_id = auth.uid())
--     calendars        - only calendars where the agent is a member
--                        with can_book = true
--     calendar_members - membership rows for those same calendars
--
-- Bucket C left wide-open (agents legitimately need brand-wide read):
--   stages, tags, dispositions, disposition_followups, lead_lists,
--   lead_custom_fields, lead_tags (already scoped in 0042),
--   members, brand_members.
--
-- App-side change: getOutboundFromNumber() must switch to the admin
-- client (it's pure server-side; the agent never touches the row).

-- ---------------------------------------------------------------------
-- Bucket A — manager+ only reads.
-- ---------------------------------------------------------------------

-- numbers
drop policy if exists numbers_read on numbers;
create policy numbers_read on numbers for select to authenticated
  using (is_manager_or_above(brand_id));

-- inbound_routes
drop policy if exists inbound_routes_read on inbound_routes;
create policy inbound_routes_read on inbound_routes for select to authenticated
  using (is_manager_or_above(brand_id));

-- workflows
drop policy if exists workflows_read on workflows;
create policy workflows_read on workflows for select to authenticated
  using (is_manager_or_above(brand_id));

-- automations (the 0013 _read policy used is_brand_member; tighten it)
drop policy if exists automations_read on automations;
create policy automations_read on automations for select to authenticated
  using (is_manager_or_above(brand_id));

-- import_presets
drop policy if exists import_presets_read on import_presets;
create policy import_presets_read on import_presets for select to authenticated
  using (is_manager_or_above(brand_id));

-- phone_pools
drop policy if exists phone_pools_read on phone_pools;
create policy phone_pools_read on phone_pools for select to authenticated
  using (is_manager_or_above(brand_id));

-- phone_pool_numbers (read via parent pool)
drop policy if exists phone_pool_numbers_read on phone_pool_numbers;
create policy phone_pool_numbers_read on phone_pool_numbers for select to authenticated
  using (
    exists (
      select 1 from phone_pools p
      where p.id = phone_pool_numbers.pool_id
        and is_manager_or_above(p.brand_id)
    )
  );

-- audit_log (brand-scoped rows + global rows where brand_id is null)
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log for select to authenticated
  using (brand_id is null or is_manager_or_above(brand_id));

-- ---------------------------------------------------------------------
-- Bucket B — scoped reads (agents see their slice).
-- ---------------------------------------------------------------------

-- Scripts attached to campaigns the caller is assigned to. Same shape
-- as current_member_visible_list_ids() / _campaign_ids() from 0041 —
-- SECURITY DEFINER so it bypasses scripts/campaigns RLS while we're
-- inside an RLS evaluation (no recursion).
create or replace function current_member_visible_script_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.script_id
  from campaigns c
  join campaign_agents ca on ca.campaign_id = c.id
  where ca.member_id = auth.uid()
    and c.script_id is not null;
$$;

drop policy if exists scripts_read on scripts;
create policy scripts_read on scripts for select to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or id in (select current_member_visible_script_ids())
    )
  );

-- Calendars the caller can book on. calendar_members.can_book gates
-- whether the member is a real bookable target (vs. just a viewer).
create or replace function current_member_visible_calendar_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select calendar_id
  from calendar_members
  where member_id = auth.uid()
    and can_book = true;
$$;

drop policy if exists calendars_read on calendars;
create policy calendars_read on calendars for select to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or id in (select current_member_visible_calendar_ids())
    )
  );

-- calendar_members rows track who can book which calendar. Agents
-- need to see their own row (so the UI can render "you can book
-- here"); managers+ see all rows on calendars in their brand.
drop policy if exists calendar_members_read on calendar_members;
create policy calendar_members_read on calendar_members for select to authenticated
  using (
    member_id = auth.uid()
    or exists (
      select 1 from calendars c
      where c.id = calendar_members.calendar_id
        and is_manager_or_above(c.brand_id)
    )
  );
