-- Sprint 5: extend scripts table to support call / sms / email kinds.
-- The base table from 0001_init.sql only has (id, brand_id, name, body, ...).

alter table scripts
  add column if not exists kind text not null default 'call'
    check (kind in ('call','sms','email')),
  add column if not exists subject text,
  add column if not exists description text;

create index if not exists scripts_brand_kind_idx on scripts(brand_id, kind);
