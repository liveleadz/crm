-- 0046 — Numbers & routing assignments
--
-- Two small additions that let managers wire numbers to specific
-- members from the /numbers admin UI:
--
--   inbound_routes.default_recipient_member_id  — the brand's default
--     ringer when an inbound call has no matching lead owner. Replaces
--     the hard-coded `hello@liveleadz.com` fallback in the SWML route
--     (which still applies as the terminal safety net when this is
--     null, so brands without configured routing keep working).
--
--   numbers.assigned_member_id  — the member who "owns" the number for
--     outbound dialing. Used as a NEW first step in pickOutboundNumber:
--     when the dialing agent has an assigned number in this brand,
--     dial out from it. Falls through to today's pool/brand-default
--     chain when nothing is assigned, so existing setups are untouched.
--
-- Both columns are nullable, FK to members(id) with ON DELETE SET NULL,
-- and inherit the existing row-level policies on their parent tables.

alter table inbound_routes
  add column if not exists default_recipient_member_id uuid
    references members(id) on delete set null;

alter table numbers
  add column if not exists assigned_member_id uuid
    references members(id) on delete set null;

-- Helpful indexes for the lookups added in code:
--   • numbers.assigned_member_id is filtered by (brand_id, assigned_member_id)
--     in pickOutboundNumber's first step.
--   • inbound_routes.default_recipient_member_id is read straight off the
--     row and doesn't need its own index, but a partial index keeps the
--     "list members who are someone's default recipient" admin query
--     cheap if we ever surface that.
create index if not exists numbers_assigned_member_idx
  on numbers (brand_id, assigned_member_id)
  where assigned_member_id is not null;

create index if not exists inbound_routes_default_recipient_idx
  on inbound_routes (default_recipient_member_id)
  where default_recipient_member_id is not null;
