# PR #8 — Released

PR #8 is merged as `3ef6260dc0ff8b1a52c7df99f9f657e422980072`. Hosted migration `20261107041636` is applied and the Vercel production deployment is READY. Full signed-in, two-device hosted acceptance remains a manual check. See [DESIGN.md §14 and §19](DESIGN.md) and [PR8_RELEASE.md](PR8_RELEASE.md).

## Implemented

- Preset Standard/Knockout type, authoritative preparation validation and immutable effective-preset snapshot. Legacy presets deterministically default to Standard; event phase/bracket type remains authoritative and incompatible presets are flagged.
- Two-part Match Prep with locked named-preset settings, cleared Custom values, acknowledged Start Match, one Cancel and database-backed History navigation.
- Full-screen Admin Mode, separate score/time/target Apply with original/proposed values, independent pending previews, penalty popup and same-event cards, confirmed immediate winner/Tie/Incomplete declarations, local newest-first Match Log and guarded reversals.
- Paused Resume with Apply/Discard/Stay, retained Abandon Match, secondary Match Complete in Admin Mode, secondary New Match in Report and expandable Score-to-Win settings. These placements were approved by the user.
- Finalized Live Match → Match Report → Edit Match → guarded Admin Mode → refreshed Report. Winner follows official adjudication; numeric breakdown distinguishes ordinary calls from signed corrections/penalties and excludes reversed entries. Historical snapshot gaps remain explicit.
- Additive date-only Event fields with retained UTC timestamp provenance and end-before-start validation, event-specific management context, responsive navy/amber match/report surfaces, dirty record/team Cancel, independent Configuration hydration, keyboard conflict labels, image uploader names/Copy ID and compact Team More actions.
- Retry/reconciliation retains the same request identity. Opening Admin does not reopen/finalize or start time. Frozen-event, played-descendant, disabled-account, RLS, claim and revision safeguards remain server-enforced.

## Validation and release

The build and six non-browser suites pass, including new partial-correction, immediate adjudication, preset/date migration and real-ledger report regressions. `CHROMIUM_PATH=/usr/bin/chromium npm run test:full` passes all seven suites, including desktop/mobile scoring, team/image flows, Configuration dirty-state checks, all 22 routes and 152 visible internal links in the release navigation audit.

The source migration `20261107033338_pr8_match_presentation.sql` was applied before merge as hosted version `20261107041636`. PR #6 schema/image-function prerequisites were verified. Hosted T4 acceptance remains a distinct check.

## Outside this implementation

Fencer History redesign, deeper event-detail restructuring, legacy confirmation-dialog consolidation, team/Control Point match execution and new competition rules remain separate work. No local-file synchronization or offline-first workflow is introduced.
