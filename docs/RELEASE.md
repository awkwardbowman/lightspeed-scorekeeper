Current merge status (November 7, 2026): PR #9 and PR #10 are merged and regression-verified. Automatic Git deployments are disabled in `vercel.json`. The phase migration and production rollout require separate authorization; see DESIGN §25.

# Event phases — implementation prepared, not deployed

Follow [PHASES_RELEASE.md](PHASES_RELEASE.md) for the phase workflow migration, legacy reconciliation, rollout order and hosted acceptance. Local full regression passed; hosted release remains pending. Earlier sections below describe prior releases.

# PR #8 release preparation

For the new Match Prep, Admin Mode, Match Report, preset type and calendar-date migration, follow [PR8_RELEASE.md](PR8_RELEASE.md). Apply the migration before the client and complete hosted T4 acceptance. Preparing this branch does not deploy or merge it.

# Team instances and image library — PR #6 (prepared, not deployed)

See [TEAM_IMAGES_RELEASE.md](TEAM_IMAGES_RELEASE.md) for the additive migration, immutable private image storage, trusted image endpoint with bundled WASM, legacy mapping and validation. Apply the reviewed server changes before merging the client; GitHub main auto-deploys. No hosted changes were made by this build.

---

# Management and match redesign — PR #5 (prepared, not deployed)

This release requires `20261106204518_match_redesign.sql` BEFORE the new client. It preserves existing matches/calls and adds the operation ledger and new settings. The owner has already verified email invitation and password recovery in production; do not repeat obsolete SMTP activation steps from historical sections below.

1. Review the migration and PR. Capture the current deployed revision and database backup/restore options. Confirm no bouts are actively being controlled during rollout; legacy running snapshots are converted to paused while preserving their last recorded remaining time.
2. Apply the additive migration using the normal authorized hosted migration workflow. This build has NOT applied it. Confirm `tMatchOperation` RLS/grants, `match_command` availability, protected views, initial Safety/Power reasons and 60-second overtime setting.
3. Deploy the reviewed client branch after the schema is ready. Older clients attempting to change ledger-enabled matches receive a reload error. Keep the ledger and its rows on rollback; do not drop tables or rewrite historical calls. Roll back the client first if needed, understanding that old clients cannot safely control ledger-enabled bouts.
4. Verify hosted sign-in and Management/Admin permissions; create/edit/archive/restore records; confirm both registered and unregistered prep; run paused-only scoring and automatic finalization; exercise a card, reversal, Admin score/time/target edit, report and refresh. Verify browser/server clock synchronization on the actual hosting environment.
5. Verify one-controller-per-bout conflicts on two devices, explicit expired-claim recovery, lost-response retry, event disciplinary history, overtime first-score completion, unresolved scoreless overtime, corrected standings and frozen event results. Confirm played-descendant winner corrections are rejected.
6. Record the deployed SHA and hosted acceptance separately from local test results. Keep the shared design Doc and `docs/DESIGN.md` synchronized with the actual release status.

Local validation:

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
# Alternatively use an existing Chromium:
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

The browser suite starts a local Vite server on port 5187 and uses Auth/HTTP fixtures backed by real disposable PostgreSQL functions and RLS. It does not contact production. Screenshots go to ignored `test-results/`.

---

# Email invitation release — November 6, 2026

Prepared against production main `1384493fe4353dd8337d9883552aff43e9eafef2`. This section supersedes the historical initial-release procedure below.

- Active managers and Admin invite Management accounts by email. No inviter receives a password or credential link.
- Password changes use the verified caller token. Other-user resets and legacy temporary-password creation are denied.
- Only Admin can pause new invitations. Public signup stays disabled; recovery remains available while invitations are paused.
- Local database, actual-handler endpoint and tournament tests pass; the production client builds. Live email delivery remains unverified until provider setup.

Activation order:
1. Complete free Brevo signup, verify the sender and enter SMTP credentials directly in Supabase Auth. Never commit or paste SMTP keys into chat.
2. Apply `20261106180204_email_invitations.sql`; readiness defaults false. Deploy the updated `manage-users` with JWT verification.
3. Allow production `?auth=invite` and `?auth=recovery` redirect URLs. Disable the old `scorekeeper_block_email` Send Email hook after custom SMTP is configured. Keep public signup disabled.
4. Merge/deploy the tested client. Verify a recovery email reaches the existing Admin and the password can be set by its owner.
5. Enable `tAccountPolicy.email_ready` using trusted service access only after delivery verification. Verify invitation, first-password setup, manager permissions and Admin pause.

Invitation reservations serialize with pause changes: already-reserved deliveries may finish; new reservations are blocked. Failed delivery attempts are marked failed and can be retried. Provider interruptions can leave a pending reservation requiring operator review.

---

# Release status and procedure

Prepared on November 6, 2026, from main `d7cf7b95ec177f724aabcc0a603b0a6c8a4c7b68`.

## Current state

GitHub write access was restored. PR #1 contains the implementation. The hosted Supabase migration is applied, `manage-users` version 1 is active with JWT verification, public signup is disabled, and the SQL Send Email hook is enabled. The original account, one match and its two scoring calls were preserved. A pre-release export was taken before migration.

Live checks confirmed signup is disabled and unauthenticated table access/account management return HTTP 401. An authenticated-role transactional scoring/statistics check passed on the hosted database, and its test records were rolled back. Production client deployment follows the PR merge.

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

**Verification limits:** the full authenticated browser workflow, Admin account creation/reset against live Auth, and actual image uploads have not been exercised. Migration tests used disposable PostgreSQL plus an authenticated-role rollback test against the hosted database; no paid hosted staging branch was created. No production passwords were changed.

Security advisors report two intentionally exposed SECURITY DEFINER operations (`account_status` and `set_event_status`), both with explicit caller checks and fixed search paths, plus the pre-existing leaked-password-protection warning. No RLS-disabled table or unsafe-view errors were reported.

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
