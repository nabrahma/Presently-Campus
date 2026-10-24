-- Presently Campus, phase 1: roles, courses and manually marked attendance.
--
-- Every write a client can make goes through a narrow column grant or a
-- security definer function that checks who is asking. Row Level Security is
-- on for every table, and nothing is granted to anon.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Helpers used by policies and functions. Not exposed through the API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

-- A single row of deployment-wide settings, edited by the admin in SQL.
create table public.settings (
  id boolean primary key default true check (id),
  -- Email domains allowed to sign up, e.g. '{college.ac.in}'. Empty allows any.
  -- Addresses on the teacher allowlist are always allowed.
  email_domains text[] not null default '{}',
  -- The college's timezone, for grouping sessions by weekday and hour.
  timezone text not null default 'Asia/Kolkata'
);

insert into public.settings default values;

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

create table public.teacher_allowlist (
  email text primary key,
  added_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Set from the allowlist by triggers. Clients have no grant on this column.
  role text not null default 'student' check (role in ('student', 'teacher')),
  full_name text not null default '' check (length(full_name) <= 120),
  roll_number text unique check (roll_number is null or length(roll_number) between 1 and 32),
  created_at timestamptz not null default now(),
  constraint teachers_have_no_roll_number check (role = 'student' or roll_number is null)
);

-- Names are tidied and roll numbers made case-insensitive before they are
-- stored, so "21cs042 " and "21CS042" cannot be two different students.
create function private.normalise_profile() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := btrim(regexp_replace(coalesce(new.full_name, ''), '\s+', ' ', 'g'));
  new.roll_number := nullif(upper(regexp_replace(coalesce(new.roll_number, ''), '\s+', '', 'g')), '');
  return new;
end;
$$;

create trigger profiles_normalise
  before insert or update on public.profiles
  for each row execute function private.normalise_profile();

create function private.normalise_allowlist_email() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

create trigger teacher_allowlist_normalise
  before insert or update on public.teacher_allowlist
  for each row execute function private.normalise_allowlist_email();

-- Every new account gets a profile. Its role comes from the allowlist and
-- nowhere else, so nobody can sign themselves up as a teacher.
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text := lower(btrim(coalesce(new.email, '')));
  allowed text[];
  listed boolean;
begin
  select exists (select 1 from public.teacher_allowlist where email = address) into listed;
  select email_domains into allowed from public.settings;

  if coalesce(cardinality(allowed), 0) > 0
     and not listed
     and not (split_part(address, '@', 2) = any (allowed)) then
    raise exception 'Use your college email address to sign up.' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, role)
  values (new.id, case when listed then 'teacher' else 'student' end);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Adding a teacher to the allowlist after they signed up promotes them, and
-- removing them demotes them, without anyone editing profiles by hand.
create function public.sync_teacher_role() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.profiles p
    set role = 'teacher', roll_number = null
    from auth.users u
    where u.id = p.id and lower(u.email) = new.email and p.role <> 'teacher';
  end if;

  if tg_op in ('DELETE', 'UPDATE') then
    update public.profiles p
    set role = 'student'
    from auth.users u
    where u.id = p.id
      and lower(u.email) = old.email
      and p.role <> 'student'
      and not exists (select 1 from public.teacher_allowlist a where a.email = lower(u.email));
  end if;

  return null;
end;
$$;

create trigger teacher_allowlist_sync_role
  after insert or update or delete on public.teacher_allowlist
  for each row execute function public.sync_teacher_role();

/* -------------------------------------------------------------------------- */
/* Courses                                                                     */
/* -------------------------------------------------------------------------- */

-- Six characters from an alphabet with no 0/O, 1/I/L, so a code read off a
-- projector or a WhatsApp message cannot be mistyped into another one.
create function private.new_join_code() returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet), 1);
    end loop;
    exit when not exists (select 1 from public.courses where join_code = candidate);
  end loop;
  return candidate;
end;
$$;

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  code text not null default '' check (length(code) <= 16),
  section text not null default '' check (length(section) <= 16),
  term text not null default '' check (length(term) <= 32),
  target_percentage int not null default 75 check (target_percentage between 1 and 100),
  late_after_minutes int not null default 10 check (late_after_minutes between 0 and 240),
  join_code text not null unique default private.new_join_code() check (join_code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index courses_teacher_idx on public.courses (teacher_id);

create table public.enrolments (
  course_id uuid not null references public.courses (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'removed')),
  primary key (course_id, student_id)
);

