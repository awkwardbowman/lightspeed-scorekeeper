# Lightspeed Scorekeeper — Design Specification

Version: 2026-11-06, consolidated following merged PR #1, #2 and #3
Status: Approved product requirements, deployed implementation, pending live acceptance, and approved management-page redesign awaiting implementation
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

- The initial live scoring mode is Traditional. Each side selects a registered fencer or enters an unregistered name. Event matches, by contrast, require registered competitors.
- Traditional calls are Indirect, Clean Hit and Counter; each call may award 1, 3 or 5 points. Preserve both call category counts and point totals in report/history.
- Default clock is three minutes unless overridden by a preset/match setting; optional target score ends the active clock when reached. The time or target completion should visibly change the screen, leaving results and correction controls visible until Match Report is chosen.
- The referee must pause before making a scoring call. Scoring/corrections are not permitted while the clock is running.
- Save each call with attribution, sequence and clock/UTC timing. Allow undo/reversal or correction when paused or ended. Audited completed-match correction must record actor, time and changed values.
- A scored match uses transactional server persistence with revision/duplicate-write protection and periodic or transition checkpoints rather than a write for every timer tick. Refresh must pause, not auto-resume. Preserve/recover user-scoped unsaved snapshots and handle network retry without duplicate calls.
- Only one referee may claim a given match at a time. The server-backed 90-second claim is checkpoint-renewed; after expiry another controller must explicitly recover/take over. Different bouts may proceed on different devices simultaneously.
- Equal scores at natural time expiry may produce a tie in standalone/group play; an elimination match cannot advance tied and must be resolved by the referee's tiebreak decision.
- Current conservative implementation: a manually ended match produces no result, EVEN WHEN one side leads. Whether to award a non-tied manually ended match is still an open product decision; no result means no credited win/loss.
- A match report includes competitors, setting snapshots, individual scored calls and category breakdown, final/partial result, referee attribution and subsequent correction history. Keep CSV/printable export behavior where supported.

Implementation: Traditional scoring, transactional saving, exclusive referee control, recovery and reports are coded and deployed. Verify live timing, pause/call/report flow, offline recovery and concurrent-device safety.

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
- Match History: detailed report of settings/preset snapshot, participants, score/call chronology, timestamps, referee attribution and any corrections/void/archive history. Include standalone and event-linked matches.
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
A. Non-tied manual stop: incomplete/no result versus award to the leading fencer. Current deployed rule is incomplete/no result for every manual stop.
B. Final global secondary tiebreak order: point differential versus total points. Wins remain first. Head-to-head is postponed.

Intentionally deferred features (not initial Traditional-workflow blockers):
- Control Point match scoring and team fixtures.
- Traditional team match execution, explicit team-result attribution processing and team standings.
- Head-to-head/multiway tie logic and detailed overtime/round rules beyond referee-selected elimination winner.
- Cross-mode reuse of one team UUID; teams remain mode-specific until separately approved.
- Optional spectator/overlay displays and other future mode-specific extensions.

## 12. Change discipline

When a decision or implementation changes: revise the relevant page, update this status/decision register, preserve the relevant rationale and PR or migration reference, sync the shared Google Doc and repository copy, and record unverified downstream workflows. Keep deprecated pre-migration audit notes in version history and separate historic references, not as false current blockers. No infrastructure changes, schema migrations or code deployment are authorized merely by editing this specification.
