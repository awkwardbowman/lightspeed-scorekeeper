# Approved next scope — small management fixes and event phases

Status: PR #9 small management/Admin UX and PR #10 large phase workflow are implemented and being integrated for the owner-authorized merge. Combined T3 and hosted migration/deployment verification are required before release. See [PHASES_RELEASE.md](PHASES_RELEASE.md).

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


### PR #9 disposition after small-fix pass — implementation pending merge and hosted verification

The R1–R9 audit above is the original open finding list. The statuses below supersede its initial "OPEN" labels. Do not mistake code on a feature branch for deployed behavior.

- **R1 implemented (small UI):** Event-row counts include all currently assigned team instances, including archived ones; registered-but-archived fencers remain visible as read-only historical registrations. Status/filters and named event count are aligned. Event-row counts reload when returning from the registration page. Backend historical registration policy remains tied to R7.
- **R2 implemented (small UI):** One team-name search applies to both Registered and Unregistered lists, and the page explains empty results and cloning teams already assigned to other events.
- **R3 implemented (small UI):** Team member/audit actors display names or safe "former staff" labels instead of UUIDs; relevant team event/logo changes resolve to human labels and before/after, and ordinary audit fields show readable before/after values without dumping JSON.
- **R5 implemented in UI; browser verification pending:** Nullify confirmation identifies action, person, recorded time, actor and signed score effect. Historical score snapshots are distinguished from current effective score. An integration browser regression now invokes Nullify, checks score/audit persistence, refreshes, and asserts the original action no longer offers Nullify. Browser suite still must be executed in an appropriate PostgreSQL/Supabase environment; backend claim/duplicate/dependency test coverage also remains a release gate.
- **R6 implemented (small UI):** Disabled New User entry point and Send Invitation form while invitations are paused/unknown; policy status is visible and reloads on Admin toggle.
- **R8 implemented (small UI):** Team/club context and a stable "Entry N" fallback distinguish same-named competitors in event scheduling, group enrollment, seeds and single-match selection; Admin log displays actor and clarifies historical totals.
- **R7 UI-only portion implemented:** Confirm before event-fencer unregistration or team unassignment; warning spells out the potential standings impact. **Unresolved high-priority backend requirement:** The current standings query enumerates live `tEventFencer` rows, so post-match unregister can remove a competitor's standings row. Decide and enforce a server-side policy preventing unsafe deletion or preserving historical eligibility, with appropriate fixture/history rules and tests. A UI confirmation alone is insufficient.
- **R4 deferred (larger, explicit state-machine/server change):** Define and enforce the event lifecycle transition matrix in both UI and `set_event_status`. Proposed for design review: Draft → Active; Active → Completed with reconciliation checks; Completed → Active by explicit audited Reopen preserving finalization snapshots; never silently allow Draft → Completed or Completed → Draft. Archive/restore rules need explicit decisions.
- **R9 handled in independent PR #10 (not merged):** The phase/group/seeding/fixture-generation redesign is implemented separately on `codex/event-phases` (https://github.com/awkwardbowman/lightspeed-scorekeeper/pull/10). Keep PR #9 independent; review integration and release/migration order once both are ready. Phase workflow remains outside this small-fix PR.

Release gates: successful changed-area CI on the final HEAD, a real browser test run for scoring/nullification and affected management screens, and a hosted acceptance preview. The open Vercel build-rate limit is separate from source compilation. This scope makes no changes to production schema, RLS, deployed site, or lifecycle server functions.


### Second UI clarity sweep — small implementation on PR #9 (November 7, 2026)

Status: IMPLEMENTED IN DRAFT BRANCH, NOT MERGED OR DEPLOYED. This pass is presentation-only, not competition logic, schema or security changes.

- Shared search fields on registration and history pages now prompt for **name**, not an unsupported ID lookup.
- Configuration navigation calls the actual general-settings screen **Match & Ranking Settings**, with an accurate description of penalty reasons, knockout overtime and standings tiebreak priority.
- Dashboard route descriptions for events, run event and history destinations describe available behavior rather than generic or misleading promises. History navigation titles explicitly identify Event, Match and Fencer History.
- Team lookup status selector distinguishes **active**, **archived**, **all** and **unassigned** in readable names. A live matching-team count and a named **More actions** menu improve row clarity. Empty results explain the search/filter mismatch.
- Image Library shows **visible/matching image counts**, offers **Clear filters**, resets pagination when switching image status, says how many images Show more will reveal, and handles a missing archive/restore target with an actionable return link.
- History shows a meaningful prompt before selecting an event or fencer and distinguishes empty data from search/scope filtering. Match details translate result status into plain language, and identify why archived/void bouts cannot be opened for editing.
- Match History original call rows use local time, named competitors and human-readable scoring action types. The same-name fencer disambiguator is applied to Fencer History's selection; Match Log receives competitor names.
- The live scoreboard's ambiguous **Manage** label is changed to **Admin Mode** (and the browser selectors updated). Match Report's progression disclosure, score-reconciliation text and CSV action now clearly describe what they do.

Verification: change-aware CI must pass for final branch HEAD. Interactive browser/PostgreSQL tests and hosted preview are still separate release checks. Vercel build-rate limiting has previously blocked hosted preview. No PR merge, migration, or deployment is performed.
