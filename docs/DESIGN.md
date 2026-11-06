# Lightspeed Scorekeeper — Design Specification

Version: 2026-11-06, consolidated following merged PR #1, #2 and #3
Status: Approved product requirements, deployed implementation, pending live acceptance, and approved management-page plus Match Prep/Live Match redesigns awaiting implementation
Scope: Lightspeed Saber Academy — Traditional fencing scorekeeper and event administration

## 1. Authority, references and implementation status

This is the canonical living design specification, synchronized between the shared Google Doc and GitHub docs/DESIGN.md. When functionality changes, update both copies. Earlier implementation plans, dependency audits and historic MVP descriptions are reference material, NOT statements of current behavior. Do not infer that a feature is live merely because it was approved, or that a previous blocker still exists because it appears in the historical audit.

Shared Google Doc: https://docs.google.com/document/d/1IvEPsjjLwE98B7_M6Qqg8PfcJ8aMCHCxpBAYFXsJW7k/edit
GitHub source: https://github.com/awkwardbowman/lightspeed-scorekeeper/blob/main/docs/DESIGN.md
Repository: https://github.com/awkwardbowman/lightspeed-scorekeeper
Production: https://lightspeed-scorekeeper.vercel.app
Release procedures: https://github.com/awkwardbowman/lightspeed-scorekeeper/blob/main/docs/RELEASE.md
SMTP reference: https://github.com/awkwardbowman/lightspeed-scorekeeper/blob/main/docs/SMTP_SETUP.md
Historic supporting references: docs/IMPLEMENTATION_PLAN.md and docs/DESIGN_DEPENDENCY_AUDIT.md.

Merged release provenance:
- PR #1 — authenticated shared management; Traditional matches, fencers, presets, individual event management, group/bracket flow, derived history, configuration, auditing and hosted data migration.
- PR #2 — manager email invitations; each account owner's recovery/password changes; Admin invitation pause; server-enforced invitation reservations and email readiness.
- PR #3 — minimum six-character passwords without mandatory character types; improved password/error messaging in invitation, recovery and account-password flows.
- All three PRs are merged. The Vercel production deployment was READY on commit 8dc83a01290d1c6fed58a0751bffb641092108e9 when checked on November 6, 2026.
- Hosted Supabase migrations include approved_scorekeeper and email_invitations. The manage-users Edge Function was ACTIVE at version 4 with JWT verification when checked.

Email invitation and password-recovery verification:
- VERIFIED IN PRODUCTION BY THE OWNER: Brevo email delivery, new Management account invitations (including recipient setup) and self-service password-reset emails/links work end to end with the existing settings. Do not reopen SMTP setup, email activation or these two workflows as pending tasks.
- The legacy SQL Send Email hook designed to suppress emails in the earlier no-SMTP phase is obsolete. The supported architecture is Brevo custom SMTP with Supabase Auth; do not restore or depend on the email-blocking hook. Its current dashboard enablement state was not independently checked in this documentation pass.
- Historical diagnostic note only: an earlier read-only database query returned invitations_paused = false and email_ready = false. Despite that value, the owner successfully tested actual account invitations and password resets using the current configuration. The prior assumption that email_ready=false necessarily blocks the working production workflow was incorrect. Do not change the flag, hook, SMTP or other production settings merely to address this historical mismatch; investigate its meaning only if a new functional problem arises.

Automated database security, handler, bracket simulation and production build tests have passed. Full real-user browser workflows, multi-device interactions and image uploads should still be exercised. Track functional verification separately from merged code.

## 2. Non-negotiable product and architecture rules

- Stay within available free tiers; no paid infrastructure is assumed or authorized by this specification.
- Exactly one Admin account and one additional application role: Management. No public registration and no Google OAuth requirement.
- Every page and data operation requires an active authorized account. All authorized Management users and Admin share the same records; this is one shared application, not a per-user silo.
- Management may create/edit/archive ordinary records. Permanent deletion, where implemented safely, is Admin-only and must not destroy historical matches, scores or attribution. Retained identities/tombstones and audit history take precedence over destructive cascades.
- Authentication and authorization are server-enforced using Supabase Auth, trusted functions, PostgreSQL permissions/RLS and protected Storage, not merely hidden UI controls. Revoking/disabling a user must prevent data access even if a browser still holds an older session.
- Login users are distinct from registered fencer identities. Use stable UUIDs for references; display names and emails are not durable relational keys.
- Scoring calls, edits, result corrections, account operations, bracket regeneration and shared configuration changes require durable audit information where applicable.
- A referee pauses the match clock before scoring; time/target completion does not silently discard scoring state or skip a deliberate match report.
- Records from historical matches and finalized events must survive user/fencer rename, preset change, team-roster change, bracket regeneration and future configuration edits.

### 2A. Standard management record pages — Lookup / Create / Edit / Confirm (approved 2026-11-06; implementation pending)

