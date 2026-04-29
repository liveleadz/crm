-- Per-brand call dispositions.
--
-- Replaces the hardcoded list of outcomes baked into the dialer with a
-- brand-scoped, manager-editable table. Each brand starts with the
-- prior 10 defaults via seed + trigger, and managers can rename, retone,
-- archive, reorder, or add new outcomes through /settings.
--
-- The picker reads the active rows ordered by sort_order, so the order
-- managers set is the order agents see.

create table if not exists dispositions (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  code text not null,
  label text not null,
  tone text not null check (tone in ('good','neutral','bad')) default 'neutral',
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, code)
);

create index if not exists dispositions_brand_idx on dispositions(brand_id, sort_order);

alter table dispositions enable row level security;

drop policy if exists dispositions_read on dispositions;
create policy dispositions_read on dispositions for select to authenticated
  using (is_brand_member(brand_id));

drop policy if exists dispositions_write on dispositions;
create policy dispositions_write on dispositions for all to authenticated
  using (brand_role(brand_id) in ('owner','admin'))
  with check (brand_role(brand_id) in ('owner','admin'));

drop trigger if exists dispositions_updated on dispositions;
create trigger dispositions_updated before update on dispositions
  for each row execute function set_updated_at();

-- Seed the prior hardcoded defaults for every existing brand.
insert into dispositions (brand_id, code, label, tone, sort_order)
select b.id, d.code, d.label, d.tone, d.sort_order
from brands b
cross join (values
  ('connected',     'Connected',      'good',    1),
  ('sale',          'Sale',           'good',    2),
  ('callback',      'Callback',       'good',    3),
  ('voicemail',     'Voicemail',      'neutral', 4),
  ('no_answer',     'No answer',      'neutral', 5),
  ('busy',          'Busy',           'neutral', 6),
  ('wrong_number',  'Wrong number',   'bad',     7),
  ('not_interested','Not interested', 'bad',     8),
  ('do_not_call',   'DNC',            'bad',     9),
  ('failed',        'Failed',         'bad',     10)
) as d(code, label, tone, sort_order)
on conflict (brand_id, code) do nothing;

-- Auto-seed every newly created brand with the same defaults so each
-- brand starts with a working list out of the box.
create or replace function seed_dispositions_for_brand() returns trigger
  language plpgsql as $$
begin
  insert into dispositions (brand_id, code, label, tone, sort_order) values
    (new.id, 'connected',      'Connected',      'good',    1),
    (new.id, 'sale',           'Sale',           'good',    2),
    (new.id, 'callback',       'Callback',       'good',    3),
    (new.id, 'voicemail',      'Voicemail',      'neutral', 4),
    (new.id, 'no_answer',      'No answer',      'neutral', 5),
    (new.id, 'busy',           'Busy',           'neutral', 6),
    (new.id, 'wrong_number',   'Wrong number',   'bad',     7),
    (new.id, 'not_interested', 'Not interested', 'bad',     8),
    (new.id, 'do_not_call',    'DNC',            'bad',     9),
    (new.id, 'failed',         'Failed',         'bad',     10)
  on conflict (brand_id, code) do nothing;
  return new;
end;
$$;

drop trigger if exists brands_seed_dispositions on brands;
create trigger brands_seed_dispositions after insert on brands
  for each row execute function seed_dispositions_for_brand();
