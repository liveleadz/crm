-- 0003_lists_and_custom_fields.sql
-- Smart Lists: a named bucket of leads (initially populated by CSV import).
-- Custom fields: brand-defined extra columns the user can map to during import.

-- Lists ----------------------------------------------------------------------
create type list_source as enum ('import', 'manual', 'filter');

create table lead_lists (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  source list_source not null default 'import',
  criteria jsonb,                  -- reserved for future dynamic lists
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_lists_brand_idx on lead_lists(brand_id);
create unique index lead_lists_brand_name_idx on lead_lists(brand_id, lower(name));

create trigger lead_lists_updated before update on lead_lists
  for each row execute function set_updated_at();

-- Each lead can belong to one originating list (the import batch). Nullable so
-- manual / pre-existing leads stay unattached.
alter table leads
  add column list_id uuid references lead_lists(id) on delete set null;
create index leads_list_idx on leads(list_id);

-- Custom fields --------------------------------------------------------------
create table lead_custom_fields (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  key text not null,               -- slug, used as the JSONB key in leads.custom
  label text not null,             -- human-readable name shown in UI
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index lead_custom_fields_brand_key_idx on lead_custom_fields(brand_id, key);
create index lead_custom_fields_brand_idx on lead_custom_fields(brand_id);

-- RLS ------------------------------------------------------------------------
alter table lead_lists enable row level security;
alter table lead_custom_fields enable row level security;

create policy lead_lists_rw on lead_lists for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));

create policy lead_custom_fields_rw on lead_custom_fields for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));

-- Realtime -------------------------------------------------------------------
alter publication supabase_realtime add table lead_lists;
