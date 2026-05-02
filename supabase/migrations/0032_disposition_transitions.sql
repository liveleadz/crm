-- 0032 — Lead-state transitions on disposition save.
--
-- Extends disposition_followups so a single disposition can also drive
-- the CRM forward without leaving the dialer:
--   • move_stage_id  — when set, lead.stage_id is updated on save and a
--                      stage_change row is appended to lead_events.
--   • add_tag_ids    — when non-empty, those tags are attached to the
--                      lead (idempotent via on conflict do nothing) and
--                      a tag_add row is appended to lead_events.
-- Both nullable / empty by default so existing rows are unaffected.

alter table disposition_followups
  add column if not exists move_stage_id uuid
    references stages(id) on delete set null,
  add column if not exists add_tag_ids uuid[] not null default '{}'::uuid[];
