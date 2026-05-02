-- 0031 — TCPA dial-window soft block (per-campaign).
--
-- A campaign can opt-in to a brand-local-time dial window. When enabled,
-- the dialer queue filter and the manual prepareCall guard refuse to
-- queue / start a call for a lead whose local time is outside the window.
-- Defaults match the federal TCPA window (08:00–21:00 lead-local) so an
-- accidental enable still yields a sane policy.
--
-- Times are stored as minutes-since-midnight to keep arithmetic trivial
-- on both server and client without dragging in a time-of-day type.

alter table campaigns
  add column if not exists tcpa_enabled boolean not null default false,
  add column if not exists dial_window_start_min int not null default 480,  -- 08:00
  add column if not exists dial_window_end_min int not null default 1260,   -- 21:00
  add column if not exists skip_weekends boolean not null default false;
