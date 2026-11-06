# Next PR: management pages and Traditional match redesign

Status: setup and dependency review, 2026-11-06. No implementation or production changes in this setup commit.

## Source and baseline

Canonical requirements: [DESIGN.md](DESIGN.md), especially sections 2A and 6A–6F.
Repository baseline: main at c063517 (Center Assign Winner controls and audit match redesign gaps).
The shared Google Doc is linked in DESIGN.md and must stay synchronized when approved behavior changes.

PR #4 (codex/fencer-editor) remains open. It improves selection and first-save identity in the combined fencer editor, but does not implement the separate-page pattern. Preserve its duplicate-insert prevention and record identity behavior when replacing that editor. Reconcile overlap explicitly before merging either change; this setup does not close or merge it.

## Implementation sequence

1. Shared record navigation and tables.
   - Extend navigation.ts, App.tsx and Pages.tsx with dedicated create/edit/confirmation routes and stable record IDs.
   - Introduce reusable lookup/search/sort/filter controls and confirmation pages in ui.tsx.
   - Preserve lookup state on save/cancel/back and avoid editable collection rows.
2. Management records.
   - Refactor Users, Fencers and Presets in Management.tsx, plus Events/Teams in Events.tsx.
   - Separate invitation, edit and disable confirmation flows; preserve existing sole-Admin, account and invitation authorization.
   - Fencers: affiliation/archive filters, notes accessible by hover/focus/touch, distinct blank create vs prefilled edit, and deliberate archive/restore.
   - Keep team roster and event registration editing on dedicated relationship pages; retain event execution separately.
3. Durable match operations before enabling new controls.
   - Add an append-only signed score-adjustment ledger, card provenance, attributed reversal metadata and original post-call score snapshots.
   - Add explicit adjudication independently of score totals, end reason and finalization.
   - Add guarded/audited reopen and incomplete transitions, preserving completion versions.
   - Keep actor/time attribution, RLS, revision checks and exclusive referee claims across every operation.
   - Use an additive migration; do not rewrite ordinary historical +1/+3/+5 calls.
4. Match state and persistence.
   - Extend match.ts, db/traditional.ts and useMatchSession.ts together.
   - Load retained reversed calls and adjustment events, use consistent effective scores, and make retries idempotent.
   - Admin Mode applies both side deltas and outcome selection atomically against its entry revision; failures keep staged changes available.
   - Preserve recovery/checkpoint behavior without silently resuming a clock.
5. Prep / Live / Manage screens.
   - Split Scorekeeper.tsx into focused components and hide surrounding app chrome in Live Match.
   - Prep confirms identities and settings, persists them and enters a stopped scoreboard.
   - Timer is an accessible start/pause control. Paused-only quick scores are fixed: +1 Indirect, +3 Clean hit, +5 Counter.
   - Manage contains timer edits, retained chronological log, confirmed reversal and completion.
   - Admin Mode shows staged score arrows and centered Assign Winner controls: left victory, draw, incomplete, right victory.
   - Use an Admin Mode penalty popup with card type, configurable reason tiles (initially Safety and Power), opponent point amount, and same-event disciplinary history. Direct award vs next-hit arming awaits confirmation.
6. Read models, reports and event integration.
   - Update vMatchResults, vFencerResults, vFencerStatistics, vFencerScoring, standings, History.tsx and CSV/report export as one consistency change.
   - Remove the current rule that treats every manual ending as incomplete.
   - Only finalized eligible results count. Incomplete cannot award a result or advance a bracket.
   - Preserve registered-only event participants, manual bracket propagation, archived-generation exclusions and frozen event finalizations.
7. Validation and release preparation.
   - Run existing build and all database, tournament and account-handler tests.
   - Add behavior tests for ledger/reversal ordering, card attribution, manual completion, explicit draw/victory, incomplete/reopen and rejection of conflicting controllers.
   - Exercise desktop/mobile prep/live/manage/report, keyboard/touch controls, refresh and save failures.
   - Update DESIGN.md and its shared Doc only to accurately distinguish proposed, implemented, tested and deployed behavior.
   - Prepare migration/release instructions for review; applying hosted changes or deployment is a separate release action.

## Product decisions

See DESIGN.md §6G for the latest confirmed decisions and unresolved card/tied-knockout questions. It supersedes earlier provisional recommendations in this plan.

