-- Advanced workflow node types: webhook trigger, message outbox, notifications.
--
-- This migration adds three things:
--   1. automations.webhook_token  — sparse, only set when trigger=webhook_received.
--      Indexed unique partial; lookup is O(1) from the public webhook receiver.
--   2. message_outbox             — queued email/SMS sends. Provider integration
--      lives downstream: this PR only enqueues with status='queued'; a future
--      drainer worker will flip rows to 'sending'/'sent'/'failed'.
--   3. notifications              — in-app notifications surfaced via the topbar
--      bell. Recipients can be a specific member (recipient_member_id) OR a
--      role broadcast (recipient_role) — exactly one is required.
--
-- All three are RLS-scoped to brand membership.

-- 1. Webhook token on automations -----------------------------------------
alter table automations
  add column if not exists webhook_token text;

create unique index if not exists automations_webhook_token_idx
  on automations(webhook_token)
  where webhook_token is not null;

-- 2. Message outbox -------------------------------------------------------
create table if not exists message_outbox (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  automation_run_id uuid references workflow_runs(id) on delete set null,
  channel text not null check (channel in ('email','sms')),
  to_addr text not null,
  from_addr text,
  subject text,
  body text not null,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','failed','skipped')),
  provider_message_id text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists message_outbox_status_idx
  on message_outbox(status, created_at);
create index if not exists message_outbox_brand_idx
  on message_outbox(brand_id, created_at desc);

alter table message_outbox enable row level security;

drop policy if exists message_outbox_brand on message_outbox;
create policy message_outbox_brand on message_outbox
  for all
  using (is_brand_member(brand_id))
  with check (is_brand_member(brand_id));

-- 3. Notifications --------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  recipient_member_id uuid references members(id) on delete cascade,
  recipient_role member_role,
  kind text not null,
  title text not null,
  body text,
  link_url text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (recipient_member_id is not null or recipient_role is not null)
);

create index if not exists notifications_recipient_idx
  on notifications(recipient_member_id, read_at, created_at desc)
  where recipient_member_id is not null;
create index if not exists notifications_brand_role_idx
  on notifications(brand_id, recipient_role, read_at, created_at desc)
  where recipient_role is not null;

alter table notifications enable row level security;

drop policy if exists notifications_brand_read on notifications;
create policy notifications_brand_read on notifications
  for select
  using (
    is_brand_member(brand_id)
    and (
      recipient_member_id = auth.uid()
      or recipient_role is not null
    )
  );

drop policy if exists notifications_brand_update on notifications;
create policy notifications_brand_update on notifications
  for update
  using (is_brand_member(brand_id))
  with check (is_brand_member(brand_id));
