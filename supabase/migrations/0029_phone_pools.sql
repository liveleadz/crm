-- 0029 — Phone number pools for outbound caller-ID rotation.
--
-- A pool groups one or more `numbers` rows under a strategy
-- (round_robin / random / sticky_lead). Brands set a default pool;
-- campaigns may override with their own. The dialer falls back to the
-- legacy single-number behavior (oldest active number) when no pool is
-- configured at any level.

create table phone_pools (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  strategy text not null default 'round_robin'
    check (strategy in ('round_robin','random','sticky_lead')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index phone_pools_brand_idx on phone_pools(brand_id);

create table phone_pool_numbers (
  pool_id uuid not null references phone_pools(id) on delete cascade,
  number_id uuid not null references numbers(id) on delete cascade,
  weight int not null default 1,
  last_used_at timestamptz,
  primary key (pool_id, number_id)
);
create index phone_pool_numbers_number_idx on phone_pool_numbers(number_id);

alter table brands
  add column if not exists default_pool_id uuid
    references phone_pools(id) on delete set null;

alter table campaigns
  add column if not exists phone_pool_id uuid
    references phone_pools(id) on delete set null;

alter table phone_pools enable row level security;
alter table phone_pool_numbers enable row level security;

create policy phone_pools_read on phone_pools for select to authenticated
  using (is_brand_member(brand_id));
create policy phone_pools_write on phone_pools for all to authenticated
  using (brand_role(brand_id) in ('owner','admin','manager'))
  with check (brand_role(brand_id) in ('owner','admin','manager'));

create policy phone_pool_numbers_read on phone_pool_numbers for select to authenticated
  using (exists (select 1 from phone_pools p
                 where p.id = pool_id and is_brand_member(p.brand_id)));
create policy phone_pool_numbers_write on phone_pool_numbers for all to authenticated
  using (exists (select 1 from phone_pools p
                 where p.id = pool_id
                   and brand_role(p.brand_id) in ('owner','admin','manager')))
  with check (exists (select 1 from phone_pools p
                 where p.id = pool_id
                   and brand_role(p.brand_id) in ('owner','admin','manager')));

create trigger phone_pools_updated_at before update on phone_pools
  for each row execute function set_updated_at();
