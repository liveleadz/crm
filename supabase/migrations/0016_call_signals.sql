alter table calls add column if not exists hangup_cause text;
alter table calls add column if not exists sip_response int;
alter table calls add column if not exists stir_attestation text;
alter table calls drop constraint if exists calls_stir_chk;
alter table calls add constraint calls_stir_chk check (stir_attestation is null or stir_attestation in ('A','B','C'));
create index if not exists calls_number_started_idx on calls(number_id, started_at desc);
alter table numbers add column if not exists cnam text;
alter table numbers add column if not exists cnam_checked_at timestamptz;
