-- 0047 — Username login alias
--
-- Some agents (e.g. power dialers shared across brands) prefer a
-- short username over a real email for daily login. Supabase Auth
-- only accepts email/password, so we layer a username alias on top:
--
--   members.username  — optional, case-insensitive unique handle.
--
-- The login page accepts "username or email" as the identifier. When
-- the input has no '@', a server action resolves the username to the
-- member's email via this column (admin client, RLS-bypassed) and
-- the client then calls signInWithPassword with the resolved email.
-- Auth itself is unchanged — Supabase still authenticates by email.
--
-- Stored lower-cased so lookups can use a plain equality predicate
-- against the unique index without case folding at query time.

alter table members
  add column if not exists username text;

-- Case-insensitive uniqueness. Allow null so existing email-only
-- accounts stay valid; only enforce uniqueness for non-null values.
create unique index if not exists members_username_lower_uniq
  on members (lower(username))
  where username is not null;
