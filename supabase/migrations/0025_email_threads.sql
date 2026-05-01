-- 0025 — Phase 2 email integration (Gmail send + inbound sync).
--
-- Owns the storage for:
--   * email_threads        — one row per Gmail thread per member
--   * email_messages       — per-message body + headers + direction
--   * email_sync_state     — Gmail historyId checkpoint per member
--
-- Plus members.email_signature for composer auto-append, and an extra
-- 'email' value in oauth_scopes (which is a free-form text[] — no enum).

-- 1. Per-member signature (HTML) appended by the lead-detail composer.
alter table members
  add column if not exists email_signature text;

-- 2. Threads. brand_id is denormalized for fast lead-page joins; lead_id is
--    the matched lead (nullable for "unmatched inbox" Phase 2.5). member_id
--    is the agent who owns the Gmail mailbox the thread lives in.
create table email_threads (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  member_id uuid not null references members(id) on delete cascade,
  ext_provider text not null default 'google'
    check (ext_provider in ('google')),
  ext_thread_id text not null,
  subject text,
  snippet text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index email_threads_ext_uniq
  on email_threads(member_id, ext_thread_id);
create index email_threads_lead_idx
  on email_threads(lead_id, last_message_at desc nulls last);
create index email_threads_brand_idx
  on email_threads(brand_id, last_message_at desc nulls last);
create index email_threads_member_idx
  on email_threads(member_id, last_message_at desc nulls last);

-- 3. Messages.
create table email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references email_threads(id) on delete cascade,
  direction text not null check (direction in ('outbound','inbound')),
  ext_message_id text not null,
  ext_history_id text,
  from_addr text,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  subject text,
  snippet text,
  body_text text,
  body_html text,
  sent_at timestamptz not null,
  member_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index email_messages_ext_uniq
  on email_messages(thread_id, ext_message_id);
create index email_messages_thread_idx
  on email_messages(thread_id, sent_at);

-- 4. Per-member Gmail sync checkpoint.
create table email_sync_state (
  member_id uuid primary key references members(id) on delete cascade,
  last_history_id text,
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

-- 5. RLS. Threads + messages are brand-scoped via is_brand_member().
--    Sync state is per-member (each agent only sees their own).
alter table email_threads enable row level security;
alter table email_messages enable row level security;
alter table email_sync_state enable row level security;

create policy email_threads_brand on email_threads for all to authenticated
  using (is_brand_member(brand_id))
  with check (is_brand_member(brand_id));

create policy email_messages_brand on email_messages for all to authenticated
  using (
    exists (
      select 1 from email_threads t
       where t.id = thread_id and is_brand_member(t.brand_id)
    )
  )
  with check (
    exists (
      select 1 from email_threads t
       where t.id = thread_id and is_brand_member(t.brand_id)
    )
  );

create policy email_sync_state_self on email_sync_state for all to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- 6. updated_at triggers — reuse existing set_updated_at().
create trigger email_threads_updated_at before update on email_threads
  for each row execute function set_updated_at();
create trigger email_sync_state_updated_at before update on email_sync_state
  for each row execute function set_updated_at();
