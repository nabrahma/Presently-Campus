-- Dev mode: the people building the app can switch their own account between
-- the teacher's and the student's view, to see and test both sides.
--
-- A dev is not a teacher. Devs are listed separately from teachers, and their
-- account holds whichever role they are viewing as, so every check on the
-- server treats them exactly as a teacher or a student would be treated.
-- Only the dev list decides who may switch; clients cannot set is_dev.

create table public.dev_allowlist (
  email text primary key,
  added_at timestamptz not null default now()
);

create trigger dev_allowlist_normalise
  before insert or update on public.dev_allowlist
  for each row execute function private.normalise_allowlist_email();

alter table public.dev_allowlist enable row level security;
revoke all on public.dev_allowlist from anon, authenticated;
grant all on public.dev_allowlist to service_role;

alter table public.profiles add column is_dev boolean not null default false;

-- A dev keeps their roll number while viewing as a teacher, so switching back
-- to the student's view does not ask for it again.
alter table public.profiles drop constraint teachers_have_no_roll_number;
alter table public.profiles add constraint teachers_have_no_roll_number
  check (role = 'student' or roll_number is null or is_dev);

-- Sign-up: devs pass the domain check like teachers do, and start in the
-- teacher's view.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text := lower(btrim(coalesce(new.email, '')));
  allowed text[];
  listed boolean;
  dev boolean;
begin
  select exists (select 1 from public.teacher_allowlist where email = address) into listed;
  select exists (select 1 from public.dev_allowlist where email = address) into dev;
  select email_domains into allowed from public.settings;

  if coalesce(cardinality(allowed), 0) > 0
     and not listed
     and not dev
     and not (split_part(address, '@', 2) = any (allowed)) then
    raise exception 'Use your college email address to sign up.' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, role, is_dev)
  values (new.id, case when listed or dev then 'teacher' else 'student' end, dev);

  return new;
end;
$$;

-- The teacher list no longer moves devs: their role is whichever view they
-- chose, and leaving the teacher list must not drop them to student.
create or replace function public.sync_teacher_role() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.profiles p
    set role = 'teacher', roll_number = null
    from auth.users u
    where u.id = p.id and lower(u.email) = new.email and p.role <> 'teacher' and not p.is_dev;
  end if;

  if tg_op in ('DELETE', 'UPDATE') then
    update public.profiles p
    set role = 'student'
    from auth.users u
    where u.id = p.id
      and lower(u.email) = old.email
      and p.role <> 'student'
      and not p.is_dev
      and not exists (select 1 from public.teacher_allowlist a where a.email = lower(u.email));
  end if;

  return null;
end;
$$;

-- Adding someone to the dev list makes them a dev now, starting as a teacher;
-- removing them returns them to whatever the teacher list says.
create function public.sync_dev_flag() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.profiles p
    set is_dev = true, role = 'teacher'
    from auth.users u
    where u.id = p.id and lower(u.email) = new.email and not p.is_dev;
  end if;

  if tg_op in ('DELETE', 'UPDATE') then
    update public.profiles p
    set is_dev = false,
        role = case when exists (select 1 from public.teacher_allowlist a where a.email = lower(u.email))
                    then 'teacher' else 'student' end,
        roll_number = case when exists (select 1 from public.teacher_allowlist a where a.email = lower(u.email))
                           then null else p.roll_number end
    from auth.users u
    where u.id = p.id
      and lower(u.email) = old.email
      and p.is_dev
      and not exists (select 1 from public.dev_allowlist d where d.email = lower(u.email));
  end if;

  return null;
end;
$$;

create trigger dev_allowlist_sync
  after insert or update or delete on public.dev_allowlist
  for each row execute function public.sync_dev_flag();

revoke all on function public.sync_dev_flag() from public, anon, authenticated;

-- The switch itself. Only a dev may call it, and only for their own account.
create function public.set_dev_view(p_role text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_role not in ('teacher', 'student') then
    raise exception 'Choose teacher or student.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = me and is_dev) then
    raise exception 'Only developers can switch views.' using errcode = '42501';
  end if;

  update public.profiles set role = p_role where id = me;
  return p_role;
end;
$$;

revoke all on function public.set_dev_view(text) from public, anon;
grant execute on function public.set_dev_view(text) to authenticated;