- A reusable navigation and interaction pattern applies to every management page for persistent records, starting with Users, Fencers, Teams, Match Presets, and Event record management. Adopt it for future CRUD entities. This does not turn live bout scoring, Run Event operations, read-only History reports, self-service Account settings, or shared Configuration into CRUD tables.
- The entry/lookup page is for browsing records: a searchable, sortable and filterable table with appropriate read-only columns, record identity, affiliation/status and any useful read-only counts. Include archived or disabled records through explicit filters/toggles; normally show active records first. No inline New/Edit form, side-by-side editor, modal upsert, or editable cells on a table/report/aggregate view. It is acceptable to show row-level navigation actions.
- Place a prominent "New [entity]" button above the table. Give each row quick, permission-appropriate Edit and Archive actions, and Restore (or comparable enable/disable) where applicable. For the Fencers table specifically, support searching, sorting, filtering by affiliation and archived status, and viewing notes on mouse hover; ensure the same notes can be accessed by keyboard focus or touch, not hover alone.
- New opens a separate, dedicated "Create [entity]" page with blank/default fields. Edit opens a separate "Edit [entity]" page with the selected stable ID and prefilled fields. Make the mode unmistakable in the page title and primary button ("Create fencer" vs "Save changes"), not only in the navigation path. Provide a Cancel/Back action that does not save, and clear save-success/error feedback; return to the lookup and retain table search/sort/filter state where practical.
- Archive opens a separate "Confirm archive [entity]" page rather than acting instantly or sharing the edit page. Identify the exact record, explain its absence from active selections and preservation of historical references, and offer explicit Confirm archive and Cancel choices. Do not delete the record. A restore action must also be deliberate and recognizable. Follow equivalent dedicated confirmation flow for deactivation of a user account, while retaining the stronger user-auth/sole-Admin safeguards.
- Users follow the same collection/creation/edit navigation, but "New user" means an invitation by email, not a password or fencer creation. The existing invitation, account-role and Admin-only restrictions remain unchanged. Teams and Events follow the same lookup vs edit separation, with roster assignment or other relationship edits handled in dedicated pages rather than inside the collection table.
- Reuse the pattern and consistent language/placement across entity types; retain the existing backend permissions, UUID identity, auditing, historical retention and domain-specific validation. This is an approved UI/UX change to implement later, not a claim that current pages already comply.

## 3. Page 1 — Account and Manage Users

Approved current policy, superseding the old Admin-created-temporary-password/no-email design:

- Only active authorized Management users and Admin may invite additional Management accounts by entering an email. No invite grants Admin privileges.
- Invitation links reach the invitee's email address; invitees choose their own passwords. The inviter cannot view, generate or set their password.
- Every account owner can change and recover only their own password. Self-service recovery sends an email link. Admin has no other-user password-reset authority.
- The shared password forms and trusted server validation require at least six characters, with no required combination of uppercase, lowercase, digits or symbols; the implemented maximum remains unchanged. Known same-password, expired-session, weak-password and provider errors should be explained safely and usefully.
- Only Admin may pause/resume new invitations. That pause must be server-enforced and must NOT block sign-in or self-service recovery. The invitation reservation/delivery workflow should prevent newly reserved sends after the pause, while handling in-flight, failed and pending deliveries predictably.
- Public signup remains disabled. App users do not need membership in the Supabase organization or dashboard.
- Admin retains exclusive authority over sensitive user administration and safe permanent deletion; Management has shared ordinary records and invitation access. Active authorized users can update their own display name.
- Profile display name is required and nonblank. The durable identity is the Supabase Auth UUID; email is a login/contact attribute. Audit account state and policy changes.
- Disabled accounts, revoked sessions, unauthorized callers and unprovisioned Auth users must be denied by backend policies/functions. Keep the sole Admin protected.
- The app must not expose service-role credentials or SMTP keys in frontend environment variables or the repository.
- The Users management screen must follow §2A: a user lookup table and distinct Invite/Create User, Edit User and account-disable confirmation pages. The listing must not embed invitation or edit forms.

Implementation: Account/authentication UI and trusted account endpoints are deployed. The owner has verified actual new-account invitations, acceptance/password setup and password reset using Brevo and existing production settings. No email configuration work remains. Admin invitation pause, disabled-user access controls and broader role/authorization behavior may still be included in the page-by-page acceptance walkthrough.

## 4. Page 2 — Manage Fencers

- Fencers are independent of login users. Required display name; optional club/affiliation and notes. Duplicate names are allowed; differentiate by stable UUID and UI context.
- Management/Admin can manage and archive fencers. Archived fencers remain visible in history and are omitted from active selection by default. Admin-only deletion must respect retained historical references.
- Historical registered-fencer displays resolve the current display name by UUID. Preserve match-time name snapshots for provenance and for generic unregistered participants.
- One reserved generic Unregistered fencer identity represents manually typed standalone participants. A standalone match can have one or two unregistered participants, including identically typed names; store individual left/right typed names with the match. The generic record is not a personal stats profile and cannot be accidentally deleted.
- Calculate completed-eligible wins, losses, ties, scoring breakdowns and match counts from authoritative match records and security-invoker PostgreSQL views rather than mutable fencer counters. Separate overall, event and standalone statistics. Ignore voided/ineligible match results and archived prior bracket generations; preserve audited historical visibility.
- Fencer management must follow §2A: a searchable, sortable/filterable fencer table with hover/focus/touch notes, row Edit/Archive buttons and a top New Fencer button. Creation, editing and archive confirmation are separate pages, with visibly distinct Create vs Edit states.

Implementation: Shared fencer CRUD and derived history/statistics are part of the initial Traditional build; verify actual filters, renames, archiving and stats in the user walkthrough.

## 5. Page 3 — Create Match Preset

