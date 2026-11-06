# Lightspeed Scorekeeper

Referee-operated Traditional lightsaber fencing, with shared Management records, event groups and brackets, detailed history, and a single Admin.

## Develop

Use Node.js LTS, run `npm ci`, and copy `.env.example` to `.env.local`. Supply the project's public URL and publishable key; never put a Supabase service-role key in a `VITE_` variable. Then run `npm run dev`.

Authentication is mandatory, including standalone matches. Active managers and Admin invite new Management accounts by email. Invitees set their own passwords; Forgot password sends a recovery link. Admin can pause invitations without blocking existing login or recovery. Public signup remains disabled. Custom SMTP must be configured before the email readiness gate is enabled.

## Validate

- `npm test` runs a PostgreSQL 17 migration/security/scoring suite in disposable PGlite, plus tournament simulations for 2–128 entrants.
- `npm run build` checks TypeScript and builds the Vite application.

## Release

Follow [docs/RELEASE.md](docs/RELEASE.md) before deploying. This release changes database permissions and match persistence; it must not be deployed independently of its migration and trusted account endpoint.

The existing Vercel project is `lightspeed-scorekeeper`; GitHub `main` deploys automatically. Environment variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Workflow

Create fencers and Traditional presets, then run standalone matches or create an event. Register event fencers, assign groups manually, generate group round-robin fixtures, and deliberately select bracket entrants in placement order. Single and double elimination include byes and grand-final reset matches. Advance resolved brackets from Run Event.

Pause before scoring. Indirect, clean hit and counter each support 1, 3 and 5 points. Time or target limits leave scoring/corrections available. Match Report finalizes a result only after a successful transactional save. Knockout ties require a referee-selected tiebreak winner. Manual stopping is conservatively recorded as no result until those outcome rules are settled.

A match has one referee claim, with a 90-second lease renewed by checkpoints. A new controller must explicitly recover an expired claim. Saves are serialized, revision-checked and retriable without duplicating calls. Refresh pauses the clock, and user-scoped local snapshots retain unsaved state. Corrections, archives and configuration changes retain audit records.

## Scope

The consolidated requirements are in [docs/DESIGN.md](docs/DESIGN.md). Control Point and Traditional team match execution remain disabled pending their rules. Reusable teams, event-scoped rosters and team images are supported. Head-to-head tiebreak semantics remain deferred; global configuration supports point differential and total points after wins, without an assumed default order.
