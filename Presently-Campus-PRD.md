# Presently Campus — Product Requirements

**Status:** Draft v1 · Oct 24, 2026
**Working name:** Presently Campus (teacher + student edition of Presently)
**Platform:** Web app (installable PWA). No native app.
**Context:** IoTBDM project, in progress.

---

## 0. Read this first (for whoever builds it)

This repo starts as a copy of the live **Presently** app. The live app must never be touched or broken.

1. **Never connect this repo to the live Presently project.** It has its own GitHub repo, its own Supabase project and its own Vercel project.
2. Before anything else, fix the two committed files that still point at the live project:
   - `.vscode/mcp.json`: replace `project_ref=jlujtirsrsfwalgomgzb` with the **new** Supabase project ref.
   - `supabase/config.toml`: change `site_url` and `additional_redirect_urls` from `presently-beta.vercel.app` to the new Vercel URL.
3. Delete the old migrations in `supabase/migrations/`. This product has a new schema (section 6) and starts from a fresh migration.
4. Keep the existing conventions: TypeScript, React 19, Vite, Tailwind v4 tokens, the shell and components, and `npm run check` (typecheck, tests, build) passing before every commit.
5. Every rule in section 5 (anti-proxy) is enforced **on the server**. The client is never trusted to decide whether a mark is valid.
6. Follow section 13 for ownership, authorship and commit messages from the very first commit.

---

## 1. Summary

Presently Campus records class attendance by QR scan and shows it per subject to both sides:

- **Teachers** see subject-wise attendance for every enrolled student, run a live session that shows a QR code, and correct marks when needed.
- **Students** scan the teacher's QR to mark themselves present, and see their own attendance per subject, including how many classes they can still miss or must attend to reach 75%.

The core difference from today's Presently: **students no longer mark their own attendance.** A mark exists only if the server accepted a valid scan, or a teacher entered it by hand.

## 2. Goals and non-goals

### Goals

- A teacher can take attendance for a class of 60 in under 3 minutes with no roll call.
- Proxy attendance is impractical: a forwarded photo of the QR, someone else's account on your phone, or one phone marking two students must all fail.
- Every student always knows their standing per subject, using the existing Presently maths.
- Attendance data is complete and queryable for analysis (the "big data" part of IoTBDM).

### Non-goals (v1)

- Native Android or iOS apps.
- Integration with the college ERP or portal.
- Face recognition or any biometric data stored by us.
- Timetable scheduling. A session exists because a teacher started it, not because a timetable says so.
- Multiple institutions. One college, one deployment.

## 3. Users and roles

| Role | Who | Can |
|---|---|---|
| **Student** | Enrolled student | Join a course with a code, register one phone, scan to mark, view own attendance |
| **Teacher** | Faculty member | Create courses, see the roster and everyone's attendance in their courses, run sessions, mark by hand, approve device changes |
| **Admin** | Project team (pilot) | Add teachers to the allowlist; done directly in SQL for v1, no UI needed |

**Becoming a teacher is never self-service.** A user is a teacher only if their email is in `teacher_allowlist`. Otherwise any student could sign up as a teacher.

## 4. User stories

### Student
1. Sign in with my college email (magic link or password).
2. On first sign-in, enter my name and roll number, and this phone is registered as my device.
3. Join a course by typing or scanning its join code.
4. In class, tap **Scan**, point at the teacher's screen, and see "Marked present: DBMS, 10:02" within 2 seconds.
5. See each course with attended / held, percentage, and "can miss N" or "attend next N".
6. See my history per course: each session with present or absent.
7. If I get a new phone, request a device change and see its status.