- A shared library of Traditional match presets accessible to authorized Management/Admin. Control Point preset editing is not active until its rules are designed.
- Preset fields include name, Traditional mode, duration, optional target score and compatible rule settings. A preset can be archived without invalidating historical matches.
- In standalone use, remember the last-used preset per authenticated user on that device. This is NOT a global default and does not imply cross-device synchronization.
- Events may store a default compatible preset. A referee may choose a different preset for a phase or match, and adjust duration/target before start without altering the shared preset.
- Store the effective match-time rule/timer/target snapshot and optional preset reference. Later preset edits/archival must not rewrite previously played matches.
- Defer overtime, round structures and advanced scoring rules until those modes have confirmed designs.
- Match Presets must follow §2A: a dedicated preset lookup/search/sort/filter table and separate Create Preset, Edit Preset and Confirm Archive Preset pages, replacing the combined selector/upsert view.

Implementation: Shared Traditional presets, archival and match-level settings snapshots are deployed. Verify creation, selection, editing, archiving and history in the walkthrough.

## 6. Page 4 — Run Single Match

STATUS: APPROVED MATCH-SCREEN REDESIGN, implementation pending (2026-11-06). The existing deployed Scorekeeper combines match setup, live controls, a 3×3 category/point grid and a call-history section on one page. That layout is superseded by the two-stage flow below. Existing transactional saving, referee leasing and match history remain required. Do not describe this UI redesign as already shipped.

### 6A. Match Prep — distinct preparation screen

- Selecting "Run Single Match" opens a dedicated Match Prep screen FIRST, not the live scoreboard. Gather both fencers (registered selection or typed Unregistered name), match preset, match duration/length and Score to Win (target score, optional/no-target allowed). A round/bout label may be retained here if needed; match UI should not display setup forms in the live view.
- Choosing a preset populates duration and Score to Win. Referee may override those values for this specific match; overrides do not mutate the shared preset. Preserve preset ID and the effective settings snapshot. Remember last-used preset per logged-in user on that device.
- Confirming prep commits/initializes the match configuration and navigates to Live Match; do NOT automatically start the timer. Keep a safe Cancel/Back path before the bout starts, without abandoning already played matches.
- DESIGN FOR LATER COLOR SUPPORT: fencers and teams may have assigned display colors. The prep screen will ultimately show the two resolved side colors and allow match-specific overrides without editing the fencer/team defaults. Preserve a match-side color snapshot/identity so historical logs and reports retain their original coloring. This is planned extension, not a claim that profile/team color fields currently exist.
- Event-linked Traditional bouts should eventually reuse the same Live Match component with event-selected, registered fencers and phase/preset context; event competitors must not switch to generic Unregistered. Do not silently implement Control Point/team scoring using these Traditional rules.

### 6B. Live Match — distraction-free scoreboard

- After confirmation, present a responsive full-viewport, scoreboard-focused screen (minimal or hidden normal app navigation/chrome): prominent LEFT and RIGHT fencer names; very large scores; large center countdown timer. Other than the timer, visible scoring controls and a Manage button, avoid setup fields, reports, large tables, toolbars and unrelated status panels on this screen. Keep usable on phone, tablet and desktop, including orientation changes.
- Each fencer has exactly THREE visible quick-scoring buttons: +1, +3 and +5, NOT the current 3×3 category/point grid. The mapping is FIXED and unambiguous: +1 = Indirect; +3 = Clean Hit; +5 = Counter. A click writes one correctly typed call; the detailed category still exists in stored calls and match reports. Clearly associate buttons with the correct side.
- Tap/click the countdown time itself to START or PAUSE the clock (including initial start and later resume). The clock must be an accessible, large interactive control with obvious running/paused visual state and keyboard affordances. On initial entry, time displays the configured duration and remains stopped.
- Preserve the already approved referee rule: pause first, then award points. Quick-score buttons are usable only while paused; while the clock runs, they must not record points. Do not silently auto-award or auto-pause when points are clicked.
- Time expiry or reaching Score to Win ends running countdown, visibly identifies match-complete status and keeps score/corrections available through the deliberate completion/report workflow. The live view remains on the scoreboard until the referee elects to view Match Report; do not unexpectedly navigate away.
- While a match is underway, match settings and participants are fixed except for explicit authorized timer adjustments, scoring reversal and audited result correction through Manage. Once a match has been finalized, restrict modifications to the established audited correction path.

### 6C. Manage — live match control panel

- The Live Match has a prominent but visually secondary "Manage" button. It opens a dedicated management overlay/panel (rather than always showing the log on the live scoreboard). Recommended safe default for implementation: opening Manage while the timer is running pauses the clock; do not silently resume on close.
- TIMER ADJUSTMENT: Provide clear up/down arrows for minutes AND seconds of remaining time (suggested controls: minute +/-1 and second +/-1 with normalized MM:SS display). Adjust actual remaining time, not the originally configured match duration; do not allow negative remaining time. Adjustments are authorized only while the clock is paused, must persist, and should produce an audit entry with actor, timestamp and before/after remaining time. Confirm specific bounds/behavior at zero if implementation exposes it.
- SCORE LOG: Show EVERY recorded hit/call plus card-derived scores and administrative adjustment events in chronological order, including reversed ones, not just the currently scoring calls. Each log row uses the exact conceptual format "<Fencer> +<points> → <Left Score> to <Right Score>" (for example "Ari +3 → 8 to 5"), alongside call time/category where useful. The displayed left/right values are the scores immediately AFTER that original call, preserved as its historical post-call snapshot; never rewrite that snapshot because a subsequent call was reversed. Current scoreboard totals, however, reflect only non-reversed calls.
- COLORS: Each hit, card-derived score and administrative adjustment log entry is visually associated with the fencer/team side that was credited, using that side's resolved color and any per-match override when color support is added. Store the call's side/identity and a match-side color snapshot to ensure future historical accuracy. Include name/side markers so color is never the only signal; reversed entries remain distinguishable and readable.
- REVERT: Every active score-log entry has a Revert action. Require an explicit confirmation identifying the fencer and +1/+3/+5 call. Reverting MUST NOT delete the row: flag the original call as reversed/overridden, record who performed the reversal (authenticated UUID) and when, keep the original point value/type/time/post-call totals, and gray/mute the row with "Reverted" attribution. A reversed row must not be reversible again through the ordinary action. The scoreboard recalculates from non-reversed calls. Do not erase audit history on repeated saves, refreshes or history export.
- MATCH COMPLETE: Provide a "Match Complete" button within Manage/Admin Mode, with explicit confirmation before ending/finalizing. Automatically award the score-derived win/loss/draw EVEN FOR MANUAL COMPLETION. When Admin Mode is enabled, show all four result choices together beneath a centered "Assign Winner" header under the scoreboard, as specified in §6E. Incomplete saves the bout as not finalized, with no official outcome. Keep the scoreboard visible and retain the deliberate Match Report transition. Do not discard calls.
- Keep safe/save/retry/offline and expired-claim recovery controls available in an appropriate management/error surface without cluttering the central live scoreboard.

