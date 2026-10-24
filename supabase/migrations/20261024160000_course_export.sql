-- A course's whole attendance record in one answer, for CSV export.
--
-- Returned as a single JSON value rather than rows, so a term of sixty
-- students and a hundred sessions does not run into the API's row limit.
-- Only closed sessions are included: open ones are not finished and
-- cancelled ones count for no one.

create function public.course_export(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.teaches_course(p_course) then
    raise exception 'You can only export your own courses.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'sessions', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'started_at', s.started_at) order by s.started_at), '[]'::jsonb)
      from public.class_sessions s
      where s.course_id = p_course and s.status = 'closed'
    ),
    'students', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', e.student_id,
          'roll_number', p.roll_number,
          'full_name', p.full_name,
          'enrolment_status', e.status,
          'joined_at', e.joined_at,
          'marks', (
            select coalesce(jsonb_object_agg(
              a.session_id,
              jsonb_build_object('status', a.status, 'method', a.method, 'marked_at', a.marked_at, 'flags', to_jsonb(a.flags))
            ), '{}'::jsonb)
            from public.attendance a
            join public.class_sessions s on s.id = a.session_id
            where s.course_id = p_course and s.status = 'closed' and a.student_id = e.student_id
          )
        )
        order by p.roll_number nulls last, p.full_name
      ), '[]'::jsonb)
      from public.enrolments e
      join public.profiles p on p.id = e.student_id
      where e.course_id = p_course
    )
  );
end;
$$;

revoke execute on function public.course_export(uuid) from public, anon;
grant execute on function public.course_export(uuid) to authenticated, service_role;
