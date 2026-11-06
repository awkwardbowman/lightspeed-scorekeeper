# PR #6 — team instances and image library

Prepared and locally verified on November 6, 2026. No hosted schema, function or production client changes were made by this build.

## Before release

Review `20261106220508_team_instances_image_library.sql` and capture backup/restore options. Use the existing authorized release workflow; this file is not authorization to mutate production. Source and hosted migration timestamps for the earlier match redesign differ, as recorded in DESIGN.md; reconcile migration history rather than replaying old migrations.

Read-only hosted inspection found zero teams, global/event roster rows, Control Point matches and team-image objects. The private `team-images` bucket has a 2 MB PNG/JPEG/WebP limit. These counts are observations at build time; repeat the preflight immediately before rollout.

For populated installations, the migration keeps the original TeamID for its match-referenced or first event, clones remaining event instances, records `tTeamLegacyMap`, and freezes old link tables as read-only evidence. New `tTeamMember` intervals are authoritative. Legacy object paths and external HTTPS URLs are retained and copied by reference. Any ambiguous team referenced by multiple event matches stops the migration transaction for explicit review. No prior match reference or frozen result is silently rewritten.

## Release order

1. Run `npm ci`, `npm run build`, `npm test` and `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` (or install Playwright Chromium). Review the exact commit and additive migration.
2. Apply the migration through the approved hosted workflow. Verify new tables have RLS; only the intended authenticated reads and command grants exist; `team_command` rejects disabled/revoked callers; direct team/roster writes and client Storage uploads/updates/deletes are denied. Run hosted security/performance advisors and compare with the previous release baseline.
3. Deploy `image-assets` with JWT verification and its **bundled WASM static file**. `supabase/config.toml` declares `functions.image-assets.static_files`. Use a CLI deployment path that includes static files; current Supabase WASM documentation says `--use-api` does not bundle them. Do not deploy only index.ts through a text-only endpoint. Verify the CLI's current help, use Docker bundling as supported, and exercise an actual decode before enabling the new client. The pinned decoder and licenses are in `supabase/functions/image-assets/vendor/`; browser bundles contain no decoder or service key.
4. Deploy the client after the schema and image endpoint are ready. `main` auto-deploys, so merging before server preparation is unsafe. Retain the prior client deployment for investigation. Older clients cannot write the retired team relationship tables; rollback does not restore those obsolete write paths.
5. With Management and Admin accounts, upload PNG/JPEG/WebP through both entry points, inspect optimized previews/byte sizes and confirm only WebP <=300 KiB / 512 pixels reaches the private bucket. Verify private signed thumbnails and refresh. Reject spoofed content, oversized dimensions, unauthenticated/disabled/revoked sessions, client overwrite and object deletion.
6. Create/clone a team; confirm inactive-fencer skips, fresh membership IDs, shared image reference and independent name/color/logo edits. Assign/unassign from both team and event screens. Reject individual/wrong-mode/frozen events and changes to a match-linked assignment. Test a stale editor and a deliberately lost response; retry must not duplicate teams, memberships or assets.
7. Complete/reopen a team-planning event and inspect frozen team appearance/roster snapshots. Add/remove current members afterward; prior snapshots and as-of membership intervals must remain unchanged. Team scoring, team standings and Control Point execution remain disabled.
8. Record hosted migration version, function version, client SHA and acceptance results separately from local test evidence. Synchronize the shared design Doc's release status.

## Partial uploads and retention

The endpoint reserves `(upload UUID, actor, SHA-256)` before writing an object. It never overwrites that path. A failed metadata registration retains a tracked reservation; retry downloads/verifies the same bytes and registers the immutable asset. Once registered, changing the image creates a new upload UUID.

Inspect pending reservations with trusted service/database access by joining `scorekeeper_private.image_upload` to `tImageAsset`. For abandoned reservations, confirm no matching ImageAsset, Team logo reference or frozen snapshot reference, and no in-flight upload. Remove eligible bytes with the Storage API and only then remove the reservation in an audited maintenance transaction. Never delete Storage metadata with SQL. No automatic deletion, paid transformation service or plan upgrade is included. Assets referenced by active/archived teams or historical snapshots are retained indefinitely.

## Verification boundaries

All tests use disposable PostgreSQL, actual SQL functions/RLS and the actual image-handler source with its real libwebp WASM decoder. Browser Auth, HTTP and object-storage transport are fixtures. They prove application data flow, including Canvas processing and lost-response retries, but do not establish hosted JWT settings, Storage behavior, edge static-file packaging or production multi-device behavior. Those require the release checks above.

References: [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [upload restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [WASM packaging](https://supabase.com/docs/guides/functions/wasm).