### 6D. Data contract and migration impact (design only; NO migration applied)

- EXISTING fields satisfy the requested match settings: public."tTraditionalMatch".target_score = ScoreToWin, duration_ms = MatchDurationMinutes stored as milliseconds, remaining_ms = TimeRemaining stored as milliseconds. Likewise, tMatchPreset already contains duration_ms and target_score. Preserve configured duration separately from current remaining time and save an authoritative pause/checkpoint value; avoid duplicative columns named exactly ScoreToWin, MatchDurationMinutes or TimeRemaining.
- EXISTING public."tTraditionalCall" contains id, match_id, side, call_type, points, match_time_ms, recorded_at and is_reversed. Existing tAudit triggers log match and call changes with actor/time/old/new data. However, current frontend removes reverted calls from its local array and the save_match RPC treats missing calls as reversed; the new UI/persistence flow must retain and reconstruct BOTH active and reversed rows without accidentally reactivating or discarding them.
- Before implementation, decide whether to add explicit tTraditionalCall.reversed_by, reversed_at and immutable left_score_after/right_score_after columns (recommended for direct log rendering), or reliably expose the same information through append-only audit/events. Current table lacks direct reversed-by/time and per-call post-score columns. Identify the user who REVERTED, not only who originally scored.
- The fixed +1/+3/+5 mapping must be enforced in authoritative save/validation logic for NEW Traditional calls as well as the UI, without corrupting any legacy recorded calls. The current call model allows type/point combinations independently.
- Anticipated future color persistence: default fencer/team colors (source model not yet chosen) and a per-match left/right color snapshot or safe equivalent; do not design the log to derive historical colors only from mutable current profile/team settings.
- Timer edits should be durable across checkpoint/reconnect and auditable; do not rewrite initial duration or manipulate every timer display tick as a DB write. Match ID, preset/settings, fencer identity, call chronology, all reversed calls, referee claims and original historical records remain intact.
- The Match Prep → Live Match navigation is a screen/UI state and does not itself require a new table or a separate match schema. The existing "ready/running/paused/ended" states may be extended as needed while preserving legacy records and tournament integration.
- Implementation requires UI reorganization plus a deliberate persistence/API audit for reversible calls, manual score adjustments, card-linked scores, result adjudication and historical snapshots. DB migrations may be needed for reversal attribution, per-call post-score snapshots and later color defaults/overrides; obtain explicit migration authorization separately.

### 6E. Result adjudication, penalty cards and Admin Mode score adjustments — APPROVED 2026-11-06 (not yet implemented)

RESULTS ON COMPLETION
- When a referee confirms Match Complete, compute the initial win/loss/tie outcome automatically from the ACTUAL effective scoreboard totals, regardless of whether the match ended because time expired, target was reached or the referee finished it manually. Left higher = left victory/right defeat; right higher = right victory/left defeat; equal scores = tie, subject to existing elimination-round winner requirement. Do not record an ordinary non-tied manually completed bout as incomplete just because its end_reason is 'manual'. This explicitly supersedes the previous unresolved manual-finish decision.
- Admin Mode layout: place ONE clearly grouped, centered outcome selector underneath/between the fencer score areas, headed "Assign Winner". Show exactly FOUR primary buttons in this group, horizontally in the order [← Left fencer victory] [Draw] [Incomplete] [Right fencer victory →], with the two victory arrows visibly pointing toward the corresponding fencer. Use actual competitor names/accessibility labels for the victory actions where space allows. On narrow screens, wrap or stack while preserving the left/center/right associations. Do NOT put separate Assign Victory buttons next to the fencers or scatter Draw/Incomplete across the overlay. These are WINNER-ASSIGNMENT arrows, distinct from the separate score-adjustment up/down arrows immediately beside each score. The group is hidden outside Admin Mode, keeping ordinary Live Match minimal.
- The two victory choices and Draw explicitly override the score-derived official result without changing scores or inventing scoring calls. Incomplete does NOT declare a draw or finalize a result: it keeps the bout saved but unfinished, paused, and eligible for later continuation or correction. Indicate the currently selected/adjudicated outcome within the group. Require confirmation before changing an already finalized bout to Incomplete, and audit each decision with actor, time, original score-derived result and new selection. A secondary "Use Score Result" reset action, if supplied, belongs outside these four primary buttons and clears an explicit victory/draw override.
- Draw is a COMPLETED official tie: no winner, both fencers receive a draw/tie in derived statistics, and no win/loss is recorded. It may be chosen as an explicit override even when scoreboard points differ; history and standings must show both the actual scores and the referee-designated draw. Incomplete is NOT an official result: keep the current scores, calls, time remaining and full audit trail, but exclude the bout from wins, losses, draws, completed-match counts and bracket advancement until finalized. It should appear as Incomplete in match/event history, allow reopening/continuation with the existing referee-claim rules, and never be confused with an equal-score draw. Knockout progression still requires an assigned winner; Draw or Incomplete cannot advance a knockout match.
- Prevent score edits and result overrides from silently disagreeing: ordinary score edits recalculate the score-derived outcome. If a referee has explicitly set a result override, preserve it as an explicit override until they change/clear it; prominently show that it differs from the calculated outcome.

