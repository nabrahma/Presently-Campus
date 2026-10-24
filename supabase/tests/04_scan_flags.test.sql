-- Phase 3: soft flags written with QR marks, and how teachers resolve them.
--
-- Continues from the earlier files. The 'live' session of c1 is open and s1
-- is marked in it; s3 is enrolled in c1 and not yet marked.

-- Two more students in c1, each with a phone, to scan alongside s3.
insert into tests.ids values
  ('s5', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('s6', 'ffffffff-ffff-ffff-ffff-ffffffffffff');

insert into auth.users (id, email) values
  (tests.id('s5'), 's5@college.edu'),
  (tests.id('s6'), 's6@college.edu');

update public.profiles set full_name = 'Esha Pillai', roll_number = '21CS005' where id = tests.id('s5');
update public.profiles set full_name = 'Farid Ali', roll_number = '21CS006' where id = tests.id('s6');

insert into public.enrolments (course_id, student_id, joined_at) values
  (tests.id('c1'), tests.id('s5'), now() - interval '1 day'),
  (tests.id('c1'), tests.id('s6'), now() - interval '1 day');

insert into public.devices (student_id, public_key, status, active_from)
select tests.id(name), tests.jwk(name || '-flags'), 'active', now() - interval '1 day'
from (values ('s3'), ('s5'), ('s6')) as students (name);

create function tests.phone(p_student text) returns uuid
language sql stable as $$ select id from public.devices where student_id = tests.id(p_student) and status = 'active' $$;

grant execute on function tests.phone(text) to service_role;

update public.settings set campus_cidrs = '{10.0.0.0/8}', shared_ip_threshold = 2;

do $$
declare
  answer jsonb;
begin
  -- The session started five minutes ago, inside c1's ten-minute late mark.
  update public.class_sessions set started_at = now() - interval '5 minutes' where id = tests.id('live');

  -- Two classmates scanned a moment ago from one campus address and browser.
  insert into public.scan_attempts (session_id, student_id, result, reason, ip, user_agent) values
    (tests.id('live'), tests.id('s1'), 'accepted', 'accepted', '10.0.0.7', 'Mozilla/5.0'),
    (tests.id('live'), tests.id('s5'), 'accepted', 'accepted', '10.0.0.7', 'Mozilla/5.0');
  insert into public.attendance (session_id, student_id, status, method, device_id)
  values (tests.id('live'), tests.id('s5'), 'present', 'qr', tests.phone('s5'));

  perform tests.as_service();

  -- A third scan from the same connection crosses the threshold of two others.
  answer := public.record_qr_mark(tests.id('live'), tests.id('s3'), tests.phone('s3'), '10.0.0.7', 'Mozilla/5.0');
  assert answer ->> 'status' = 'inserted', format('mark written, got %s', answer);
  assert answer -> 'flags' = '["shared_connection"]', format('shared connection flagged, got %s', answer -> 'flags');

  -- So are the earlier scans in the burst, now that it is big enough to notice.
  assert (select 'shared_connection' = any (flags) from public.attendance where session_id = tests.id('live') and student_id = tests.id('s1')),
    'the first sharer is flagged too';
  assert (select 'shared_connection' = any (flags) from public.attendance where session_id = tests.id('live') and student_id = tests.id('s5')),
    'and the second';

  -- A second scan for the same student, or with a phone already used.
  answer := public.record_qr_mark(tests.id('live'), tests.id('s3'), tests.phone('s3'), '10.0.0.8', 'Mozilla/5.0');
  assert answer = '{"status": "conflict", "conflict": "student"}', format('student conflict, got %s', answer);
  answer := public.record_qr_mark(tests.id('live'), tests.id('s6'), tests.phone('s3'), '10.0.0.8', 'Mozilla/5.0');
  assert answer = '{"status": "conflict", "conflict": "device"}', format('device conflict, got %s', answer);
end $$;

do $$
declare
  answer jsonb;
begin
  -- Twenty minutes in, from a mobile network outside the campus ranges.
  update public.class_sessions set started_at = now() - interval '20 minutes' where id = tests.id('live');

  perform tests.as_service();
  answer := public.record_qr_mark(tests.id('live'), tests.id('s6'), tests.phone('s6'), '203.0.113.5', 'Mozilla/5.0 (Android)');
  assert answer -> 'flags' = '["off_campus", "late"]', format('off campus and late, got %s', answer -> 'flags');
  reset role;

  perform tests.as_user(tests.id('t1'));
  perform tests.expect_error(
    format('select public.record_qr_mark(%L, %L, %L, %L, %L)', tests.id('live'), tests.id('s6'), tests.phone('s6'), '10.0.0.1', 'x'),
    'permission denied'
  );
end $$;

do $$
declare
  r record;
begin
  update public.settings set campus_cidrs = '{}';

  perform tests.as_service();
  -- With no campus ranges configured the off-campus check is off.
  delete from public.attendance where session_id = tests.id('live') and student_id = tests.id('s6');
  assert public.record_qr_mark(tests.id('live'), tests.id('s6'), tests.phone('s6'), '203.0.113.5', 'Other') -> 'flags' = '["late"]',
    'no off-campus flag without campus ranges';
  reset role;

  -- The teacher reviews: s3 was a proxy, s6 was genuinely late.
  perform tests.as_user(tests.id('t1'));
  perform public.teacher_mark(tests.id('live'), tests.id('s3'), 'absent', 'Reviewed flag: proxy');
  perform public.teacher_mark(tests.id('live'), tests.id('s6'), 'present', 'Reviewed flag: genuine');

  select * into r from public.flag_outcomes(tests.id('c1')) where flag = 'shared_connection';
  assert (r.kept, r.removed, r.pending) = (0, 1, 2), format('shared_connection outcomes, got %s/%s/%s', r.kept, r.removed, r.pending);
  select * into r from public.flag_outcomes(tests.id('c1')) where flag = 'late';
  assert (r.kept, r.removed, r.pending) = (1, 0, 0), format('late outcomes, got %s/%s/%s', r.kept, r.removed, r.pending);
  reset role;

  perform tests.as_user(tests.id('t2'));
  perform tests.expect_error(format('select * from public.flag_outcomes(%L)', tests.id('c1')), 'your own courses');
end $$;
