# Lightspeed Scorekeeper — MVP Design

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