### Teacher
1. Sign in; I land on my courses.
2. Create a course (name, code, section, target %, default 75) and get a join code to share.
3. Start a session and show a full-screen rotating QR on the projector, with a live count: "38 of 60 marked".
4. Close the session. Everyone enrolled who did not scan is absent.
5. See a roster per course: roll number, name, attended / held, %, margin, and at-risk highlighting.
6. Open a session and mark a student present by hand (phone dead, no smartphone), with a reason.
7. See flagged scans (section 5.5) and act on them.
8. Approve or reject device change requests from students in my courses.
9. Export a course's attendance as CSV.

---

## 5. Anti-proxy design

### 5.1 Threats and how each is stopped

| Attack | Stopped by |
|---|---|
| Photo or screenshot of the QR sent to someone outside | QR changes every 10 s and expires within 20 s (5.2) |
| Live video call of the QR from class | Short expiry plus soft flags for off-campus network or location (5.5); raises effort, not fully closed |
| Absent student's account logged in on a friend's phone | Each account works only from its one registered device (5.3) |
| One phone marking two students | One mark per device per session (database constraint), and a device belongs to one account only |
| Clearing the app's data to register a phone for a second account | New devices have a cooling-off period and cannot mark in the same class they were registered in (5.3) |
| Calling the API directly to insert attendance | Students have no insert rights on attendance; only the server function writes (6.3) |
| Scanning for a session that has ended | Session must be open; tokens carry the session id |
| Absent student's actual phone carried into class by a friend | **Not prevented in v1.** Mitigated by the live count vs head count, and by passkey verification in phase 4 (5.6) |

**Rejected ideas, and why:**
- **MAC address:** browsers cannot read it, and phones randomise it per network.
- **One attendance per IP address:** on campus Wi-Fi a whole class shares one public IP, as do many users on mobile data, so this would block genuine students. IP is used only as a soft flag (5.5).

### 5.2 Rotating QR token

Each session has a random 32-byte **secret**, created when the teacher starts it and stored where only that teacher and the server can read it.

- Time is divided into **10-second windows**: `window = floor(server_time_seconds / 10)`.
- Token: `p1.<session_id>.<window>.<sig>`
  - `sig = base64url(HMAC-SHA256(secret, "<session_id>.<window>"))`, truncated to the first 16 bytes so the QR stays small.
- The **teacher's browser** generates tokens locally from the secret (like an authenticator app), so the QR keeps rotating even on a poor classroom connection.
- **Clock correction:** when the session starts, the server returns its current time. The teacher's client stores the offset and uses `Date.now() + offset`. A teacher laptop with a wrong clock must still produce valid tokens.
- The server accepts the **current and the previous** window, so a token is valid for 10 to 20 seconds.
- **One implementation** of token generation and verification, in `supabase/functions/_shared/qrToken.ts`, imported by both the Edge Function and the web app. It must have unit tests.

### 5.3 Device binding (one phone per account)

On a student's first sign-in on a phone, the app:

1. Generates an **ECDSA P-256 key pair with WebCrypto, marked non-extractable**. The private key cannot be read or copied out of the browser, even by our own code.
2. Stores the key in IndexedDB and calls `navigator.storage.persist()`.
3. Sends the **public key** to the `register-device` function.

Rules, enforced on the server:

- A public key belongs to **one** account. Registering a key already used by another account fails.
- A student has **at most one active device.**
- The first device is active after a **cooling-off period of 12 hours**, or immediately if a teacher of one of their courses approves it.
- A device registered while one of the student's sessions is open **cannot mark that session.** This blocks the "clear data, log in as friend, register, scan" trick.
- A new device for a student who already has one becomes **pending**. A teacher approves it, and the old device is revoked. Every registration, approval and revocation is logged.

Every scan is signed with the device key (5.4), so a request without the registered phone fails.

**Known risk (Safari):** Safari can delete a site's storage after 7 days without a visit, unless the app is installed to the home screen. Losing the key means a device change request. Mitigations: ask students to install the app (the existing install prompt), request persistent storage, and make device change requests quick for teachers to approve.

### 5.4 Scan flow

