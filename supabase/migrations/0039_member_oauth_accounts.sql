-- 0039 — Multi-account OAuth support per member.
--
-- Until now each member could connect a single Google account; the
-- access/refresh tokens lived in members.email_oauth as a single
-- JSONB blob. Re-running the connect flow blew the prior tokens away,
-- which prevented managers from binding LeadPilot calendars to
-- calendars across multiple Google accounts (e.g. personal + workspace).
--
-- This migration introduces member_oauth_accounts so a member can hold
-- N OAuth grants. Calendars gain an owner_account_id column pointing at
-- the specific account row used to fetch tokens for sync.
--
-- The legacy members.email_oauth columns are intentionally preserved
-- and kept in sync as the "primary" account by the OAuth callback —
-- email-send and email-pull paths still read from that single blob.
-- Shipping multi-account email is a separate, larger change.

create table if not exists member_oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  provider text not null check (provider in ('google')),
  account_email text not null, -- always lowercased
  oauth jsonb not null,        -- shape mirrors GoogleTokenSet
  scopes text[] not null default '{}', -- e.g. {'calendar','email'}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, provider, account_email)
);
create index if not exists member_oauth_accounts_member_idx
  on member_oauth_accounts(member_id);

alter table member_oauth_accounts enable row level security;

drop policy if exists member_oauth_accounts_self on member_oauth_accounts;
create policy member_oauth_accounts_self on member_oauth_accounts for all
  to authenticated
  using (member_id = (select auth.uid()))
  with check (member_id = (select auth.uid()));

drop trigger if exists member_oauth_accounts_updated_at on member_oauth_accounts;
create trigger member_oauth_accounts_updated_at before update on member_oauth_accounts
  for each row execute function set_updated_at();

-- Each LeadPilot calendar binds to one specific OAuth account. Nullable
-- because not all calendars are externally bound and pre-migration rows
-- start without it (backfilled below).
alter table calendars
  add column if not exists owner_account_id uuid
    references member_oauth_accounts(id) on delete set null;
create index if not exists calendars_owner_account_idx
  on calendars(owner_account_id);

-- Backfill: project the existing single-blob OAuth into one
-- member_oauth_accounts row per connected member, then point all of
-- that member's owned calendars at the new row. Idempotent via the
-- unique key, so re-running the migration is safe.
do $$
declare
  r record;
  new_id uuid;
  email text;
begin
  for r in
    select id, email_oauth, oauth_scopes
    from members
    where email_provider = 'google' and email_oauth is not null
  loop
    email := lower(coalesce(r.email_oauth->>'account_email', ''));
    if email = '' then
      continue;
    end if;
    insert into member_oauth_accounts (member_id, provider, account_email, oauth, scopes)
    values (r.id, 'google', email, r.email_oauth, coalesce(r.oauth_scopes, '{}'::text[]))
    on conflict (member_id, provider, account_email) do update
      set oauth = excluded.oauth,
          scopes = excluded.scopes,
          updated_at = now()
    returning id into new_id;
    update calendars
      set owner_account_id = new_id
      where owner_member_id = r.id and owner_account_id is null;
  end loop;
end
$$;
