-- Phase 1: roles, RLS isolation, course and session functions, and figures.
--
-- Each DO block is one transaction. tests.as_user switches to the API role
-- with a JWT subject for the rest of that block, exactly as PostgREST does.

create schema tests;
grant usage on schema tests to authenticated, anon;

create table tests.ids (name text primary key, id uuid not null);
grant select on tests.ids to authenticated, anon;

create function tests.id(p_name text) returns uuid
language sql stable as $$ select id from tests.ids where name = p_name $$;

create function tests.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Runs a statement and requires it to fail with a message matching a pattern.
create function tests.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm !~* p_pattern then
      raise exception 'expected an error matching "%" from: %, got: %', p_pattern, p_sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected an error matching "%" from: %', p_pattern, p_sql;
end;
$$;

grant execute on all functions in schema tests to authenticated, anon;

insert into tests.ids values
  ('t1', '11111111-1111-1111-1111-111111111111'),
  ('t2', '22222222-2222-2222-2222-222222222222'),
  ('s1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('s2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('s3', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

/* Roles come from the allowlist and nowhere else ---------------------------- */

insert into public.teacher_allowlist (email) values ('  Teacher.One@College.edu ');

insert into auth.users (id, email) values
  (tests.id('t1'), 'teacher.one@college.edu'),
  (tests.id('t2'), 'teacher.two@college.edu'),
  (tests.id('s1'), 's1@college.edu'),
  (tests.id('s2'), 's2@college.edu'),
  (tests.id('s3'), 's3@college.edu');

do $$
begin
  assert (select role from public.profiles where id = tests.id('t1')) = 'teacher', 'allowlisted email signs up as a teacher';
  assert (select role from public.profiles where id = tests.id('t2')) = 'student', 'unlisted email signs up as a student';
end $$;

insert into public.teacher_allowlist (email) values ('teacher.two@college.edu');

do $$
begin
  assert (select role from public.profiles where id = tests.id('t2')) = 'teacher', 'adding to the allowlist promotes';
end $$;

-- Sign-up can be limited to the college's domain; allowlisted teachers are exempt.
update public.settings set email_domains = '{college.edu}';
insert into public.teacher_allowlist (email) values ('visiting@gmail.com');

do $$
begin
  perform tests.expect_error(
    $q$insert into auth.users (email) values ('someone@gmail.com')$q$,
    'college email'
  );
  insert into auth.users (email) values ('visiting@gmail.com');
end $$;

update public.settings set email_domains = '{}';

/* Profiles ------------------------------------------------------------------ */

do $$
begin
  perform tests.as_user(tests.id('s1'));
  update public.profiles set full_name = '  Asha   Rao ', roll_number = ' 21cs001 ' where id = tests.id('s1');
  assert (select full_name || '|' || roll_number from public.profiles where id = tests.id('s1')) = 'Asha Rao|21CS001',
    'names are tidied and roll numbers upper-cased';

  perform tests.expect_error(
    format('update public.profiles set role = %L where id = %L', 'teacher', tests.id('s1')),
    'permission denied'
  );

  -- Another student's row is invisible, so an update touches nothing.
  update public.profiles set full_name = 'Hijacked' where id = tests.id('s2');
  reset role;
  assert (select full_name from public.profiles where id = tests.id('s2')) = '', 'cannot edit another profile';
end $$;

do $$
begin
  perform tests.as_user(tests.id('s2'));
  perform tests.expect_error(
    format('update public.profiles set roll_number = %L where id = %L', '21cs001', tests.id('s2')),
    'duplicate key'
  );
  update public.profiles set full_name = 'Bilal Khan', roll_number = '21CS002' where id = tests.id('s2');
  reset role;

  perform tests.as_user(tests.id('s3'));
  update public.profiles set full_name = 'Chen Li', roll_number = '21CS003' where id = tests.id('s3');
  reset role;

  perform tests.as_user(tests.id('t1'));
  update public.profiles set full_name = 'Dr Meera Iyer' where id = tests.id('t1');
  perform tests.expect_error(
    format('update public.profiles set roll_number = %L where id = %L', 'T1', tests.id('t1')),
    'teachers_have_no_roll_number'
  );
  reset role;

  perform tests.as_user(tests.id('t2'));
  update public.profiles set full_name = 'Prof Arjun Nair' where id = tests.id('t2');
end $$;

/* Courses ------------------------------------------------------------------- */

do $$
declare
  created uuid;
begin
  perform tests.as_user(tests.id('t1'));
  insert into public.courses (name, code, section) values ('Database Systems', 'CS301', 'A') returning id into created;
  reset role;
  insert into tests.ids values ('c1', created);

  perform tests.as_user(tests.id('t2'));
  insert into public.courses (name, code) values ('Networks', 'CS302') returning id into created;
  perform tests.expect_error(
    format('insert into public.courses (name, teacher_id) values (%L, %L)', 'Stolen', tests.id('t1')),
    'permission denied'
  );
  perform tests.expect_error(
    $q$update public.courses set join_code = 'AAAAAA'$q$,
    'permission denied'
  );
  reset role;
  insert into tests.ids values ('c2', created);

  assert (select teacher_id from public.courses where id = created) = tests.id('t2'), 'teacher_id defaults to the caller';
  assert (select join_code ~ '^[A-HJKMNP-Z2-9]{6}$' from public.courses where id = created), 'join code avoids ambiguous characters';

  perform tests.as_user(tests.id('s1'));
  perform tests.expect_error(
    $q$insert into public.courses (name) values ('Fake course')$q$,
    'row-level security'
  );
end $$;

/* Joining ------------------------------------------------------------------- */

do $$
declare
  code text;
  other_code text;
begin
  select join_code into code from public.courses where id = tests.id('c1');
  select join_code into other_code from public.courses where id = tests.id('c2');

  perform tests.as_user(tests.id('s1'));
  -- Typed loosely, the way people type codes off a projector.
  assert public.join_course(lower(substr(code, 1, 3)) || '-' || lower(substr(code, 4))) = tests.id('c1'), 'join by code';
  assert public.join_course(code) = tests.id('c1'), 'joining twice is harmless';
  perform public.join_course(other_code);
  perform tests.expect_error($q$select public.join_course('ZZZZZZ')$q$, 'no course has that code');
  reset role;

  perform tests.as_user(tests.id('s2'));
  perform public.join_course(code);
  reset role;

  perform tests.as_user(tests.id('t2'));
  perform tests.expect_error(format('select public.join_course(%L)', code), 'only students');
  reset role;

  -- A student who has not finished setup cannot appear on a roster nameless.
  insert into auth.users (id, email) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 's4@college.edu');
  perform tests.as_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform tests.expect_error(format('select public.join_course(%L)', code), 'roll number');
end $$;

-- Both early students joined a month ago.
update public.enrolments set joined_at = now() - interval '30 days'
where student_id in (tests.id('s1'), tests.id('s2'));

/* Sessions and marks -------------------------------------------------------- */

-- Runs a closed session for c1 that started p_days_ago, with the given marks.
create function tests.run_session(p_days_ago int, p_marks jsonb, p_finish text default 'close')
returns uuid
language plpgsql as $$
declare
  session_id uuid;
  mark record;
begin
  perform tests.as_user(tests.id('t1'));
  session_id := (public.start_session(tests.id('c1')) -> 'session' ->> 'id')::uuid;
  for mark in select key, value from jsonb_each_text(p_marks) loop
    perform public.teacher_mark(session_id, tests.id(mark.key), mark.value, 'Roll call');
  end loop;
  if p_finish = 'close' then
    perform public.close_session(session_id);
  elsif p_finish = 'cancel' then
    perform public.cancel_session(session_id);
  end if;
  reset role;

  update public.class_sessions
  set started_at = now() - make_interval(days => p_days_ago),
      closed_at = case when status = 'open' then null else now() - make_interval(days => p_days_ago) + interval '1 hour' end
  where id = session_id;
  return session_id;
end;
$$;

do $$
begin
  insert into tests.ids values ('x1', tests.run_session(20, '{"s1": "present"}'));
  insert into tests.ids values ('x2', tests.run_session(15, '{"s1": "present", "s2": "excused"}'));
  insert into tests.ids values ('x3', tests.run_session(10, '{}'));
  insert into tests.ids values ('x4', tests.run_session(5, '{"s1": "present"}', 'cancel'));
  insert into tests.ids values ('x5', tests.run_session(0, '{"s1": "present"}', 'leave open'));
end $$;

do $$
begin
  perform tests.as_user(tests.id('t1'));
  perform tests.expect_error(format('select public.start_session(%L)', tests.id('c1')), 'already has an open session');
  perform tests.expect_error(
    format('select public.teacher_mark(%L, %L, %L, %L)', tests.id('x3'), tests.id('s1'), 'present', '  '),
    'reason'
  );
  perform tests.expect_error(
    format('select public.teacher_mark(%L, %L, %L, %L)', tests.id('x4'), tests.id('s1'), 'present', 'Late'),
    'cancelled'
  );
  reset role;

  perform tests.as_user(tests.id('t2'));
  perform tests.expect_error(format('select public.start_session(%L)', tests.id('c1')), 'your own courses');
  perform tests.expect_error(format('select public.close_session(%L)', tests.id('x5')), 'your own sessions');
  perform tests.expect_error(
    format('select public.teacher_mark(%L, %L, %L, %L)', tests.id('x5'), tests.id('s2'), 'present', 'Proxy'),
    'your own sessions'
  );
  reset role;

  perform tests.as_user(tests.id('s1'));
  perform tests.expect_error(format('select public.start_session(%L)', tests.id('c1')), 'your own courses');
  perform tests.expect_error(
    format('select public.teacher_mark(%L, %L, %L, %L)', tests.id('x3'), tests.id('s1'), 'present', 'Trust me'),
    'your own sessions'
  );
end $$;

-- A student who joins today was not enrolled for the earlier classes.
do $$
declare
  code text := (select join_code from public.courses where id = tests.id('c1'));
begin
  perform tests.as_user(tests.id('s3'));
  perform public.join_course(code);
end $$;

/* Figures ------------------------------------------------------------------- */

do $$
declare
  r record;
begin
  perform tests.as_user(tests.id('t1'));

  -- s1: present at x1 and x2, absent from x3; x4 cancelled and x5 open count for no one.
  select * into r from public.course_report(tests.id('c1')) where student_id = tests.id('s1');
  assert (r.attended, r.held, r.excused) = (2, 3, 0), format('s1 figures, got %s/%s/%s', r.attended, r.held, r.excused);

  -- s2: excused at x2, so it counts on neither side.
  select * into r from public.course_report(tests.id('c1')) where student_id = tests.id('s2');
  assert (r.attended, r.held, r.excused) = (0, 2, 1), format('s2 figures, got %s/%s/%s', r.attended, r.held, r.excused);

  -- s3 joined after every closed session.
  select * into r from public.course_report(tests.id('c1')) where student_id = tests.id('s3');
  assert (r.attended, r.held) = (0, 0), format('s3 figures, got %s/%s', r.attended, r.held);

  assert (select count(*) from public.course_report(tests.id('c1'))) = 3, 'roster lists every enrolled student';

  select * into r from public.my_courses_overview() where course_id = tests.id('c1');
  assert r.students = 3 and r.sessions_held = 3, 'overview counts students and closed sessions';
  assert r.at_risk = 2, format('s1 (66.7%%) and s2 (0%%) are below 75%%, got %s', r.at_risk);
  assert r.average_percentage = 33.3, format('average of 66.7 and 0, got %s', r.average_percentage);
  assert r.open_session_id = tests.id('x5'), 'overview names the open session';

  select count(*) filter (where status = 'present') as present,
         count(*) filter (where status = 'absent' and not joined_after_start) as absent,
         count(*) filter (where joined_after_start) as late_joiners
  into r
  from public.session_report(tests.id('x3'));
  assert (r.present, r.absent, r.late_joiners) = (0, 2, 1), 'session report splits present, absent and late joiners';

  perform tests.expect_error(format('select * from public.course_report(%L)', tests.id('c2')), 'your own courses');
  reset role;

  perform tests.as_user(tests.id('s1'));
  select * into r from public.my_figures() where course_id = tests.id('c1');
  assert (r.attended, r.held) = (2, 3), 'student sees the same figures as the teacher';
  assert (select count(*) from public.my_figures()) = 2, 'one row per enrolled course';
  perform tests.expect_error(format('select * from public.course_report(%L)', tests.id('c1')), 'your own courses');
  perform tests.expect_error(format('select * from public.session_report(%L)', tests.id('x1')), 'your own sessions');
end $$;

/* Isolation ----------------------------------------------------------------- */

do $$
begin
  perform tests.as_user(tests.id('s2'));
  assert (select count(*) from public.attendance) = 1, 'a student reads only their own attendance';
  assert not exists (select 1 from public.attendance where student_id = tests.id('s1')), 'not another student''s';
  assert (select count(*) from public.courses) = 1, 'a student reads only enrolled courses';
  assert not exists (select 1 from public.profiles where id = tests.id('s1')), 'not classmates'' profiles';
  assert exists (select 1 from public.profiles where id = tests.id('t1')), 'but their teacher''s name';
  assert not exists (select 1 from public.enrolments where student_id <> tests.id('s2')), 'nor classmates'' enrolments';

  perform tests.expect_error(
    format('insert into public.attendance (session_id, student_id, status, method, device_id) values (%L, %L, %L, %L, %L)',
      tests.id('x5'), tests.id('s2'), 'present', 'qr', gen_random_uuid()),
    'permission denied'
  );
  perform tests.expect_error(
    format('update public.attendance set status = %L', 'present'),
    'permission denied'
  );
  perform tests.expect_error('delete from public.attendance', 'permission denied');
  perform tests.expect_error('select * from public.teacher_allowlist', 'permission denied');
  perform tests.expect_error('select * from public.settings', 'permission denied');
end $$;

do $$
begin
  perform tests.as_user(tests.id('t2'));
  assert (select count(*) from public.courses) = 1, 'a teacher reads only their own courses';
  assert not exists (select 1 from public.class_sessions where course_id = tests.id('c1')), 'not another teacher''s sessions';
  assert not exists (select 1 from public.attendance), 'nor their attendance';
  assert exists (select 1 from public.profiles where id = tests.id('s1')), 'reads a student in their course';
  assert not exists (select 1 from public.profiles where id = tests.id('s2')), 'not a student outside it';
end $$;

do $$
begin
  perform set_config('role', 'anon', true);
  perform tests.expect_error('select * from public.courses', 'permission denied');
  perform tests.expect_error('select public.my_figures()', 'permission denied');
end $$;

/* Corrections --------------------------------------------------------------- */

do $$
begin
  perform tests.as_user(tests.id('t1'));
  perform public.teacher_mark(tests.id('x2'), tests.id('s1'), 'absent', 'Left after attendance');
  assert (select attended from public.course_report(tests.id('c1')) where student_id = tests.id('s1')) = 1,
    'removing a mark makes the student absent';
  perform public.teacher_mark(tests.id('x2'), tests.id('s1'), 'present', 'Came back');

  assert (select count(*) from public.attendance_changes where session_id = tests.id('x2') and student_id = tests.id('s1')) = 3,
    'every manual change is logged';
  assert (
    select previous_status from public.attendance_changes
    where session_id = tests.id('x2') and student_id = tests.id('s1') and new_status = 'absent'
  ) = 'present', 'the log keeps what was there before';

  assert (select method || '|' || marked_by::text || '|' || reason from public.attendance
          where session_id = tests.id('x2') and student_id = tests.id('s1'))
    = 'manual|' || tests.id('t1')::text || '|Came back',
    'a manual mark records the method, the teacher and the reason';
end $$;

/* Removing a student -------------------------------------------------------- */

do $$
declare
  code text := (select join_code from public.courses where id = tests.id('c1'));
begin
  perform tests.as_user(tests.id('s2'));
  update public.enrolments set status = 'removed';
  reset role;
  assert (select status from public.enrolments where student_id = tests.id('s2')) = 'active', 'students cannot remove themselves';

  perform tests.as_user(tests.id('t1'));
  update public.enrolments set status = 'removed' where course_id = tests.id('c1') and student_id = tests.id('s2');
  reset role;

  perform tests.as_user(tests.id('s2'));
  assert not exists (select 1 from public.courses), 'a removed student loses sight of the course';
  perform tests.expect_error(format('select public.join_course(%L)', code), 'removed you');
end $$;

/* Reopening and auto-close -------------------------------------------------- */

do $$
begin
  update public.class_sessions set closed_at = now() - interval '5 minutes' where id = tests.id('x3');

  perform tests.as_user(tests.id('t1'));
  perform tests.expect_error(format('select public.reopen_session(%L)', tests.id('x3')), 'another session');
  perform public.close_session(tests.id('x5'));
  perform public.reopen_session(tests.id('x3'));
  perform public.close_session(tests.id('x3'));
  reset role;

  update public.class_sessions set closed_at = now() - interval '20 minutes' where id = tests.id('x3');
  perform tests.as_user(tests.id('t1'));
  perform tests.expect_error(format('select public.reopen_session(%L)', tests.id('x3')), 'last 15 minutes');
end $$;

do $$
declare
  stale uuid;
begin
  perform tests.as_user(tests.id('t2'));
  stale := (public.start_session(tests.id('c2')) -> 'session' ->> 'id')::uuid;
  reset role;

  update public.class_sessions set started_at = now() - interval '4 hours' where id = stale;
  assert private.close_stale_sessions() = 1, 'one stale session closed';
  assert (select status = 'closed' and closed_at = started_at + interval '3 hours'
          from public.class_sessions where id = stale), 'closed as of the three hour mark';
end $$;