1. Student taps **Scan**. The camera opens inside the app. Scanning works only while signed in.
2. The app decodes the QR. Use the `qr-scanner` npm package (worker-based; works on iOS Safari, where `BarcodeDetector` does not exist).
3. The app signs `"<token>|<user_id>"` with the device's private key.
4. The app calls the Edge Function `mark-attendance` with `{ token, device_id, signature }`. The user comes from the JWT, never from the body.
5. The server checks **in this order** and stops at the first failure:

| # | Check | Failure message shown to the student |
|---|---|---|
| 1 | Token parses and session exists | "That isn't a Presently code." |
| 2 | Session is open | "This class has closed." |
| 3 | `sig` is valid for the current or previous window | "Code expired. Scan the screen again." |
| 4 | Student is enrolled in the session's course | "You're not in this course. Join it first." |
| 5 | Device belongs to this student and is active | "This phone isn't registered to you." |
| 6 | Device's `active_from` has passed (cooling-off over or approved) **and** it was registered before the session started | "New phones can't mark this class. Ask your teacher." |
| 7 | Signature verifies with the device's public key | "This phone couldn't be verified." |
| 8 | Device has not marked anyone else in this session | "This phone has already marked someone in this class." |
| 9 | Student not already marked in this session | Success, idempotent: "Already marked present." |

6. On success, the server inserts the attendance row (`method = 'qr'`) and returns the course name and time. The app shows a clear success state with a haptic tap where supported.
7. **Every attempt, accepted or rejected, goes into `scan_attempts`**, with the reason, IP and user agent. Teachers need it for review, and it is the raw data for analysis.

**Scanning needs a connection.** There is no offline queue for scans: a queued scan would arrive after its token had expired, which is the point of the token. The rest of the app still works offline for reading.

### 5.5 Soft signals (flag, don't block)

These are recorded as `flags` on the attendance row and shown to the teacher; they never reject a scan on their own, because each one has false positives.

- **Off-campus network:** the request IP is outside the college's configured IP ranges (`settings.campus_cidrs`). Empty means the check is off.
- **Shared connection:** in the same session, more than N students scanned from the same IP and user agent within a few seconds. N is configurable; default 3.
- **Late:** the scan happened more than X minutes after the session started; X is set per course, default 10.
- *(Phase 4)* **Location:** the browser's GPS reading is more than R metres from the classroom, if location checking is enabled. Indoor GPS is unreliable, so this stays a flag.

### 5.6 Phase 4: passkeys

Add a passkey (WebAuthn) with **user verification** to each scan, so the phone's owner must unlock with fingerprint or face. This addresses the "friend carries the absent student's phone" gap, unless the phone's PIN is shared. Use `@simplewebauthn/browser` and `@simplewebauthn/server`. Passkeys can sync across a person's own devices, which is why the device key in 5.3 remains the binding and the passkey proves presence.

---

## 6. Data model

Fresh schema in a new Supabase project. All tables have Row Level Security on.

### 6.1 Tables

