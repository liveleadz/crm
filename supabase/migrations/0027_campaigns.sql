-- 0027 — Campaigns: power-dialer aggregate (script + calendar + lead lists +
-- assigned agents) plus disposition follow-up templates and call/appointment
-- attribution columns.
--
-- A campaign bundles everything an agent needs to power-dial: a call script,
-- a calendar (+ default appointment owner), one or more lead lists, and the
-- set of assigned agents. The same brand still has stand-alone (ad-hoc)
-- dialing — campaign_id stays nullable on calls/appointments.
--
-- disposition_followups holds per-disposition email/SMS/task templates.
-- A row with campaign_id = NULL is the brand-wide default; a row with
-- campaign_id set is the per-campaign override (uniqueness enforced by
-- (brand_id, campaign_id, disposition_id)).

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  description text,
  script_id uuid references scripts(id) on delete set null,
  calendar_id uuid references calendars(id) on delete set null,
  default_owner_id uuid references members(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','paused','archived')),
  recently_called_minutes int not null default 240,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_brand_status_idx on campaigns(brand_id, status);

create table campaign_lists (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  list_id uuid not null references lead_lists(id) on delete cascade,
  primary key (campaign_id, list_id)
);

create table campaign_agents (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  primary key (campaign_id, member_id)
);
create index campaign_agents_member_idx on campaign_agents(member_id);

create table disposition_followups (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  -- NULL campaign_id => brand-wide default. Non-null => campaign override.
  campaign_id uuid references campaigns(id) on delete cascade,
  disposition_id uuid not null references dispositions(id) on delete cascade,
  send_email boolean not null default false,
  email_subject text,
  email_body text,           -- supports {{lead.first_name}} via lib/automation-templates
  send_sms boolean not null default false,
  sms_body text,
  create_task boolean not null default false,
  task_title text,
  task_due_minutes int,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One row per (scope, disposition). Partial unique indexes split the
-- campaign and brand-default cases because UNIQUE NULLS NOT DISTINCT is PG15+.
create unique index disposition_followups_brand_uniq
  on disposition_followups(brand_id, disposition_id)
  where campaign_id is null;
create unique index disposition_followups_campaign_uniq
  on disposition_followups(campaign_id, disposition_id)
  where campaign_id is not null;
create index disposition_followups_lookup_idx
  on disposition_followups(brand_id, disposition_id);

-- Attribution columns. Both nullable so ad-hoc dials remain valid.
alter table calls
  add column if not exists campaign_id uuid references campaigns(id) on delete set null;
create index if not exists calls_campaign_idx
  on calls(campaign_id) where campaign_id is not null;

alter table appointments
  add column if not exists campaign_id uuid references campaigns(id) on delete set null;
create index if not exists appointments_campaign_idx
  on appointments(campaign_id) where campaign_id is not null;

-- RLS: brand-scoped read; manager+ for write on campaigns / followups.
alter table campaigns enable row level security;
alter table campaign_lists enable row level security;
alter table campaign_agents enable row level security;
alter table disposition_followups enable row level security;

create policy campaigns_read on campaigns for select to authenticated
  using (is_brand_member(brand_id));
create policy campaigns_write on campaigns for all to authenticated
  using (brand_role(brand_id) in ('owner','admin','manager'))
  with check (brand_role(brand_id) in ('owner','admin','manager'));

create policy campaign_lists_read on campaign_lists for select to authenticated
  using (exists (select 1 from campaigns c
                 where c.id = campaign_id and is_brand_member(c.brand_id)));
create policy campaign_lists_write on campaign_lists for all to authenticated
  using (exists (select 1 from campaigns c
                 where c.id = campaign_id
                   and brand_role(c.brand_id) in ('owner','admin','manager')))
  with check (exists (select 1 from campaigns c
                 where c.id = campaign_id
                   and brand_role(c.brand_id) in ('owner','admin','manager')));

create policy campaign_agents_read on campaign_agents for select to authenticated
  using (exists (select 1 from campaigns c
                 where c.id = campaign_id and is_brand_member(c.brand_id)));
create policy campaign_agents_write on campaign_agents for all to authenticated
  using (exists (select 1 from campaigns c
                 where c.id = campaign_id
                   and brand_role(c.brand_id) in ('owner','admin','manager')))
  with check (exists (select 1 from campaigns c
                 where c.id = campaign_id
                   and brand_role(c.brand_id) in ('owner','admin','manager')));

create policy disposition_followups_read on disposition_followups for select to authenticated
  using (is_brand_member(brand_id));
create policy disposition_followups_write on disposition_followups for all to authenticated
  using (brand_role(brand_id) in ('owner','admin','manager'))
  with check (brand_role(brand_id) in ('owner','admin','manager'));

create trigger campaigns_updated_at before update on campaigns
  for each row execute function set_updated_at();
create trigger disposition_followups_updated_at before update on disposition_followups
  for each row execute function set_updated_at();