create index enrolments_student_idx on public.enrolments (student_id);

/* -------------------------------------------------------------------------- */
/* Sessions and attendance                                                     */
/* -------------------------------------------------------------------------- */

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  started_by uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  note text check (note is null or length(note) <= 200),
  constraint open_sessions_have_no_close_time check ((status = 'open') = (closed_at is null))
);

-- A course runs one class at a time.
create unique index class_sessions_one_open_per_course
  on public.class_sessions (course_id) where status = 'open';
create index class_sessions_course_started_idx on public.class_sessions (course_id, started_at desc);

-- Presence only. Absence is computed: an enrolled student with no row for a
-- closed session they were enrolled before was absent from it.
create table public.attendance (
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('present', 'excused')),
  method text not null check (method in ('qr', 'manual')),
  device_id uuid,
  marked_at timestamptz not null default now(),
  marked_by uuid references public.profiles (id),
  reason text check (reason is null or length(reason) <= 200),
  flags text[] not null default '{}',
  primary key (session_id, student_id),
  constraint manual_marks_name_teacher_and_reason
    check (method = 'qr' or (marked_by is not null and coalesce(btrim(reason), '') <> '')),
  constraint qr_marks_name_a_device check (method = 'manual' or device_id is not null)
);

-- One phone, one student, per class.
create unique index attendance_one_mark_per_device
  on public.attendance (session_id, device_id) where device_id is not null;
create index attendance_student_idx on public.attendance (student_id);

-- Every correction a teacher makes, including removals, so a mark that has
-- been overwritten or deleted is still accounted for.
create table public.attendance_changes (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  previous_status text,
  previous_method text,
  previous_flags text[] not null default '{}',
  new_status text not null check (new_status in ('present', 'excused', 'absent')),
  reason text not null,
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default now()
);

create index attendance_changes_session_idx on public.attendance_changes (session_id);

/* -------------------------------------------------------------------------- */
/* Access helpers                                                              */
/* -------------------------------------------------------------------------- */

-- Security definer so policies can consult other tables without recursing
-- through those tables' own policies.

create function private.is_teacher() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'teacher'
  )
$$;

create function private.teaches_course(p_course uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.courses where id = p_course and teacher_id = (select auth.uid())
  )
$$;

create function private.teaches_session(p_session uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.class_sessions s
    join public.courses c on c.id = s.course_id
    where s.id = p_session and c.teacher_id = (select auth.uid())
  )
$$;

create function private.enrolled_in(p_course uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.enrolments
    where course_id = p_course and student_id = (select auth.uid()) and status = 'active'
  )
$$;

-- True when the caller teaches a course the student is or was enrolled in.
create function private.teaches_student(p_student uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.enrolments e
    join public.courses c on c.id = e.course_id
    where e.student_id = p_student and c.teacher_id = (select auth.uid())
  )
$$;

-- True when the given teacher teaches a course the caller is enrolled in, so
-- a student can see who their teachers are.
create function private.is_my_teacher(p_teacher uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.courses c
    join public.enrolments e on e.course_id = c.id
    where c.teacher_id = p_teacher and e.student_id = (select auth.uid()) and e.status = 'active'
  )
$$;

/* -------------------------------------------------------------------------- */
/* Row Level Security                                                          */
/* -------------------------------------------------------------------------- */

alter table public.settings enable row level security;
alter table public.teacher_allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrolments enable row level security;
alter table public.class_sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.attendance_changes enable row level security;

-- settings and teacher_allowlist have no policies: only the admin and the
-- server functions read them.

create policy "read own, own students and own teachers" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.teaches_student(id)
    or private.is_my_teacher(id)
  );

create policy "update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "teacher reads own, student reads enrolled" on public.courses
  for select to authenticated
  using (teacher_id = (select auth.uid()) or private.enrolled_in(id));

create policy "teachers create their own" on public.courses
  for insert to authenticated
  with check (teacher_id = (select auth.uid()) and private.is_teacher());

create policy "teacher updates own" on public.courses
  for update to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

create policy "student reads own, teacher reads own courses" on public.enrolments
  for select to authenticated
  using (student_id = (select auth.uid()) or private.teaches_course(course_id));

