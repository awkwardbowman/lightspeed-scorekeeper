# PR #8 planning — UI consistency, management pages and match presentation

Status: DESIGN DRAFT ONLY (November 6, 2026); no PR opened, no application code changed or deployed. Expected next PR number is #8 because #7 is latest merged; verify numbering before opening. PR #4 closed without merge; PR #5, #6 and #7 merged.

Canonical scope and acceptance criteria: [DESIGN.md §14](DESIGN.md) and [shared Google Doc](https://docs.google.com/document/d/1IvEPsjjLwE98B7_M6Qqg8PfcJ8aMCHCxpBAYFXsJW7k/edit).

## Proposed implementation scope
1. Shared dark-navy / warm-amber theme tokens and unified Primary/Secondary/Quiet/Danger buttons; Title Case headings; single Cancel.
2. Responsive, full-width management and history filters/tables; ID-first order, right-aligned bordered action buttons; Users separate Email and Role; Fencers no Notes table field and partial Name/Affiliation search.
3. Events date-only Start/End; dedicated Manage Teams top-level navigation; event-specific participant/roster links without mixing entity lookup and edits.
4. Match Prep with Left/Right Fencer row and Settings group; preset selects locked Length, Score Target and Match Type; Custom clears/enables; remove Round/Bout; Start Match and Cancel.
5. Live headline more prominent than names and timer; score buttons bottom corners and Manage centered above saved status. Manage transitions directly to the same full-screen scoreboard in editable Admin Mode: left log rail (newest first, viewer-local time, confirmed reversals), center score/time preview with original values and per-section Apply controls, right current-fencer/current-event card-history rail, per-fencer Penalty popup, winner declaration and bottom Resume (returns without restarting clock). Preserve sensitive actions, match lifecycle and audit; see DESIGN.md §14I.
6. Breadcrumb separators at every depth. Readable Match History listing, winner-aware bolding, table/filter cleanup. Fencer History redesign deferred.

## Approved preset model change and save guarantees
Approved: add match_type (Standard/Knockout) to tMatchPreset, separate from scoring mode; update preset Create/Edit and database/API constraints with legacy fallback (Standard for standalone suggested), preserve authoritative event bracket type and effective match snapshots. Existing referee claim, cards, ledger, stats, knockout, audit, and hosted migration protections must not regress. Use selective tests for UI edits; any preset schema/backend change requires full regression and hosted acceptance.

## Deliberately separate later scope
- No “Sync Local Files” feature (explicitly rejected). Use the shared Supabase database as authoritative; retain only normal acknowledgement, fail-and-retry/idempotency protections and existing minimal lost-response recovery. Match Prep recovery field is removed; no offline-first mode.
- Admin Mode layout and behavior are now included in PR #8 (§14I). Specific pending UI decisions: placement for Incomplete, Match Complete / Match Report / Match Settings, and Apply for outcome/target changes. Do not drop these capabilities when simplifying navigation.
- Fencer History redesign and larger individual event-detail/navigation restructuring if required.
- Deferred team/Control Point scoring.

Implementation should follow this living file and update the canonical DESIGN.md plus shared Doc as decisions are revised. Keep completed/merged features out of the active backlog, but preserve unverified hosted acceptance separately.
