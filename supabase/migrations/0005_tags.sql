-- 0005_tags.sql
-- Augment the existing `tags` and `lead_tags` tables (defined in 0001_init.sql)
-- with metadata columns we need now: created_by attribution, updated_at, and a
-- case-insensitive uniqueness guarantee so "VIP" / "vip" don't collide. Tables
-- start out empty in the live DB so additive ALTERs are safe.

-- Tags ----------------------------------------------------------------------
alter table tags
  add column if not exists created_by uuid references members(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- Default color for newly inserted rows. Existing nulls (none in production
-- yet) stay null and get resolved to the fallback in the frontend palette.
alter table tags alter column color set default 'slate';

-- Case-insensitive uniqueness alongside the existing (brand_id, name) constraint.
create unique index if not exists tags_brand_lower_name_uniq
  on tags(brand_id, lower(name));

create index if not exists tags_brand_idx on tags(brand_id);

drop trigger if exists tags_updated on tags;
create trigger tags_updated before update on tags
  for each row execute function set_updated_at();

-- Lead → tag join -----------------------------------------------------------
alter table lead_tags
  add column if not exists created_by uuid references members(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create index if not exists lead_tags_tag_idx on lead_tags(tag_id);
