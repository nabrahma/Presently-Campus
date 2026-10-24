# Presently Campus

Class attendance by QR scan, for teachers and students.

A teacher starts a session and projects a rotating QR code. Students scan it
from their one registered phone to mark themselves present. Both sides see
attendance per subject, with the classes each student can still miss or must
attend to stay on target.

This repository began as a copy of Presently, the personal attendance
tracker. It has its own Supabase project and its own
Vercel project, and never talks to the live Presently app. The full
requirements are in [Presently-Campus-PRD.md](Presently-Campus-PRD.md).

## Status

Phase 0: separate setup. The copied app builds and deploys on its own; the
campus schema and screens follow in later phases.

## Run it

```bash
npm install
cp .env.example .env   # point it at the Presently Campus Supabase project
npm run dev
```

`npm run check` runs the typecheck, the tests and the production build, and
must pass before every commit.

## License

[MIT](LICENSE)