CARD-ASSISTED OPPONENT SCORING
- Place a small Yellow Card and Red Card button associated with EACH fencer on the Live Match screen or its compact Admin controls. The fencer associated with the card is the SANCTIONED fencer.
- Choosing a card arms a visible pending card for that fencer. The NEXT actual +1/+3/+5 scoring action FOR THE OPPOSING FENCER is attributed to the card rather than an ordinary hit. Pressing a card by itself does not award any points, consume time or guess the penalty's point amount; the referee still selects the opponent's scoring button to determine whether 1, 3 or 5 points are credited. Keep the fixed +1=Indirect, +3=Clean Hit, +5=Counter button layout for simplicity, but preserve the separate card reason in the underlying log rather than presenting it as a normal hit.
- The card marker is linked to the sanctioned side, credited side, selected value, color of the credited player, original time, acting referee, and the resulting scoring event. Log examples: "Yellow card on Ari → Jordan +3 → 8 to 8". These card-derived points count toward the scoreboard/target unless later reversed. Reversion preserves both card provenance and reversing actor in history.
- Provide a visible pending-card state and a clear way to cancel an accidental selection without awarding points. Do not transfer a pending penalty to a same-side score. Handling multiple simultaneous pending cards, replacement versus stacking, and official card-rule point limits must be explicitly validated during implementation; don't invent competition penalties or automatic card points.
- Any pending card state should survive non-destructive UI navigation and recovery where practical, or clearly warn before discarding it. Prevent a referee from unwittingly scoring an ordinary hit when a penalty is armed.

ADMIN MODE SCORE ARROWS AND AUDITED DELTA
- Show small UP and DOWN score-adjustment controls immediately beside each fencer's numeric score only when Admin Mode is active; these must not be confused with the separate LEFT/RIGHT winner-selection arrows in the centered "Assign Winner" group. Ordinary Live Match remains a clean display. The Match Admin control surface is a referee/match-management mode, not automatically a grant of the application's sole Admin account role; actual authority must remain protected by current authenticated match-controller permissions.
- Entering Admin Mode pauses the timer safely. Snapshot both authoritative effective scores and the current match revision at entry. Pressing an arrow adjusts the corresponding displayed score by exactly one point for each press; no negative scoreboard values. These edits are STAGED while the mode is open and must be visibly distinguishable from committed scored hits.
- On closing/applying Admin Mode, compare staged left/right scores against the saved entry snapshot. If unchanged, add no score adjustment. If changed, commit ONE atomic, attributed admin-override operation that captures BOTH old and new scores, left and right signed deltas, actor UUID, UTC timestamp, and the matching reason/category "Admin override". Example: old 8–5 → new 10–4 yields left +2 and right −1 in one grouped log event. Do not generate spurious +1/3/5 Indirect/Clean/Counter hit events to explain administrative deltas.
- Reflect the final corrected scores everywhere (live display, Match Report, historical stats, match completion/target logic, event standings). Keep existing hit and reverted-hit records immutable; admin override is an additional ledger operation and must not rewrite prior historical post-hit score snapshots. The adjustment log can be reversed/corrected only with another explicitly attributed operation rather than being silently deleted.
- A save/revision conflict or network error must not close the panel and falsely claim success; keep the staged change available for retry or explicit discard. Restore the normal Live Match view only after the authoritative save succeeds. After Admin Mode closes, the timer stays paused until the referee starts it.
- Recompute the score-based default winner from effective totals (including admin adjustments); an explicit result override, if present, remains separately distinguishable. Match Complete still requires its own confirmation.

DATABASE AND READ-MODEL REQUIREMENTS (no migration applied)
- Existing tTraditionalMatch.duration_ms, remaining_ms, target_score and tTraditionalCall.is_reversed continue to meet timer/target/reversal requirements. Ordinary tTraditionalCall points are CONSTRAINED to 1,3,5 and call_type to indirect/clean/counter, so negative/other admin score adjustments cannot be stored as ordinary calls without an intentional schema change.
- Add an append-only match score-adjustment event/ledger (recommended) or an equivalent versioned event model with match ID, both old/new totals, signed per-side deltas, actor/time, active/reversal state and event ordering. Update transactional saving, calculated scores, score-to-win detection, reporting, aggregate views and tournament propagation to consume this ledger consistently and without double counting. Keep prior records and support existing match history.
- Preserve card reason separately from the original scoring category, with sanctioned_side and credited_side/points tied to the affected score-call ID. DB change likely needed (additive metadata/table) for durable, auditable card provenance.
- Persist explicit outcome overrides (left victory, right victory or Draw) separately from score-derived winner, end_reason and finalization state. Incomplete must be a first-class unfinalized match status/operation rather than an outcome equivalent to Draw; re-opening a previously completed match for correction/continuation requires a guarded, audited status transition and preservation of earlier completion versions. Modify vMatchResults because it currently forces end_reason='manual' to outcome='incomplete'. Downstream fencer statistics/standings must use the adjudicated result only for FINALIZED bouts, exclude all Incomplete bouts from wins/losses/draws and advancement, and support Draw with non-equal actual scores.
- Ensure reversal audit and score-snapshot work described in §6D remains compatible with card-linked calls and admin adjustments. Schema additions are proposals until separately authorized; design edits do not authorize DDL or application releases.