Confirmed:
- Time expiry or reaching Score to Win automatically finalizes the result without navigating away from the scoreboard. The current referee can correct a finalized result through audited Admin Mode. Preserve prior completion versions and guard event-dependent changes.
- Any authorized Management/Admin referee holding the match claim may use Admin Mode; account-level Admin is not required. Enforce this on the server.
- Opening Manage pauses the clock. Closing it does not resume automatically.
- Allow remaining-time increases beyond the originally selected preset duration so a wrong preset can be corrected in place. Preserve the original preset/settings provenance and audit before/after effective settings. Update the existing database duration cap deliberately; do not merely bypass client validation.
- Admin Mode also offers up/down arrow controls for Score to Win. Adjust the match-specific target without modifying the shared preset. Paused-only, persisted and audited. No-target remains supported; exact arrow behavior at that boundary and target-change finalization behavior still need specification.
- Cards are managed in Admin Mode, only while paused. Use a penalty popup identifying the sanctioned fencer, offering card choices, configurable reason tiles and referee-selected points awarded to the opponent. Initial reason categories: Safety and Power. Preserve card/reason/points/actor/time and reversal history independently of ordinary hit categories.
- Show each fencer's prior card record from the SAME event while the penalty popup is open. Do not mix other events or standalone matches into that disciplinary record. Standalone matches have no event-wide card history.
- The earlier one-pending-card-per-side/replacement proposal was accepted, followed by the popup/direct-point-entry redesign above. Whether confirming the popup directly applies a penalty or still arms a later score remains to be confirmed; do not implement both and double-award.

Unresolved:
- Candidate card types named by the owner: Yellow, Red, Black and Double Black. Their official meaning, automatic disqualification effects and point restrictions are not confirmed. Do not invent sanctions from the names.
- Preferred proposed simplification: popup confirmation directly commits one attributed opponent penalty award for the selected amount, replacing next-hit arming. This needs confirmation.
- Tied knockout behavior is under discussion. Options: save an official draw and flag it for correction in Run Event before bracket advancement; or explicitly label matches Knockout vs Standard and enter configurable overtime on a tied knockout expiry.
- The overtime idea is a proposal: one minute by default, configurable, with a lightly pulsing red screen border. Automatic clock restart, sudden death vs full period, repeated ties, target-reached ties and reduced-motion handling remain unspecified. No overtime rule is approved yet.
- Whichever option is chosen, an unresolved knockout tie must not select an arbitrary advancing winner. Run Event should identify questionable results before generating a bracket or advancing dependent fixtures.


## Scope boundaries

Profile/team default colors and historical color snapshots can follow later as the design permits; initial controls must have readable textual left/right identity.
Do not add Control Point, team fixtures, head-to-head ranking, overtime rules or a new global secondary ranking priority.
Do not reopen owner-verified invitation delivery or password recovery configuration.

## Confirmed code dependencies

- save_match currently accepts a snapshot plus active calls and represents reversal by absence from that list.
- loadTraditionalMatch currently filters out reversed calls; new log requirements need retained history.
- scoreFor currently sums ordinary calls only.
- vMatchResults currently labels manual endings incomplete.
- match_bounds currently caps remaining time at configured duration.
- readRoute currently accepts only enumerated static routes; dedicated record navigation requires a deliberate route design.
- History and aggregate views must consume the same effective score/outcome model as the live display.

## Release acceptance examples

- Confirm prep: configured duration displayed, timer stopped, no setup forms on Live Match.
- While running: score actions and shortcuts cannot add calls.
- Paused scores: +1/+3/+5 persist the corresponding fixed call types.
- Admin adjustment 8–5 to 10–4: one atomic event with +2/-1; old calls remain unchanged.
- Reverse a card penalty: retain its reason, sanctioned fencer, credited opponent, points, scoring and reversing actor/time, and original score snapshots.
- Manual completion at 8–5: left win; explicit Draw at 8–5: official draw where allowed; Incomplete: no result.
- Refresh/report/statistics/standings all agree, and stale controllers cannot overwrite newer changes.
- Reopening a finalized event bout preserves historical completion versions and handles dependent fixtures explicitly.

Baseline verification: npm run build and npm test passed on 2026-11-06, including database/RLS/scoring, tournament simulations (2–128 entrants), and account endpoint tests.
