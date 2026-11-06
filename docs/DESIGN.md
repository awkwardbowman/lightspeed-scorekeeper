# Lightspeed Scorekeeper — Design Specification

## Access policy revision — November 6, 2026

This section supersedes earlier account-creation, password-reset and no-email decisions below.

- Any active authorized Management user or Admin may invite a new Management account by entering an email address. The invite should deliver an account-access link; no manager chooses or receives the invitee's password.
- Every user may reset/change only their own password. Remove Admin reset-other-user controls and server actions. No other-user password may be set through app endpoints.
- Only Admin may temporarily pause or resume creation of new accounts. Enforce this on the server, independently of ordinary shared Configuration permissions. Pausing invitations must not block existing sign-in or self-service recovery.
- Keep public self-registration disabled. App managers do not need Supabase organization/dashboard membership. New accounts always receive Management, never Admin.
- Email was acceptable on the assumption that Supabase could deliver invitations without substantial additional setup. Verified Supabase documentation says its default SMTP sends only to organization-team addresses. Ordinary app-user invites require custom SMTP/email delivery; do not add app users to the Supabase organization as a workaround.
- User authorized free-tier Brevo SMTP setup. Replacement invitation, self-service recovery and Admin pause controls are prepared and locally tested. Production activation is gated on provider signup, sender verification, SMTP configuration and delivery verification.

Source: https://supabase.com/docs/guides/auth/auth-smtp (verified November 6, 2026).



**Status:** Consolidated product requirements, last revised 2026-11-06. This file is the local editable source; a Google Drive copy is published for other agents. Agreed requirements override the historic MVP outline below. No code or database changes are implied by writing this file.


**Shared access:** Google Drive copy: https://docs.google.com/document/d/1IvEPsjjLwE98B7_M6Qqg8PfcJ8aMCHCxpBAYFXsJW7k/edit?usp=drivesdk . This local `docs/DESIGN.md` contains the complete agreed decisions for Pages 1–8, dependency order, database gap analysis, and deferred questions. The supporting `IMPLEMENTATION_PLAN.md` and `DESIGN_DEPENDENCY_AUDIT.md` remain separate for detailed tracking. Keep local and Drive copies synchronized when requirements change; do not attempt GitHub writes without explicit approval.


**Non-negotiable constraints:** Keep the application on free tiers; only one Admin; exactly two roles (`admin`, `management`); shared records with management CRUD/archive and Admin-only permanent deletion; mandatory authentication; no public signup; and preserve historical match results and attribution. No Google OAuth dependency.


**Important definitions:** An application Management login is not a fencer. Registered fencers use stable UUIDs; typed names in standalone bouts use a generic reserved Unregistered fencer identity, and this identity cannot accumulate personal stats. Match presets are global, belong to neither users nor fencers, and events can choose a default that referees may override per match. Page 3's last-used preset is a selection convenience, not an application-wide default.


---


## Approved requirements and page-by-page implementation plan


Status: user-reviewed requirements; implement pages in dependency order. Keep work local until user requests deliverables. No GitHub write attempts; use Supabase only for explicitly approved DB changes. Free-tier-only constraint.


### Order
1. Account & Manage Users
2. Manage Fencers
3. Create Match Preset
4. Run Single Match
5. Manage Events & Teams
6. Run Event (selection → matches → standings/team history → brackets)
7. View History (events, matches, fencers)
8. Configuration (team images, key mappings, other preferences)


### Page 1: Account & Manage Users — decisions confirmed
- Two application roles only: Admin (sole user, designated owner) and Management.
- All Management and Admin accounts share records throughout the app.
- Management can create, edit, archive; permanent deletion only by Admin.
- Admin creates Management users using temporary passwords; force password change on first sign-in and after reset.
- Every page requires authorized login; no guest mode; no public registration.
- Password resets are admin-managed only via new temporary passwords; no recovery emails.
- Disabled users lose access immediately, including existing sessions; enforce server side and database RLS, not just page hiding.
- Login identifier is email; email delivery not required for this flow.
- Required display name; stable Supabase Auth UUID is the foreign key, not email.
- Admin may choose generated or manually entered temporary password.
- Management user can edit own display name; Admin can edit all display names.
- Login email changes are Admin-only.
- Record administrative actions (create, reset, disable, enable, etc.).
- If deleting a Management user, preserve historical records and original-user attribution. Requires avoiding cascading auth.users hard deletion; use an archival/tombstone strategy with retained reference ID or historical snapshots. Determine precise implementation before writing destructive code.


### Back end
- tUser exists, and the one account has been promoted to Admin.
- tMatchPreset and tEventTeam created and verified with RLS.
- Existing owner_id RLS needs shared-management policy work (and immediate disabled-account denial) before enabling multiuser app.
- Secure user creation/password reset should be implemented in trusted server/edge function, never embed admin service key in browser.
- Current app /account and /users are scaffolds, and the existing CloudPanel supports email magic-link login. Replace/consolidate auth safely.


