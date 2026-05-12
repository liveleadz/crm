-- 0049_wrong_number_dnc_clear_stage
--
-- Wrong Number / DNC dispositions should drop the lead off the kanban
-- and tag the contact so it's instantly visible on the leads list why
-- it stopped being dialled. Previously the seeded automations only
-- flipped do_not_call (DNC also moved the lead to Lost). Reps had no
-- visual signal in the pipeline beyond the do-not-call badge, and the
-- Lost column slowly filled with bad-number contacts that aren't
-- really "lost deals".
--
-- This migration:
--   (a) Seeds two per-brand tags: "Wrong Number" and "DNC (Do Not Call)".
--   (b) Rewires the two system automations to use the new clear_stage
--       action plus an add_tag pointing at the seeded tag.
--   (c) Refreshes seed_automations_for_brand so future brands inherit
--       the same configuration on first stage seed.
--   (d) Backtracks: for every lead whose call history contains a
--       wrong_number or do_not_call disposition, applies the same
--       treatment so the kanban reflects the cleanup today.

-- ---------------------------------------------------------------------
-- (a) Per-brand tag seeds
-- ---------------------------------------------------------------------

insert into tags (brand_id, name, color)
select b.id, 'Wrong Number', 'hp' from brands b
on conflict (brand_id, name) do nothing;

insert into tags (brand_id, name, color)
select b.id, 'DNC (Do Not Call)', 'hp' from brands b
on conflict (brand_id, name) do nothing;

-- ---------------------------------------------------------------------
-- (b) Rewire the existing system automations
-- ---------------------------------------------------------------------
-- Wrong number → clear_stage + add_tag(WN). Intentionally does NOT
-- flip do_not_call: a wrong number on file may be corrected later, and
-- the contact themselves hasn't refused contact.

with brand_tags as (
  select b.id as brand_id,
    (select id from tags where brand_id = b.id and name = 'Wrong Number') as wn_tag_id
  from brands b
)
update automations a
set
  name = 'Wrong number → remove from pipeline & tag',
  description = 'When a call is dispositioned as Wrong number, drop the lead off the pipeline and tag it as Wrong Number so the bad contact info is visible on the leads list.',
  actions = jsonb_build_array(
    jsonb_build_object('kind', 'clear_stage'),
    jsonb_build_object('kind', 'add_tag', 'tag_id', bt.wn_tag_id)
  )
from brand_tags bt
where a.brand_id = bt.brand_id
  and a.is_system = true
  and a.trigger_type = 'disposition_set'
  and a.trigger_config->'codes' ? 'wrong_number'
  and bt.wn_tag_id is not null;

-- DNC → clear_stage + add_tag(DNC) + mark_dnc. Replaces the previous
-- move-to-Lost behaviour: Lost is for deals that failed to close, not
-- for opted-out contacts.

with brand_tags as (
  select b.id as brand_id,
    (select id from tags where brand_id = b.id and name = 'DNC (Do Not Call)') as dnc_tag_id
  from brands b
)
update automations a
set
  name = 'DNC → remove from pipeline & tag',
  description = 'When a call is dispositioned as DNC, drop the lead off the pipeline, tag it as DNC (Do Not Call), and flag do_not_call so future dials skip it.',
  actions = jsonb_build_array(
    jsonb_build_object('kind', 'clear_stage'),
    jsonb_build_object('kind', 'add_tag', 'tag_id', bt.dnc_tag_id),
    jsonb_build_object('kind', 'mark_dnc')
  )
from brand_tags bt
where a.brand_id = bt.brand_id
  and a.is_system = true
  and a.trigger_type = 'disposition_set'
  and a.trigger_config->'codes' ? 'do_not_call'
  and bt.dnc_tag_id is not null;

-- ---------------------------------------------------------------------
-- (c) Refresh seed_automations_for_brand so newly-created brands
--     inherit the new behaviour on their first stage seed.
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

  -- Tags are seeded above via the brand-wide insert; pull the ids
  -- here so the automation actions can reference them.
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

-- ---------------------------------------------------------------------
-- (d) Backtrack historical dispositions
-- ---------------------------------------------------------------------
-- Wrong number: any lead that ever had a wrong_number disposition gets
-- its stage cleared and the WN tag attached. do_not_call is left
-- untouched (per the new rule).

with wn_hits as (
  select distinct c.lead_id, c.brand_id
  from calls c
  where c.disposition = 'wrong_number' and c.lead_id is not null
)
update leads l
set stage_id = null
from wn_hits w
where l.id = w.lead_id
  and l.stage_id is not null;

insert into lead_tags (lead_id, tag_id)
select distinct c.lead_id, t.id
from calls c
join tags t on t.brand_id = c.brand_id and t.name = 'Wrong Number'
where c.disposition = 'wrong_number' and c.lead_id is not null
on conflict (lead_id, tag_id) do nothing;

-- DNC: same shape, plus mark do_not_call=true.

with dnc_hits as (
  select distinct c.lead_id, c.brand_id
  from calls c
  where c.disposition = 'do_not_call' and c.lead_id is not null
)
update leads l
set stage_id = null,
    do_not_call = true
from dnc_hits d
where l.id = d.lead_id
  and (l.stage_id is not null or l.do_not_call = false);

insert into lead_tags (lead_id, tag_id)
select distinct c.lead_id, t.id
from calls c
join tags t on t.brand_id = c.brand_id and t.name = 'DNC (Do Not Call)'
where c.disposition = 'do_not_call' and c.lead_id is not null
on conflict (lead_id, tag_id) do nothing;
