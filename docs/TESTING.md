# Scorekeeper Selective Testing Policy

Last reviewed: 2026-11-06. Initial implementation based on application version 0.4.0.

## Purpose

Avoid running every regression suite on every small edit without weakening safety checks for live bout scoring, disciplinary calls, authentication, permissions, persistent history, or event results. **Criticality determines what must be covered when relevant; it does not mean every critical suite runs for an unrelated cosmetic change.**

This policy covers automated *local/CI* verification. Hosted Supabase migrations, trusted Edge Function deployment, and the Vercel application are separate release steps; a green local suite does not prove production was deployed.

## Levels

| Level | Contents | Required for |
| --- | --- | --- |
| T0 Smoke | Production build + tournament and match-command tests | Every code change in normal development |
| T1 Targeted | T0 + changed feature area, cross-feature dependencies, and selected test suites | Normal PRs and focused changes |
| T2 Integration | Production build + all six non-browser test suites | Multi-system features, cross-module refactors, permissions or database contract changes |
| T3 Full Regression | T2 + Playwright browser suite | Major releases, scoring/security/schema changes before production acceptance, or explicit request |
| T4 Hosted Release Acceptance | Targeted manual tests against the exact deployed SHA, migration and functions | Coordinated releases where hosted behavior and permissions matter |

The tiers are **not SemVer numbers**. A patch release touching a scoring permission boundary can still require T3/T4. A minor change to an isolated label might need only T0 plus the relevant browser check.

## Existing suite registry and criticality

| Suite name | Existing test file | Primary responsibilities | Impact criticality |
| --- | --- | --- | --- |
| `match` | `tests/match-redesign.test.mjs` | Ledger, referee claim, points, cards, reversals, retries, overtime, winner corrections | C0 (critical) |
| `database` | `tests/database.test.mjs` | Migrations, shared RLS, audit retention, persistence, permissions, standings | C0 |
| `tournament` | `tests/tournament.test.mjs` | Group round-robin, elimination brackets, byes, grand-final reset | C0 |
| `account` | `tests/account-endpoint.test.mjs` | Invitations, password changes, roles, session/account authorization | C0 |
| `teams` | `tests/team-instances.test.mjs` | Team lineage, cloning, rosters, assignments, snapshots, storage policies | C1 (high) |
| `images` | `tests/image-assets.test.mjs` | Image validation, WebP decoder, upload retry, immutability, error recovery | C1 |
| `browser` | `tests/browser.test.mjs` | Actual UI paths through disposable PostgreSQL/fixture transport, including team/image flows | C0 for changed live-match/auth screens; C1 for other covered UI workflows |

Tests not yet written cannot be counted as passing. In particular, the browser suite is one large integration file, not individual page-level suites, so browser selection currently runs the *whole* browser file. Deferrable Control Point and Traditional team execution remain outside the implemented feature scope.

## Commands

```sh
npm ci

# T0
npm run test:smoke

# T1 — automatically inspect commits vs origin/main plus local tracked/untracked changes
npm run test:changed -- --base=origin/main

# Include Playwright when UI browser coverage is relevant
npm run test:changed -- --base=origin/main --browser

# Manual selection: T0 + affected dependencies
npm run test:select -- --scope=teams
npm run test:select -- --scope=match,events
npm run test:select -- --scope=account,configuration
npm run test:select -- --scope=ui

# Exact tests, without automatic smoke baseline — deliberate override only
npm run test:select -- --only=images,teams

# Preview selection (no build/tests)
npm run test:select -- --scope=match --dry-run
npm run test:select -- --list

# T2 and T3
npm run test:integration
npx playwright install chromium
npm run test:full

# Backward-compatible historical commands:
npm test              # all six non-browser suites
npm run test:browser   # browser only
```

All selector-driven commands run `npm run build` first by default; `--no-build` is intended only for deliberate local debugging. The selector exits at the first failure. Missing Git base refs or unknown source files fall back conservatively to broad tests, never zero coverage. Documentation-only diffs may skip tests entirely.

## Selection rules

- Scoring, referee claims, clock, cards, correction, and live match code: match + database + tournament; browser is relevant.
- Tournament graph: tournament + match + database; browser is relevant.
- Account and Auth: account + database; browser is relevant.
- Teams and event assignments: teams + database + images where logo references/clone behavior intersect; browser is relevant.
- Image pipeline or trusted upload endpoint: images + teams; browser is relevant.
- Events and record relationships: tournament + match + database + teams; browser is relevant.
- History: match + database + teams; browser is relevant.
- Configuration: database + account + match + teams; browser is relevant.
- Shared database access, SQL schema fixtures, migrations, toolchain, or unknown code changes: all six non-browser suites; browser is relevant.
- Basic UI shell/style changes: T0 + browser when selected.
- Docs-only changes: no automated tests needed.

The `scripts/test-select.mjs` registry is executable policy. Update this mapping whenever new tests, feature boundaries, or dependencies are added.

**Browser behavior:** `--changed` prints a warning rather than silently trying to install/run Chromium. Supply `--browser` after installing Chromium, or choose T3. Explicit `--scope=ui` and `--only=browser` always run the browser suite.

## Test requirements by change and release type

| Change | Minimum |
| --- | --- |
| Comments/docs only | None; review content |
| Cosmetic UI | T0 + T1 UI browser coverage when visual behavior matters |
| Feature-specific edit | T1 for the feature and related dependencies; browser when user interaction changes |
| Cross-feature refactor | T2, plus browser for changed user flows |
| Schema, RLS, scoring command, auth/session, audit ledger, tournament advancement or finalization | T3 before merge/release; T4 on the hosted environment after coordinated rollout |
| New major workflow or app release | T3 + T4 |
| Manual emergency patch | At least relevant C0 tests before rollout; follow with T3 and document exceptions |

## CI and release discipline

- PR validation is automated through `.github/workflows/scorekeeper-tests.yml`: production build and change-aware non-browser tests.
- Full regression is manually invocable through GitHub Actions and is **not** assumed to be running on each PR.
- No branch protection or required-check enforcement is implied by this workflow. Vercel deploys from `main`; merge only after checking required suites and migration order.
- Test results, migration state, deployed SHA, and hosted acceptance are four separate statuses. Never mark a migration or hosted check complete solely because the local suites pass.
- If a skipped area is later implicated by a defect, fix the selection mapping, add an appropriate regression, and rerun the higher tier. Track deliberate exceptions in the PR/release notes.

For deployment order, production risks, manual auth/referee/tournament checks, and pending migrations, see [RELEASE.md](RELEASE.md) and [TEAM_IMAGES_RELEASE.md](TEAM_IMAGES_RELEASE.md).