### Page 2: Manage Fencers — decisions confirmed
- Fencer records are independent of Management login accounts; there is no account-to-fencer relationship.
- Basic profile: required display name; optional club/affiliation and notes.
- Duplicate display names are permitted. Distinguish fencers via stable UUID, never by name.
- Historical displays show the fencer's **current** display name, resolved by fencer ID. Match snapshots may be retained for audit/fallback but are not the preferred historical display.
- Automatically calculate match counts, wins/losses, scoring breakdowns, and historical summaries from match records.
- **Wins (and preferably other derived fencer statistics) must be calculated in PostgreSQL views, not stored as mutable counters on tFencer.** Views should count only eligible completed match results; ties, canceled bouts, incomplete matches, and event-vs-standalone attribution need explicit policies when implementing the reporting queries. Use PostgreSQL 15+ `security_invoker = true` for public-facing views so underlying tables' RLS continues to apply. Verify views do not leak disabled or unauthorized users' data. No views created yet: design decision only.
- Management can archive fencers; archived fencers stay visible in history, are excluded from active pickers by default; only Admin may permanently delete records, preserving historical attribution where relevant.


### Page 3: Create Match Preset — decisions confirmed
- **Traditional mode only** for the initial preset editor; the database enum and schema support future Control Point expansion, but do not expose Control Point preset editing yet.
- Initial properties: required name, Traditional mode, default duration, optional score-to-win/target score. Defer overtime, round structure and advanced rules.
- A **shared/global preset library** accessible to all authorized management users; usable for standalone and event matches.
- **Remember the last-used preset**, rather than configuring a default preset. Exact scope (per user/device vs globally) needs a later implementation decision; recommend per authenticated user.
- A match stores a **snapshot of applied settings**. Later preset edits never rewrite historical match timing, targets, or other applied rules. A nullable `preset_id` can retain provenance, but match settings remain authoritative.
- `tMatchPreset` already exists with `mode`, `name`, `duration_ms`, nullable `target_score`, `settings`, timestamps, and `is_default`. With the chosen last-used behavior, do not rely on `is_default`; plan for a per-user most-recent selection preference if persistent across devices.
- Share preset CRUD under the common Management data-visibility decision. Archived presets should not appear in active pickers, but remain referenced in historical match records.


### Page 4: Run Single Match — decisions confirmed
- In a standalone match, each competitor field must permit either **searching/selecting an existing registered fencer** (store their stable UUID) OR **typing an unregistered name**. Typed names resolve to **one shared generic "Unregistered" fencer record** (a reserved `tFencer` identity), never to a Management/Auth account. Preserve each typed participant name on the match as `left_name` / `right_name` snapshots, while both foreign keys may refer to that same generic Unregistered fencer UUID. **Two unregistered fencers may fight each other, including the same displayed name; do not enforce distinct left/right fencer IDs for this reserved identity.** Exclude the Unregistered fencer UUID from normal fencer win/loss/per-fencer statistics and any public profile aggregation; its generic identity is not an actual competitor. A registered fencer on the other side still receives appropriate statistics. Do not auto-create new real fencer records just because a name was typed. Resolve how to enforce reserved identity/flag without accidental deletion when implementing the table and match editor.
- This flexibility is **standalone only**. **Every event match must use registered fencer records**; free-text/unregistered competitors are prohibited for event bouts.
- Record each manually typed competitor name with its saved standalone match. It must not be conflated with an existing registered fencer of that name. Statistics for actual registered fencers resolve by fencer UUID, never by text. Standalone bouts with one or two Unregistered participants **are saved in shared match history**.
- Match presets **are not assigned to fencers**. Presets are reusable, global match configuration objects. An event has an assigned default preset; an individual event match may select a different preset before it starts (e.g. special round). Standalone matches use preset selection independently; respect Page 3's remembered-last-used selection decision. In all cases, store a snapshot of actual match settings.
- **A tie is a valid outcome only when the scores are equal and the clock expires.** Manually ending at equal score records an **incomplete/no-result** match, not a tie. Do not credit wins/losses for incomplete matches.
- Referee must pause clock to score; existing per-call 1/3/5 categories unchanged. Authenticated user's UUID should be captured on creation/edits without referee input.
- **Autosave** match progress throughout a bout as well as completed results, with debouncing/transactions so timer ticks do not issue excessive database writes. Never auto-resume a live clock after refresh, and handle network failure/recovery without discarding current in-progress state.
- **Completed corrections** are allowed for Management users, but every correction to result or scoring calls must produce an **immutable audit trail** with actor UUID, old/new values and timestamp; admin has same ability. Recompute stats from current authoritative match data via views.
- **Preset overrides**: after selecting a preset, referees can adjust match-specific duration and target score before start; doing so never edits the shared preset.


