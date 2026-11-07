# Approved next scope — small management fixes and event phases

Status: design approved, implementation not started. PR #8 is released; see [DESIGN.md §20](DESIGN.md). The authoritative next requirements and acceptance criteria are [DESIGN.md §21](DESIGN.md), synchronized with the shared design Doc. No PR number is reserved by this plan.

## Small / offloadable work

| ID | Task | Boundary |
| --- | --- | --- |
| S1 | New User and Pause/Resume Invitations in one toolbar row | Existing permissions unchanged |
| S2 | Accessible copy icon instead of Copy ID text | Coordinate shared ID component with S3 |
| S3 | IDs only in explicit tables or ID lookups | Remove ordinary form/detail/list/selector ID clutter; retain backend UUIDs/audits |
| S4 | Standard Back label and top-left placement below breadcrumbs | Preserve invoking context, filters and dirty-form safeguards; no duplicate Back/Cancel |
| S5 | Individual event columns instead of overloaded Details | Mode, format, dates, registrations and status separately |
| S6 | Registered fencer/team count on event rows | Event registrants, not summed phase memberships |
| S7 | All / Registered / Unregistered registration filters | Relative to selected event; phase variant depends on L1 |
| S8 | Run Event action on event-table rows; lifecycle controls in Run Event | Remove execution link and Active/Completed controls from registration/setup screens |

S1, S5 and S6 can be implemented independently. S2–S4 touch shared UI and should coordinate. S7–S8 need to preserve the larger phase navigation contract. Small does not imply new permission or competition-rule design.

## Larger coordinated work

1. L1 — Extend existing phases and introduce phase registrations with per-phase seeds and presets. Group A–D, Winners' Bracket, Losers' Bracket and Finals are all phases of an event. A fencer may remain registered in multiple phases simultaneously. Managers may add phases/participants after the event starts.
2. L2 — Phase-specific scheduling/bracket generations, durable match sequence and atomic archive-and-replace regeneration of every current match in that phase. Retain manual/generated/played history and protect other phases, referee claims and event finalizations.
3. L3 — Run Event lists phase tiles and opens a scoped phase detail/match list. Registration is read-only here with links to dedicated editors. Tile states: no matches gray; scheduled/unstarted blue; started but not all officially completed orange; all officially completed green. Next runnable scheduled match comes first.
4. L4 — Visualize the actual saved bracket and automatically advance finalized winners within that phase, with byes, unresolved slots, exact retries and played-descendant correction safeguards. Cross-phase winner/loser assignment remains manual.
5. L5 — Phase-aware reports/history, preserved match-time preset snapshots, legacy hierarchy reconciliation, schema/RLS and regression/release verification throughout.

L1 establishes the contract for L2–L4. L2's authoritative fixtures/sequence/generations drive both tile state and the bracket. Treat these as one coherent model; do not create a competing phase entity alongside existing tEventPhase/phase_id support.

## Confirmed decisions

- Green requires all eligible matches to be officially completed, not merely started.
- Regeneration marks/archives old matches; it never deletes results, calls or audits.
- Deathmatch means the existing Knockout style. Use Standard/Knockout labels.
- Groups are phases, with no additional group hierarchy required in the UI.
- Phase membership is many-to-many within an event. Group A → Winners' Bracket → Losers' Bracket → Finals is a valid manually assigned progression.
- Phase presets may change during an event; safely update unplayed fixtures, retain played snapshots and use explicit audited corrections for played/running bouts.
- Setup and registration belong in Manage Events; execution and lifecycle controls belong in Run Event. Keep the Run Event link on the event-table row.

## Verification and release

Documentation only. No application changes, migrations or deployment are performed by this update. Small UI work needs focused validation; phase schema/scoring/advancement changes require T3 full regression plus appropriate hosted T4 acceptance. Keep existing event snapshots, auth/RLS, audit, idempotency and referee controls intact.
