-- Debug table for SignalWire SWML webhook callbacks. Captures every
-- request our /api/swml/dial endpoint receives so we can inspect what
-- SignalWire actually sends (headers, body, query). Temporary aid for
-- bringing up the WebRTC dialer; remove once /dialer-v2 is verified.

create table if not exists swml_debug (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  method text,
  url text,
  query jsonb,
  headers jsonb,
  body jsonb,
  body_text text,
  response jsonb
);
create index if not exists swml_debug_created_idx on swml_debug(created_at desc);

-- Service role only; never exposed via RLS-enabled client.
alter table swml_debug enable row level security;
