-- CSV export data, against the c1 history built by the earlier files.

do $$
declare
  exported jsonb;
  s1 jsonb;
begin
  perform tests.as_user(tests.id('t1'));
  exported := public.course_export(tests.id('c1'));

  -- x1, x2, x3 and x5 are closed; x4 is cancelled and 'live' is open.
  assert jsonb_array_length(exported -> 'sessions') = 4, format('closed sessions only, got %s', jsonb_array_length(exported -> 'sessions'));
  assert (
    select bool_and((a ->> 'started_at')::timestamptz <= (b ->> 'started_at')::timestamptz)
    from jsonb_array_elements(exported -> 'sessions') with ordinality as x(a, i)
    join jsonb_array_elements(exported -> 'sessions') with ordinality as y(b, j) on j = i + 1
  ), 'oldest first, as a register reads';

  select student into s1 from jsonb_array_elements(exported -> 'students') as student where student ->> 'id' = tests.id('s1')::text;
  assert s1 ->> 'roll_number' = '21CS001', 'students carry their roll number';
  assert s1 -> 'marks' -> (tests.id('x1')::text) ->> 'status' = 'present', 'and their marks by session';
  assert not (s1 -> 'marks' ? tests.id('x4')::text), 'cancelled sessions are left out';
  assert not (s1 -> 'marks' ? tests.id('live')::text), 'open sessions are left out';

  assert exists (
    select 1 from jsonb_array_elements(exported -> 'students') as student
    where student ->> 'id' = tests.id('s2')::text and student ->> 'enrolment_status' = 'removed'
  ), 'removed students are included, marked as removed';
  reset role;

  perform tests.as_user(tests.id('t2'));
  perform tests.expect_error(format('select public.course_export(%L)', tests.id('c1')), 'your own courses');
  reset role;

  perform tests.as_user(tests.id('s1'));
  perform tests.expect_error(format('select public.course_export(%L)', tests.id('c1')), 'your own courses');
end $$;
