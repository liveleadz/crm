-- Graph automations: optional canvas-based editor for automations.
--
-- Each automation can be authored either as a "simple" linear chain (today's
-- behavior — actions[] runs synchronously after the trigger) or as a "graph"
-- (nodes/edges DAG with branches and time-based wait nodes, executed via
-- workflow_runs state machine and a cron tick).
--
-- The legacy actions[] column stays as the source of truth for simple mode.
-- When mode='graph', the graph column is authoritative and actions[] holds a
-- best-effort linearization for back-compat readouts (list view, search).
--
-- workflow_runs is repurposed: its workflow_id FK becomes optional, a new
-- automation_id FK is added, and a check constraint enforces exactly one
-- owner per run. The pre-existing partial index on next_run_at already
-- covers the cron tick query.

-- automations: graph mode flag + jsonb graph -------------------------------
alter table automations
  add column if not exists graph jsonb;

alter table automations
  add column if not exists mode text not null default 'simple';

alter table automations
  drop constraint if exists automations_mode_chk;
alter table automations
  add constraint automations_mode_chk check (mode in ('simple', 'graph'));

-- workflow_runs: allow runs owned by an automation instead of a workflow.
alter table workflow_runs
  alter column workflow_id drop not null;

alter table workflow_runs
  add column if not exists automation_id uuid references automations(id) on delete cascade;

alter table workflow_runs
  drop constraint if exists workflow_runs_owner_chk;
alter table workflow_runs
  add constraint workflow_runs_owner_chk check (
    (automation_id is not null and workflow_id is null) or
    (automation_id is null and workflow_id is not null)
  );

create index if not exists workflow_runs_automation_idx
  on workflow_runs(automation_id) where automation_id is not null;