### Page 5: Manage Events & Teams — decisions confirmed
- **Competition format:** Support both individual and team-based events, but **each event chooses one format**; do not mix individual and team competitions within a single event. This is separate from the Traditional vs Control Point scoring mode.
- **Reusable teams:** `tTeam` represents a reusable team identity. `tEventTeam` associates a team to each participating event, and a team may participate in multiple events.
- **Event-scoped rosters:** A team retains its identity between events, but its members are specified **per event**, not inherited from a global roster. `tTeamFencer` (global membership) cannot express the selected behavior alone; when implementing, add a relation such as `tEventTeamFencer` keyed to `(event_id, team_id, fencer_id)` with appropriate foreign keys, RLS and checks. Do not silently change the intended event-scoped behavior to fit the current table.
- **Membership multiplicity:** A fencer may participate on **multiple teams within the same event**. Do not constrain `(event_id, fencer_id)` to be unique; validate only that team and fencer belong to the correct event/roster and owner/permissions.
- **Team-result attribution:** For Traditional team events, individual fencer bouts contribute toward team standings. When a participant belongs to multiple teams, **explicitly select the team they represent for that specific match**. Never implicitly credit every team the participant belongs to. Match/result records must retain the assigned team identity independently of later roster edits. Determine standings tie-breaking and ranking rules in Page 6.
- **Event stages:** Draft → Active → Completed → Archived, with **manual** transitions by authorized Management/Admin users. Reopening rules still to decide in Page 6 if applicable.
- **Event fields:** Initial editor covers event **name, Traditional/Control Point mode, individual/team competition format, optional dates, description and a default match preset**; no venue, organizer or event image in first iteration.
- **Presets:** Event selects a default preset, and a different compatible preset can be chosen before any specific event match (e.g. special round). Presets apply to event/match configuration, **never** fencers. Match settings are snapshotted. Initial preset editor is Traditional-only; Control Point behavior needs separate design before activation.
- **Fencer identity:** All event bouts must use registered fencer UUIDs. No typed-name or generic Unregistered participants in an event.
- **Historical consistency:** Event/match results must retain the match-time representing team and the event ID even when team rosters change later. Precise rules for editing finalized event rosters can be refined when implementing Run Event.


### Page 6: Run Event — decisions confirmed (first round)
- Match pairings can be manually created **or** generated automatically. The generation formats and constraints still need to be decided.
- **Parallel match execution** is allowed: separate live event matches on different devices at the same time. Concurrency control for two users opening the same match still needs to be specified; distinct bouts must not share or overwrite live state.
- Traditional event standings are ordered by **number of match wins** as the primary ranking. Secondary tie-breakers and handling of draws / uneven match counts still need explicit definitions. Derive rankings from authoritative match records in PostgreSQL **security-invoker views**, not user-maintained counters.
- Support **multiple bracket formats**: single elimination, double elimination, and round robin. Phasing and automatic propagation/reseeding are not yet specified.
- **Completed matches count immediately** toward standings, with no secondary referee or Management approval. Corrections remain audited and update calculated standings.
- Management may **reopen a completed event**, with an audit trail; do not erase results/history when reopening. Archived-event behavior remains distinct from Completed.
- Continue enforcing Page 5 requirements: distinct Individual vs Team event formats, registered fencers only, event-specific team rosters, explicit team attribution on each team-format bout, and event-level default preset with per-match selection and settings snapshot.


