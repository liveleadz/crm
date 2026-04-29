-- 0004_tasks.sql
-- Tasks / follow-ups. A task is a unit of work for a member.
-- Optionally tied to a lead (e.g. "call back Mary tomorrow") or standalone
-- (e.g. "renew SignalWire account"). Supports snooze, recurrence, and
-- per-task reminder configurations dispatched by a separate worker.

-- Enums ----------------------------------------------------------------------
create type task_status as enum ('open', 'done');
create type task_priority as enum ('low', 'normal', 'high');
create type task_kind as enum ('call', 'text', 'email', 'meeting', 'note', 'other');
create type task_reminder_channel as enum ('email', 'sms', 'in_app');

-- Tasks ----------------------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,        -- nullable: standalone tasks ok
  assignee_id uuid references members(id) on delete set null,  -- null = unassigned
  title text not null,
  notes text,
  kind task_kind not null default 'other',
  priority task_priority not null default 'normal',
  status task_status not null default 'open',
  due_at timestamptz,                                          -- nullable: someday/maybe
  snoozed_until timestamptz,                                   -- if set & future, hide from Today
  completed_at timestamptz,
  completed_by uuid references members(id) on delete set null,
  -- Recurrence rule. NULL = one-shot. Shape:
  --   { kind: 'daily'|'weekly'|'monthly'|'yearly', every: int, ends_at: ts|null, count: int|null }
  recurrence jsonb,
  -- For recurring chains: this task's parent (the original "template" task).
  parent_task_id uuid references tasks(id) on delete set null,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_brand_idx on tasks(brand_id);
create index tasks_lead_idx on tasks(lead_id);
create index tasks_assignee_idx on tasks(assignee_id);
create index tasks_due_idx on tasks(brand_id, status, due_at);
create index tasks_parent_idx on tasks(parent_task_id);

create trigger tasks_updated before update on tasks
  for each row execute function set_updated_at();

-- Task reminders -------------------------------------------------------------
-- Each row is a single scheduled nudge for a task. The dispatcher picks up
-- rows where remind_at <= now() and sent_at is null and the task is still open.
create table task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  channel task_reminder_channel not null,
  -- Resolved absolute time the reminder fires. Recomputed when task is
  -- created / due_at changes / snoozed.
  remind_at timestamptz not null,
  -- Stored offset in minutes relative to due_at, for re-resolution. Negative
  -- means "before due". e.g. -30 = 30 min before, 0 = at due time.
  offset_minutes int not null,
  sent_at timestamptz,
  send_error text,
  created_at timestamptz not null default now()
);
create index task_reminders_task_idx on task_reminders(task_id);
create index task_reminders_dispatch_idx on task_reminders(remind_at)
  where sent_at is null;

-- RLS ------------------------------------------------------------------------
alter table tasks enable row level security;
alter table task_reminders enable row level security;

-- Tasks: any brand member can RW for now. Tighten per-role later (agents see
-- only their own assignments) once we wire up the team UI.
create policy tasks_rw on tasks for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));

-- Reminders inherit access from their task.
create policy task_reminders_rw on task_reminders for all to authenticated
  using (exists (select 1 from tasks t where t.id = task_reminders.task_id and is_brand_member(t.brand_id)))
  with check (exists (select 1 from tasks t where t.id = task_reminders.task_id and is_brand_member(t.brand_id)));

-- Realtime -------------------------------------------------------------------
alter publication supabase_realtime add table tasks;