```text
profiles
  id               uuid pk, references auth.users
  role             text  'student' | 'teacher'     -- set by trigger from teacher_allowlist, never by the client
  full_name        text  not null
  roll_number      text  unique, null for teachers
  created_at       timestamptz

teacher_allowlist
  email            text pk                          -- managed by admin in SQL

courses
  id               uuid pk
  teacher_id       uuid -> profiles
  name, code, section, term   text
  target_percentage int  default 75, 1..100
  late_after_minutes int default 10
  join_code        text unique                      -- 6 characters, no ambiguous letters
  archived         boolean default false
  created_at       timestamptz

enrolments
  course_id        uuid -> courses
  student_id       uuid -> profiles
  joined_at        timestamptz
  status           text 'active' | 'removed'
  pk (course_id, student_id)

devices
  id               uuid pk
  student_id       uuid -> profiles
  public_key       jsonb (JWK)        unique
  user_agent       text
  status           text 'active' | 'pending' | 'revoked'
  active_from      timestamptz        -- end of the cooling-off period, or approval time
  approved_by      uuid null -> profiles
  created_at, revoked_at
  unique index: one 'active' device per student_id

class_sessions
  id               uuid pk
  course_id        uuid -> courses
  started_by       uuid -> profiles
  started_at       timestamptz
  closed_at        timestamptz null   -- null while open
  status           text 'open' | 'closed' | 'cancelled'
  note             text null

session_secrets                        -- separate table so students can read sessions but never secrets
  session_id       uuid pk -> class_sessions
  secret           bytea

attendance
  session_id       uuid -> class_sessions
  student_id       uuid -> profiles
  status           text 'present' | 'excused'
  method           text 'qr' | 'manual'
  device_id        uuid null -> devices
  marked_at        timestamptz
  marked_by        uuid null -> profiles   -- teacher, for manual marks
  reason           text null               -- required for manual marks
  flags            text[] default '{}'
  pk (session_id, student_id)
  unique (session_id, device_id) where device_id is not null

scan_attempts                          -- every attempt, kept for review and analysis
  id               bigint pk
  session_id       uuid null
  student_id       uuid
  device_id        uuid null
  result           text 'accepted' | 'rejected'
  reason           text               -- the failed check from 5.4
  ip               inet
  user_agent       text
  created_at       timestamptz

settings                               -- single row
  campus_cidrs     cidr[] default '{}'
  shared_ip_threshold int default 3
```

**Absence is computed, not stored.** A student is absent for a session if it is `closed`, they were enrolled before it started, and they have no attendance row. Cancelled sessions count for no one. `excused` is excluded from both sides, like Cancelled and Holiday in Presently today.

### 6.2 Attendance figure

For a student in a course: **held** = closed sessions started after `joined_at`, minus excused; **attended** = present rows. Feed these into the existing `attendanceStats`, `standings` and `safetyZone` from `src/lib/attendanceMath.ts`, unchanged. Do the same for the teacher's roster, per student.

Compute the roster in SQL: a `course_report(course_id)` function returning one row per student with attended, held and percentage. Do not compute it by fetching every row into the browser.

### 6.3 Access rules (RLS)

| Table | Student | Teacher | Server functions (service role) |
|---|---|---|---|
| profiles | Read and update own (not `role`) | Read students enrolled in own courses | All |
| courses | Read courses they're enrolled in | Full access to own | All |
| enrolments | Read own; join only through `join_course(code)` | Read and remove in own courses | All |
| devices | Read own | Read and approve for students in own courses | Insert (register-device) |
| class_sessions | Read sessions of enrolled courses | Full access to own courses' sessions | All |
| session_secrets | **No access** | Read own sessions' secrets | All |
| attendance | Read own | Read own courses'; insert or update manual marks through `teacher_mark()` | Insert (mark-attendance) |
| scan_attempts | Read own | Read own courses' | Insert |

### 6.4 Server functions

**Edge Functions (Deno):**
- `register-device`: applies the rules in 5.3.
- `mark-attendance`: applies the checks in 5.4 and writes `scan_attempts`.

**Postgres functions (`security definer`, with an explicit `search_path`):**
- `join_course(code)`
- `start_session(course_id)`: creates the session and secret, and returns `{ session, secret, server_time }`. Fails if the course already has an open session.
- `close_session(session_id)`, `cancel_session(session_id)`
- `teacher_mark(session_id, student_id, status, reason)`
- `approve_device(device_id)`: activates it now and revokes the student's previous device.
- `course_report(course_id)`
- `session_report(session_id)`: present, absent and flagged lists.

**Auto-close:** sessions left open for more than 3 hours are closed by a scheduled job (Supabase cron).

---

## 7. Screens

Reuse the existing look: black canvas, one green accent, mono numerals, the bottom dock on phones and the side rail on wide screens. The shell switches tabs by role.

