-- 0050_callback_task_title_lead
--
-- The seeded "Callback → create follow-up task" automation has been
-- creating tasks titled just "Callback" — reps had to open each task
-- to see which contact it belonged to. Switch the title to render
-- the lead's display name (full name, falling back to company, then
-- phone via the template engine's `lead.display_name` var).
--
-- Forward-compatible: also refresh seed_automations_for_brand() so
-- new brands inherit the new title on their first stage seed.

-- ---------------------------------------------------------------------
-- (a) Update existing system Callback automations across all brands.
-- ---------------------------------------------------------------------

update automations a
set actions = (
  select jsonb_agg(
    case
      when action->>'kind' = 'create_task'
        then jsonb_set(action, '{title}', '"Callback — {{lead.display_name}}"'::jsonb)
      else action
    end
  )
  from jsonb_array_elements(a.actions) as action
)
where a.is_system = true
  and a.trigger_type = 'disposition_set'
  and a.trigger_config->'codes' ? 'callback';

-- ---------------------------------------------------------------------
-- (b) Refresh seed_automations_for_brand so future brands inherit
--     the templated title on first stage seed.
-- ---------------------------------------------------------------------

create or replace function seed_automations_for_brand(p_brand_id text)
  returns void language plpgsql as $$
declare
  won_stage_id uuid;
  lost_stage_id uuid;
  appt_stage_id uuid;
  wn_tag_id uuid;
  dnc_tag_id uuid;
begin
  select id into won_stage_id from stages
    where brand_id = p_brand_id and is_won order by position limit 1;
  select id into lost_stage_id from stages
    where brand_id = p_brand_id and is_lost order by position limit 1;
  select id into appt_stage_id from stages
    where brand_id = p_brand_id and name in ('Appointment Set', 'Appointment')
    order by case when name = 'Appointment Set' then 0 else 1 end, position
    limit 1;

  insert into tags (brand_id, name, color)
  values (p_brand_id, 'Wrong Number', 'hp')
  on conflict (brand_id, name) do nothing;
  insert into tags (brand_id, name, color)
  values (p_brand_id, 'DNC (Do Not Call)', 'hp')
  on conflict (brand_id, name) do nothing;
  select id into wn_tag_id from tags
    where brand_id = p_brand_id and name = 'Wrong Number';
  select id into dnc_tag_id from tags
    where brand_id = p_brand_id and name = 'DNC (Do Not Call)';

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
      'When a call is dispositioned as Sale, move the lead to the Won stage.',
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

  if dnc_tag_id is not null
     and not exists (
       select 1 from automations
       where brand_id = p_brand_id and is_system = true
         and trigger_type = 'disposition_set'
         and trigger_config->'codes' ? 'do_not_call'
     ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'DNC → remove from pipeline & tag',
      'When a call is dispositioned as DNC, drop the lead off the pipeline, tag it as DNC (Do Not Call), and flag do_not_call so future dials skip it.',
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('do_not_call')),
      jsonb_build_array(
        jsonb_build_object('kind', 'clear_stage'),
        jsonb_build_object('kind', 'add_tag', 'tag_id', dnc_tag_id),
        jsonb_build_object('kind', 'mark_dnc')
      ),
      true,
      30
    );
  end if;

  if wn_tag_id is not null
     and not exists (
       select 1 from automations
       where brand_id = p_brand_id and is_system = true
         and trigger_type = 'disposition_set'
         and trigger_config->'codes' ? 'wrong_number'
     ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'Wrong number → remove from pipeline & tag',
      'When a call is dispositioned as Wrong number, drop the lead off the pipeline and tag it as Wrong Number so the bad contact info is visible on the leads list.',
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('wrong_number')),
      jsonb_build_array(
        jsonb_build_object('kind', 'clear_stage'),
        jsonb_build_object('kind', 'add_tag', 'tag_id', wn_tag_id)
      ),
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
      'When a call is dispositioned as Callback, create a call task for the agent at the requested time, titled with the contact''s name (or business / phone fallback) for instant identification in the task list.',
      'disposition_set',
      jsonb_build_object('codes', jsonb_build_array('callback')),
      jsonb_build_array(jsonb_build_object(
        'kind', 'create_task',
        'title', 'Callback — {{lead.display_name}}',
        'task_kind', 'call',
        'use_callback_at', true,
        'assign_to_caller', true,
        'with_reminder', true
      )),
      true,
      50
    );
  end if;

  if appt_stage_id is not null
     and not exists (
       select 1 from automations
       where brand_id = p_brand_id and is_system = true
         and trigger_type = 'appointment_booked'
     ) then
    insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
    values (
      p_brand_id,
      'Appointment booked → Appointment Set',
      'When an appointment is booked for a lead, move it to the Appointment Set stage.',
      'appointment_booked',
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object('kind', 'move_stage', 'stage_id', appt_stage_id)),
      true,
      60
    );
  end if;
end;
$$;
