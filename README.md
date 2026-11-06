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

## Cloud match storage (optional)

The app runs locally without cloud credentials. Supabase adds email sign-in,
manual save of the current Traditional match, and loading saved matches on
another device. The timer is **never** resumed automatically by a cloud load.

1. Install dependencies: `npm install @supabase/supabase-js` (commit both package.json and package-lock.json).
2. For local testing, copy `.env.example` to `.env.local` and fill in the **publishable** Supabase key from Project Settings > API Keys. Never use service role/secret keys in a Vite app.
3. On the Supabase Auth > URL Configuration page, set Site URL to `https://lightspeed-scorekeeper.vercel.app` and add `http://localhost:5173` to the redirect allow list. Add a different localhost or preview URL only if you actually use it.
4. The hosted Vercel project already has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured. Push to `main` to build with them.
5. Enter your email in Cloud storage, follow the sign-in link, pause the match, click **Save current match to cloud**, then use **Load selected** to restore it.

Cloud operations currently affect `tTraditionalMatch` and `tTraditionalCall` only.
Future event, roster, team, and Control Point editors will use the same
`src/db/supabase.ts` connection. Cloud saving is deliberately manual; live
multidevice editing and autosave are not implemented yet.
