-- Realtime broadcast for in-browser inbound call popup. The
-- IncomingCallProvider subscribes to inserts on `notifications` filtered
-- to the current member; an inbound_call row triggers the answer/reject
-- popup with the conference name attached.

alter publication supabase_realtime add table notifications;
