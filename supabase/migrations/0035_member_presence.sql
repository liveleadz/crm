-- Phase N: Member presence.
--
-- Supabase realtime presence is great for instant push to other clients
-- on the Live Floor, but it's client-only — server components can't read
-- it for sidebar badge counts or time-on-screen aggregates. So we mirror
-- the latest snapshot into a tiny `member_presence` table updated via a
-- once-per-minute server-action ping.
--
-- One row per (brand, member). Status is one of on_call/active/idle/
-- offline. `seconds_today` accumulates only when the prior status was
-- active or on_call (idle and offline don't accumulate). It resets when
-- a new local-day session starts (the action checks the previous
-- last_session_started_at date against the brand-local today).

create table if not exists member_presence (
  brand_id text not null references brands(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  status text not null check (status in ('on_call','active','idle','offline')),
  last_event_at timestamptz not null default now(),
  last_session_started_at timestamptz,
  seconds_today int not null default 0,
  primary key (brand_id, member_id)
);

create index if not exists member_presence_brand_status_idx
  on member_presence(brand_id, status);

alter table member_presence enable row level security;

-- Same brand-scoped pattern used everywhere else: any authenticated
-- member of the brand can read + write rows for that brand. The action
-- layer further constrains writes to the caller's own member_id.
create policy member_presence_brand_select on member_presence
  for select to authenticated using (is_brand_member(brand_id));
create policy member_presence_brand_insert on member_presence
  for insert to authenticated with check (is_brand_member(brand_id));
create policy member_presence_brand_update on member_presence
  for update to authenticated
  using (is_brand_member(brand_id))
  with check (is_brand_member(brand_id));

-- No delete policy: rows are stable per (brand, member), updated in
-- place. Brand or member deletion cascades the row away.
