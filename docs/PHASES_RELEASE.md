# Event phases — prepared, not deployed

The large §21 L1–L5 implementation is on `codex/event-phases`. Local T3 full regression passes. No hosted migration or production deployment has been performed. The small-management branch is separate and needs integration review where both change event navigation, history, scoring presentation or tests.

## Rollout order

1. Review/back up the actual hosted schema and data; confirm all preceding migrations, including PR #8's match-presentation migration (hosted under its recorded rollout timestamp). Stop active referee sessions and coordinate a client reload during this rollout.
2. Inspect existing `tEventPhase`, `tEventGroup`, `tBracket` and phase-linked matches. The migration flattens each legacy group into its own phase, preserving group, bracket and match IDs, original attribution, calls and audits. Empty parent phases become archived. A bracket spanning multiple old groups deliberately aborts the transaction; reconcile its intended phase before retrying rather than discarding associations. Existing seeded entrants/participants are backfilled. Review duplicate/unknown participant cases against real data.
3. Apply `20261107065125_event_phase_workflow.sql` through the authorized migration workflow before deploying the client. It extends phases, introduces phase registrations/immutable command receipts, adds sequence/readiness/byes/settings snapshots, updates guarded match commands and advancement, and adds phase views/standings/finalization snapshots. No tables or scoring history are dropped. Existing historical finalizations remain historical; new phase snapshots are captured on subsequent finalizations.
4. Verify grants/RLS, migrated association/count consistency, function availability, match readiness and original phase attribution. Ensure frozen events remain frozen and active claims cannot be bypassed. The old legacy command protocol remains available for retained historical records; use the new phase UI for managed phases and reload older clients.
5. Deploy the reviewed client after schema verification. Complete hosted T4 acceptance against the exact deployed SHA and record both migration version and client deployment before calling the feature released.

## Hosted T4 acceptance

Use authorized Management/Admin accounts on desktop/mobile and two devices. Create Group A–D with a Standard 60-second/10-point preset, enroll event registrants in multiple phases with independent seeds, and verify duplicate seed rejection and registration filters. Generate while Draft, activate from Run Event, confirm no registration editor appears there, inspect all four tile states and next-runnable ordering. All-started-but-unfinished must remain orange.

Play a seeded Knockout bracket with byes and unresolved slots; verify official completion automatically fills the next fixture without Sync. Unresolved ties/Incomplete cannot advance. A correction conflicting with a played descendant must roll back. Test a competing claim, expired claim recovery, stale phase revision, interrupted generation response and exact retry after reload without duplicate generation.

Change a phase preset: only safe unplayed fixtures change; started/played snapshots remain. Add a later phase during an active event and manually assign qualifiers without removing earlier memberships. Regenerate with manual/generated/played fixtures: all prior current phase matches are archived with calls/reports retained; another phase stays untouched. Claimed/running fixtures block regeneration.

Check phase-aware reports, archived bracket/history, renamed phase attribution, event finalization snapshots, frozen write denial, explicit reopen and retained old finalizations. Disabled/revoked accounts must remain denied. Confirm narrow-screen bracket scrolling stays inside the component. Team/Control Point execution and automatic cross-phase routing remain outside this release.

## Recovery

Prefer a forward fix after rollout. Keep registrations, receipt/audit rows, phase settings and archived matches intact. Reverting the client alone restores older UI assumptions about groups and manual Sync, so it is not a complete semantic rollback after legacy flattening. If a restoration is necessary, use the reviewed pre-migration backup and a coordinated downtime procedure rather than reversing archival or deleting ledger rows.

## Local evidence

`CHROMIUM_PATH=/usr/bin/chromium npm run test:full` passed all eight suites: tournament, phases, match, account, database, teams, images and browser. The full-release navigation audit passed 23 routes. The expanded phase SQL suite also simulates canonical server-generated graphs at boundary sizes through 128 entrants, including byes, elimination counts and reset finals, and checks exact match retries after event finalization. Browser coverage uses the actual client/API contract backed by disposable PostgreSQL and does not contact production.
