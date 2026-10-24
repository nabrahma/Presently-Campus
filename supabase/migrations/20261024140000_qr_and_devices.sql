-- Presently Campus, phase 2: QR attendance and device binding.
--
-- A session gets a secret its QR tokens are signed with. A student's phone
-- gets a key pair whose public half is registered here. Only the
-- mark-attendance Edge Function, running as the service role, writes QR marks,
-- and it records every attempt in scan_attempts.

/* -------------------------------------------------------------------------- */
/* Session secrets                                                             */
/* -------------------------------------------------------------------------- */

-- Kept apart from class_sessions so that students, who can read sessions,
-- have no path to a secret at all.
create table public.session_secrets (
  session_id uuid primary key references public.class_sessions (id) on delete cascade,
  secret bytea not null default extensions.gen_random_bytes(32) check (length(secret) = 32)
);

-- Sessions opened before this migration get a secret too.
insert into public.session_secrets (session_id)
select id from public.class_sessions
on conflict do nothing;

/* -------------------------------------------------------------------------- */
/* Devices                                                                     */
/* -------------------------------------------------------------------------- */

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  -- The public half of a P-256 key as a JWK, reduced to kty, crv, x and y so
  -- the same key always compares equal. One key, one account.
  public_key jsonb not null unique,
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  status text not null check (status in ('active', 'pending', 'revoked')),
  -- When the device may first mark: the end of its cooling-off period, or the
  -- moment a teacher approved it.
  active_from timestamptz,
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint active_devices_have_a_start check (status <> 'active' or active_from is not null),
  constraint revoked_devices_say_when check ((status = 'revoked') = (revoked_at is not null))
);

create unique index devices_one_active_per_student on public.devices (student_id) where status = 'active';
create unique index devices_one_pending_per_student on public.devices (student_id) where status = 'pending';

