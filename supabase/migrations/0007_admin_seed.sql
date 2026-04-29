-- 0007_admin_seed.sql
-- Two founder emails get owner-role membership across every brand on signup.
-- Mirrors the existing handle_new_user trigger flow so accounts created via
-- the public signup page are usable immediately without manual provisioning.

create or replace function grant_founder_brand_access(p_member_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if lower(p_email) in ('hello@liveleadz.com', 'hello@buyersignals.io') then
    insert into brand_members (brand_id, member_id, role, is_active)
    select b.id, p_member_id, 'owner'::member_role, true
      from brands b
    on conflict (brand_id, member_id) do update
      set role = 'owner'::member_role,
          is_active = true;
  end if;
end;
$$;

-- Run on every new public.members row (which is itself created by the
-- on_auth_user_created trigger after auth signup).
create or replace function handle_new_member_founder_grant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform grant_founder_brand_access(new.id, new.email);
  return new;
end;
$$;

drop trigger if exists members_founder_grant on members;
create trigger members_founder_grant
  after insert on members
  for each row execute function handle_new_member_founder_grant();

-- Backfill: if either founder already has a members row, grant immediately.
do $$
declare m record;
begin
  for m in
    select id, email from members
    where lower(email) in ('hello@liveleadz.com', 'hello@buyersignals.io')
  loop
    perform grant_founder_brand_access(m.id, m.email);
  end loop;
end $$;