### Student (dock: Home · Scan · Courses · Settings)
- **Home:** the course closest to the line (as on today's Today screen); any open session in my courses, with a large **Scan** button; my courses with % and margin.
- **Scan:** a full-screen camera with a framing guide. Result states: success (green, course and time), each failure message from 5.4, and no camera permission (with how to enable it).
- **Courses:** list with % and margin; **Join a course** with a code input or a scan of the join QR.
- **Course detail:** margin panel (reuse from SubjectDetail), sessions with present, absent or excused, and the teacher's name.
- **Settings:** profile; device status (active, pending, or cooling off until a given time); request a device change; install app; sign out.

### Teacher (dock: Courses · Live · Approvals · Settings)
- **Courses:** each course with student count, sessions held, average %, and count at risk.
- **Create or edit course:** shows the join code and a join QR to project once.
- **Course detail:** roster table (roll no, name, attended/held, %, margin), sortable, with at-risk rows highlighted; session list; **Start session**; **Export CSV**.
- **Live session:** a projector-friendly full screen with the rotating QR (`qrcode` npm package), a countdown ring for the current window, the course name, "38 of 60 marked" updating live (Supabase Realtime on `attendance` for this session), recent flags, and **Close session**. It must keep rotating with a bad connection.
- **Session detail:** present, absent and flagged lists; mark present or excused with a reason; reopen within 15 minutes of closing.
- **Approvals:** pending device requests, with student, roll number, date and user agent; approve or reject.

---

## 8. Reuse from Presently

| Keep | Change | Drop |
|---|---|---|
| `components/*` (Shell, Panel, Readout, Gauge, Sheet, DataRow, ConfirmDialog, Empty, ErrorBoundary, UpdatePrompt) | `Shell`: docks by role | `StatusControl` for students (they no longer mark) |
| `lib/attendanceMath.ts` and its tests | `store.tsx`: split into session, student and teacher data; scans don't use the outbox | `demoData.ts`, unless rewritten for both roles |
| `lib/supabaseClient.ts` (`withValidToken`, token handling) | `screens/Auth.tsx`: college email; role from the server | `Calendar.tsx` for students (teachers correct marks per session instead) |
| `lib/date.ts`, `csv.ts`, `useInstallPrompt`, `useMediaQuery` | `Onboarding.tsx`: name, roll number, device registration | `schedule.ts`, unless timetables are added later |
| PWA setup in `vite.config.ts`, `vercel.json` | README and DESIGN.md: describe the new product | Old migrations |
| Test setup (Vitest, Testing Library, jsdom) | | |

---

## 9. Build phases

Each phase ends with `npm run check` green and is deployable on its own.

### Phase 0: separate setup
- [ ] New GitHub repo, Supabase project and Vercel project; env vars set for Production, Preview and Development, all pointing at the **new** Supabase project.
- [ ] `.vscode/mcp.json` and `supabase/config.toml` updated (section 0).
- [ ] Old migrations removed; app renamed in `index.html`, the PWA manifest and README.
- **Done when:** the copied app deploys to the new URL and nothing references `jlujtirsrsfwalgomgzb` or `presently-beta`.

### Phase 1: roles, courses and manual attendance
- [ ] Schema for profiles, teacher_allowlist, courses, enrolments, class_sessions, attendance (manual only), with RLS.
- [ ] Teacher: create a course, see the join code, start and close a session, mark by hand, see the roster.
- [ ] Student: join by code, see courses and course detail with margin.
- **Done when:** a teacher and two students can run a full week of manually marked classes, and each sees correct figures. RLS tests show that a student cannot read another student's attendance or another teacher's course.

### Phase 2: QR attendance and device binding
- [ ] `session_secrets`, `devices`, `scan_attempts`; `qrToken.ts` with tests.
- [ ] `register-device` and `mark-attendance` Edge Functions.
- [ ] Teacher live session screen; student Scan screen; device status and approvals.
- **Done when** every check in section 10 passes on real phones.

### Phase 3: analysis and polish
- [ ] Flags (5.5) and their display; CSV export; Realtime live count.
- [ ] Analysis views for the teacher: students heading below 75% before a cutoff date; absence by weekday and time slot; trend per course.
- **Done when:** a four-week pilot (section 11) can run end to end.

### Phase 4: optional hardening
- [ ] Passkeys with user verification per scan (5.6).
- [ ] Location flag.

---

## 10. Acceptance tests (anti-proxy)

Run these on real phones before any pilot. Each must behave exactly as stated.

| # | Do this | Expect |
|---|---|---|
| 1 | Scan the projected QR normally | Marked present in under 2 s |
| 2 | Photograph the QR, wait 30 s, scan the photo | "Code expired" |
| 3 | Log into student B's account on student A's registered phone and scan | "This phone isn't registered to you" (or registration is refused, because the key belongs to A) |
| 4 | Student A scans, then logs out, logs in as B on the same phone and scans | "This phone isn't registered to you": the phone's key belongs to A. Even if it did belong to B, check 8 refuses a second mark from one phone |
| 5 | Clear site data, log in as B (who has no phone registered), register the phone, scan in the same class | "New phones can't mark this class" (cooling-off, and registered during the session) |
| 6 | Call the attendance table directly from the browser console with a student's token | Refused by RLS |
| 7 | Replay a captured, valid `mark-attendance` request after the session closes | "This class has closed" |
| 8 | Scan a course you're not enrolled in | "You're not in this course" |
| 9 | Set the teacher laptop's clock 2 minutes wrong, then run a session | Scans still succeed (server time offset) |
| 10 | 60 students scan within 2 minutes | All accepted; the live count reaches 60 |
| 11 | Scan twice | Second scan says "Already marked present"; one row only |
| 12 | Teacher marks a student by hand | Row has `method = manual`, the reason, and the teacher's id |

Automated tests cover: `qrToken.ts` (valid, previous window, expired, tampered signature, wrong session); each check in `mark-attendance` (Deno tests); RLS with a student's and a teacher's JWT; `course_report` figures against `attendanceStats`.

## 11. Pilot and success measures

One section of about 60 students, one teacher, four weeks.

| Measure | Target |
|---|---|
| Time to mark a full class | Under 3 minutes |
| Scans that succeed on the first try | Over 90% |
| Rejected scans by reason | Reported weekly |
| Flagged scans confirmed by the teacher as proxies | Reported; aim to reach zero |
| Gap between scan count and head count | Spot-checked each week |
| Students who know their margin (short survey) | Over 80% |

## 12. Privacy

- Store only what the checks need: name, roll number, email, device public key, IP and user agent on scan attempts.
- Delete IP and user agent from `scan_attempts` after 90 days.
- No location is stored unless the phase 4 location check is turned on; even then, store only the flag, not the coordinates.
- No photos and no biometric data. Passkeys keep biometrics on the phone.
- Show a short notice at sign-up explaining what is recorded and why. India's Digital Personal Data Protection Act 2023 applies.

## 13. Team and working conventions

### 13.1 Who owns what

The project is built by two people working together on one shared laptop (agreed with the course teacher). Each part has one owner, and every commit for that part is credited to its owner, so the history shows who built what. Swap rows as you agree.

| Area | Owner |
|---|---|
| Phase 0 setup; schema, RLS and Postgres functions (6.1–6.4) | nabrahma |
| `qrToken.ts`, `register-device`, `mark-attendance` (5.2–5.4) | nabrahma |
| Student screens: Home, Scan, Courses, Course detail, Settings | nabrahma |
| Teacher screens: Courses, Course detail, Live session, Session detail, Approvals | Abhishek Kokadwar |
| Flags, CSV export, Realtime count, analysis views (5.5, Phase 3) | Abhishek Kokadwar |
| Acceptance tests on real phones (section 10) and the pilot (section 11) | Abhishek Kokadwar |
| Code review | Each reviews the other's pull requests |

**Authorship rules (one shared laptop)**
- **Credit follows the table above, never chance.** A commit is authored by the owner of the area it changes.
- A commit that touches both owners' areas is authored by the owner of the main change, with the other person added as a trailer on the last line:
  `Co-authored-by: Name <email>`. GitHub then credits both.
- Both identities are set up once in this repo as git aliases, so switching is one word and author and committer always match:

```bash
# Run once inside the repo. Abhishek's email must be one added to his GitHub account
# (Settings → Emails) so GitHub links the commits to his profile.
git config alias.commit-nabrahma '!GIT_AUTHOR_NAME="nabrahma" GIT_AUTHOR_EMAIL="nabrahma@users.noreply.github.com" GIT_COMMITTER_NAME="nabrahma" GIT_COMMITTER_EMAIL="nabrahma@users.noreply.github.com" git commit'
git config alias.commit-abhishek '!GIT_AUTHOR_NAME="Abhishek Kokadwar" GIT_AUTHOR_EMAIL="abhikokadwar2@gmail.com" GIT_COMMITTER_NAME="Abhishek Kokadwar" GIT_COMMITTER_EMAIL="abhikokadwar2@gmail.com" git commit'

# Then commit with whichever applies:
git commit-nabrahma -m "Subject" -m "Body"
git commit-abhishek -m "Subject" -m "Body"
```

- **For automated build sessions:** before each commit, look up the changed area in the table above and use the matching alias. Don't use plain `git commit`. If unsure which area a change belongs to, ask before committing.
- **Signing is optional.** If you sign, each person uses their own key, generated on this laptop and added to their own GitHub account, e.g. `git -c user.signingkey=~/.ssh/abhishek_signing.pub -c gpg.format=ssh commit -S`. Never sign one person's commit with the other's key.
- Work on a branch per feature and merge to `main` through a pull request; the other person reviews it. Vercel deploys `main`.

### 13.2 Commit messages

Write them like a well-kept open source project. A reader should understand **what changed and why** without opening the diff.

- **Subject line:** imperative mood, sentence case, no full stop, 72 characters at most. Describe the effect, not the activity.
  - Good: `Reject scans from a phone registered during the session`
  - Bad: `fixed bug`, `updates`, `feat: stuff`, `WIP`
- A blank line, then a **body** wrapped at 72 characters, explaining:
  - the problem or the reason for the change
  - what was done, at the level of behaviour, not a list of files
  - anything a reviewer must know: trade-offs, follow-ups, how it was tested
- **One logical change per commit.** Tests and docs for a change go in the same commit as the change.
- `npm run check` passes before every commit.
- **No mention of AI tools** anywhere: not in commit messages, trailers, code comments, docs or pull requests.

Example:

```text
Reject scans from a phone registered during the session

A student could clear the app's data, sign in as an absent friend,
register the phone as the friend's first device and scan for them in
the same class. Device binding alone did not stop this, because the
friend had no device yet.

A device now carries the time it becomes usable: twelve hours after
registration, or the moment a teacher approves it. mark-attendance
rejects a device that was registered after the session started or is
still cooling off, with a message telling the student to ask the
teacher.

Covered by acceptance test 5 and new mark-attendance tests for both
conditions.
```

## 14. Open questions

1. How are teachers verified for the pilot: an allowlist of emails (assumed), or a college email domain?
2. Does the college count on-duty or medical leave? If so, as `excused` (assumed) or as present?
3. Late arrivals: just a flag (assumed), or a separate "late" status that counts differently?
4. Can a course have more than one teacher, such as a lab assistant?
5. What should a student without a smartphone do? Manual marking by the teacher is assumed.
6. Which IP ranges does the campus network use, for the off-campus flag?
