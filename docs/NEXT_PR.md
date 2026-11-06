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
   - Card selection arms the next opponent score; never creates an immediate award.
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

## Product decisions pending user response

These are questions, not adopted requirements:
- At time/target, stop and keep results provisional until explicit Match Complete, or finalize automatically?
- May the currently claimed Management referee use Admin Mode, or only the sole account Admin?
- Proposed timer/card rules: Manage pauses; remaining time cannot exceed configured duration; one pending card per sanctioned side, replaced by a later card on that side; card arming only while paused; reject knockout draws at finalization.
- The incomplete/reopen workflow needs explicit agreement, including previously finalized event bouts with already played dependent matches. Do not invalidate descendants silently.
- Card color/value restrictions remain unspecified; retain referee-selected +1/+3/+5 unless competition rules are supplied.

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
- Reverse a card-linked hit: retain card, scoring and reversing actor/time, and original score snapshots.
- Manual completion at 8–5: left win; explicit Draw at 8–5: official draw where allowed; Incomplete: no result.
- Refresh/report/statistics/standings all agree, and stale controllers cannot overwrite newer changes.
- Reopening a finalized event bout preserves historical completion versions and handles dependent fixtures explicitly.

Baseline verification: npm run build and npm test passed on 2026-11-06, including database/RLS/scoring, tournament simulations (2–128 entrants), and account endpoint tests.
