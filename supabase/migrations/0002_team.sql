-- 0002_team.sql
-- Member activation flag + mobile phone (used later for offline call fallback).
-- Updates is_brand_member / brand_role to honor the new flag so deactivation
-- is enforced at the DB layer (RLS automatically blocks inactive members).

alter table brand_members
  add column is_active boolean not null default true;

create index brand_members_active_idx on brand_members(brand_id) where is_active;

alter table members
  add column mobile_phone text;

create or replace function is_brand_member(b text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from brand_members
    where brand_id = b
      and member_id = auth.uid()
      and is_active = true
  );
$$;

create or replace function brand_role(b text) returns member_role
language sql stable security definer set search_path = public as $$
  select role from brand_members
  where brand_id = b
    and member_id = auth.uid()
    and is_active = true
  limit 1;
$$;
