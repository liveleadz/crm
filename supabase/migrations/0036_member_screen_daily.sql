-- Phase R: Daily on-screen rollup.
--
-- `member_presence.seconds_today` resets at brand-local midnight, so 7d/30d
-- "on-screen time" totals can't be reconstructed from it alone. This table
-- captures one row per (brand, member, brand-local-day) so the per-agent
-- page can show real 7-day and 30-day totals.
--
-- Two writers feed it:
--   1. `pingPresence` server action — when it detects a day rollover, it
--      persists the *prior* day's seconds_today before resetting the row.
--      This is the cheap zero-latency path for active agents.
--   2. `/api/cron/screen-rollup` — a backstop that catches stragglers
--      (agents whose presence row was never pinged again after midnight).

create table if not exists member_screen_daily (
  brand_id text not null references brands(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  day_local date not null,
  seconds_on_screen int not null default 0,
  captured_at timestamptz not null default now(),
  primary key (brand_id, member_id, day_local)
);

create index if not exists member_screen_daily_brand_day_idx
  on member_screen_daily(brand_id, day_local desc);

alter table member_screen_daily enable row level security;

-- Brand-scoped read + write for any authenticated member. Writes are still
-- constrained at the action / cron layer (cron uses service-role and bypasses
-- RLS; the inline write in `pingPresence` only touches the caller's own row).
create policy member_screen_daily_brand_select on member_screen_daily
  for select to authenticated using (is_brand_member(brand_id));
create policy member_screen_daily_brand_insert on member_screen_daily
  for insert to authenticated with check (is_brand_member(brand_id));
create policy member_screen_daily_brand_update on member_screen_daily
  for update to authenticated
  using (is_brand_member(brand_id))
  with check (is_brand_member(brand_id));
