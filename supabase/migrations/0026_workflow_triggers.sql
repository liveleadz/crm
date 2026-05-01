-- Per-action audit log for both simple-mode and graph-mode automation runs.
-- Captures every executed action with status (ok / skipped / failed) so the
-- Activity tab on the automation editor can show "what actually happened"
-- per run, complementing the workflow_runs table (which only captures
-- node-level state for graph mode).
--
-- Insert path:
--   - simple mode: written by lib/automation-engine.runAutomations after
--     each executeAction call. workflow_run_id is NULL.
--   - graph mode:  written by lib/workflow-graph-engine.walkFrom after each
--     executeAction call. workflow_run_id references the parent run.
--
-- detail jsonb is engine-defined and may include action-kind specifics
-- (e.g. message_outbox_id for send_email/send_sms, http status for
-- http_request, error message for failures).

create table action_log (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  workflow_run_id uuid references workflow_runs(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  trigger_type text not null,
  action_kind text not null,
  status text not null check (status in ('ok','skipped','failed')),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index action_log_brand_idx on action_log(brand_id, created_at desc);
create index action_log_automation_idx on action_log(automation_id, created_at desc);
create index action_log_run_idx on action_log(workflow_run_id) where workflow_run_id is not null;

alter table action_log enable row level security;

create policy action_log_brand_select on action_log for select to authenticated
  using (is_brand_member(brand_id));