create policy "teacher removes and restores in own courses" on public.enrolments
  for update to authenticated
  using (private.teaches_course(course_id))
  with check (private.teaches_course(course_id));

create policy "teacher reads own, student reads enrolled" on public.class_sessions
  for select to authenticated
  using (private.teaches_course(course_id) or private.enrolled_in(course_id));

create policy "teacher annotates own" on public.class_sessions
  for update to authenticated
  using (private.teaches_course(course_id))
  with check (private.teaches_course(course_id));

create policy "student reads own, teacher reads own courses" on public.attendance
  for select to authenticated
  using (student_id = (select auth.uid()) or private.teaches_session(session_id));

create policy "student reads own, teacher reads own courses" on public.attendance_changes
  for select to authenticated
  using (student_id = (select auth.uid()) or private.teaches_session(session_id));

/* -------------------------------------------------------------------------- */
/* Figures                                                                     */
/* -------------------------------------------------------------------------- */

-- The one definition of a student's figures in a course, used by every report.
--
--   held      closed sessions the student was enrolled for (started after they
--             joined, or marked for them anyway), minus excused ones
--   attended  present marks in those sessions
--   excused   excused marks, which count on neither side
--
-- Cancelled and still-open sessions count for no one.
create function private.course_figures(p_course uuid)
returns table (student_id uuid, attended int, held int, excused int)
language sql stable security definer set search_path = ''
as $$
  select
    e.student_id,
    (count(*) filter (where x.status = 'present'))::int,
    (count(x.session_id) - count(*) filter (where x.status = 'excused'))::int,
    (count(*) filter (where x.status = 'excused'))::int
  from public.enrolments e
  left join lateral (
    select s.id as session_id, a.status
    from public.class_sessions s
    left join public.attendance a on a.session_id = s.id and a.student_id = e.student_id
    where s.course_id = e.course_id
      and s.status = 'closed'
      and (s.started_at >= e.joined_at or a.student_id is not null)
  ) x on true
  where e.course_id = p_course
  group by e.student_id
$$;

