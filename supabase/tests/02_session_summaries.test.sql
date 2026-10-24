-- Session summaries, against the data the phase 1 tests left behind:
--   x1 s1 present · x2 s1 present, s2 excused (s2 since removed)
--   x3 no marks · x4 cancelled · x5 s1 present
-- s1 joined before every session; s3 joined after all of them.

do $$
declare
  r record;
begin
  perform tests.as_user(tests.id('t1'));

  assert (select count(*) from public.course_sessions_summary(tests.id('c1'))) = 5, 'one row per session';

  select * into r from public.course_sessions_summary(tests.id('c1')) where session_id = tests.id('x1');
  assert (r.expected, r.present, r.excused) = (1, 1, 0), format('x1 got %s/%s/%s', r.expected, r.present, r.excused);

  -- The removed student's excused mark no longer counts anywhere.
  select * into r from public.course_sessions_summary(tests.id('c1')) where session_id = tests.id('x2');
  assert (r.expected, r.present, r.excused) = (1, 1, 0), format('x2 got %s/%s/%s', r.expected, r.present, r.excused);

  select * into r from public.course_sessions_summary(tests.id('c1')) where session_id = tests.id('x3');
  assert (r.expected, r.present) = (1, 0), format('x3 got %s/%s', r.expected, r.present);

  assert (select status from public.course_sessions_summary(tests.id('c1')) where session_id = tests.id('x4')) = 'cancelled',
    'cancelled sessions are listed as such';

  assert (
    select array_agg(session_id order by started_at desc) = array_agg(session_id)
    from public.course_sessions_summary(tests.id('c1'))
  ), 'newest first';

  reset role;
  perform tests.as_user(tests.id('t2'));
  perform tests.expect_error(format('select * from public.course_sessions_summary(%L)', tests.id('c1')), 'your own courses');
end $$;
