-- 0044 - Disposition escalation ladder.
--
-- Adds a per-disposition "consecutive-streak" stage ladder. When an
-- agent saves the same disposition (or any disposition in the same
-- category, optionally) on a lead repeatedly within a campaign, the
-- lead steps through a configured ordered list of pipeline stages.
-- After the streak exceeds the ladder, a terminal action fires:
-- optional move to a terminal stage, optional tag attach, optional DNC.
--
-- Pre-wires the canonical use case: 5-rung "No Answer 1...5" ladder
-- followed by terminal stage "Lost / Never Answered" for the
-- 'no_answer' disposition on every brand. Manager-configurable from
-- /settings.
--
-- Streak semantics live in app code (lib/disposition-followups.ts) -
-- the ladder is computed by walking calls.disposition rows for the
-- (lead, campaign) pair newest-first and counting leading matches.
-- The just-saved call is part of the count because setDisposition()
-- writes it before escalation runs.

-- ---------------------------------------------------------------------
-- 1. Schema: extend dispositions with escalation columns.
-- ---------------------------------------------------------------------

alter table dispositions
  add column if not exists escalation_enabled boolean not null default false,
  -- Ordered ladder. escalation_stage_ids[0] applies at streak=1,
  -- [1] at streak=2, ... When streak > array_length, terminal fires.
  add column if not exists escalation_stage_ids uuid[] not null default '{}'::uuid[],
  add column if not exists escalation_terminal_stage_id uuid references stages(id) on delete set null,
  add column if not exists escalation_terminal_tag_id uuid references tags(id) on delete set null,
  add column if not exists escalation_terminal_set_dnc boolean not null default false,
  -- match_category=true: any disposition with the same category counts
  -- toward the streak (so 'busy' contributes to the 'no_answer' ladder).
  -- false: only the literal disposition_id matches.
  add column if not exists escalation_match_category boolean not null default true;

-- ---------------------------------------------------------------------
-- 2. Seed 6 ladder stages per existing brand.
--    Append after the highest current position so manager-defined
--    custom stages stay where the manager put them.
-- ---------------------------------------------------------------------

with maxpos as (
  select brand_id, coalesce(max(position), 0) as p from stages group by brand_id
)
insert into stages (brand_id, name, position, color, is_won, is_lost)
select b.id, v.name, mp.p + v.n, v.color, false, v.is_lost
from brands b
join maxpos mp on mp.brand_id = b.id
cross join (values
  ('No Answer 1',           1, 'amber', false),
  ('No Answer 2',           2, 'amber', false),
  ('No Answer 3',           3, 'amber', false),
  ('No Answer 4',           4, 'amber', false),
  ('No Answer 5',           5, 'hp',    false),
  ('Lost / Never Answered', 6, 'hp',    true)
) as v(name, n, color, is_lost)
where not exists (
  select 1 from stages s
  where s.brand_id = b.id and s.name = v.name
);

-- ---------------------------------------------------------------------
-- 3. Pre-wire the no_answer disposition's escalation_stage_ids and
--    terminal stage on every existing brand.
-- ---------------------------------------------------------------------

update dispositions d
set escalation_enabled = true,
    escalation_stage_ids = coalesce(
      (
        select array_agg(s.id order by ord)
        from (values
          ('No Answer 1', 1),
          ('No Answer 2', 2),
          ('No Answer 3', 3),
          ('No Answer 4', 4),
          ('No Answer 5', 5)
        ) as v(name, ord)
        join stages s on s.brand_id = d.brand_id and s.name = v.name
      ),
      '{}'::uuid[]
    ),
    escalation_terminal_stage_id = (
      select id from stages
      where brand_id = d.brand_id and name = 'Lost / Never Answered'
      limit 1
    )
where d.code = 'no_answer';

-- ---------------------------------------------------------------------
-- 4. Per-brand seed trigger: on new brand insert, create both the
--    baseline 6 stages (mirroring the 0001 seed) AND the 6 ladder
--    stages, then wire no_answer once dispositions exist.
--
--    The 0011 brands_seed_dispositions trigger fires on the same
--    insert. Postgres fires AFTER INSERT triggers in name order, so
--    we name this one with a 'z' prefix to ensure dispositions are
--    seeded first by 'brands_seed_dispositions'.
-- ---------------------------------------------------------------------

create or replace function seed_default_stages_for_brand() returns trigger
  language plpgsql as $$
declare
  base_pos int := 0;
begin
  -- Baseline 6 (skip if already present so re-running is idempotent).
  if not exists (select 1 from stages where brand_id = new.id) then
    insert into stages (brand_id, name, position, color, is_won, is_lost) values
      (new.id, 'New',         1, 'slate',  false, false),
      (new.id, 'Contacted',   2, 'blue',   false, false),
      (new.id, 'Qualified',   3, 'amber',  false, false),
      (new.id, 'Appointment', 4, 'purple', false, false),
      (new.id, 'Won',         5, 'green',  true,  false),
      (new.id, 'Lost',        6, 'hp',     false, true);
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

drop trigger if exists z_brands_seed_stages on brands;
create trigger z_brands_seed_stages after insert on brands
  for each row execute function seed_default_stages_for_brand();

-- Wire no_answer escalation for new brands. Must run after both the
-- dispositions seed and the stages seed. Trigger names sort as:
--   brands_seed_dispositions   (0011)
--   z_brands_seed_stages       (this migration)
--   zz_brands_wire_no_answer   (this migration, runs last)
create or replace function wire_no_answer_escalation_for_brand() returns trigger
  language plpgsql as $$
begin
  update dispositions d
  set escalation_enabled = true,
      escalation_stage_ids = coalesce(
        (
          select array_agg(s.id order by ord)
          from (values
            ('No Answer 1', 1),
            ('No Answer 2', 2),
            ('No Answer 3', 3),
            ('No Answer 4', 4),
            ('No Answer 5', 5)
          ) as v(name, ord)
          join stages s on s.brand_id = d.brand_id and s.name = v.name
        ),
        '{}'::uuid[]
      ),
      escalation_terminal_stage_id = (
        select id from stages
        where brand_id = d.brand_id and name = 'Lost / Never Answered'
        limit 1
      )
  where d.brand_id = new.id and d.code = 'no_answer';
  return new;
end;
$$;

drop trigger if exists zz_brands_wire_no_answer on brands;
create trigger zz_brands_wire_no_answer after insert on brands
  for each row execute function wire_no_answer_escalation_for_brand();

-- No new RLS policies needed: new columns inherit dispositions' row
-- policies (read=is_brand_member, write=owner/admin from 0011).
