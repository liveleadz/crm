-- Automations: lightweight per-brand "when X, do Y" rules.
--
-- Distinct from the (currently empty) `workflows` graph editor reserved for
-- future stateful, multi-step flows. Automations are fire-and-forget: a
-- trigger fires, every enabled automation matching that trigger runs its
-- ordered list of actions immediately and synchronously inside the same
-- request.
--
-- Triggers v1:
--   disposition_set   — fired by setDisposition() after a call wraps up.
--                       trigger_config: { codes: text[] }   (matches if call disposition in codes)
--
-- Actions v1 (jsonb array, executed in order):
--   { kind: 'move_stage',  stage_id: uuid }
--   { kind: 'mark_dnc' }
--   { kind: 'add_tag',     tag_id: uuid }
--   { kind: 'create_task', title: text, kind?: task_kind, due_in_minutes?: int, assign_to_caller?: bool }
--
-- Each brand is auto-seeded with sensible defaults that mirror the prior
-- hardcoded behavior (sale → Won, not_interested/do_not_call → Lost,
-- do_not_call → DNC flag, callback → create_task), all enabled and editable.

create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  description text,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  is_enabled boolean not null default true,
  is_system boolean not null default false,
  sort_order int not null default 0,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automations_brand_idx on automations(brand_id, sort_order);
create index if not exists automations_brand_trigger_idx
  on automations(brand_id, trigger_type) where is_enabled;

alter table automations enable row level security;

drop policy if exists automations_read on automations;
create policy automations_read on automations for select to authenticated
  using (is_brand_member(brand_id));

drop policy if exists automations_write on automations;
create policy automations_write on automations for all to authenticated
  using (brand_role(brand_id) in ('owner','admin'))
  with check (brand_role(brand_id) in ('owner','admin'));

drop trigger if exists automations_updated on automations;
create trigger automations_updated before update on automations
  for each row execute function set_updated_at();

-- Seed defaults --------------------------------------------------------------
-- Helper: build the default automations for a given brand. Resolves Won/Lost
-- stages from the brand's pipeline at seed time and bakes their ids into
-- trigger configs. If the brand is missing a Won or Lost stage we just skip
-- the corresponding automation — the manager can wire it later.
create or replace function seed_automations_for_brand(p_brand_id text)
  returns void language plpgsql as $$
declare
  won_stage_id uuid;
  lost_stage_id uuid;
begin
  select id into won_stage_id from stages
    where brand_id = p_brand_id and is_won order by position limit 1;
  select id into lost_stage_id from stages
    where brand_id = p_brand_id and is_lost order by position limit 1;

  if won_stage_id is not null then
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

  if lost_stage_id is not null then
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

  -- DNC: flag the lead and (if Lost stage exists) drop it into Lost.
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

  -- Wrong number: just DNC the lead so it stops getting dialed.
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

  -- Callback: create a follow-up task for the agent who took the call.
  insert into automations (brand_id, name, description, trigger_type, trigger_config, actions, is_system, sort_order)
  values (
    p_brand_id,
    'Callback → create follow-up task',
    'When a call is dispositioned as Callback, create a call task for the agent at the requested time.',
    'disposition_set',
    jsonb_build_object('codes', jsonb_build_array('callback')),
    jsonb_build_array(jsonb_build_object(
      'kind', 'create_task',
      'title', 'Callback',
      'task_kind', 'call',
      'use_callback_at', true,
      'assign_to_caller', true
    )),
    true,
    50
  );
end;
$$;

-- Backfill existing brands.
do $$
declare b record;
begin
  for b in select id from brands loop
    if not exists (select 1 from automations where brand_id = b.id) then
      perform seed_automations_for_brand(b.id);
    end if;
  end loop;
end $$;

-- Auto-seed every newly created brand. Runs *after* the disposition + stage
-- seed triggers because trigger ordering on the same table is alphabetical
-- by trigger name and `brands_seed_zz_automations` sorts after
-- `brands_seed_dispositions`.
create or replace function seed_automations_for_brand_trigger() returns trigger
  language plpgsql as $$
begin
  perform seed_automations_for_brand(new.id);
  return new;
end;
$$;

drop trigger if exists brands_seed_zz_automations on brands;
create trigger brands_seed_zz_automations after insert on brands
  for each row execute function seed_automations_for_brand_trigger();
