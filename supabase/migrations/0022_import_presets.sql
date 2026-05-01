-- Saved import presets — let agents reuse a CSV→lead mapping plus the
-- side-options (default phone country, initial stage, extra tag ids,
-- skip-dedup) without re-mapping every column for recurring imports.
--
-- Mapping is stored as JSONB keyed by CSV header → MappingTarget string.
-- The wizard auto-applies a preset when the parsed CSV's headers match
-- the preset's keys; otherwise the preset can be applied manually from
-- the dropdown. Stale entries (header missing from the new CSV) are
-- ignored at apply time.

create table if not exists import_presets (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  mapping jsonb not null default '{}'::jsonb,
  default_country text not null default 'US',
  -- Initial stage is optional. References stages but on stage delete we
  -- want the preset to keep working (just fall back to "no stage"), so
  -- on delete set null.
  stage_id uuid references stages(id) on delete set null,
  extra_tag_ids uuid[] not null default '{}',
  skip_dedup boolean not null default false,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_presets_brand_idx
  on import_presets(brand_id, created_at desc);

-- Case-insensitive uniqueness per brand so duplicate "Facebook lead form"
-- saves get rejected instead of cluttering the dropdown.
create unique index if not exists import_presets_brand_lower_name_uniq
  on import_presets(brand_id, lower(name));

drop trigger if exists import_presets_updated on import_presets;
create trigger import_presets_updated before update on import_presets
  for each row execute function set_updated_at();

alter table import_presets enable row level security;
drop policy if exists import_presets_brand on import_presets;
create policy import_presets_brand on import_presets
  for all
  using (is_brand_member(brand_id))
  with check (is_brand_member(brand_id));
