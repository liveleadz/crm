-- Disposition tracking on every call.
--
-- Every call must end with a disposition. Until the agent picks one we
-- mark the row needs_disposition=true and the UI surfaces a "needs
-- disposition" badge / picker so nothing falls through the cracks.

alter table calls
  add column if not exists note text,
  add column if not exists callback_at timestamptz,
  add column if not exists needs_disposition boolean not null default true;

-- Backfill: anything already with a disposition is settled.
update calls set needs_disposition = false where disposition is not null;

create index if not exists calls_needs_disposition_idx
  on calls(brand_id, started_at desc)
  where needs_disposition = true;
