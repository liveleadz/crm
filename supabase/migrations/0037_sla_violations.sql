-- Phase S: SLA violations.
--
-- A small open-incidents table fed by /api/cron/sla-tick. The cron
-- evaluates every brand on a 5-min cadence and writes one row per
-- (brand, member, kind) when a rule fires; rows are deleted when the
-- condition clears, so the table only ever contains *open* alerts.
--
-- v1 watches two rules, both computable from `member_presence` plus
-- recent `calls`:
--   - 'agent_idle'       — status='idle' AND last_event_at is 30+ min old
--                          (but still inside the 3-min staleness cutoff,
--                          otherwise we'd flag offline-by-staleness too).
--   - 'no_calls_active'  — status in ('active','on_call') for 30+ min
--                          AND zero calls placed in the last 30 min.
--
-- Reads are allowed for any brand member; writes go through the
-- service-role cron only, so no INSERT/UPDATE/DELETE policy is needed
-- for authenticated users.

create table if not exists sla_violations (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  kind text not null check (kind in ('agent_idle','no_calls_active')),
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  unique (brand_id, member_id, kind)
);

create index if not exists sla_violations_brand_idx
  on sla_violations(brand_id);

alter table sla_violations enable row level security;

create policy sla_violations_brand_read on sla_violations
  for select to authenticated using (is_brand_member(brand_id));