IMPLEMENTATION ACCEPTANCE
- Manual completion at 8–5 produces a left win by default; 5–8 produces a right win; equal scores produce a completed Draw (except elimination winner resolution). Assign Victory overrides the calculated winner without altering scores; explicit Draw produces a finalized draw even for a non-tied scoreboard when permitted; Incomplete saves an unfinalized paused match and credits neither a win, a loss nor a draw.
- Arming Yellow/Red on one side marks the next score awarded to the opponent with card metadata, not an instant point award; reversal preserves its history.
- While Admin Mode is open, score arrows change preview totals only; on close, a correct, atomic override records signed deltas and author even if one side loses points; on refresh/report/standings the same effective scores and adjudication appear.
- Existing automatic checkpoint, referee-lease and corrected-call audit guarantees must hold after the redesign.

Implementation acceptance (including §6E): Starting a single match first displays Prep; confirming displays stopped full-screen Live Match; timer tap toggles running/paused; while paused +1/+3/+5 creates correct call types on the right side; Manage edits time, shows score-after-call log with colors where supported, and confirms durable audit-safe reversals and manual completion; all remains consistent through refresh, multi-device conflicts, finalization and Match History.

### 6F. Match redesign gap and dependency audit — 2026-11-06

The following items are NOT approvals to change the database or existing game rules. They document unresolved behavior and implementation requirements discovered while reconciling §6A–6E with the live code and database. Address the high-impact decisions before the final implementation specification; other items can use safe defaults and be validated during testing.

Product behavior requiring a clear decision before release:
1. AUTOMATIC STOP vs FINALIZATION. At time zero or Score to Win, the clock should visibly stop and show the ending reason as already required. Clarify whether that automatically FINALIZES the match's statistical result or leaves a pending completion screen until the referee presses Match Complete/Report. Never publish an official result twice or strand a finished match without a way to finalize. A manually pressed Match Complete always requires confirmation. Recommended: stop/lock the clock on limit, show provisional score-derived outcome, and finalize only after explicit completion; preserve the scoreboard until Report.
2. ADMIN MODE PERMISSIONS. The user calls it an "admin button", while the app has one special Admin role and multiple Management/referee users. Decide whether any authenticated referee currently holding the match claim may use Admin Mode (suggested), or whether account-level Admin approval is required for score/victory overrides. Enforcement belongs in the server policy, not only UI.
3. MATCH LIFE CYCLE. Define what a referee sees and can do after choosing Incomplete, after changing a previously completed match to Incomplete, and after resuming a time-expired or target-reached match. A saved Incomplete match must never be counted as a result or advance a bracket. Reopening a completed bout must preserve prior finalization snapshots and require correct permissions.
4. CARD PENDING-STATE SEMANTICS. Confirm what happens if multiple Yellow/Red cards are armed (one per sanctioned fencer, replace last card, or queue), and whether a referee can apply a card while the timer runs. Existing design says a card arms the next opponent score, never grants automatic points. Card-derived scoring category vs penalty reason should remain distinguishable in history and aggregate reports.
5. RESULT OVERRIDE VALIDATION. A referee may select Draw or assign either victor despite numerical score, but knockout matches still require a winner to advance. Decide whether the UI merely warns on forbidden Draw/Incomplete at knockout finalization or blocks submission until resolved. Recommended: permit saving an unfinalized bout, reject Draw as an officially advancing knockout result.

Implementation dependencies / safe defaults to test:
6. SCORE-LEDGER CONSISTENCY. The current DB permits ordinary calls of only +1/+3/+5 and excludes is_reversed calls from score views; it cannot directly represent negative Admin adjustments or card provenance. Implement an append-only adjustment ledger (or equivalent), add/reconstruct reversal attribution, and update vMatchResults, vFencerResults, vFencerStatistics, vFencerScoring, standings, exports and the history UI so ALL displays agree. Handle migration of existing matches without modifying historical score calls.
7. ADMIN MODE COMMIT SEMANTICS. Store preview deltas and outcome selection against the same authoritative match revision; apply them atomically on exit/confirm, report save failures and allow Cancel/Discard. If score changes cross the target threshold or time is edited to zero, show the resulting phase change before finalization; don't silently re-run the clock. Ensure adjusting scores after card-derived points/reverts does not rewrite prior log snapshots.
8. TIMER BOUNDS AND RECONNECT. The hosted match_bounds CHECK currently requires remaining_ms between zero and configured duration_ms. If referees need to add time BEYOND the original duration, a deliberate policy/schema change is needed. Use normalized minutes/seconds, bounded controls, server-validated paused-only edits and explicit zero-time behavior; preserve checkpoints and exclusive referee lease on refresh/offline recovery.
9. EXPLICIT CONFIRMATION / ACCIDENT PREVENTION. Confirm Revert and Match Complete, visibly differentiate result overrides from score correction, offer an accessible Cancel for an armed card, and prevent accidental double taps or keyboard shortcut collisions on mobile/tablets. Keep the live scoreboard focused; Admin Mode should not auto-resume the timer.
10. COLOR SCOPE AND LEGACY FALLBACK. The eventual fencer/team default colors, match-level overrides and persisted historical color snapshots are not yet in the schema. Until implemented, use clear neutral/left-right distinction and never rely on color alone in the score log. Future colors should not block the initial two-screen rebuild unless specifically prioritized.
11. EVENT INTEGRATION. Reuse the live Traditional component for registered event bouts, but preserve group-tie and elimination-winner rules, manual bracket advancement, archived-generation exclusion and event finalization snapshots. Verify that match outcome overrides, Incomplete bouts and score adjustments cannot prematurely propagate bracket winners or corrupt completed standings.

