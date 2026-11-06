# Release status and procedure

Prepared on November 6, 2026, from main `d7cf7b95ec177f724aabcc0a603b0a6c8a4c7b68`.

## Current state

Source changes and a migration are prepared locally. **Nothing in this release has been merged or deployed. The live database has not been migrated.**

GitHub's connector rejected branch creation with HTTP 403 (`Resource not accessible by integration`). A local `git push --dry-run` also failed because no GitHub credentials are available. Repository metadata's reported push permission did not establish a working write path. Restore repository Contents read/write authorization before attempting publication.

## Included

- Password authentication and an app-wide access gate, a trusted Admin account-management function, required password changes, disabled/session-revoked denial, retained user identities, and an immutable audit store.
- Shared Management access, independent registered fencers and the reserved Unregistered identity, global preset CRUD, standalone match participant selection and setting snapshots.
- Transactional call upserts/reversals, serialized revision checks, hashed referee claims, 90-second lease/recovery, periodic and transition checkpoints, device recovery and completed corrections.
- Event lifecycle, registrations, reusable teams, event-specific rosters, manual group assignments, round-robin scheduling, manual bracket selection, single/double elimination, byes, conditional reset finals, archival regeneration and manual pairing/voiding.
- Event/match/fencer history, split derived statistics, current registered names, retained call/correction audits and event finalization snapshots.
- Shared ranking order, global keyboard mappings, protected uploaded team images and HTTPS image URLs, with configuration audits.

## Validation

`npm test` reconstructs the current public schema in disposable PostgreSQL 17 (PGlite), applies the migration, and checks cross-creator reads/edits; deletion restrictions; disabled, revoked, unknown and temporary-password accounts; retained audits; transactional scoring/undo/retries; referee conflicts; participant identities; archival bracket generation; and frozen finalization configuration. Tournament simulations cover 2–128 entrants, byes, elimination counts and grand-final resets.

`npm run build` checks the application TypeScript and production bundling. The account Edge Function is syntax-checked with esbuild. Browser inspection confirmed the sign-in gate at both Dashboard and a direct standalone-match URL.

**Not yet verified:** deployed Edge Function/Auth account operations, the full authenticated browser workflow, actual object-storage uploads, activation of the hosted no-email Auth hook, and the migration against a hosted staging database. Do these before production promotion. No production passwords or accounts were changed during preparation.

## Deployment order

1. Restore GitHub write authorization, push the prepared branch, and open a PR. Keep production on the existing main commit while validating the preview.
2. Take a database backup/export appropriate to the existing free-tier project and inspect the migration. It changes shared RLS and creator-coupled FKs while retaining records. Preserve the sole Admin identity. Existing legacy match results are retained and can be reviewed/finalized; they are not silently assigned outcomes.
3. Apply `supabase/migrations/20261106090202_approved_scorekeeper.sql` using the connected Supabase migration tool to a staging database first. For the current hosted project, use `semzwajjdrvmldkbtbaq` only after staging validation. Do not run the test fixture `tests/schema-baseline.sql` against a hosted database.
4. Deploy `supabase/functions/manage-users/index.ts` as `manage-users`, with JWT verification enabled. Supabase supplies the server-only service-role key to its function runtime. Never expose it to Vite or commit it.
5. Verify the Admin can set and use a password before removing reliance on any existing magic-link session. Disable public signup in Supabase Auth, keep email/password sign-in enabled, and activate the free-tier SQL Send Email hook `public.scorekeeper_block_email`. The hook rejects email sign-in/recovery rather than sending email; Admin-provisioned accounts are confirmed by the trusted endpoint. `supabase/config.toml` records these settings, but SQL migrations alone do not activate hosted Auth hooks. Verify raw recovery and magic-link requests fail. The schema also denies app data to unprovisioned Auth users.
6. Confirm the `team-images` bucket is private with its size/MIME restrictions and active-user policies, and all views use security-invoker behavior. Run hosted security advisors.
7. Build the preview with the existing Vercel public environment variables. Verify account creation/reset/required-change, disabling an already-signed-in user, registered/unregistered bouts, offline retry, duplicate tabs, group scheduling, bracket advancement and regeneration, snapshots, uploads, keyboard controls and history.
8. After those checks pass, merge the exact tested branch and verify the new main deployment is READY. A migration changes the server contract: coordinate it with application rollout and retain the prior deployment for investigation, rather than assuming an old client is compatible with the new schema.

## Remaining product decisions

- Control Point and Traditional team execution remain deferred; write access to existing Control Point match/call/time tables is disabled for browser users.
- Head-to-head tie handling (particularly multiway ties and incomplete schedules) is not invented. Wins are primary; optional global secondary criteria currently support point differential and total points. Equal criteria remain tied; no automatic qualifiers are chosen.
- Manually ended matches conservatively produce no result, including non-ties, until that outstanding rule is decided.
- Last-used preset is remembered per authenticated user on the device. Global keyboard mappings are captured before starting a bout. The recovery lease is 90 seconds with explicit takeover after expiry.
- Historical team fixture/result processing will be added with Control Point rules. Team roster preparation does not imply team scoring is implemented.

Implementation references: [Auth hooks](https://supabase.com/docs/guides/auth/auth-hooks), [server-side account creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser), and [Edge Function authorization](https://supabase.com/docs/guides/functions/auth-headers). Verified November 6, 2026; selected hooks are available on Free.
