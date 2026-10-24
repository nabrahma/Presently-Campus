-- Dev mode: devs switch their own view; nobody else can, and the teacher list
-- never moves them.

insert into tests.ids values
  ('d1', 'dddddddd-dddd-dddd-dddd-dddddddddd01'),
  ('d2', 'dddddddd-dddd-dddd-dddd-dddddddddd02');

update public.settings set email_domains = '{college.edu}';
insert into public.dev_allowlist (email) values (' Dev.One@Elsewhere.org ');

do $$
begin
  -- A listed dev signs up from outside the college domain and starts as a teacher.
  insert into auth.users (id, email) values (tests.id('d1'), 'dev.one@elsewhere.org');
  assert (select role = 'teacher' and is_dev from public.profiles where id = tests.id('d1')),
    'a listed dev signs up as a dev in the teacher view';
end $$;

update public.settings set email_domains = '{}';

do $$
begin
  perform tests.as_user(tests.id('d1'));
  assert public.set_dev_view('student') = 'student', 'a dev can switch to the student view';
  assert (select role from public.profiles where id = tests.id('d1')) = 'student', 'and the role follows';

  update public.profiles set roll_number = 'dev01' where id = tests.id('d1');
  assert public.set_dev_view('teacher') = 'teacher', 'and back to the teacher view';
  assert (select roll_number from public.profiles where id = tests.id('d1')) = 'DEV01',
    'keeping the roll number for the next switch';

  perform tests.expect_error('select public.set_dev_view(''admin'')', 'teacher or student');
  perform tests.expect_error(
    format('update public.profiles set is_dev = false where id = %L', tests.id('d1')),
    'permission denied'
  );
  perform tests.expect_error('select * from public.dev_allowlist', 'permission denied');
  reset role;

  perform tests.as_user(tests.id('s1'));
  perform tests.expect_error('select public.set_dev_view(''teacher'')', 'only developers');
  reset role;

  perform tests.as_user(tests.id('t1'));
  perform tests.expect_error('select public.set_dev_view(''student'')', 'only developers');
  reset role;
end $$;

do $$
begin
  -- The teacher list leaves devs where they chose to be.
  perform tests.as_user(tests.id('d1'));
  perform public.set_dev_view('student');
  reset role;

  insert into public.teacher_allowlist (email) values ('dev.one@elsewhere.org');
  assert (select role from public.profiles where id = tests.id('d1')) = 'student',
    'joining the teacher list does not pull a dev out of the student view';
  delete from public.teacher_allowlist where email = 'dev.one@elsewhere.org';
  assert (select role from public.profiles where id = tests.id('d1')) = 'student',
    'and leaving it does not either';

  -- Someone already signed up becomes a dev when listed, and stops when removed.
  insert into auth.users (id, email) values (tests.id('d2'), 'dev.two@college.edu');
  insert into public.dev_allowlist (email) values ('dev.two@college.edu');
  assert (select role = 'teacher' and is_dev from public.profiles where id = tests.id('d2')),
    'listing an existing account makes it a dev in the teacher view';

  delete from public.dev_allowlist where email = 'dev.two@college.edu';
  assert (select role = 'student' and not is_dev from public.profiles where id = tests.id('d2')),
    'removing it returns the account to what the teacher list says';

  perform tests.as_user(tests.id('d2'));
  perform tests.expect_error('select public.set_dev_view(''teacher'')', 'only developers');
  reset role;
end $$;
