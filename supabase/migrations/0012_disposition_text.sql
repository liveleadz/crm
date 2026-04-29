-- Convert calls.disposition from a fixed enum to free-form text so it
-- can hold the per-brand disposition codes managed in the dispositions
-- table. The valid set is now enforced at write-time by the UI / server
-- actions (codes are scoped per brand, so a single global enum doesn't
-- model reality anyway).

alter table calls
  alter column disposition type text using disposition::text;

drop type if exists call_disposition;
