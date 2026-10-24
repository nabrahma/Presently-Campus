-- Presently Campus, phase 3: soft flags on QR marks (section 5.5).
--
-- Flags never reject a scan: each signal has innocent explanations. They are
-- recorded on the attendance row for the teacher to review.
--
--   off_campus         the scan came from outside the campus's address ranges
--   shared_connection  more students than the threshold scanned from the same
--                      address and browser within a few seconds
--   late               the scan came after the course's late mark

alter table public.settings
  -- The campus network's public ranges, e.g. '{203.0.113.0/24}'. Empty turns
  -- the off-campus flag off.
  add column campus_cidrs cidr[] not null default '{}',
  -- How many other students may share an address and browser in one burst
  -- before the scans are flagged.
  add column shared_ip_threshold int not null default 3 check (shared_ip_threshold >= 1);

-- How close together scans from one connection have to be to count as shared.
create function private.shared_window() returns interval
language sql immutable
as $$ select interval '10 seconds' $$;

-- Writes a QR mark with its flags. Called only by the mark-attendance Edge
-- Function, after every hard check has passed. A unique violation means
-- another scan won a race, and says which one.
create function public.record_qr_mark(
  p_session uuid,
  p_student uuid,
  p_device uuid,
  p_ip inet,
  p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  target public.class_sessions;
  late_after int;
  config public.settings;
  flags text[] := '{}';
  sharers uuid[];
  written public.attendance;
  violated text;
begin
  select * into target from public.class_sessions where id = p_session;
  select late_after_minutes into late_after from public.courses where id = target.course_id;
  select * into config from public.settings;

  if p_ip is not null and cardinality(config.campus_cidrs) > 0 and not (p_ip <<= any (config.campus_cidrs)) then
    flags := array_append(flags, 'off_campus');
  end if;

  if now() > target.started_at + make_interval(mins => late_after) then
    flags := array_append(flags, 'late');
  end if;

  if p_ip is not null then
    select array_agg(distinct a.student_id) into sharers
    from public.scan_attempts a
    where a.session_id = p_session
      and a.result = 'accepted'
      and a.ip = p_ip
      and a.user_agent is not distinct from p_user_agent
      and a.student_id <> p_student
      and a.created_at > now() - private.shared_window();

    if coalesce(cardinality(sharers), 0) >= config.shared_ip_threshold then
      flags := array_append(flags, 'shared_connection');
      -- The earlier scans in the burst were just as shared; they are flagged
      -- now that the burst is big enough to notice.
      update public.attendance a
      set flags = array_append(a.flags, 'shared_connection')
      where a.session_id = p_session
        and a.student_id = any (sharers)
        and a.method = 'qr'
        and not ('shared_connection' = any (a.flags));
    end if;
  end if;

  begin
    insert into public.attendance (session_id, student_id, status, method, device_id, flags)
    values (p_session, p_student, 'present', 'qr', p_device, flags)
    returning * into written;
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    return jsonb_build_object(
      'status', 'conflict',
      'conflict', case when violated = 'attendance_one_mark_per_device' then 'device' else 'student' end
    );
  end;

  return jsonb_build_object('status', 'inserted', 'marked_at', written.marked_at, 'flags', to_jsonb(written.flags));
end;
$$;

revoke execute on function public.record_qr_mark(uuid, uuid, uuid, inet, text) from public, anon, authenticated;
revoke execute on function private.shared_window() from public, anon, authenticated;
grant execute on function public.record_qr_mark(uuid, uuid, uuid, inet, text) to service_role;
grant execute on function private.shared_window() to service_role;

-- How many flagged marks teachers removed as proxies, and how many they kept,
-- per course: the pilot's measure of whether the flags point at real proxies.
create function public.flag_outcomes(p_course uuid)
returns table (flag text, kept int, removed int, pending int)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.teaches_course(p_course) then
    raise exception 'You can only see reports for your own courses.' using errcode = '42501';
  end if;

  return query
    with reviewed as (
      select unnest(c.previous_flags) as flag, c.new_status
      from public.attendance_changes c
      join public.class_sessions s on s.id = c.session_id
      where s.course_id = p_course and cardinality(c.previous_flags) > 0
    ),
    waiting as (
      select unnest(a.flags) as flag
      from public.attendance a
      join public.class_sessions s on s.id = a.session_id
      where s.course_id = p_course and cardinality(a.flags) > 0
    ),
    names as (
      select flag from reviewed union select flag from waiting
    )
    select
      n.flag,
      (select count(*) from reviewed r where r.flag = n.flag and r.new_status <> 'absent')::int,
      (select count(*) from reviewed r where r.flag = n.flag and r.new_status = 'absent')::int,
      (select count(*) from waiting w where w.flag = n.flag)::int
    from names n
    order by n.flag;
end;
$$;

revoke execute on function public.flag_outcomes(uuid) from public, anon;
grant execute on function public.flag_outcomes(uuid) to authenticated, service_role;
