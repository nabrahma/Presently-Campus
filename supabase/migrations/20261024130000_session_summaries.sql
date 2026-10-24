-- Per-session counts for a teacher's course screen and live count.
--
-- "expected" uses the same rule as course_figures: a student counts for a
-- session if they were enrolled before it started, or were marked anyway.
-- Only students still enrolled are counted, so the figures match the roster.

create function public.course_sessions_summary(p_course uuid)
returns table (
  session_id uuid,
  started_at timestamptz,
  closed_at timestamptz,
  status text,
  note text,
  expected int,
  present int,
  excused int,
  flagged int
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.teaches_course(p_course) then
    raise exception 'You can only see reports for your own courses.' using errcode = '42501';
  end if;

  return query
    select
      s.id,
      s.started_at,
      s.closed_at,
      s.status,
      s.note,
      (count(e.student_id) filter (where e.joined_at <= s.started_at or a.student_id is not null))::int,
      (count(*) filter (where a.status = 'present'))::int,
      (count(*) filter (where a.status = 'excused'))::int,
      (count(*) filter (where cardinality(a.flags) > 0))::int
    from public.class_sessions s
    left join public.enrolments e on e.course_id = s.course_id and e.status = 'active'
    left join public.attendance a on a.session_id = s.id and a.student_id = e.student_id
    where s.course_id = p_course
    group by s.id
    order by s.started_at desc;
end;
$$;

revoke execute on function public.course_sessions_summary(uuid) from public, anon;
grant execute on function public.course_sessions_summary(uuid) to authenticated, service_role;
