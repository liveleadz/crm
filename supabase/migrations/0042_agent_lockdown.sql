-- 0042 — Agent lockdown.
--
-- Migration 0040 already tightened the high-traffic per-row tables
-- (leads, calls, sms, appointments, tasks, lead_events, recordings,
-- campaigns) so agents only see their own work. This migration
-- closes the remaining gaps:
--
-- 1) Brand-wide config tables still allow any member to write. Tighten
--    them so agents can read (the dialer / pipeline / forms need it)
--    but only manager+ can mutate. Tables covered:
--      stages, tags, scripts, lead_lists, lead_custom_fields,
--      workflows, import_presets, numbers, inbound_routes,
--      calendars, calendar_members.
--
--    Already gated correctly elsewhere — left alone:
--      dispositions / disposition_followups (0011, 0027)
--      automations (0013)
--      phone_pools / phone_pool_numbers (0029)
--
-- 2) lead_tags inherits from leads. The 0001 policy only checks
--    is_brand_member, which would let an agent tag any lead
--    regardless of leads_select scope. Mirror leads_select for read
--    (own + assigned-list) and tighten write to "own lead OR mgr+".
--
-- 3) leads.owner_id reassignment is wide-open under the leads_modify
--    policy ("agents can modify their own leads") — agents could
--    reassign their own lead to another agent (or null) and lose
--    visibility. A column-level trigger blocks any owner_id change
--    unless the writer is manager+.

-- ---------------------------------------------------------------------
-- Helper: split a brand-wide read + manager-only write pair.
-- (Done inline per-table; keeping it explicit for grep-ability.)
-- ---------------------------------------------------------------------

-- stages -------------------------------------------------------------
drop policy if exists stages_rw on stages;
create policy stages_read on stages for select to authenticated
  using (is_brand_member(brand_id));
create policy stages_insert on stages for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy stages_update on stages for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy stages_delete on stages for delete to authenticated
  using (is_manager_or_above(brand_id));

-- tags ---------------------------------------------------------------
drop policy if exists tags_rw on tags;
create policy tags_read on tags for select to authenticated
  using (is_brand_member(brand_id));
create policy tags_insert on tags for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy tags_update on tags for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy tags_delete on tags for delete to authenticated
  using (is_manager_or_above(brand_id));

-- scripts ------------------------------------------------------------
drop policy if exists scripts_rw on scripts;
create policy scripts_read on scripts for select to authenticated
  using (is_brand_member(brand_id));
create policy scripts_insert on scripts for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy scripts_update on scripts for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy scripts_delete on scripts for delete to authenticated
  using (is_manager_or_above(brand_id));

-- lead_lists ---------------------------------------------------------
drop policy if exists lead_lists_rw on lead_lists;
create policy lead_lists_read on lead_lists for select to authenticated
  using (is_brand_member(brand_id));
create policy lead_lists_insert on lead_lists for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy lead_lists_update on lead_lists for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy lead_lists_delete on lead_lists for delete to authenticated
  using (is_manager_or_above(brand_id));

-- lead_custom_fields -------------------------------------------------
drop policy if exists lead_custom_fields_rw on lead_custom_fields;
create policy lead_custom_fields_read on lead_custom_fields for select to authenticated
  using (is_brand_member(brand_id));
create policy lead_custom_fields_insert on lead_custom_fields for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy lead_custom_fields_update on lead_custom_fields for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy lead_custom_fields_delete on lead_custom_fields for delete to authenticated
  using (is_manager_or_above(brand_id));

-- workflows ----------------------------------------------------------
drop policy if exists workflows_rw on workflows;
create policy workflows_read on workflows for select to authenticated
  using (is_brand_member(brand_id));
create policy workflows_insert on workflows for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy workflows_update on workflows for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy workflows_delete on workflows for delete to authenticated
  using (is_manager_or_above(brand_id));

-- import_presets -----------------------------------------------------
drop policy if exists import_presets_brand on import_presets;
create policy import_presets_read on import_presets for select to authenticated
  using (is_brand_member(brand_id));