### Page 6: Run Event — decisions confirmed (second round)
- **Single active referee per match.** Individual matches can run simultaneously on different devices, but once a referee starts a particular match it becomes locked against competing scorekeepers. This is principally a safety precaution (user does not expect two referees to use the same bout). Implement an atomic server-side claim/lease; a stale/crashed session must be recoverable without silent overrides. Others can read status/results without controlling the match. Define the lease timeout/takeover UX during implementation.
- **Competition pipeline is configurable group play → bracket placements**, like a FIFA World Cup group stage followed by knockout(s). Group-stage matches are round robin within groups. Event managers control relevant parameters (number and size of groups, group assignment/seeding, qualifiers, bracket format, seeding and applicable presets). Existing promise to support single- and double-elimination remains; treat round robin as a competition *phase* rather than an alternative final bracket. Manual pairing remains available. Do not assume globally random pairings are the normal workflow.
- **Standings ranking:** wins are primary; secondary tie-break priority must be an **application-wide Configuration setting**, not a per-event setting. This global setting should be used by PostgreSQL stats/standings views. Need define how to handle draws, head-to-head among three+ tied participants, differing numbers of bouts and rule changes after event completion. The user has not selected a tie-break sequence yet.
- **Sequential competition phases**, potentially using a different preset per phase and allowing match-specific preset selection/overrides where necessary. Per-event default preset continues to be the fallback. Match settings are snapshotted when a bout is initialized/played so edits to presets do not rewrite history.
- **Manual bracket reconciliation and regeneration.** Management can edit incorrect match data or throw out/reset matches, retaining an audit trail. Management can regenerate a bracket after changes. An initial bracket generation creates all appropriate **match records in advance** with pairings/slots for the bracket but **no scores and no started_at/ended_at** until played. The existing database has separate `tTraditionalMatch` and `tControlPointMatch` tables, not a generic `tMatch`; generated rows should go to the relevant mode table unless a later design intentionally unifies them. Creation metadata (created_at) is still normal and necessary; the user's no-timestamp intent concerns match play timestamps. On regeneration, avoid silently destroying already-played records or losing audits; require clear manual conflict resolution.
- The match lifecycle must distinguish scheduled/not-started placeholders, active referee-claimed bouts, completed bouts, voided/reset bouts, and audit history. Define event phase, group, bracket, slot/seeding and progression references as schema additions when implementing Run Event; do not rely on event_id alone.


### Page 6: Run Event — decisions confirmed (third round, supersedes open questions above)
- **Manual group assignments.** Management assigns registered competitors to groups; do not automatically randomize/seed groups. Group play is round robin *within each manually assigned group*. Configuration of group count/size and scheduling can be provided by Management.
- **Manual advancement from group standings to brackets.** Show each group’s standings and provide controls to select/add individual qualifiers to the next bracket. Management chooses how many and exactly whom to advance; do not auto-select based solely on a fixed "top N" rule. The bracket builder must accept deliberate manual placements and be editable before matches start.
- **Team-competition mechanics deferred.** Teams are primarily for Control Point; do not assert a fully decided Traditional team-versus-team fixture architecture. Revisit before implementing Control Point match processing. Existing decisions about reusable teams, event-specific rosters, multiple memberships and explicit match-specific team attribution still apply.
- **No draws advancing in elimination matches.** A knockout match continues until the referee resolves a tiebreak and supplies a winner. Do not impose an automatic overtime or rematch algorithm absent a later decision; group-stage timed ties remain valid.
- **Regenerating a bracket archives the entire prior bracket’s generated match records (including completed records), rather than deleting them or preserving/reusing them in the new bracket.** Create a *new set* of scheduled match rows, without scores or play-start/end timestamps. Archived old matches remain available for history and audit, but are excluded from active bracket/standings calculations so they are not double-counted. Add appropriate archival identifiers/flags and history relationships before implementing; current match schema needs them. Handle concurrent active matches safely when offering regeneration.
- **Standings primary criterion** is match wins; subsequent priority is globally configured under Configuration, not per event, and still needs a concrete sequence selected. Derived stats/standings from security-invoker views should reflect authoritative non-archived results. An event result should not be changed accidentally by an unrelated preset edit.
- **Status:** Page 6 high-level workflow defined; precise Control Point/team fixtures, tiebreak rules' referee controls, bracket schema and UI can be specified during implementation.


### Page 7: View History — decisions confirmed
- **Event History: full detail.** Show event metadata, competition phases/groups, participants/rosters, group and final standings, each generated bracket including archived prior generations, and individual match results, with drill-downs throughout.
- **Match History: detailed report.** Include final/partial score, each scoring call, chronological match timeline, match settings/preset snapshot, referee/user attribution where recorded, and all subsequent correction/audit history. This applies to standalone and event-linked matches; unregistered standalone fencers retain their entered name snapshots.
- **Fencer History: split statistics.** Show overall performance statistics plus separate **event** and **standalone** summaries and histories. Registered fencers are joined by stable UUID and displayed under their **current** profile display name; unregistered generic identity must be excluded from personal performance aggregation.
- **Archived visibility: toggle/filter.** Hide archived/voided entries from ordinary active or history searches by default, with an explicit option to reveal them and a visible status badge. Archived bracket generations and matches remain auditable and accessible when requested.
- **Frozen historical standings.** Completed events preserve their finalized standings and the exact global ranking/tiebreak configuration used when finalized. Changing current app-wide ranking rules must not silently recalculate completed event standings. At completion/finalization, persist a standings snapshot/configuration version (and participants/result totals) separately from live PostgreSQL security-invoker views; define how an explicitly reopened event is re-finalized with an audit trail. Existing in-progress standings and fencer stats can still be live derived views.
- **Data and display constraints:** use current registered fencer names where UUIDs resolve; preserve original name, scores and preset settings as immutable/auditable match-time snapshots for provenance. Match correction activity should show actor UUID, timestamp and before/after values.
- **Implementation:** Event, Match and Fencer searchable pickers and drill-down routes are already scaffolded; add views, audits and finalized snapshot storage before exposing authoritative historical rankings.


