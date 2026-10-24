-- Phase 2: session secrets, devices, approvals and scan attempts.
--
-- Continues from the earlier files: t1 teaches c1 (s1 and s3 active, s2
-- removed), t2 teaches c2 (s1 active). Devices are written as the service
-- role, as the register-device function does.

grant usage on schema tests to service_role;
grant select on tests.ids to service_role;

create function tests.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

create function tests.jwk(p_seed text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', md5(p_seed || 'x'), 'y', md5(p_seed || 'y'))
$$;

grant execute on all functions in schema tests to authenticated, anon, service_role;

/* Secrets ------------------------------------------------------------------- */

do $$
declare
  started jsonb;
  live uuid;
begin
  perform tests.as_user(tests.id('t1'));
  started := public.start_session(tests.id('c1'));
  live := (started -> 'session' ->> 'id')::uuid;
  assert length(decode(started ->> 'secret', 'base64')) = 32, 'start_session returns a 32-byte secret';
  assert (started ->> 'server_time')::bigint > 0, 'and the server time';
  assert (public.live_session_key(live) ->> 'secret') = started ->> 'secret', 'the projector can fetch the same secret again';
  assert (select count(*) from public.session_secrets where session_id = live) = 1, 'the teacher can read it';
  reset role;
  insert into tests.ids values ('live', live);

  perform tests.as_user(tests.id('s1'));
  assert not exists (select 1 from public.session_secrets), 'students never see a secret';
  assert exists (select 1 from public.class_sessions where id = live), 'though they see the session';
  perform tests.expect_error(format('select public.live_session_key(%L)', live), 'your own sessions');
  reset role;

  perform tests.as_user(tests.id('t2'));
  assert not exists (select 1 from public.session_secrets where session_id = live), 'nor does another teacher';
  reset role;

  assert (select count(*) from public.session_secrets) = (select count(*) from public.class_sessions),
    'every session has a secret, including ones opened before this migration';
end $$;

/* Devices ------------------------------------------------------------------- */

do $$
declare
  first_phone uuid;
begin
  perform tests.as_service();
  insert into public.devices (student_id, public_key, user_agent, status, active_from)
  values (tests.id('s1'), tests.jwk('s1-phone'), 'Mozilla/5.0 (iPhone)', 'active', now() + interval '12 hours')
  returning id into first_phone;
  insert into public.device_events (device_id, student_id, event) values (first_phone, tests.id('s1'), 'registered');

  perform tests.expect_error(
    format('insert into public.devices (student_id, public_key, status, active_from) values (%L, %L, %L, now())',
      tests.id('s3'), tests.jwk('s1-phone'), 'active'),
    'devices_public_key_key'
  );
  perform tests.expect_error(
    format('insert into public.devices (student_id, public_key, status, active_from) values (%L, %L, %L, now())',
      tests.id('s1'), tests.jwk('s1-second'), 'active'),
    'devices_one_active_per_student'
  );
  reset role;
  insert into tests.ids values ('s1-phone', first_phone);

  perform tests.as_user(tests.id('s1'));
  perform tests.expect_error(
    format('insert into public.devices (student_id, public_key, status, active_from) values (%L, %L, %L, now())',
      tests.id('s1'), tests.jwk('forged'), 'active'),
    'permission denied'
  );
  perform tests.expect_error(
    format('update public.devices set active_from = now() where id = %L', first_phone),
    'permission denied'
  );
  assert (select count(*) from public.devices) = 1, 'a student reads their own devices';
  reset role;

  perform tests.as_user(tests.id('s3'));
  assert not exists (select 1 from public.devices), 'not a classmate''s';
  reset role;

  perform tests.as_user(tests.id('t2'));
  assert exists (select 1 from public.devices where id = first_phone), 'a teacher of the student reads them';
end $$;

/* Approvals ----------------------------------------------------------------- */

do $$
declare
  replacement uuid;
  approved public.devices;
begin
  -- Cutting a first phone's cooling-off short.
  perform tests.as_user(tests.id('t1'));
  approved := public.approve_device(tests.id('s1-phone'));
  assert approved.active_from <= now() and approved.approved_by = tests.id('t1'), 'approval ends the cooling-off now';
  perform tests.expect_error(format('select public.reject_device(%L)', tests.id('s1-phone')), 'already in use');
  reset role;

  -- A device change: the new phone waits for a teacher.
  perform tests.as_service();
  insert into public.devices (student_id, public_key, status)
  values (tests.id('s1'), tests.jwk('s1-new-phone'), 'pending')
  returning id into replacement;
  perform tests.expect_error(
    format('insert into public.devices (student_id, public_key, status) values (%L, %L, %L)',
      tests.id('s1'), tests.jwk('s1-third'), 'pending'),
    'devices_one_pending_per_student'
  );
  reset role;

  perform tests.as_user(tests.id('s3'));
  perform tests.expect_error(format('select public.approve_device(%L)', replacement), 'students in your courses');
  reset role;

  perform tests.as_user(tests.id('t1'));
  approved := public.approve_device(replacement);
  reset role;

  assert approved.status = 'active', 'the new phone is active';
  assert (select status from public.devices where id = tests.id('s1-phone')) = 'revoked', 'the old phone is retired';
  assert (select count(*) from public.devices where student_id = tests.id('s1') and status = 'active') = 1, 'one active phone';
  assert (
    select array_agg(event order by id) from public.device_events where student_id = tests.id('s1')
  ) = array['registered', 'approved', 'revoked', 'approved'], 'every step is logged';

  update tests.ids set id = replacement where name = 's1-phone';
end $$;

-- A teacher cannot approve phones of students who have left their course.
do $$
declare
  removed_phone uuid;
begin
  perform tests.as_service();
  insert into public.devices (student_id, public_key, status)
  values (tests.id('s2'), tests.jwk('s2-phone'), 'pending')
  returning id into removed_phone;
  reset role;

  perform tests.as_user(tests.id('t1'));
  assert not exists (select 1 from public.devices where id = removed_phone), 'a removed student''s phone is out of sight';
  perform tests.expect_error(format('select public.approve_device(%L)', removed_phone), 'students in your courses');
end $$;

/* QR marks ------------------------------------------------------------------ */

do $$
begin
  perform tests.as_service();
  insert into public.attendance (session_id, student_id, status, method, device_id)
  values (tests.id('live'), tests.id('s1'), 'present', 'qr', tests.id('s1-phone'));

  -- One phone cannot mark a second student in the same class.
  perform tests.expect_error(
    format('insert into public.attendance (session_id, student_id, status, method, device_id) values (%L, %L, %L, %L, %L)',
      tests.id('live'), tests.id('s3'), 'present', 'qr', tests.id('s1-phone')),
    'attendance_one_mark_per_device'
  );
  perform tests.expect_error(
    format('insert into public.attendance (session_id, student_id, status, method) values (%L, %L, %L, %L)',
      tests.id('live'), tests.id('s3'), 'present', 'qr'),
    'qr_marks_name_a_device'
  );

  insert into public.scan_attempts (session_id, student_id, device_id, result, reason, ip, user_agent) values
    (tests.id('live'), tests.id('s1'), tests.id('s1-phone'), 'accepted', 'accepted', '10.0.0.7', 'Mozilla/5.0'),
    (tests.id('live'), tests.id('s3'), null, 'rejected', 'device_not_registered', '10.0.0.7', 'Mozilla/5.0');
  insert into public.scan_attempts (session_id, student_id, result, reason, ip, user_agent, created_at)
  values (tests.id('x1'), tests.id('s1'), 'rejected', 'token_expired', '10.0.0.9', 'Old phone', now() - interval '91 days');
  reset role;

  perform tests.as_user(tests.id('s3'));
  assert (select count(*) from public.scan_attempts) = 1, 'a student reads only their own attempts';
  reset role;

  perform tests.as_user(tests.id('t1'));
  assert (select count(*) from public.scan_attempts where session_id = tests.id('live')) = 2, 'a teacher reads their course''s attempts';
  reset role;

  perform tests.as_user(tests.id('t2'));
  assert not exists (select 1 from public.scan_attempts where session_id = tests.id('live')), 'not another course''s';
  reset role;

  assert private.scrub_scan_attempts() = 1, 'one attempt is past 90 days';
  assert (select ip is null and user_agent is null and reason = 'token_expired'
          from public.scan_attempts where session_id = tests.id('x1')), 'its network details are gone, the record is not';
end $$;
