# Approved next scope — small management fixes and event phases

Status: design approved; small management/Admin UX work in progress on `feat/scorekeeper-small-management-ux`, not yet merged or deployed. PR #8 is released; see [DESIGN.md §20](DESIGN.md). The authoritative next requirements and acceptance criteria are [DESIGN.md §21](DESIGN.md), synchronized with the shared design Doc. No PR number is reserved by this plan.

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
| S9 | Admin Mode side rails permanently visible | Match Log and Previous Cards panels never collapse; responsive screens stack them visibly |
| S10 | No raw JSON in ordinary scoring, Match Report, History or Configuration views | Human-readable action, points, participants, time, settings and status only; diagnostic JSON belongs in separate deep Admin tools |
| S11 | Nullify saved scoring log entries from Admin Mode | Clear per-entry Nullify with confirmation, permission/referee protection and immutable reversing audit entry; never delete original records |


S1, S5, S6, and S9–S11 can be implemented independently. S2–S4 touch shared UI and should coordinate. S7–S8 need to preserve the larger phase navigation contract. Nullification uses the existing reversal command only for scoring calls, cards and score-delta corrections; timer, target, and outcome correction flows remain deliberate Admin controls pending any separately scoped inverse command. Small does not imply new permission or competition-rule design.

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

This checklist also tracks the in-progress feature branch. No production migration or deployment is authorized by the checklist itself. The UI work needs focused validation, including visible non-collapsible Admin panels, no displayed JSON, successful audited Nullify and rejection of duplicate/stale reversals; phase schema/scoring/advancement changes require T3 full regression plus appropriate hosted T4 acceptance. Keep existing event snapshots, auth/RLS, audit, idempotency and referee controls intact.


## Additional design audit — OPEN findings (November 6, 2026)

Status: REVIEW PROPOSALS ONLY, not yet approved or implemented. Findings below were verified against PR #9 and the current server migration. Do not treat them as part of approved S1–S11 merely because they are documented.

| Ref | Priority | Gap and proposed acceptance |
| --- | --- | --- |
| R1 | High / small | **Registration list/count consistency:** Manage Events counts only non-archived event team instances, but the Registered Teams list includes archived instances; event-registered archived fencers are hidden entirely by the registration picker. Define active versus historically registered counts and show archived enrolled participants distinctly, read-only where necessary. The list, count, filters and export must agree. |
| R2 | High / small | **Team registration search:** Search filters only unassigned teams, not already-registered teams. Apply one normal name search to both Registered and Unregistered modes; show a meaningful no-results state and explain that teams assigned to other events must be cloned. |
| R3 | High / small | **Audit visibility/actor resolution:** Team membership history still prints `added_by`/`removed_by` UUIDs; new `describeChanges` drops every `*_id` field even when an event assignment, logo or other meaningful relationship changed. Resolve actors to names; show readable before/after values or relationship names for material fields, while preserving original audit evidence. |
| R4 | High / design + server guard | **Event lifecycle transition matrix:** Run Event currently offers every other status, including Completed → Draft and Draft → Completed; the existing `set_event_status` function accepts transitions without a state-specific matrix (though it validates pending matches at completion). Specify allowed transitions, exact completion prerequisites, deliberate reopen and archive rules, confirmations and server enforcement before expanding lifecycle UX. |
| R5 | High / testing | **Nullify actual behavior:** PR #9's browser assertion verifies only that a Nullify button exists. Add end-to-end click, confirmation, persisted score/card effect, refresh, double-click/retry, finalized/winner dependency and rejection/claim tests. Confirmations should identify specific log time, participant, original action and effect; show a clear reason when reversal is unavailable. |
| R6 | Medium / small | **Invitation policy state:** When invitations are paused, New User remains available with only the server rejection explaining failure. Surface the pause prominently at the creation affordance and explain/disable new invites until resumed, retaining Admin-only pause and Management invitation permissions. |
| R7 | High / design + server guard | **Registration removal can affect standings:** Event fencer toggles delete `tEventFencer` immediately without confirmation, while `standings(p_event)` enumerates current `tEventFencer` records. Removing a played competitor can therefore remove that fencer from current standings despite retained match history. Define whether post-play removal is forbidden or historical registration must be retained, and add explicit server guards, confirmation and audit. Team Unassign also lacks a contextual confirmation. |
| R8 | Medium / small | **Duplicate names and log context:** Several run-event selections show only a fencer name; two same-name competitors are indistinguishable. Use club/affiliation/team as secondary context, add a deliberate disambiguator if still identical. The Admin Match Log should expose readable actor attribution for corrections and distinguish historical score snapshots from current effective totals. |
| R9 | Defer to L1–L5 | **Execution still embeds setup:** Run Event continues to render phase creation, groups, seeds, manual match scheduling and bracket generation. This is known transitional behavior, not fixed by S8. Remove those editors as part of the authoritative phase setup/execution split; expose only read-only context and navigation in Run Event. |

Implementation guidance: R1–R3, R5–R6, and much of R8 are isolated PR #9 candidates. R4 and R7 require explicit lifecycle/removal decisions and backend validation; do not patch only the UI. R9 depends on the coordinated larger phase work. All additions require focused browser checks beyond passing source compilation.