### Page 8: Configuration — decisions confirmed
- **Shared settings access:** Both Admin and Management may change application-wide Configuration. Admin's *exclusive* operations remain account administration and permanent deletion, not ordinary Configuration changes.
- **Global standings tiebreakers:** Match wins are the primary ranking criterion. Authorized users can reorder secondary tiebreak criteria (e.g., head-to-head, point differential, total points) in a single application-wide setting. This is not event-specific. Exact chosen order is a runtime configuration value, *not yet selected*. Define deterministic handling for head-to-head involving multiple tied competitors, draws, uneven numbers of matches, and unresolved equal ranks during implementation.
- **Historical rankings:** A completed event retains a frozen version/snapshot of the ranking configuration and final standings. Later changes to global criteria must not silently modify a completed event. Reopening and re-finalizing an event must produce a new audited snapshot/version.
- **Keyboard shortcuts:** One **global/shared key mapping**, not per-user settings. Changes can be made by Management or Admin, propagate to all users, and should be audited. Validate conflicts and reserved browser shortcuts; live match sessions must not unexpectedly switch their input scheme in the middle of a bout (decide when a changed mapping takes effect).
- **Team images:** Each reusable team has one primary image across all events; there are no event-level image overrides in the initial scope. Support **uploaded files and external image URLs**. File uploads require protected storage, size/type validation, and a relationship to the shared team UUID. URL-based images require safe handling and validation. If a logo changes, existing event team displays use the current team image unless we later decide to retain a match-time logo snapshot.
- **Shared configuration audit:** Record each shared setting change with actor UUID, UTC timestamp, setting identifier, and previous/new values. Retain historical versions for event standings rules.
- **Authorization:** All API/storage operations must check active, authorized accounts; a merely hidden Configuration page is not a security boundary. No paid services.


### Local workspace tracking
- Canonical local planning path: `docs/IMPLEMENTATION_PLAN.md`. No GitHub writes or file output unless the user explicitly requests them.
- Database changes require separate explicit user authorization; current confirmed schema additions include `tMatchPreset` and `tEventTeam`, both created and verified with RLS.
- Full local audit: `docs/DESIGN_DEPENDENCY_AUDIT.md` (schema facts checked against live Supabase on 2026-11-06). Treat it as a design review, not approval to apply migrations.
- **Page 8 reviewed:** Management and Admin can configure shared global tiebreak priority and key mappings; one image per reusable team (uploads or URL); every configuration change is audited.


---


## Database dependency audit and implementation blockers


## Lightspeed Scorekeeper — Dependency and schema audit


**Date:** 2026-11-06  |  **State:** Design review, not a schema migration  |  **Source of decisions:** `IMPLEMENTATION_PLAN.md`


## Conclusion


All eight page scopes have a clear intended dependency order. There are no blocking product questions for starting Page 1 (Account & Manage Users). The *existing Supabase schema is **not** yet compatible with several approved features*, including shared Management access, user deactivation, event-scoped rosters, and a single Unregistered fencer ID on both sides of a standalone match. Plan migrations in the corresponding dependency phase rather than rebuilding the schema prematurely. No migrations or code deployments were performed as part of this audit.


## Immediate blockers — resolve during Page 1 before creating additional Management accounts


