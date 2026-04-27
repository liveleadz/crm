-- LeadPilot USA — initial schema.
-- 6 sub-brands tenant-scoped via brand_members + RLS.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- Enums
-- ============================================================

create type member_role as enum ('owner', 'admin', 'manager', 'agent', 'viewer');
create type lead_source as enum ('manual', 'form', 'csv', 'api', 'workflow');
create type call_direction as enum ('outbound', 'inbound');
create type call_disposition as enum (
  'connected', 'voicemail', 'no_answer', 'busy', 'failed',
  'wrong_number', 'do_not_call', 'callback', 'sale', 'not_interested'
);
create type sms_direction as enum ('outbound', 'inbound');
create type sms_status as enum ('queued', 'sent', 'delivered', 'failed', 'received');

-- ============================================================
-- Holding + brands
-- ============================================================

create table brands (
  id text primary key,            -- 'hp','vl','bs','ll','hb','bi'
  slug text not null unique,
  name text not null,
  ein text,                       -- shared EIN across DBAs
  dba text,
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into brands (id, slug, name, color) values
  ('hp','homepro-appointments','HomePro Appointments','orange'),
  ('vl','virgin-leads','Virgin Leads','pink'),
  ('bs','buyer-signals','Buyer Signals','blue'),
  ('ll','live-leads','Live Leads','green'),
  ('hb','homepro-bids','HomePro Bids','purple'),
  ('bi','buyer-incentives','Buyer Incentives','amber');

-- One row per auth.users user — global profile.
create table members (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  -- agent-connected sending email (Gmail/Outlook OAuth)
  email_provider text,
  email_oauth jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-brand role assignment.
create table brand_members (
  brand_id text not null references brands(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  role member_role not null default 'agent',
  created_at timestamptz not null default now(),
  primary key (brand_id, member_id)
);
create index brand_members_member_idx on brand_members(member_id);

-- ============================================================
-- Pipelines + leads
-- ============================================================

create table stages (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  position int not null,
  color text,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  unique (brand_id, position)
);
create index stages_brand_idx on stages(brand_id);

create table tags (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (brand_id, name)
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  stage_id uuid references stages(id) on delete set null,
  owner_id uuid references members(id) on delete set null,
  source lead_source not null default 'manual',
  first_name text,
  last_name text,
  email text,
  phone text,                     -- E.164
  city text,
  state text,
  zip text,
  notes text,
  custom jsonb not null default '{}'::jsonb,
  do_not_call boolean not null default false,
  do_not_email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_brand_idx on leads(brand_id);
create index leads_stage_idx on leads(stage_id);
create index leads_owner_idx on leads(owner_id);
create index leads_phone_idx on leads(phone);

create table lead_tags (
  lead_id uuid not null references leads(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (lead_id, tag_id)
);

create table lead_events (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  type text not null,             -- 'note','stage_change','tag_add','call','sms','email','workflow'
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on lead_events(lead_id);
create index lead_events_brand_idx on lead_events(brand_id);

-- ============================================================
-- Telephony
-- ============================================================

create table numbers (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  e164 text not null unique,
  signalwire_id text,
  label text,
  a2p_campaign_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index numbers_brand_idx on numbers(brand_id);

create table calls (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  member_id uuid references members(id) on delete set null,
  number_id uuid references numbers(id) on delete set null,
  direction call_direction not null,
  from_number text not null,
  to_number text not null,
  signalwire_call_id text,
  disposition call_disposition,
  duration_sec int,
  recording_url text,
  transcript text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index calls_brand_idx on calls(brand_id);
create index calls_lead_idx on calls(lead_id);
create index calls_member_idx on calls(member_id);

create table sms (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  member_id uuid references members(id) on delete set null,
  number_id uuid references numbers(id) on delete set null,
  direction sms_direction not null,
  from_number text not null,
  to_number text not null,
  body text not null,
  status sms_status not null default 'queued',
  signalwire_sms_id text,
  created_at timestamptz not null default now()
);
create index sms_brand_idx on sms(brand_id);
create index sms_lead_idx on sms(lead_id);

create table recordings (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  call_id uuid not null references calls(id) on delete cascade,
  storage_path text not null,     -- bucket path
  duration_sec int,
  transcript text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Scripts + workflows + appointments
-- ============================================================

create table scripts (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  body text not null,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workflows (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  graph jsonb not null,           -- { nodes: [...], edges: [...] }
  enabled boolean not null default false,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  current_node_id text,
  state jsonb not null default '{}'::jsonb,
  status text not null default 'running',  -- 'running','waiting','completed','failed','cancelled'
  next_run_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index workflow_runs_brand_idx on workflow_runs(brand_id);
create index workflow_runs_next_idx on workflow_runs(next_run_at) where status = 'waiting';

create table appointments (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  status text not null default 'scheduled',  -- 'scheduled','confirmed','completed','no_show','cancelled'
  created_at timestamptz not null default now()
);
create index appointments_brand_idx on appointments(brand_id);
create index appointments_lead_idx on appointments(lead_id);
create index appointments_starts_idx on appointments(starts_at);

-- ============================================================
-- Audit
-- ============================================================

create table audit_log (
  id bigserial primary key,
  brand_id text references brands(id) on delete set null,
  member_id uuid references members(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_log_brand_idx on audit_log(brand_id);
create index audit_log_entity_idx on audit_log(entity, entity_id);

-- ============================================================
-- updated_at triggers
-- ============================================================

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger leads_updated before update on leads
  for each row execute function set_updated_at();
create trigger members_updated before update on members
  for each row execute function set_updated_at();
create trigger scripts_updated before update on scripts
  for each row execute function set_updated_at();
create trigger workflows_updated before update on workflows
  for each row execute function set_updated_at();

-- ============================================================
-- Auth helpers
-- ============================================================

create or replace function is_brand_member(b text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from brand_members
    where brand_id = b and member_id = auth.uid()
  );
$$;

create or replace function brand_role(b text) returns member_role
language sql stable security definer set search_path = public as $$
  select role from brand_members
  where brand_id = b and member_id = auth.uid()
  limit 1;
$$;

-- Auto-create members row on auth signup.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- RLS
-- ============================================================

alter table brands enable row level security;
alter table members enable row level security;
alter table brand_members enable row level security;
alter table stages enable row level security;
alter table tags enable row level security;
alter table leads enable row level security;
alter table lead_tags enable row level security;
alter table lead_events enable row level security;
alter table numbers enable row level security;
alter table calls enable row level security;
alter table sms enable row level security;
alter table recordings enable row level security;
alter table scripts enable row level security;
alter table workflows enable row level security;
alter table workflow_runs enable row level security;
alter table appointments enable row level security;
alter table audit_log enable row level security;

-- Brands: any authenticated user can read brands they belong to.
create policy brands_read on brands for select to authenticated
  using (is_brand_member(id));

-- Members: read self + any member sharing a brand.
create policy members_read_self on members for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from brand_members bm1
    join brand_members bm2 on bm1.brand_id = bm2.brand_id
    where bm1.member_id = auth.uid() and bm2.member_id = members.id
  ));
create policy members_update_self on members for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Brand membership: read where you are a member; only owner/admin can modify.
create policy brand_members_read on brand_members for select to authenticated
  using (is_brand_member(brand_id));
create policy brand_members_admin on brand_members for all to authenticated
  using (brand_role(brand_id) in ('owner','admin'))
  with check (brand_role(brand_id) in ('owner','admin'));

-- Generic brand-scoped policies (read + write for any member; tighten later per role).
create policy stages_rw on stages for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy tags_rw on tags for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy leads_rw on leads for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy lead_tags_rw on lead_tags for all to authenticated
  using (exists (select 1 from leads l where l.id = lead_tags.lead_id and is_brand_member(l.brand_id)))
  with check (exists (select 1 from leads l where l.id = lead_tags.lead_id and is_brand_member(l.brand_id)));
create policy lead_events_rw on lead_events for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy numbers_rw on numbers for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy calls_rw on calls for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy sms_rw on sms for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy recordings_rw on recordings for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy scripts_rw on scripts for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy workflows_rw on workflows for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy workflow_runs_rw on workflow_runs for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy appointments_rw on appointments for all to authenticated
  using (is_brand_member(brand_id)) with check (is_brand_member(brand_id));
create policy audit_log_read on audit_log for select to authenticated
  using (brand_id is null or is_brand_member(brand_id));

-- ============================================================
-- Realtime
-- ============================================================

alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table lead_events;
alter publication supabase_realtime add table calls;
alter publication supabase_realtime add table sms;
alter publication supabase_realtime add table appointments;

-- ============================================================
-- Default stages per brand (Kanban: New / Contacted / Qualified / Appt / Won / Lost)
-- ============================================================

insert into stages (brand_id, name, position, color, is_won, is_lost)
select b.id, s.name, s.position, s.color, s.is_won, s.is_lost
from brands b
cross join (values
  ('New', 1, 'slate', false, false),
  ('Contacted', 2, 'blue', false, false),
  ('Qualified', 3, 'amber', false, false),
  ('Appointment', 4, 'purple', false, false),
  ('Won', 5, 'green', true, false),
  ('Lost', 6, 'red', false, true)
) as s(name, position, color, is_won, is_lost);
