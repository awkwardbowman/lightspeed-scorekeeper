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
