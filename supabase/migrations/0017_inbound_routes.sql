-- Inbound call handling.
--
-- Per-number routing config (which members ring, how long, whether voicemail
-- catches missed calls). Rows are 1:1 with numbers; a missing row means the
-- number simply hangs up on inbound (existing behavior).

create table if not exists inbound_routes (
  number_id uuid primary key references numbers(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  strategy text not null default 'simul' check (strategy in ('simul','round_robin','single')),
  -- Member IDs to ring. Empty array = no one rings; voicemail still applies
  -- when enabled.
  member_ids uuid[] not null default '{}',
  ring_timeout_sec int not null default 25 check (ring_timeout_sec between 5 and 120),
  voicemail_enabled boolean not null default true,
  voicemail_greeting text,
  updated_at timestamptz not null default now()
);
create index if not exists inbound_routes_brand_idx on inbound_routes(brand_id);

alter table inbound_routes enable row level security;
drop policy if exists inbound_routes_brand on inbound_routes;
create policy inbound_routes_brand on inbound_routes
  for all
  using (is_brand_member(brand_id))
  with check (is_brand_member(brand_id));

-- Mark a calls row as a voicemail capture so the call list can render it
-- distinctly from a missed call.
alter table calls add column if not exists is_voicemail boolean not null default false;
