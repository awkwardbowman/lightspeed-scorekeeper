# Lightspeed Scorekeeper

A lightweight, responsive scoring app for Lightspeed-style lightsaber fencing matches.

## Start the app

Install [Node.js](https://nodejs.org/) (current LTS), then from this folder:

```bash
npm install
npm run dev
```

Open the local address that Vite prints (usually `http://localhost:5173`).

## Deploy

Push this project to `awkwardbowman/lightspeed-scorekeeper`, then in Vercel select **Add New → Project → Import Git Repository**. Framework should auto-detect as **Vite**; build command `npm run build`, output directory `dist`. No environment variables are required.

## Scoring

1. Enter fencer names and optionally match/event/round details, set duration and optional target score.
2. Start the timer. Pause before making each call.
3. While paused, record an indirect, clean hit, or counter worth 1, 3, or 5 points for either fencer; resume.
4. The match ends when time runs out or a target score is reached. It remains on screen until you select **Match report**.
5. View category counts, export CSV, or print the report.

The match is saved in your browser only; this is not multi-device synchronization. Starting a new match **replaces** the previous local match. Export first.

Detailed scope and future enhancements: [docs/DESIGN.md](docs/DESIGN.md).
