-- 0048 — Pipeline split: agents vs above-agent + No Show auto-followup.
--
-- The pipeline now has a clean handoff between agents (who prospect and book)
-- and managers/admins/owners (who close):
--
--   Agents  : New → Contacted → Qualified → Appointment Set
--   Closers : Appointment Set → Won (sale) | No Show
--
-- This migration is the DB half. UI scoping is done in the loaders, not RLS,
-- so direct lead URLs / imports / admin actions still work for above-agent
-- roles — this is a *view* decision, not a security boundary.
--
-- Pieces:
--   (a) Two new flags on `stages`: is_appointment_set, is_no_show, mirroring
--       the existing is_won / is_lost pattern from 0001.
--   (b) Backfill: flag the existing "Appointment Set" stage per brand and
--       insert a fresh "No Show" stage at the end of each brand's ladder.
--   (c) Patch seed_default_stages_for_brand() so new brands get the same.
--   (d) Track who set the appointment on the lead row, so a No Show can ping
--       the original setter even after a reschedule.
--   (e) Trigger A — capture the setter on stage transitions into
--       Appointment Set. COALESCE with whatever the application already set
--       so admin-client paths (auth.uid() = null) can pre-populate it.
--   (f) Trigger B — when a lead lands on a No Show stage, fire a follow-up
--       task and an in-app notification for the setter. Both triggers are
--       SECURITY DEFINER so they bypass RLS for cross-member writes.

-- (a) Stage flags ----------------------------------------------------------
alter table stages
  add column if not exists is_appointment_set boolean not null default false,
  add column if not exists is_no_show         boolean not null default false;

-- (b) Backfill flags + insert No Show stage per brand ---------------------
update stages
   set is_appointment_set = true
 where name = 'Appointment Set'
   and is_won  = false
   and is_lost = false;

-- One No Show stage per brand, appended at the end. Idempotent: skip brands
-- that already have one (matched by flag, not name, so a renamed stage is
-- still detected).
insert into stages (brand_id, name, position, color, is_won, is_lost, is_no_show)
select b.id,
       'No Show',
       coalesce((select max(position) from stages where brand_id = b.id), 0) + 1,
       'hp',
       false,
       false,
       true
  from brands b
 where not exists (
   select 1 from stages s
    where s.brand_id = b.id and s.is_no_show = true
 );

-- (c) Update the per-brand stage seeder for new brands --------------------
-- Mirrors 0045's body but adds the No Show stage and seeds the two new
-- flags on Appointment Set / No Show. Ladder block is unchanged.
create or replace function seed_default_stages_for_brand() returns trigger
  language plpgsql as $$
declare
  base_pos int := 0;
begin
  if not exists (select 1 from stages where brand_id = new.id) then
    insert into stages (brand_id, name, position, color, is_won, is_lost,
                        is_appointment_set, is_no_show) values
      (new.id, 'New',             1, 'slate',  false, false, false, false),
      (new.id, 'Contacted',       2, 'blue',   false, false, false, false),
      (new.id, 'Qualified',       3, 'amber',  false, false, false, false),
      (new.id, 'Appointment Set', 4, 'purple', false, false, true,  false),
      (new.id, 'Won',             5, 'green',  true,  false, false, false),
      (new.id, 'No Show',         6, 'hp',     false, false, false, true),
      (new.id, 'Lost',            7, 'hp',     false, true,  false, false);
  end if;

  select coalesce(max(position), 0) into base_pos from stages where brand_id = new.id;

  insert into stages (brand_id, name, position, color, is_won, is_lost)
  select new.id, v.name, base_pos + v.n, v.color, false, v.is_lost
  from (values
    ('No Answer 1',           1, 'amber', false),
    ('No Answer 2',           2, 'amber', false),
    ('No Answer 3',           3, 'amber', false),
    ('No Answer 4',           4, 'amber', false),
    ('No Answer 5',           5, 'hp',    false),
    ('Lost / Never Answered', 6, 'hp',    true)
  ) as v(name, n, color, is_lost)
  where not exists (
    select 1 from stages s where s.brand_id = new.id and s.name = v.name
  );

  return new;
end;
$$;

-- (d) Track the appointment setter on the lead ----------------------------
alter table leads
  add column if not exists appointment_set_by_member_id uuid
    references members(id) on delete set null,
  add column if not exists appointment_set_at timestamptz;

create index if not exists leads_appt_setter_idx
  on leads(appointment_set_by_member_id)
  where appointment_set_by_member_id is not null;

-- (e) Trigger A — capture setter on transition into Appointment Set -------
create or replace function track_appointment_setter() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  new_is_set boolean;
begin
  select is_appointment_set into new_is_set from stages where id = new.stage_id;
  if coalesce(new_is_set, false) then
    -- COALESCE so application code (admin client, auth.uid() = null) can
    -- pre-populate the setter and have it stick.
    new.appointment_set_by_member_id :=
      coalesce(new.appointment_set_by_member_id, auth.uid());
    new.appointment_set_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists leads_track_appointment_setter on leads;
create trigger leads_track_appointment_setter
  before update of stage_id on leads
  for each row when (old.stage_id is distinct from new.stage_id)
  execute function track_appointment_setter();

-- (f) Trigger B — fire task + notification on transition into No Show -----
create or replace function notify_appointment_no_show() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  is_no    boolean;
  setter   uuid;
  label    text;
begin
  select is_no_show into is_no from stages where id = new.stage_id;
  if not coalesce(is_no, false) then
    return new;
  end if;

  setter := new.appointment_set_by_member_id;
  if setter is null then
    -- No tracked setter (e.g. legacy leads pre-0048). Nothing to notify.
    return new;
  end if;

  label := coalesce(
    nullif(trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), ''),
    new.phone,
    new.email,
    'this lead'
  );

  insert into tasks (
    brand_id, lead_id, assignee_id, title, kind, priority, status, due_at, created_by
  ) values (
    new.brand_id, new.id, setter,
    'Follow up — ' || label || ' was a no-show',
    'call', 'high', 'open',
    now() + interval '1 hour',
    auth.uid()
  );

  insert into notifications (
    brand_id, recipient_member_id, kind, title, body, link_url, data
  ) values (
    new.brand_id, setter, 'appointment_no_show',
    'Appointment marked No Show',
    label || ' was marked as a no-show. Tap to re-engage.',
    '/leads/' || new.id::text,
    jsonb_build_object('lead_id', new.id, 'marked_by', auth.uid())
  );

  return new;
end;
$$;

drop trigger if exists leads_no_show_notify on leads;
create trigger leads_no_show_notify
  after update of stage_id on leads
  for each row when (old.stage_id is distinct from new.stage_id)
  execute function notify_appointment_no_show();
