# PR #6: team instances, cloning and image library

Status: implemented and locally verified, November 6, 2026. Hosted migration, trusted image-function deployment, production client release and hosted acceptance remain pending.

Canonical requirements and implementation notes: [DESIGN.md §7A–7C](DESIGN.md). Release order, legacy mapping, private Storage controls, decoder packaging, rollback limits and partial-upload recovery: [TEAM_IMAGES_RELEASE.md](TEAM_IMAGES_RELEASE.md).

Included: durable TeamIdentity lineage; independent event-specific team instances; atomic active-fencer cloning; audited editable membership intervals/current and as-of rosters; event assignment from Teams and Events with server locks; shared Image Library; browser-optimized WebP preview/approval; immutable private assets, logo references and per-instance colors; guarded retries and frozen event roster/appearance snapshots.

Verification: production build and all database/tournament/account/match tests; populated legacy mapping, team lifecycle and permission tests; actual image handler with the real WASM decoder; desktop/mobile browser flows through disposable PostgreSQL and fixture Storage transport, including a committed upload with a lost response.

Team-match scoring, team standings, Control Point execution and head-to-head rules remain deferred. No new game rules or production release are implied by this implementation.