1. **Shared data vs owner-only authorization.** The current `tFencer`, `tEvent`, `tTeam`, `tMatchPreset`, `tEventTeam` and match tables use `owner_id = auth.uid()` RLS; `tEventTeam`, `tTraditionalMatch`, `tControlPointMatch` and related relations also have composite `(id, owner_id, mode)` foreign keys. This prevents different Management accounts from editing a common record and may prevent cross-owner relationships. The user explicitly chose shared records across every Management/Admin account. Select and migrate to a shared-scope/tenant identity with a separate `created_by` / `updated_by` actor UUID (or equivalent access-control scheme). Ensure the FKs, uniqueness constraints, CRUD queries and RLS all agree; don't just broaden SELECT policies while keeping owner-constrained FKs. Single shared application scope is sufficient initially; no multitenancy requirement has been specified.
2. **Disabled accounts must lose access even with valid existing sessions.** `tUser.is_active` currently isn't referenced by existing data-table RLS, which tests only `auth.uid()`. An app-side redirect alone cannot prevent direct API requests or invalidate bearer tokens. Apply active-user checks to *every* data operation, protect sensitive server/edge functions, revoke refresh sessions when disabled and validate authorization at request time; design lockout tests with an existing access token. Supabase Auth session revocation alone may leave already-issued JWTs valid until expiry. `must_change_password` likewise needs server-enforced restrictions on ordinary data operations until the password is changed.
3. **Admin-only account management and permanent deletion.** `tUser` currently allows self-read and self-display-name update, not listing/editing other users. Its `display_name` column currently permits an empty string even though the design requires a display name; enforce nonblank names on account creation and at the database layer after backfilling the Admin profile. Secure creation, email changes, temporary password reset, enable/disable and user listing require a server-side Admin-only endpoint. Never expose service-role credentials to browser code. Lock out public signups. Guard sole Admin from being demoted/deleted. The user may select generated or manually entered strong temporary passwords; force change on first use and after reset. The current navigation still has a guest/local route to the standalone scorekeeper; replace the UI guard and protect every data action before allowing other accounts.
4. **Preservation of user attribution vs cascading deletes.** Current `tUser.id` and many record `owner_id` FKs point to `auth.users(id) ON DELETE CASCADE`. Deleting an Auth user can therefore delete profiles and historical domain data, contradicting the explicit preservation requirement. Migrate to a retained/tombstoned user identity or immutable attribution references *before* implementing physical Auth deletion. An inactive user and an archived record are different concepts.
5. **Audits before destructive/corrective controls.** Need a trustworthy append-only account action/audit store (and later match/config action audit). Actor ID, record ID, type, before/after, and timestamp. The admin can archive and permanently delete; Management may archive but not physically delete. Existing table delete policies currently allow owner deletion and do not enforce Admin-only hard-delete rules.


## Page 2 — Manage Fencers


- Existing `tFencer` has id/owner_id/display_name/timestamps only; add optional club/affiliation, notes, `is_archived` (and potential reserved/unregistered marker). Duplicate display names are permitted. Fencers are **not** app-login users.
- **One generic Unregistered fencer UUID** represents every manually typed competitor in standalone match records; preserve their typed names per side on the match. It must be excluded from individual win/loss/profile views. Two generic participants may fight each other. **Actual conflict verified:** `tTraditionalMatch` currently has `matches_no_same_fencer` CHECK forbidding identical non-null left/right IDs. Revise the constraint to allow the reserved Unregistered identity on both sides but still block a registered fencer from facing themself. Do not let admins accidentally delete the reserved identity.
- Historical registered fencer displays resolve current `display_name` by UUID; `left_name`/`right_name` are fallback snapshots for audit/unregistered names.
- Create live computed statistics using PostgreSQL views with `security_invoker = true`; count only eligible current/non-voided results and separate event vs standalone. Distinguish draws and no-results; avoid archived-bracket double-counting. Completed-event final standings are *snapshots* (separate from live statistics views).


## Page 3 — Create Match Preset


- `tMatchPreset` already exists with mode, name, duration, target, JSON settings, `is_default`, timestamps and owner-local name uniqueness. The initial editor is **Traditional only**, but the schema anticipates Control Point.
- Presets are global/shared. Existing `(owner_id, mode, name)` uniqueness and owner RLS must align with the new shared-scope model. No use for `is_default` in the standalone UI (the user chose **last-used preset**); event-level default is stored on the event. Consider a per-user last-used selection so one manager's choice doesn't overwrite another's.
- Add archive/active status. Applied match duration/target remains authoritative even if the preset changes or is archived; record nullable `preset_id` as provenance. Permit pre-match local overrides without mutating the preset.


## Page 4 — Run Single Match


- Existing `tTraditionalMatch` has nullable `event_id`, nullable `left_fencer_id`/`right_fencer_id`, participant name snapshots, timer, target, phase and end reason; current saved calls are in `tTraditionalCall`.
- Standalone matches may select a saved fencer UUID or the reserved generic Unregistered UUID with a typed name. Every event match MUST use valid registered fencers, which requires server-side enforcement (not merely a UI filter). Event fencer selection also needs a registration/membership relationship so a match can verify participants belong to its event.
- Autosave must not write every ~70 ms timer tick. Use periodic/transition/event-driven checkpoints with recovery, conflict control and transactional save of match/calls. The current `saveTraditionalMatch` performs multiple non-atomic client operations, so concurrent devices and corrections can result in inconsistent histories.
- Final outcome semantics: tie only on time expiry with equal scores; manual equal-score ending is incomplete/no-result; knockout must continue until referee resolves tie. A non-tied manually stopped match's final status is not yet expressly defined — ask at implementation if needed.
- Add match correction audit, archived/void state, `created_by`/`last_edited_by`/`referee_id`, and reserved identity exception. Manual edits update derived stats; originally applied settings remain snapshotted.


## Page 5 — Manage Events & Teams


