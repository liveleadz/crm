-- 0024 — Allow appointments without a lead so externally-pulled "busy"
-- blocks (ext_status='ext_only') can land in the calendar without a fake
-- lead. The plan-level invariant is enforced in code: when lead_id is null,
-- ext_event_id must be set.

alter table appointments
  alter column lead_id drop not null;
