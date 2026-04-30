-- Track when an inbound number's provider voice handler was last pointed at
-- our SWML route. Null means not connected.

alter table numbers
  add column if not exists inbound_connected_at timestamptz;
