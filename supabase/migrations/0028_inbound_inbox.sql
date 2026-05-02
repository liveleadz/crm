-- Inbound triage columns: who has worked the call and when. Lets the
-- Inbox view filter "needs handling" vs. "handled" without inventing a
-- new disposition. Partial index keeps the unhandled lookup cheap on
-- brands with millions of calls.

alter table calls add column if not exists handled_at timestamptz;
alter table calls add column if not exists handled_by uuid
  references members(id) on delete set null;

create index if not exists calls_inbound_unhandled_idx
  on calls(brand_id, started_at desc)
  where direction = 'inbound' and handled_at is null;