- `tEvent` currently has name, Traditional/Control Point mode, optional dates, description and owner; needs competition format (individual/team), lifecycle (Draft/Active/Completed/Archived), default `tMatchPreset` reference (compatible mode), archived-state metadata, and event finalization snapshot/config version.
- `tTeam` is reusable, with a fixed mode; `tEventTeam` already maps `(event_id,team_id)` and enforces same mode and owner. Since fencer rosters differ across events, existing global `tTeamFencer(team_id,fencer_id)` **does not implement the selected roster behavior**. Add `tEventTeamFencer(event_id,team_id,fencer_id)` (or equivalent relation) with matching parent event/team and membership, without uniqueness on `(event_id,fencer_id)` (multi-team membership is explicitly allowed).
- For individual events, define a direct event registrant table (e.g. `tEventFencer`) so groups and generated pairings can reference registered participants, not free text. For team events, explicit match-side team attribution is needed when one fencer belongs to several teams. Existing `tTraditionalMatch` has no side/team IDs.
- `tTeam.mode` makes the same team UUID mode-specific. If a team should enter both Traditional and Control Point events, that restriction needs a future decision; defer rather than assuming.


## Page 6 — Run Event


- Event-phase schema is absent: plan `tEventPhase` (ordered phases and preset choice), `tEventGroup` with manual assignment, group participants, bracket-generation/version, bracket nodes/slots and match membership or round references. Support manual pairings and generated group round-robin fixtures. Management manually chooses bracket entrants from standings; *no automatic qualifiers*.
- Bracket generation creates scheduled match rows in the appropriate mode-specific table, with no calls/scores and `started_at`/`ended_at` NULL. Existing `created_at` remains populated. Unplayed placeholder slots may require pending opponent references or nullable participant IDs.
- Parallel separate matches are allowed; the same match has one referee claim/lease at a time, with explicit recovery/takeover policy. Implement DB-backed claim atomically; local UI locks aren't sufficient.
- Single elimination and double elimination bracket generation need explicit progression dependencies, winner resolution, losers bracket paths, byes and bracket versioning. A round robin is primarily a group/phase format. Management may edit/void matches with audit; regeneration **archives all matches and the old bracket generation**, including completed ones, then creates fresh match rows; never delete past results. Block/resolve generation while bouts are actively claimed.
- Active standings calculated from non-archived, finalized eligible match data in security-invoker views. Wins rank first; global setting orders tiebreakers. Need to specify interpretation of group draws, uneven game counts and multi-party head-to-head once standings UI is implemented. If event completed, stored standings snapshots and selected ranking-rule version take precedence over live views.
- Control Point team fixtures and referee tiebreak procedure are explicitly deferred; do not claim those mechanics are decided.


## Page 7 — View History


- Existing navigation has Event / Match / Fencer history entry points, but it needs searchable pickers, event phases, groups, brackets and archived generation history.
- Record immutable audit events for score corrections, manual result changes, bracket regeneration, account operations and global config changes. Do not use mutable counters for fencer wins.
- Completed event standings and global-tiebreak config must be frozen as event-finalization snapshots; preserve previous finalizations when a completed event is reopened and later finalized again.
- Archived records hidden by default but accessible through filters; avoid losing registered fencer association after display-name changes or user deletion.


## Page 8 — Configuration


- Application-wide configuration editable by **Admin and Management**, with audit trail. Shared tiebreak ordering (wins always first) and shared global keyboard mappings. Version/snapshot ranking rules on event completion.
- Team image is **one per reusable team**, shared across all events. Accept both uploaded files and external URLs. Files need a protected Supabase Storage bucket, access rules, and MIME/size validation. Consider URL validation and safe image rendering for external links. Existing `tTeam` lacks the image reference.
- Keyboard mapping changes should be checked for conflicting and reserved keys, and shouldn't surprise referees during an active match (apply at next match or after explicit reload is a reasonable default, not yet user-approved).


## Decision questions that may be postponed (not blockers for Page 1)


1. Should the last-used preset be stored separately per user across devices, or just remembered on that device? Recommendation: per-user preference.
2. Specific ordering and semantics for custom global tiebreaks (including draws, head-to-head across three tied fencers, incomplete schedules). Settings editor can expose a list and let Management choose; seed with an initial order to be agreed at implementation.
3. What does a non-tied referee manually ended standalone match mean (valid result vs incomplete)? The only explicit rule is that manually ended *equal* scores are incomplete.
4. Stale referee lock timeout and takeover flow; determine practical reconnect behavior before live multi-device scoring.
5. Team-based Traditional standings and Control Point's detailed scoring/match fixture model are deferred. Don't invent Control Point rules.
6. Whether the same reusable team name/identity is intended to be usable in events of different scoring modes; the current `tTeam.mode` constrains it to one mode.
7. Standings eligibility for previously archived match results and how tie-break-defined knockout continuation is represented in match calls; the intended archiving of bracket generations **must** prevent double counting.