-- The teacher's roster: one row per student, computed here rather than by
-- shipping every attendance row to the browser.
create function public.course_report(p_course uuid)
returns table (
  student_id uuid,
  full_name text,
  roll_number text,
  enrolment_status text,
  joined_at timestamptz,
  attended int,
  held int,
  excused int
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.teaches_course(p_course) then
    raise exception 'You can only see reports for your own courses.' using errcode = '42501';
  end if;

  return query
    select e.student_id, p.full_name, p.roll_number, e.status, e.joined_at, f.attended, f.held, f.excused
    from public.enrolments e
    join public.profiles p on p.id = e.student_id
    join private.course_figures(p_course) f on f.student_id = e.student_id
    where e.course_id = p_course
    order by p.roll_number nulls last, p.full_name;
end;
$$;

-- The calling student's figures in each course they are enrolled in.
create function public.my_figures()
returns table (course_id uuid, attended int, held int, excused int)
language sql stable security definer set search_path = ''
as $$
  select e.course_id, f.attended, f.held, f.excused
  from public.enrolments e
  cross join lateral private.course_figures(e.course_id) f
  where e.student_id = (select auth.uid())
    and e.status = 'active'
    and f.student_id = e.student_id
$$;

-- The teacher's course list, with enough to spot trouble at a glance.
create function public.my_courses_overview()
returns table (
  course_id uuid,
  students int,
  sessions_held int,
  average_percentage numeric,
  at_risk int,
  open_session_id uuid
)
language sql stable security definer set search_path = ''
as $$
  select
    c.id,
    (select count(*) from public.enrolments e where e.course_id = c.id and e.status = 'active')::int,
    (select count(*) from public.class_sessions s where s.course_id = c.id and s.status = 'closed')::int,
    stats.average,
    stats.at_risk,
    (select s.id from public.class_sessions s where s.course_id = c.id and s.status = 'open')
  from public.courses c
  cross join lateral (
    select
      round(avg(f.attended * 100.0 / f.held), 1) as average,
      (count(*) filter (where f.attended * 100 < c.target_percentage * f.held))::int as at_risk
    from private.course_figures(c.id) f
    join public.enrolments e on e.course_id = c.id and e.student_id = f.student_id
    where e.status = 'active' and f.held > 0
  ) stats
  where c.teacher_id = (select auth.uid())
$$;

-- Everyone enrolled, with their mark for one session. "absent" for an open
-- session means "not marked yet".
create function public.session_report(p_session uuid)
returns table (
  student_id uuid,
  full_name text,
  roll_number text,
  status text,
  method text,
  marked_at timestamptz,
  reason text,
  flags text[],
  joined_after_start boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.teaches_session(p_session) then
    raise exception 'You can only see reports for your own sessions.' using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.full_name,
      p.roll_number,
      coalesce(a.status, 'absent'),
      a.method,
      a.marked_at,
      a.reason,
      coalesce(a.flags, '{}'::text[]),
      e.joined_at > s.started_at
    from public.class_sessions s
    join public.enrolments e on e.course_id = s.course_id and e.status = 'active'
    join public.profiles p on p.id = e.student_id
    left join public.attendance a on a.session_id = s.id and a.student_id = e.student_id
    where s.id = p_session
    order by p.roll_number nulls last, p.full_name;
end;
$$;

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

create function public.join_course(p_code text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  target public.courses;
  existing text;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if not found or me.role <> 'student' then
    raise exception 'Only students can join a course.' using errcode = '42501';
  end if;
  if me.roll_number is null or me.full_name = '' then
    raise exception 'Add your name and roll number first.' using errcode = 'P0001';
  end if;

  select * into target
  from public.courses
  where join_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
    and not archived;
  if not found then
    raise exception 'No course has that code. Check it with your teacher.' using errcode = 'P0002';
  end if;

  select status into existing
  from public.enrolments
  where course_id = target.id and student_id = me.id;
  if existing = 'removed' then
    raise exception 'Your teacher removed you from this course. Ask them to add you back.' using errcode = '42501';
  end if;

  insert into public.enrolments (course_id, student_id)
  values (target.id, me.id)
  on conflict do nothing;

  return target.id;
end;
$$;

create function public.start_session(p_course uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  created public.class_sessions;
begin
  if not private.teaches_course(p_course) then
    raise exception 'You can only start sessions for your own courses.' using errcode = '42501';
  end if;
  if exists (select 1 from public.courses where id = p_course and archived) then
    raise exception 'This course is archived.' using errcode = 'P0001';
  end if;

  begin
    insert into public.class_sessions (course_id, started_by)
    values (p_course, (select auth.uid()))
    returning * into created;
  exception when unique_violation then
    raise exception 'This course already has an open session. Close it first.' using errcode = 'P0001';
  end;

  return jsonb_build_object(
    'session', to_jsonb(created),
    -- The teacher's device corrects its clock against this.
    'server_time', floor(extract(epoch from clock_timestamp()) * 1000)
  );
end;
$$;

create function public.close_session(p_session uuid) returns public.class_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  changed public.class_sessions;
begin
  if not private.teaches_session(p_session) then
    raise exception 'You can only close your own sessions.' using errcode = '42501';
  end if;

  update public.class_sessions
  set status = 'closed', closed_at = now()
  where id = p_session and status = 'open'
  returning * into changed;
  if not found then
    raise exception 'This session is not open.' using errcode = 'P0001';
  end if;

  return changed;
end;
$$;

-- A session that should not have happened, or was started by mistake. It
-- stops counting for everyone, whether it was open or already closed.
create function public.cancel_session(p_session uuid) returns public.class_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  changed public.class_sessions;
begin
  if not private.teaches_session(p_session) then
    raise exception 'You can only cancel your own sessions.' using errcode = '42501';
  end if;

  update public.class_sessions
  set status = 'cancelled', closed_at = coalesce(closed_at, now())
  where id = p_session and status in ('open', 'closed')
  returning * into changed;
  if not found then
    raise exception 'This session is already cancelled.' using errcode = 'P0001';
  end if;

  return changed;
end;
$$;

-- Closing a moment too early is an easy mistake, so it can be undone for a
-- short while.
create function public.reopen_session(p_session uuid) returns public.class_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  changed public.class_sessions;
begin
  if not private.teaches_session(p_session) then
    raise exception 'You can only reopen your own sessions.' using errcode = '42501';
  end if;

  begin
    update public.class_sessions
    set status = 'open', closed_at = null
    where id = p_session and status = 'closed' and closed_at > now() - interval '15 minutes'
    returning * into changed;
  exception when unique_violation then
    raise exception 'Another session of this course is open. Close it first.' using errcode = 'P0001';
  end;
  if not found then
    raise exception 'Only a session closed in the last 15 minutes can be reopened.' using errcode = 'P0001';
  end if;

  return changed;
end;
$$;

-- A teacher's mark: present or excused, or absent to remove a mark. Always
-- with a reason, and always logged.
create function public.teacher_mark(
  p_session uuid,
  p_student uuid,
  p_status text,
  p_reason text
) returns public.attendance
language plpgsql security definer set search_path = ''
as $$
declare
  target public.class_sessions;
  previous public.attendance;
  result public.attendance;
  why text := btrim(coalesce(p_reason, ''));
begin
  select * into target from public.class_sessions where id = p_session;
  if not found or not private.teaches_session(p_session) then
    raise exception 'You can only mark your own sessions.' using errcode = '42501';
  end if;
  if target.status = 'cancelled' then
    raise exception 'This session was cancelled.' using errcode = 'P0001';
  end if;
  if p_status not in ('present', 'excused', 'absent') then
    raise exception 'A mark is present, excused or absent.' using errcode = '22023';
  end if;
  if why = '' then
    raise exception 'Give a reason for the mark.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.enrolments
    where course_id = target.course_id and student_id = p_student and status = 'active'
  ) then
    raise exception 'That student is not in this course.' using errcode = 'P0001';
  end if;

  select * into previous
  from public.attendance
  where session_id = p_session and student_id = p_student
  for update;

  if p_status = 'absent' then
    delete from public.attendance where session_id = p_session and student_id = p_student;
    result := null;
  else
    insert into public.attendance (session_id, student_id, status, method, marked_by, reason)
    values (p_session, p_student, p_status, 'manual', (select auth.uid()), why)
    on conflict (session_id, student_id) do update
      set status = excluded.status,
          method = 'manual',
          device_id = null,
          marked_by = excluded.marked_by,
          reason = excluded.reason,
          marked_at = now(),
          flags = '{}'
    returning * into result;
  end if;

  insert into public.attendance_changes (
    session_id, student_id, previous_status, previous_method, previous_flags,
    new_status, reason, changed_by
  ) values (
    p_session, p_student, previous.status, previous.method, coalesce(previous.flags, '{}'),
    p_status, why, (select auth.uid())
  );

  return result;
end;
$$;

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                                */
/* -------------------------------------------------------------------------- */

-- A session left open after class would keep counting nobody and keep
-- accepting scans. Anything open for three hours is closed as of that mark.
create function private.close_stale_sessions() returns int
language sql security definer set search_path = ''
as $$
  with closed as (
    update public.class_sessions
    set status = 'closed', closed_at = started_at + interval '3 hours'
    where status = 'open' and started_at < now() - interval '3 hours'
    returning 1
  )
  select count(*)::int from closed
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('close-stale-sessions', '*/10 * * * *', 'select private.close_stale_sessions()');
  end if;
end
$$;

-- Students see a session start, and teachers see marks arrive, as it happens.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.class_sessions, public.attendance;
  end if;
end
$$;

/* -------------------------------------------------------------------------- */
/* Grants                                                                      */
/* -------------------------------------------------------------------------- */

revoke all on all tables in schema public from anon, authenticated;

grant select on
  public.profiles,
  public.courses,
  public.enrolments,
  public.class_sessions,
  public.attendance,
  public.attendance_changes
to authenticated;

grant update (full_name, roll_number) on public.profiles to authenticated;
grant insert (name, code, section, term, target_percentage, late_after_minutes) on public.courses to authenticated;
grant update (name, code, section, term, target_percentage, late_after_minutes, archived) on public.courses to authenticated;
grant update (status) on public.enrolments to authenticated;
grant update (note) on public.class_sessions to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.course_report(uuid),
  public.my_figures(),
  public.my_courses_overview(),
  public.session_report(uuid),
  public.join_course(text),
  public.start_session(uuid),
  public.close_session(uuid),
  public.cancel_session(uuid),
  public.reopen_session(uuid),
  public.teacher_mark(uuid, uuid, text, text)
to authenticated;

-- Policies and column defaults call these as the requesting user.
grant execute on function
  private.is_teacher(),
  private.teaches_course(uuid),
  private.teaches_session(uuid),
  private.enrolled_in(uuid),
  private.teaches_student(uuid),
  private.is_my_teacher(uuid),
  private.new_join_code()
to authenticated;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;
