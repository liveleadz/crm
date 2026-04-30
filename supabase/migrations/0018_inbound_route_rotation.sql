-- Round-robin rotation pointer.
--
-- Tracks which member was last rung for an inbound number so the next call
-- can advance to the following member in member_ids[]. Single-agent
-- strategy ignores this field; simul ignores it; round_robin uses it.

alter table inbound_routes
  add column if not exists last_rung_member_id uuid;
