# Presently Campus — Technical Design

## What this is

A web app (installable PWA) that takes class attendance by QR scan and shows it
per subject to the teacher and the student. One college per deployment. The
requirements are in [Presently-Campus-PRD.md](Presently-Campus-PRD.md); this
document records how they are met and why.

The governing rule: **the client is never trusted to decide whether a mark is
valid.** Every rule that stops a proxy runs on the server.

## Decisions

| Decision | Alternatives | Reason |
| --- | --- | --- |
| Vite React client on Supabase (Postgres, Auth, Edge Functions, Realtime) | A custom backend | Row Level Security expresses who-may-read-what next to the data, and the two places that need server code get Edge Functions. |
| Clients have no write grant on attendance, devices or sessions | RLS insert policies | A policy can check *who* writes, not *whether a scan was valid*. Writes go through a security definer function that checks the caller, or the service-role Edge Function. |
| Absence is computed, never stored | An absent row per student per session | Rows exist only for something that happened. Closing a session needs no fan-out, and a late joiner is never "absent" from classes before they joined. |
| One definition of the figures, `private.course_figures` | Counting in each report | The roster, the course overview, the student's own figures and the export cannot disagree. |
| The existing attendance maths, unchanged | New maths for counts | `figuresStats` feeds server counts into `attendanceStats`, so margins are worked out exactly as in Presently, in integer space. |
| Rotating HMAC tokens signed on the teacher's device | Fetching each code from the server | The projector keeps rotating offline. One module, `qrToken.ts`, signs in the browser and verifies in the Edge Function. |
| A non-extractable ECDSA key per browser, not per account | Device fingerprinting, MAC or IP | Browsers cannot read a MAC address and IPs are shared on campus Wi-Fi. A key that cannot leave the browser proves the request came from the registered phone. One key per browser is what makes a phone belong to one student. |
| Soft flags recorded in Postgres | Rejecting on IP or time | Each signal has innocent causes. `record_qr_mark` computes them where the data is, and teachers decide. |
| Rules as runtime-agnostic modules behind a store interface | Logic inside the Deno handlers | Every scan check is unit tested in Node by `npm run check`; the Deno entry points only wire them to Supabase. |
| A small keyed cache instead of the old outbox | TanStack Query; keeping the outbox | Nothing a student does is queued: a queued scan would arrive expired. Reads are cached per user for offline reading and refetched on focus; writes go straight to the server and invalidate what they touched. |
| Hand-drawn SVG charts | A chart library | Two small charts would not justify a dependency heavier than the rest of the screen. |

## Data model

The schema is built in five migrations, one per phase (see
`supabase/migrations`). In brief:

- `profiles` carry a role set by triggers from `teacher_allowlist`; clients can
  update only their name and roll number.
- `courses` (with a six-character join code from an alphabet without look-alike
  characters), `enrolments`, `class_sessions` (one open per course),
  `attendance` (present or excused only), `attendance_changes` (every manual
  correction, with what it replaced).
- `session_secrets` holds each session's 32-byte secret. Students have no policy
  on it at all.
- `devices` holds each phone's public key (unique: one key, one account), with
  at most one active and one pending per student; `device_events` logs every
  step.
- `scan_attempts` logs every scan, accepted or not, with address and browser;
  those two are cleared after 90 days.
- `settings` holds the allowed email domains, the campus address ranges and the
  shared-connection threshold, edited by the admin in SQL.

A student's figures in a course: **held** is closed sessions they were enrolled
for (started after they joined, or marked anyway) minus excused ones;
**attended** is their present marks in those. Cancelled and open sessions count
for no one.

## A scan, end to end

1. The teacher's projector derives a token for the current 10-second window
   from the session secret and the server-corrected clock.
2. The student's Scan screen decodes it in qr-scanner's worker (which works on
   iOS Safari), signs `"<token>|<user_id>"` with the phone's private key, and
   calls `mark-attendance`.
3. The function takes the user from the access token and runs the nine checks
   of section 5.4 in order, stopping at the first failure: session exists, is
   open, token valid for this window or the last, student enrolled, device theirs
   and active, past cooling-off and registered before the class began, signature
   valid, phone not used for anyone else, student not already marked.
4. `record_qr_mark` writes the mark with any soft flags; the table's unique
   constraints settle two scans racing each other.
5. The attempt is logged. Realtime delivers the new row to the teacher's
   projector, whose count moves.

## Client architecture

React Router owns the routes behind a shared shell mounted once as a layout
route. The route set depends on the role, so nothing is matched until the
profile is known; matching early sent a teacher reloading a session page to the
catch-all. The projector sits outside the shell so it can fill the screen.

The session provider caches the profile so an installed app opened offline still
knows whose it is. Data hooks read through `lib/remote.ts`, keyed by user id and
cleared on sign-out. The phone's key lives in IndexedDB as a non-extractable
`CryptoKey`, with persistent storage requested.

The interface is Presently's: a black canvas, one green accent, mono numerals,
a bottom dock on phones and a side rail on wide screens, sheets that are drawers
on touch and dialogs with a pointer, colour never carrying meaning alone.

## Testing

- `npm run check`: the attendance maths, the token module (valid, previous
  window, expired, future, tampered, wrong session), device signatures, every
  scan check and registration rule, the projector's clock correction (including
  a laptop two minutes off), phone status, analysis, CSV output, and render
  tests driving the real session and data code against a fake Supabase client.
- `npm run test:db`: the migrations on a throwaway Postgres, with SQL tests for
  role assignment, RLS isolation between students and between teachers, every
  function's permission checks, the figures in excused, cancelled, open and
  late-joined cases, approvals, flags and the export.
- Acceptance tests on real phones: section 10 of the requirements.

## Known limits

- An absent student's own phone, carried in and unlocked by a friend, is not
  prevented; the live count against a head count is the check. Phase 4 adds a
  passkey with user verification to each scan.
- Safari may clear an uninstalled site's storage after seven days, taking the
  phone's key with it. Installing the app avoids this; otherwise the student
  requests a device change.