## 7. Page 5 — Manage Events and Teams

- Each event has a name, Traditional or Control Point scoring mode, individual OR team competition format (not mixed in one event), optional dates, description and compatible default preset. Venue/organizer/event-image extras are outside the initial editor.
- Authorized managers transition event status manually through Draft, Active, Completed and Archived, and may reopen Completed with an audit; reopening must not silently erase prior finalization/history.
- Individual events register existing fencer UUIDs; generic Unregistered or free-text entries are not allowed in event matches.
- Teams have reusable identities. Event participation is stored separately, and event-specific rosters are not inherited automatically from global team membership.
- One fencer may be on multiple teams within an event. Future team bouts must explicitly identify which team each fencer represents on each side, retaining that team identity even when rosters change.
- Events choose compatible default presets; a specific match/phase may override preset and effective settings while retaining a snapshot.
- Reusable teams and per-event rosters can be managed now, but team-match scoring, team standings and Control Point play are NOT implemented. Do not present roster preparation as functional team fixtures.
- Team and event record management must follow §2A, with list/lookup screens separate from Create/Edit/Archive confirmation pages. Keep event execution, fixture scheduling and live scoring operational workflows distinct.

Implementation: Event records, status, registration and reusable team/event-roster preparation are deployed. Individual Traditional events are the initial executable format. Verify activation/completion/reopen/archives with real data.

## 8. Page 6 — Run Event

- Group-to-bracket progression is explicitly managed. Management creates groups and manually assigns competitors; do not auto-randomize group membership.
- Group matches are round robin within the selected group. Management can also create manual pairings, select compatible presets for phases or matches and reconcile incorrectly entered bouts.
- Show each group's standings. Management decides how many people advance and manually selects the actual qualifiers and their placement/seeding; no implicit top-N automatic qualification.
- Bracket choices include single and double elimination with appropriate byes, winner/loser progression, conditional grand-final reset and manual editable placements before matches begin.
- Generating a bracket creates scheduled match records in advance, with no played calls/scores and no started_at or ended_at play timestamps. Creation timestamps are normal and distinct from play timestamps.
- Regeneration archives the ENTIRE old bracket generation and its generated matches, including completed bouts, then creates new scheduled records. Old results and audits remain accessible but must not count in the active bracket/standings. Handle active referee claims safely.
- Multiple separate event bouts can run simultaneously; one active controller per bout. Referee tiebreak winner selection is required to complete an elimination tie; no automatic unapproved overtime/rematch procedure.
- Completed eligible results update live group standings without a second manager approval. Wins always rank first. Global ranking configuration can order point differential and total points as secondary criteria. Equal criteria may remain tied; Management manually selects qualifiers rather than assuming an automatic resolution.
- Completed events freeze a result/standings snapshot with the ranking rules then in effect. Reopen/re-finalize generates an audited new version, never a silent recalculation from later global rules.
- Precise head-to-head rules, multiple-way head-to-head, incomplete-schedule ranking and team/Control Point fixtures remain deferred.

Implementation: Individual Traditional round robin, manually selected bracket advancement, single/double elimination, archival regeneration and frozen finalization are deployed. The tournament simulations cover 2–128 entrants, but live end-to-end group/bracket use still needs review.

## 9. Page 7 — View History

- Event History: full event metadata, groups/phases/participants, event rosters, match links, brackets including archived prior generations, group standings and finalized snapshot versions.
- Match History: detailed report of settings/preset snapshot, participants, chronological ordinary and card-linked scoring, reversed-but-retained entries, admin score-adjustment deltas (before/after totals and actor), explicit winner/no-victor adjudication, original post-call left/right score snapshots, reversal actor/time, timer edits, timestamps, referee attribution and corrections/void/archive history. Include standalone and event-linked matches and side/competitor colors when implemented.
- Fencer History: overall performance with separate event and standalone summaries; current profile name by UUID, original name snapshot for provenance. Exclude generic Unregistered from personal aggregates.
- Archived and voided records are hidden from normal active queries by default, available through an explicit toggle/filter with recognizable status.
- Immutable audit records should show actor UUID, UTC timestamp and old/new values where applicable. Archive or regenerate without destroying evidence of prior completed bouts.
- Finalized historical standings use the frozen result and rule snapshot instead of current global ranking settings; reopening creates a new auditable version.

Implementation: History, linked detail and statistics views are deployed. Validate real browse/search filters, current-name resolution and corrected scores.

## 10. Page 8 — Configuration