create policy import_presets_insert on import_presets for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy import_presets_update on import_presets for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy import_presets_delete on import_presets for delete to authenticated
  using (is_manager_or_above(brand_id));

-- numbers ------------------------------------------------------------
drop policy if exists numbers_rw on numbers;
create policy numbers_read on numbers for select to authenticated
  using (is_brand_member(brand_id));
create policy numbers_insert on numbers for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy numbers_update on numbers for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy numbers_delete on numbers for delete to authenticated
  using (is_manager_or_above(brand_id));

-- inbound_routes -----------------------------------------------------
drop policy if exists inbound_routes_brand on inbound_routes;
create policy inbound_routes_read on inbound_routes for select to authenticated
  using (is_brand_member(brand_id));
create policy inbound_routes_insert on inbound_routes for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy inbound_routes_update on inbound_routes for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy inbound_routes_delete on inbound_routes for delete to authenticated
  using (is_manager_or_above(brand_id));

-- calendars ----------------------------------------------------------
drop policy if exists calendars_brand on calendars;
create policy calendars_read on calendars for select to authenticated
  using (is_brand_member(brand_id));
create policy calendars_insert on calendars for insert to authenticated
  with check (is_manager_or_above(brand_id));
create policy calendars_update on calendars for update to authenticated
  using (is_manager_or_above(brand_id))
  with check (is_manager_or_above(brand_id));
create policy calendars_delete on calendars for delete to authenticated
  using (is_manager_or_above(brand_id));

-- calendar_members (inherits via parent calendar) --------------------
drop policy if exists calendar_members_brand on calendar_members;
create policy calendar_members_read on calendar_members for select to authenticated
  using (
    exists (
      select 1 from calendars c
      where c.id = calendar_id and is_brand_member(c.brand_id)
    )
  );
create policy calendar_members_write on calendar_members for all to authenticated
  using (
    exists (
      select 1 from calendars c
      where c.id = calendar_id and is_manager_or_above(c.brand_id)
    )
  )
  with check (
    exists (
      select 1 from calendars c
      where c.id = calendar_id and is_manager_or_above(c.brand_id)
    )
  );

-- ---------------------------------------------------------------------
-- lead_tags — mirror leads_select for read, restrict write to lead's
-- own owner OR mgr+. Mirrors the helper functions added in 0041 so we
-- don't reintroduce the recursion that 0040 caused.
-- ---------------------------------------------------------------------
drop policy if exists lead_tags_rw on lead_tags;

create policy lead_tags_read on lead_tags for select to authenticated
  using (
    exists (
      select 1 from leads l
      where l.id = lead_tags.lead_id
        and is_brand_member(l.brand_id)
        and (
          is_manager_or_above(l.brand_id)
          or l.owner_id = (select auth.uid())
          or l.list_id in (select current_member_visible_list_ids())
        )
    )
  );

create policy lead_tags_write on lead_tags for all to authenticated
  using (
    exists (
      select 1 from leads l
      where l.id = lead_tags.lead_id
        and is_brand_member(l.brand_id)
        and (
          is_manager_or_above(l.brand_id)
          or l.owner_id = (select auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from leads l
      where l.id = lead_tags.lead_id
        and is_brand_member(l.brand_id)
        and (
          is_manager_or_above(l.brand_id)
          or l.owner_id = (select auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------
-- Lock owner_id reassignment to manager+. Agents keep write access to
-- their own leads but can't change ownership (e.g. to dump a lead onto
-- a colleague). The trigger fires only when owner_id actually changes,
-- so all other lead edits are unaffected.
-- ---------------------------------------------------------------------
create or replace function block_agent_owner_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and not is_manager_or_above(new.brand_id) then
    raise exception 'Only managers can reassign lead ownership'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_owner_guard on leads;
create trigger leads_owner_guard
  before update of owner_id on leads
  for each row
  when (new.owner_id is distinct from old.owner_id)
  execute function block_agent_owner_change();