## Verified schema facts (read-only)


- Live Supabase schema checked 2026-11-06: `tUser`, `tFencer`, `tMatchPreset`, `tEvent`, `tTeam`, `tEventTeam`, `tTeamFencer`, `tTraditionalMatch`, `tControlPointMatch` all present, plus three call/time tables. `tMatchPreset` and `tEventTeam` have RLS enabled. This audit made **no schema changes**.
- Existing table RLS mostly uses `owner_id = auth.uid()` and some client-visible DELETE policies; this does **not** yet satisfy shared users, admin-only permanent deletion, disabled-user denial or required-password-change restrictions.
- `tTraditionalMatch.matches_no_same_fencer` check disallows the identical reserved Unregistered fencer ID for both sides. Existing match FK constraints couple participant and event owners to the match owner.
- `tUser.id` and many other tables have `ON DELETE CASCADE` to `auth.users`; incompatible with preserving historical attribution if auth records are hard-deleted without a redesign.


---


# Historic MVP and deployed navigation baseline (superseded where conflicting)


## Product
A referee-operated lightsaber fencing scorekeeper, responsive for tablets, phones, and laptops. The referee **pauses before making a call**. Scoring is never applied while the match clock is running.


## Included in MVP v0.1
- Normal fencing mode (initial mode; other modes follow later).
- Two independently named fencers, optional event and round labels.
- Configurable match length (defaults to 3 minutes).
- Optional target score; match ends when time hits zero **or** a target is reached.
- Three separate scoring categories per fencer: **Indirect**, **Clean hit**, and **Counter**, each available at **+1, +3, and +5** (nine distinct call/value combinations).
- Pause first, then make/referee a call, add a score, resume.
- Distinct match-complete presentation that persists until the user chooses **Match report**.
- Per-fencer score category counts plus point totals in the report.
- Individual scored calls with match-clock and UTC timestamps; removing mistaken calls is permitted while paused or ended.
- CSV export per scored call, browser-printable match report, and local browser auto-save.
- Browser refresh pauses a running match rather than silently allowing it to run without supervision.


## Explicit scope boundaries
- No server, login, syncing, match database, tournament bracket, or multi-device collaboration yet.
- Matches are saved as a **single current local session**. Starting a new match replaces it; export before doing so.
- Scoring categories and +1/+3/+5 values are the current Normal Fencing controls; refactor to mode-specific scoring rules when more modes are implemented.
- No automatic clock stop on hit: referee always pauses first.
- Manual match ending while paused is supported; calls can be undone.
- A target-score ending automatically reopens to paused if undoing a call drops both players below the target.
- A tie at the time limit is shown as a tie; no automatic overtime or tiebreaker logic is assumed.


## Potential follow-up design decisions
- Additional match modes and mode-specific point mappings.
- Editing past calls and adjudicating disallowed/penalty scores.
- Save multiple matches, tournament reports, and roster management.
- Hosted persistence and optional collaborative real-time scoring.
- Referee/overlay spectator display and scoring hotkeys.
- Extend mode-specific rules without losing the distinction between scoring categories and point values.


## Stack
React 19 + TypeScript + Vite 7, browser localStorage; static Vercel deployment.


## Navigation scaffold (MVP v0.3)
- **Dashboard** has eight tiles: Manage Users (Admin only), Manage Fencers, Manage Events, Match Presets, Run Event, Run Single Match, View History, and Configuration.
- **Manage Events** leads to event-scoped Teams and roster management (no global Teams main tile).
- **Run Event** leads to Standings (then Team History), Matches (then Run Event Match), and Create Bracket.
- **View History** leads to Event History, Match History, and Fencer History, each eventually with searchable pickers and detail drill-down.
- **Configuration** leads to Team Images, Key Mappings, and General Settings.
- **Run Single Match** retains the existing Traditional scorekeeper and optional Supabase cloud storage; it currently has no event ID. Its timer stays mounted when navigating away.
- URLs use hash routes so links, browser Back, and refresh work on the current static Vercel/Vite deployment without server rewrites.
- The Admin tile and page are access-limited by reading `tUser.app_role` and `tUser.is_active` from Supabase. No admin CRUD actions exist in the client at this stage; future user management must be implemented server-side with a verified Admin authorization check.
- All other new pages are *scaffolds*, not functioning database editors. Match Preset form is an interactive unsaved preview. Do not imply it has saved anything.
- Existing account sign-in uses email magic link and `shouldCreateUser: false` to prevent the web UI from auto-registering people. Disabling public Auth signups at the Supabase project level and building Admin-managed credentials are separate upcoming tasks.
- Future database work: persist match presets, relate teams and rosters to events, implement read/write editors and policies, and add event-linked match runners. No Control Point gameplay rules are assumed yet.