-- Every registration, approval and revocation, for review.
create table public.device_events (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  event text not null check (event in ('registered', 'requested', 'approved', 'rejected', 'revoked', 'superseded')),
  actor uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index device_events_device_idx on public.device_events (device_id);

alter table public.attendance
  add constraint attendance_device_id_fkey foreign key (device_id) references public.devices (id);

/* -------------------------------------------------------------------------- */
/* Scan attempts                                                               */
/* -------------------------------------------------------------------------- */

-- Every scan, accepted or not: what teachers review and what analysis reads.
create table public.scan_attempts (
  id bigint generated always as identity primary key,
  -- Only set when the token named a session that exists.
  session_id uuid references public.class_sessions (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  -- Only set when the request named a device that exists.
  device_id uuid references public.devices (id) on delete set null,
  result text not null check (result in ('accepted', 'rejected')),
  reason text not null,
  -- Cleared after 90 days by private.scrub_scan_attempts.
  ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  created_at timestamptz not null default now()
);

create index scan_attempts_session_idx on public.scan_attempts (session_id, created_at);
create index scan_attempts_student_idx on public.scan_attempts (student_id);

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

-- True when the caller teaches a course the student is actively enrolled in:
-- the teachers who may approve that student's phone.
create function private.teaches_active_student(p_student uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.enrolments e
    join public.courses c on c.id = e.course_id
    where e.student_id = p_student and e.status = 'active' and c.teacher_id = (select auth.uid())
  )
$$;

alter table public.session_secrets enable row level security;
alter table public.devices enable row level security;
alter table public.device_events enable row level security;
alter table public.scan_attempts enable row level security;

create policy "teacher reads own sessions' secrets" on public.session_secrets
  for select to authenticated
  using (private.teaches_session(session_id));

create policy "student reads own, teacher reads own students'" on public.devices
  for select to authenticated
  using (student_id = (select auth.uid()) or private.teaches_active_student(student_id));

create policy "student reads own, teacher reads own students'" on public.device_events
  for select to authenticated
  using (student_id = (select auth.uid()) or private.teaches_active_student(student_id));

create policy "student reads own, teacher reads own courses'" on public.scan_attempts
  for select to authenticated
  using (student_id = (select auth.uid()) or private.teaches_session(session_id));

/* -------------------------------------------------------------------------- */
/* Sessions carry a secret                                                     */
/* -------------------------------------------------------------------------- */

create or replace function public.start_session(p_course uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  created public.class_sessions;
  key bytea;
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

  insert into public.session_secrets (session_id) values (created.id) returning secret into key;

  return jsonb_build_object(
    'session', to_jsonb(created),
    'secret', encode(key, 'base64'),
    -- The teacher's device corrects its clock against this.
    'server_time', floor(extract(epoch from clock_timestamp()) * 1000)
  );
end;
$$;

-- What the projector needs to resume showing a session's QR code after a
-- reload: the secret, and the server's clock to correct its own against.
create function public.live_session_key(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  key bytea;
begin
  if not private.teaches_session(p_session) then
    raise exception 'You can only show your own sessions.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.class_sessions where id = p_session and status = 'open') then
    raise exception 'This session is not open.' using errcode = 'P0001';
  end if;

  select secret into key from public.session_secrets where session_id = p_session;
  return jsonb_build_object(
    'secret', encode(key, 'base64'),
    'server_time', floor(extract(epoch from clock_timestamp()) * 1000)
  );
end;
$$;

/* -------------------------------------------------------------------------- */
/* Device approvals                                                            */
/* -------------------------------------------------------------------------- */

-- Approving a phone activates it now. For a device change, that also retires
-- the student's previous phone; for a first phone, it ends the cooling-off.
create function public.approve_device(p_device uuid) returns public.devices
language plpgsql security definer set search_path = ''
as $$
declare
  target public.devices;
  retired uuid;
begin
  select * into target from public.devices where id = p_device for update;
  if not found or not private.teaches_active_student(target.student_id) then
    raise exception 'You can only approve phones of students in your courses.' using errcode = '42501';
  end if;
  if target.status = 'revoked' then
    raise exception 'This phone was already rejected or replaced.' using errcode = 'P0001';
  end if;

  if target.status = 'pending' then
    for retired in
      update public.devices
      set status = 'revoked', revoked_at = now()
      where student_id = target.student_id and status = 'active'
      returning id
    loop
      insert into public.device_events (device_id, student_id, event, actor)
      values (retired, target.student_id, 'revoked', (select auth.uid()));
    end loop;
  end if;

  update public.devices
  set status = 'active',
      active_from = least(coalesce(active_from, now()), now()),
      approved_by = (select auth.uid())
  where id = p_device
  returning * into target;

  insert into public.device_events (device_id, student_id, event, actor)
  values (target.id, target.student_id, 'approved', (select auth.uid()));

  return target;
end;
$$;

-- Rejecting a phone retires it. A rejected device change leaves the
-- student's current phone as it was.
create function public.reject_device(p_device uuid) returns public.devices
language plpgsql security definer set search_path = ''
as $$
declare
  target public.devices;
begin
  select * into target from public.devices where id = p_device for update;
  if not found or not private.teaches_active_student(target.student_id) then
    raise exception 'You can only reject phones of students in your courses.' using errcode = '42501';
  end if;
  if target.status = 'revoked' then
    raise exception 'This phone was already rejected or replaced.' using errcode = 'P0001';
  end if;
  if target.status = 'active' and target.active_from <= now() then
    raise exception 'This phone is already in use. Approve a replacement instead.' using errcode = 'P0001';
  end if;

  update public.devices
  set status = 'revoked', revoked_at = now()
  where id = p_device
  returning * into target;

  insert into public.device_events (device_id, student_id, event, actor)
  values (target.id, target.student_id, 'rejected', (select auth.uid()));

  return target;
end;
$$;

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                                */
/* -------------------------------------------------------------------------- */

-- Network and browser details are kept only as long as review needs them.
create function private.scrub_scan_attempts() returns int
language sql security definer set search_path = ''
as $$
  with scrubbed as (
    update public.scan_attempts
    set ip = null, user_agent = null
    where created_at < now() - interval '90 days'
      and (ip is not null or user_agent is not null)
    returning 1
  )
  select count(*)::int from scrubbed
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('scrub-scan-attempts', '17 3 * * *', 'select private.scrub_scan_attempts()');
  end if;
end
$$;

/* -------------------------------------------------------------------------- */
/* Grants                                                                      */
/* -------------------------------------------------------------------------- */

revoke all on public.session_secrets, public.devices, public.device_events, public.scan_attempts from anon, authenticated;
grant select on public.session_secrets, public.devices, public.device_events, public.scan_attempts to authenticated;

grant all on public.session_secrets, public.devices, public.device_events, public.scan_attempts to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function
  public.live_session_key(uuid),
  public.approve_device(uuid),
  public.reject_device(uuid),
  private.teaches_active_student(uuid),
  private.scrub_scan_attempts()
from public, anon, authenticated;

grant execute on function
  public.start_session(uuid),
  public.live_session_key(uuid),
  public.approve_device(uuid),
  public.reject_device(uuid),
  private.teaches_active_student(uuid)
to authenticated;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;