- Both Admin and Management may edit ordinary application-wide configuration; this does not grant Management Admin-only account-policy or destructive privileges.
- Global standings criteria: wins are always primary; current secondary supported choices are point differential and total points, reorderable globally by authorized managers. No selected default secondary priority is assumed here. Head-to-head is not presently implemented.
- Keyboard mappings are one shared configuration, not per-account. Audit changes, prevent conflicts/reserved shortcuts and freeze mappings at the beginning of a match so later changes cannot surprise a referee mid-bout.
- Each reusable team has one main image shared across its events. Support authenticated private uploads and HTTPS external image URLs; validate type/size and protect Storage access. No event-level logo override in initial scope.
- Shared configuration modifications require an audit record with actor, timestamp, setting identifier and before/after state. Previously finalized standings retain the then-current configuration version.

Implementation: Shared keyboard mappings, secondary ranking configuration, team image sources and audits are deployed; validate real images, URL behavior and device keyboard interaction.

## 11. Outstanding work: active verification vs product decisions vs deferrals

Approved Match Prep / Live Match redesign awaiting implementation (not deployed, not a deferred feature):
- Implement §6A–6F: Match Prep, minimalist Live Match and the Manage/Admin Mode surface, including tap-to-toggle clock, fixed +1 Indirect/+3 Clean/+5 Counter quick-score controls, timer arrows, score correction up/down arrows, card-armed opponent scoring, durable colored/reversible log, and a CENTERED "Assign Winner" group of four buttons [← Left Victory] [Draw] [Incomplete] [Right Victory →] under the scoreboard, plus report/recovery integration. The deployed client still uses the original combined setup/live page and 3×3 grid.
- Existing match duration/target/remaining columns suffice. Implementation additionally requires durable card provenance, actor-attributed call reversal metadata, per-call historical score snapshots, and a separate admin adjustment ledger or equivalent (the existing call points CHECK only accepts 1/3/5). The outcome/read-model layer must also stop marking every manually ended match incomplete and support explicit victory overrides. Consider later color snapshots. NO schema migration, code deployment or DB mutation is authorized by this document update.
- Test paused-only scoring, timer corrections, penalty attribution on opponent score, signed admin delta on mode exit, audit-safe reversal and outcome override, refreshed playback, finalization/standings propagation and multi-device referee leases after implementation.

Approved management-page UX work awaiting implementation (not deployed and not intentionally deferred):
- Apply §2A to Users, Fencers, Teams, Match Presets and other record-management pages: searchable/sortable/filterable lookup tables; notes accessible on hover/focus/touch; row navigation actions; separate labeled Create/Edit forms and dedicated Archive/deactivation confirmation screens. Existing mixed lookup/editor screens still need refactoring. No schema migration or deployment is authorized by recording this design.

Active verification/operational follow-up (not new design scope):
1. COMPLETED AND VERIFIED: The owner successfully completed a new-account invitation and password reset with the current production settings. No email-ready flag change, SMTP setup or old no-email hook restoration is required.
2. Walk through remaining account controls: Admin invitation pause, Management permissions, disabled-session denial and protected routes. Invitation delivery, invitee account setup and self-service password reset have already been tested successfully.
3. Execute a registered and unregistered standalone bout through calls, corrections, timer end, manual stop and Match Report; verify statistics and history.
4. Test refresh/offline retry, stale referee lease and simultaneous control of the same bout versus two distinct bouts.
5. Run real individual Traditional events with groups, manual bracket placement, elimination, regeneration/archiving, finalization and reopened history.
6. Check fencer/preset archive, team logo upload, global keyboard mapping and configuration/history audits on mobile and desktop.

Open product decisions (do NOT resolve by assumption):
A. RESOLVED: Match Complete derives win/loss/draw from final effective scores, including manual completion. In Admin Mode the single centrally aligned "Assign Winner" group has four buttons in order: [← Left Victory] [Draw] [Incomplete] [Right Victory →]. Draw = completed official draw; Incomplete = saved/paused/unfinalized without credited win/loss/draw. Victory arrows point to their corresponding sides and are NOT score adjustment arrows. The existing server still needs to implement this behavior.
B. Final global secondary tiebreak order: point differential versus total points. Wins remain first. Head-to-head is postponed.
C. Final timer-edit bounds and zero-time behavior, and whether Manage auto-pauses an active clock (safe UI default proposed in §6C). These are implementation details not yet explicitly confirmed.
D. Color defaults/ownership for fencer vs team and default values before optional per-match overrides are introduced; preserve historical snapshots even if coloring is delivered in a later phase.
E. Card rule detail: whether multiple simultaneous armed cards should replace or stack, and whether red/yellow colors have any point restrictions beyond the referee-chosen +1/+3/+5. Do not invent competition penalties.

Intentionally deferred features (not initial Traditional-workflow blockers):
- Control Point match scoring and team fixtures.
- Traditional team match execution, explicit team-result attribution processing and team standings.
- Head-to-head/multiway tie logic and detailed overtime/round rules beyond referee-selected elimination winner.
- Cross-mode reuse of one team UUID; teams remain mode-specific until separately approved.
- Optional spectator/overlay displays and other future mode-specific extensions.

## 12. Change discipline

When a decision or implementation changes: revise the relevant page, update this status/decision register, preserve the relevant rationale and PR or migration reference, sync the shared Google Doc and repository copy, and record unverified downstream workflows. Keep deprecated pre-migration audit notes in version history and separate historic references, not as false current blockers. No infrastructure changes, schema migrations or code deployment are authorized merely by editing this specification.
