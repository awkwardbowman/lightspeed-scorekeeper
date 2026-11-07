# PR #8 release: match workflow and UI rework

The implementation extends `design/pr-8-ui-consistency`. Deploy the database migration before the new client. Local verification and hosted acceptance are separate gates; no hosted changes are performed by preparing this branch.

## Included behavior

- Match Prep separates the two fencers from Settings. Named presets own duration, target and Standard/Knockout Match Type; Custom clears those settings. Start Match waits for acknowledged preparation and opens a stopped timer. History opens saved bouts; the ad hoc match-ID recovery field is removed.
- Presets gain `match_type`, separate from scoring mode. Existing presets become Standard deterministically. Event phase/bracket type remains authoritative; incompatible presets produce an explicit error. Preparation records the full effective preset snapshot in the immutable operation ledger. Later preset edits cannot rewrite the match.
- Admin Mode is the full-screen scoreboard, with per-side score Apply, timer Apply, expandable Score-to-Win settings, confirmed immediate result declarations, newest-first local-time log, same-event disciplinary history and adjacent penalty controls. Other unapplied previews survive an individual Apply. Resume offers Apply / Discard / Stay when dirty and never starts time.
- Match Complete is secondary in Admin Mode; New Match is secondary in Match Report. Abandon Match preserves saved history. Finalized live bouts expose Match Report; Edit Match returns to guarded Admin Mode without reopening. The report has adjudicated winner, effective scores, a score-progression chart and categorical +1/+3/+5/Other totals. Penalties and signed corrections remain Other; reversed actions do not contribute to net totals. Legacy snapshot gaps are labeled.
- Event calendar dates are stored separately from retained legacy timestamps. The migration uses UTC dates because the old editor explicitly labeled timestamps UTC. New date changes reject end-before-start; inconsistent legacy pairs remain available for explicit correction. Neither browser nor database session timezone shifts the dates.
- Event names open an event-specific management context. Existing registrations, teams, phases, bracket, match and standings pages retain their authoritative permissions. Unsupported event formats are labeled Planning Only.
- Shared navy/amber controls, responsive match/report layout, record/team discard warnings, name-based image attribution with Copy ID, compact team More actions, keyboard conflict feedback and independent Configuration dirty-state hydration extend the earlier branch fixes.

## Database rollout

1. Back up and inspect the hosted schema and data. Confirm the previously merged PR #5 and #6 migrations are present, and complete the PR #6 image-function rollout if still pending; see `TEAM_IMAGES_RELEASE.md`.
2. Apply `20261107033338_pr8_match_presentation.sql`. It adds preset type and calendar dates and replaces the existing security-invoker `match_command` while retaining authorization, RLS, request receipts, revision checks, referee claims, immutable audit, event freezes, overtime and played-descendant guards.
3. Check existing presets became Standard, event date projection is correct, original timestamp values remain, and authenticated callers have date-column access through existing RLS. Inspect any legacy reversed date pairs for deliberate correction.
4. Deploy the client after schema verification. Avoid mixed client versions during rollout: old clients may still write timestamp columns, while this client edits the independent calendar dates.
5. Complete hosted T4 acceptance before treating the release as verified.

## Hosted T4 acceptance

Use real authorized accounts on desktop/mobile and two devices. Verify named preset vs Custom, one acknowledged match creation, pause-first scoring, independent score/time/target Apply and claim conflict/recovery. Exercise a lost acknowledgement and exact retry without duplicate points/cards. Confirm every result choice can cancel, official overrides beat numeric score ordering, Incomplete removes credited results, unresolved knockout ties cannot advance, and automatic completion exposes Match Report without redirecting.

Verify Report → Edit Match → correction → Resume refreshes the same report and retains prior finalization evidence. Confirm frozen events, played bracket descendants, revoked/disabled accounts and stale revisions reject invalid changes. Verify chronological reversal drops, signed Other totals, retained legacy snapshot gaps, same-event card scope, event dates near timezone boundaries, unsaved-form Cancel and Configuration edits surviving another section's save.

## Rollback

The migration is additive except for replacing the command function. Keep added columns, immutable operations and historical timestamps. Roll back the client only after considering old Admin semantics: old clients submit combined edits and may require Match Complete after winner selection. Do not delete ledger history, recalculate played matches from current presets, or convert calendar dates back into inferred timestamps. Prefer a forward fix for a deployed scoring defect.

## Deliberate follow-ups

Hosted acceptance and any still-pending PR #6 rollout remain release tasks. Fencer History redesign, deeper event-detail restructuring, legacy confirmation-dialog consolidation, team/Control Point execution and new competition rules are outside this implementation.

## Local verification

`CHROMIUM_PATH=/usr/bin/chromium npm run test:full` passed the production build and all seven suites, including 22-route navigation, post-finalization report refresh and automatic target completion. This uses disposable PostgreSQL and fixture Auth/Storage transport, not hosted production.

## Production release record

PR #8 merged as `3ef6260dc0ff8b1a52c7df99f9f657e422980072`. Hosted migration `pr8_match_presentation` version `20261107041636` was applied before merge. Existing three match and two call identities, original event timestamps/calendar projection and command/RLS permissions were verified. Vercel deployment `dpl_EwGVt9326FHWpMTepdGC9ZEZJ6ok` is READY. The production public URL returns HTTP 200 with the new client assets. Full signed-in/two-device acceptance remains manual.
