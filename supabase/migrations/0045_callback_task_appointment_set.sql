-- 0045 — Callback task linkage + Appointment Set automation.
--
-- Two related changes that round out the disposition follow-through:
--
--   (a) Tasks created from a call (e.g. the seeded "Callback → create
--       follow-up task" automation) now carry a back-pointer to the
--       originating call. This lets the task UI surface the call's
--       notes, recording, and a one-click "Callback" button without
--       having to scan call history by phone number.
--
--   (b) Renames the default "Appointment" pipeline stage to
--       "Appointment Set" to match the disposition category and the
--       way the team talks about the funnel. Idempotent: only renames
--       brands that still hold the seed value (so a brand that
--       customised the stage name is never overwritten). Also seeds an
--       automation that moves the lead into that stage whenever an
--       agent dispositions a call as Appointment Set.
--
--   (c) The seeded Callback automation gets `with_reminder: true` so
--       the agent receives an in-app reminder at callback time. We also
--       backfill that flag onto the existing per-brand automation rows.

-- (a) Tasks ↔ calls back-reference -----------------------------------------
alter table tasks
  add column if not exists call_id uuid references calls(id) on delete set null;

create index if not exists tasks_call_idx on tasks(call_id) where call_id is not null;

-- (b) Rename the default Appointment stage --------------------------------
-- Only touch rows that look like the seed default: name='Appointment',
-- not won, not lost. Anything else is a brand customisation.
update stages
  set name = 'Appointment Set'
  where name = 'Appointment'
    and is_won = false
    and is_lost = false
    and not exists (
      -- Don't collide with brands that already have an "Appointment Set"
      -- stage (e.g. the manager renamed manually pre-migration).
      select 1 from stages s2
      where s2.brand_id = stages.brand_id and s2.name = 'Appointment Set'
    );

-- Update the per-brand seed trigger so future brands match.
create or replace function seed_default_stages_for_brand() returns trigger
  language plpgsql as $$
declare
  base_pos int := 0;
begin
  -- Baseline 6 (skip if already present so re-running is idempotent).
  if not exists (select 1 from stages where brand_id = new.id) then
    insert into stages (brand_id, name, position, color, is_won, is_lost) values
      (new.id, 'New',             1, 'slate',  false, false),
      (new.id, 'Contacted',       2, 'blue',   false, false),
      (new.id, 'Qualified',       3, 'amber',  false, false),
      (new.id, 'Appointment Set', 4, 'purple', false, false),
      (new.id, 'Won',             5, 'green',  true,  false),
      (new.id, 'Lost',            6, 'hp',     false, true);
  end if;

  select coalesce(max(position), 0) into base_pos from stages where brand_id = new.id;

  -- Ladder stages (skip names that already exist).
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

-- (c) Patch the existing Callback automation rows so the in-app reminder
-- fires at callback time. We rewrite each create_task action object in
-- place rather than replacing the whole actions array, so any manual
-- tweaks (e.g. the manager retitled the task) are preserved.
update automations
  set actions = (
    select jsonb_agg(
      case
        when (act->>'kind') = 'create_task'
          then act || jsonb_build_object('with_reminder', true)
        else act
      end
    )
    from jsonb_array_elements(automations.actions) as act
  )
  where is_system = true
    and trigger_type = 'disposition_set'
    and trigger_config->'codes' ? 'callback';

-- (d) Refresh the per-brand seed function ----------------------------------
-- Replaces the body from migration 0013 (idempotent — same shape, plus
-- the appointment_set automation and the with_reminder flag baked into
-- the callback action).
create or replace function seed_automations_for_brand(p_brand_id text)
  returns void language plpgsql as $$
declare
  won_stage_id uuid;
  lost_stage_id uuid;
  appt_stage_id uuid;
begin
  select id into won_stage_id from stages
    where brand_id = p_brand_id and is_won order by position limit 1;
  select id into lost_stage_id from stages
    where brand_id = p_brand_id and is_lost order by position limit 1;
  -- Match by display name so a manager who customised the order still
  -- gets the seeded appointment_set automation pointing at the right
  -- stage. Falls through with NULL if neither candidate exists.
  select id into appt_stage_id from stages
    where brand_id = p_brand_id and name in ('Appointment Set', 'Appointment')
    order by case when name = 'Appointment Set' then 0 else 1 end, position
    limit 1;

  if won_stage_id is not null
     and not exists (
       select 1 from automations
       where brand_id = p_brand_id and is_system = true
         and trigger_type = 'disposition_set'
         and trigger_config->'codes' ? 'sale'
     ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'Sale → move to Won',
      'When an agent dispositions a call as Sale, move the lead to the Won stage.',
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('sale')),
      jsonb_build_array(jsonb_build_object('kind', 'move_stage', 'stage_id', won_stage_id)),
      true,
      10
    );
  end if;

  if lost_stage_id is not null
     and not exists (
       select 1 from automations
       where brand_id = p_brand_id and is_system = true
         and trigger_type = 'disposition_set'
         and trigger_config->'codes' ? 'not_interested'
     ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'Not interested → move to Lost',
      'When a call is dispositioned as Not interested, move the lead to the Lost stage.',
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('not_interested')),
      jsonb_build_array(jsonb_build_object('kind', 'move_stage', 'stage_id', lost_stage_id)),
      true,
      20
    );
  end if;

  if not exists (
    select 1 from automations
    where brand_id = p_brand_id and is_system = true
      and trigger_type = 'disposition_set'
      and trigger_config->'codes' ? 'do_not_call'
  ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'DNC → mark Do Not Call',
      'When a call is dispositioned as DNC, flag the lead as Do Not Call' ||
        case when lost_stage_id is not null then ' and move it to Lost.' else '.' end,
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('do_not_call')),
      case
        when lost_stage_id is not null then
          jsonb_build_array(
            jsonb_build_object('kind', 'mark_dnc'),
            jsonb_build_object('kind', 'move_stage', 'stage_id', lost_stage_id)
          )
        else
          jsonb_build_array(jsonb_build_object('kind', 'mark_dnc'))
      end,
      true,
      30
    );
  end if;

  if not exists (
    select 1 from automations
    where brand_id = p_brand_id and is_system = true
      and trigger_type = 'disposition_set'
      and trigger_config->'codes' ? 'wrong_number'
  ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'Wrong number → mark Do Not Call',
      'When a call is dispositioned as Wrong number, flag the lead as Do Not Call so it''s skipped on future dials.',
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('wrong_number')),
      jsonb_build_array(jsonb_build_object('kind', 'mark_dnc')),
      true,
      40
    );
  end if;

  if not exists (
    select 1 from automations
    where brand_id = p_brand_id and is_system = true
      and trigger_type = 'disposition_set'
      and trigger_config->'codes' ? 'callback'
  ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'Callback → create follow-up task',
      'When a call is dispositioned as Callback, create a call task for the agent at the requested time, with an in-app reminder.',
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('callback')),
      jsonb_build_array(jsonb_build_object(
        'kind', 'create_task',
        'title', 'Callback',
        'task_kind', 'call',
        'use_callback_at', true,
        'assign_to_caller', true,
        'with_reminder', true
      )),
      true,
      50
    );
  end if;

  -- Appointment Set: move the lead into the configured pipeline stage.
  -- The lead is materialised earlier in the dialer flow (ensureLeadForCall)
  -- so the move_stage action always has a valid lead, even on a fresh
  -- ad-hoc dial.
  if appt_stage_id is not null
     and not exists (
       select 1 from automations
       where brand_id = p_brand_id and is_system = true
         and trigger_type = 'disposition_set'
         and trigger_config->'codes' ? 'appointment_set'
     ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'Appointment Set → move to Appointment Set',
      'When an agent dispositions a call as Appointment Set, move the contact to the Appointment Set pipeline stage.',
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('appointment_set')),
      jsonb_build_array(jsonb_build_object('kind', 'move_stage', 'stage_id', appt_stage_id)),
      true,
      60
    );
  end if;
end;
$$;

-- Backfill: re-run the seeder for every existing brand. Each insert is
-- guarded by a NOT EXISTS check so this is safe to execute repeatedly.
do $$
declare b record;
begin
  for b in select id from brands loop
    perform seed_automations_for_brand(b.id);
  end loop;
end $$;
