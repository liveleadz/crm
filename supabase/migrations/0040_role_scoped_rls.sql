-- 0040 — Role-scoped RLS.
--
-- Until now every brand member could read/write every brand-scoped row
-- (the original policies in 0001_init.sql comment "tighten later per
-- role"). That meant a freshly-invited agent saw every lead, call, SMS,
-- campaign and appointment in the workspace.
--
-- This migration tightens the high-traffic tables so:
--   - owner / admin / manager keep full visibility (no behavior change).
--   - agent / viewer only see rows that belong to them, or — for leads —
--     rows on a list inside a campaign they're assigned to.
--
-- Tables intentionally left brand-wide: stages, tags, scripts, numbers,
-- dispositions, calendars. Agents need them to dial / book / categorize.

-- ---------------------------------------------------------------------
-- Helper: is the current user a manager-or-above on this brand?
-- ---------------------------------------------------------------------
create or replace function is_manager_or_above(b text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select brand_role(b) in ('owner','admin','manager');
$$;

grant execute on function is_manager_or_above(text) to authenticated;

-- ---------------------------------------------------------------------
-- leads
-- Read: own OR on a list inside a campaign they're on. Write: own only.
-- Manager+ keeps full access.
-- ---------------------------------------------------------------------
drop policy if exists leads_rw on leads;
drop policy if exists leads_select on leads;
drop policy if exists leads_modify on leads;

create policy leads_select on leads for select to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or owner_id = (select auth.uid())
      or exists (
        select 1
        from campaign_lists cl
        join campaign_agents ca on ca.campaign_id = cl.campaign_id
        where cl.list_id = leads.list_id
          and ca.member_id = (select auth.uid())
      )
    )
  );

create policy leads_modify on leads for all to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or owner_id = (select auth.uid())
    )
  )
  with check (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- lead_events
-- Agents only see events they themselves recorded. lead_tags inherits
-- from leads via its existing exists() policy and tightens automatically.
-- ---------------------------------------------------------------------
drop policy if exists lead_events_rw on lead_events;

create policy lead_events_rw on lead_events for all to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or member_id = (select auth.uid())
    )
  )
  with check (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or member_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------
drop policy if exists calls_rw on calls;

create policy calls_rw on calls for all to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or member_id = (select auth.uid())
    )
  )
  with check (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or member_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- sms
-- ---------------------------------------------------------------------
drop policy if exists sms_rw on sms;

create policy sms_rw on sms for all to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or member_id = (select auth.uid())
    )
  )
  with check (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or member_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- recordings — inherit from the parent call.
-- ---------------------------------------------------------------------
drop policy if exists recordings_rw on recordings;

create policy recordings_rw on recordings for all to authenticated
  using (
    exists (
      select 1 from calls c
      where c.id = recordings.call_id
        and is_brand_member(c.brand_id)
        and (
          is_manager_or_above(c.brand_id)
          or c.member_id = (select auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from calls c
      where c.id = recordings.call_id
        and is_brand_member(c.brand_id)
        and (
          is_manager_or_above(c.brand_id)
          or c.member_id = (select auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------
-- appointments — agent sees only ones they own.
-- ---------------------------------------------------------------------
drop policy if exists appointments_rw on appointments;

create policy appointments_rw on appointments for all to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or member_id = (select auth.uid())
    )
  )
  with check (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or member_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- tasks — agent sees tasks assigned to them (or that they created).
-- ---------------------------------------------------------------------
drop policy if exists tasks_rw on tasks;

create policy tasks_rw on tasks for all to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or assignee_id = (select auth.uid())
      or created_by = (select auth.uid())
    )
  )
  with check (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or assignee_id = (select auth.uid())
      or created_by = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- campaigns — agents only see campaigns they're assigned to.
-- Write policy (manager+) from 0027_campaigns.sql is unchanged.
-- ---------------------------------------------------------------------
drop policy if exists campaigns_read on campaigns;

create policy campaigns_read on campaigns for select to authenticated
  using (
    is_brand_member(brand_id) and (
      is_manager_or_above(brand_id)
      or exists (
        select 1 from campaign_agents ca
        where ca.campaign_id = campaigns.id
          and ca.member_id = (select auth.uid())
      )
    )
  );
