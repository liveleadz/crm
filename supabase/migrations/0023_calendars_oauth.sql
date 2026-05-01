-- 0023 — Brand-owned shared calendars + per-member OAuth scope tracking.
--
-- Phase 1 of the email + calendar integration: ships calendar resources,
-- agent assignment, and the OAuth scope column. members.email_provider /
-- members.email_oauth already exist (0001_init); we only add oauth_scopes
-- so the UI can tell calendar-only vs email-only grants apart without
-- inspecting the JSON.

alter table members
  add column if not exists oauth_scopes text[] not null default '{}';

create table if not exists calendars (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  color text,
  owner_member_id uuid references members(id) on delete set null,
  ext_provider text check (ext_provider in ('google','microsoft')),
  ext_calendar_id text,
  ext_sync_token text,
  ext_last_sync_at timestamptz,
  default_duration_min int not null default 30,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Both binding fields are set together or both null. Keeps the schema
  -- honest so the sync code can short-circuit on ext_provider null.
  constraint calendars_ext_pair_chk
    check ((ext_provider is null and ext_calendar_id is null)
        or (ext_provider is not null and ext_calendar_id is not null))
);
create index if not exists calendars_brand_idx on calendars(brand_id, is_active);
create index if not exists calendars_ext_lookup_idx
  on calendars(ext_provider, ext_calendar_id)
  where ext_provider is not null;

create table if not exists calendar_members (
  calendar_id uuid not null references calendars(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  can_book boolean not null default true,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (calendar_id, member_id)
);
create index if not exists calendar_members_member_idx on calendar_members(member_id);

alter table appointments
  add column if not exists calendar_id uuid references calendars(id) on delete set null,
  add column if not exists ext_event_id text,
  add column if not exists ext_etag text,
  add column if not exists ext_status text not null default 'local';
create index if not exists appointments_calendar_idx on appointments(calendar_id);
create unique index if not exists appointments_ext_event_uniq
  on appointments(calendar_id, ext_event_id)
  where ext_event_id is not null;

alter table calendars enable row level security;
alter table calendar_members enable row level security;

drop policy if exists calendars_brand on calendars;
create policy calendars_brand on calendars for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));

drop policy if exists calendar_members_brand on calendar_members;
create policy calendar_members_brand on calendar_members for all to authenticated
  using (
    exists (select 1 from calendars c
              where c.id = calendar_id and is_brand_member(c.brand_id))
  )
  with check (
    exists (select 1 from calendars c
              where c.id = calendar_id and is_brand_member(c.brand_id))
  );

drop trigger if exists calendars_updated_at on calendars;
create trigger calendars_updated_at before update on calendars
  for each row execute function set_updated_at();
