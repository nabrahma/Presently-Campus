# Presently Campus

Class attendance by QR scan, for teachers and students.

A teacher starts a session and projects a QR code that changes every ten
seconds. Students scan it from the one phone registered to them, and are marked
present in about a second. Both sides then see attendance per subject: the
teacher a roster with everyone's standing, each student their own margin, the
classes they can still miss or must attend to stay on target.

Students never mark themselves. A mark exists only because the server accepted
a valid scan, or a teacher entered it by hand with a reason.

The full requirements are in [Presently-Campus-PRD.md](Presently-Campus-PRD.md).
This repository began as a copy of Presently, the personal attendance tracker,
and has its own Supabase and Vercel projects; it never talks to the live
Presently app.

## What each side gets

**Students** (Home · Scan · Courses · Settings)

- Join a course with its six-character code, or by scanning its join QR code.
- Scan the projected code from inside the app. The answer is immediate: marked
  present, or exactly why not.
- Per course: percentage, the margin ("can miss 3" or "attend the next 2"), and
  every class since joining.
- The phone's registration status, and a device change request for a new phone.

**Teachers** (Courses · Live · Approvals · Settings)

- Create courses and share the join code once.
- Start a session and project the rotating code, with a live count of who has
  scanned. It keeps rotating on a poor connection.
- A roster per course with each student's figures, at-risk students
  highlighted, sortable by roll number, name or percentage.
- Mark anyone present, excused or absent by hand, with a reason; review flagged
  scans; close, reopen within 15 minutes, or cancel a session.
- Approve new phones. Export the register, or every mark, as CSV.
- Analysis: who will not reach the target by a chosen date, attendance class by
  class, and absence by weekday and hour.

## How proxies are stopped

| Attempt | What stops it |
| --- | --- |
| A photo of the code sent to someone outside | The code expires within 20 seconds |
| A student's account used on a friend's phone | Each account scans only from its one registered phone, which signs every scan with a key that cannot leave it |
| One phone marking two students | One mark per phone per class, enforced by the database |
| Clearing the app's data to register a phone for an absent friend | New phones cool off for 12 hours and can never mark a class that began before they were registered |
| Calling the API directly | Students cannot write attendance at all; only the server function does |
| A live video call of the code, a borrowed phone carried in | Not blocked outright. Scans from off campus, from one connection in a burst, or after the late mark are flagged for the teacher |

Section 5 of the requirements has the full design, and section 10 the
acceptance tests to run on real phones before a pilot.

## Run it locally

```bash
npm install
cp .env.example .env    # the Presently Campus project's URL and anon key
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run check` | Typecheck, every test, and the production build. Must pass before every commit. |
| `npm run test:db` | Applies the migrations to a throwaway Postgres in Docker and runs the database tests: RLS isolation, every function's permission checks, the figures, flags and export. Needs Docker running. |
| `npm run check:functions` | Typechecks the Edge Functions with Deno. |

The Edge Functions' rules (`supabase/functions/_shared`) are plain TypeScript
with the database behind an interface, so `npm run check` tests every scan check
and registration rule in Node as well.

## Set up a deployment

One college, one deployment. You need a Supabase project and a Vercel project of
your own; never reuse the live Presently ones.

1. **Supabase project.** Create it. MCP server configs (`.mcp.json`,
   `.vscode/mcp.json`) are local tooling and are not committed; point yours at
   the new project's ref.
2. **Schema and functions.** With the [Supabase CLI](https://supabase.com/docs/guides/cli):

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   supabase functions deploy register-device
   supabase functions deploy mark-attendance
   ```

   The migrations enable `pg_cron` for the two scheduled jobs (closing sessions
   left open for three hours, and clearing scan addresses after 90 days) and add
   the session and attendance tables to Realtime.
3. **Auth.** In the dashboard, set the Site URL and redirect URLs to your Vercel
   URL (the values in `supabase/config.toml` assume
   `https://presently-campus.vercel.app`). Magic links and passwords both work.
4. **Teachers and settings.** Teachers are never self-service. In the SQL
   editor:

   ```sql
   insert into teacher_allowlist (email) values ('teacher@college.ac.in');

   update settings set
     email_domains = '{college.ac.in}',        -- only these may sign up; '{}' allows any
     campus_cidrs = '{203.0.113.0/24}',        -- campus network ranges; '{}' turns the off-campus flag off
     shared_ip_threshold = 3;                  -- others on one connection before a scan is flagged
   ```

   A teacher already signed up as a student is promoted the moment their email
   is added.
5. **Vercel.** Import the repository and set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` for Production, Preview and Development, all pointing
   at the Presently Campus project. `vercel.json` handles routing, caching and
   allows the camera for the site's own origin.

Students should install the app to their home screen: Safari can clear a site's
storage, and the phone's key with it, after a week without a visit.

## Project layout

```text
src/
  screens/student/   Home, Scan, Courses, CourseDetail, JoinLink
  screens/teacher/   Courses, CourseDetail, SessionDetail, Live, Projector, Approvals, Analysis
  screens/           Auth, Onboarding, Settings (shared)
  lib/               session, student and teacher data, device key, analysis, attendance maths
  components/        Shell, panels, gauges, sheets, charts, QR code
supabase/
  migrations/        the schema, one file per phase
  functions/         register-device and mark-attendance, with their rules in _shared/
  tests/             database tests run by npm run test:db
```

[DESIGN.md](DESIGN.md) explains the technical decisions.

## Team

Built by nabrahma and Abhishek Kokadwar for the IoTBDM project. Section 13 of the
requirements records who owns each part and how commits are written.

## License

[MIT](LICENSE)
