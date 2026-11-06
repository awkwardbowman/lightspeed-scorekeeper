process.on("uncaughtException", (e) => {
  console.error(e.stack, e.detail ?? "", e.hint ?? "", e.query ?? "");
  process.exit(1);
});
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const db = new PGlite();
const admin = randomUUID(),
  manager = randomUUID(),
  other = randomUUID(),
  outsider = randomUUID();
const sessions = new Map(
  [admin, manager, other, outsider].map((id) => [id, randomUUID()]),
);
await db.exec(
  `create role anon;create role supabase_auth_admin;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`,
);
await db.exec(
  await readFile(new URL("./schema-baseline.sql", import.meta.url), "utf8"),
);
for (const id of [admin, manager, other, outsider])
  await db.query("insert into auth.users values($1);", [id]);
for (const [id, s] of sessions)
  await db.query("insert into auth.sessions values($1,$2)", [s, id]);
for (const id of [admin, manager, other])
  await db.query(
    'insert into public."tUser"(id,email,display_name,app_role) values($1,$2,$3,$4)',
    [
      id,
      `${id}@test.invalid`,
      id === admin ? "Maya" : "Management",
      id === admin ? "admin" : "management",
    ],
  );
await db.exec(
  'alter table public."tFencer" enable row level security;create policy legacy_owner on public."tFencer" for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());',
);
const preserved = randomUUID();
await db.query(
  'insert into public."tFencer"(id,owner_id,display_name) values($1,$2,$3)',
  [preserved, admin, "Existing fencer"],
);
const migrations = (
  await readdir(new URL("../supabase/migrations", import.meta.url))
).sort();
for (const file of migrations.filter((x) => !x.includes("team_instances"))) {
  try {
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  } catch (e) {
    console.error(
      "Migration failed:",
      e.message,
      e.position,
      e.query?.slice(
        Math.max(0, Number(e.position) - 250),
        Number(e.position) + 250,
      ),
    );
    throw e;
  }
}
async function auth(id) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, session_id: sessions.get(id) }),
  ]);
  await db.exec("set role authenticated");
}
async function root() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims','{}',false)");
}
async function q(sql, args = []) {
  return (await db.query(sql, args)).rows;
}
async function reject(sql, args = [], pattern) {
  await assert.rejects(() => db.query(sql, args), pattern);
}
// Seed two genuinely different old event rosters plus a separate global roster.
const legacy = randomUUID(),
  eventA = randomUUID(),
  eventB = randomUUID(),
  inactive = randomUUID(),
  active = randomUUID();
await q(
  "insert into public.\"tFencer\"(id,owner_id,display_name,is_archived) values($1,$2,'Retired',true),($3,$2,'Active',false)",
  [inactive, admin, active],
);
await q(
  "insert into public.\"tEvent\"(id,owner_id,name,mode,competition_format) values($1,$2,'Team A','traditional','team'),($3,$2,'Team B','traditional','team')",
  [eventA, admin, eventB],
);
await q(
  "insert into public.\"tTeam\"(id,owner_id,name,mode,image_path) values($1,$2,'Legacy team','traditional',$3)",
  [legacy, admin, `${legacy}/old.webp`],
);
await q(
  "insert into public.\"tEventTeam\"(event_id,team_id,owner_id,mode,added_at) values($1,$2,$3,'traditional','2026-01-01'),($4,$2,$3,'traditional','2026-02-01')",
  [eventA, legacy, admin, eventB],
);
await q(
  'insert into public."tTeamFencer"(team_id,fencer_id,owner_id) values($1,$2,$3)',
  [legacy, preserved, admin],
);
await q(
  'insert into public."tEventTeamFencer" values($1,$2,$3),($1,$2,$4),($5,$2,$3)',
  [eventA, legacy, active, inactive, eventB],
);
const migration = await readFile(
  new URL(
    `../supabase/migrations/${migrations.find((x) => x.includes("team_instances"))}`,
    import.meta.url,
  ),
  "utf8",
);
await db.exec(migration);
await auth(manager);
const mapped = await q('select * from public."tTeamLegacyMap"');
assert.equal(mapped.length, 2);
const instances = await q(
  'select * from public."vTeamInstances" order by event_id',
);
assert.equal(instances.length, 2);
assert.equal(instances[0].team_identity_id, instances[1].team_identity_id);
assert.ok(
  instances.every((t) => t.image_path === `${legacy}/old.webp`),
  "legacy object shared without copy",
);
assert.equal(
  (await q('select * from public."tEventTeamFencer"')).length,
  3,
  "legacy evidence retained",
);
assert.equal(
  (await q('select * from public."tTeamMember" where team_id=$1', [legacy]))
    .length,
  2,
  "event roster replaces global roster for assigned instance",
);
await reject(
  'insert into public."tEventTeamFencer" values($1,$2,$3)',
  [eventA, legacy, preserved],
  /permission denied/,
);
await reject(
  "update public.\"tTeam\" set name='Bypass' where id=$1",
  [legacy],
  /permission denied/,
);
await reject(
  'delete from public."tTeamMember" where team_id=$1',
  [legacy],
  /permission denied/,
);
await reject(
  'insert into public."tTeamIdentity"(owner_id) values($1)',
  [manager],
  /permission denied/,
);
const cmd = async (
  action,
  id,
  revision = null,
  values = {},
  request = randomUUID(),
) =>
  (
    await q("select public.team_command($1,$2,$3,$4,$5) result", [
      request,
      action,
      id,
      revision,
      JSON.stringify(values),
    ])
  )[0].result;
let source = (await q('select * from public."tTeam" where id=$1', [legacy]))[0];
const cloneId = randomUUID(),
  request = randomUUID();
const first = await cmd("clone", cloneId, null, { source_id: legacy }, request);
assert.equal(first.team.event_id, null);
assert.equal(first.team.team_identity_id, legacy);
assert.equal(first.team.cloned_from_team_id, legacy);
assert.deepEqual(
  first.skipped.map((f) => f.id),
  [inactive],
);
assert.equal(
  (await q('select * from public."tTeamMember" where team_id=$1', [cloneId]))
    .length,
  1,
);
assert.deepEqual(
  await cmd("clone", cloneId, null, { source_id: legacy }, request),
  first,
  "lost response retries return exact result",
);
await reject(
  "select public.team_command($1,'clone',$2,null,$3)",
  [request, cloneId, JSON.stringify({ source_id: legacy, name: "Changed" })],
  /already used/,
);
let clone = (
  await cmd("edit", cloneId, first.team.revision, {
    name: "Independent",
    team_color_hex: "#123aBC",
  })
).team;
assert.equal(
  (await q('select name from public."tTeam" where id=$1', [legacy]))[0].name,
  "Legacy team",
);
await assert.rejects(
  () => cmd("edit", cloneId, first.team.revision, { name: "stale" }),
  /another device/,
);
await assert.rejects(
  () => cmd("edit", cloneId, clone.revision, { team_color_hex: "red" }),
  /check constraint/,
);
await assert.rejects(
  () =>
    cmd("clone", randomUUID(), null, {
      source_id: legacy,
      mode: "control_point",
    }),
  /source scoring mode/,
);
const individual = randomUUID();
await root();
await q(
  "insert into public.\"tEvent\"(id,owner_id,name,mode) values($1,$2,'Individual','traditional')",
  [individual, admin],
);
await auth(manager);
await assert.rejects(
  () => cmd("edit", cloneId, clone.revision, { event_id: individual }),
  /team-format/,
);
clone = (await cmd("edit", cloneId, clone.revision, { event_id: eventA })).team;
assert.equal(clone.event_id, eventA);
const memberRequest = randomUUID();
const added = await cmd(
  "add_member",
  clone.id,
  clone.revision,
  { fencer_id: preserved },
  memberRequest,
);
clone = added.team;
assert.deepEqual(
  await cmd(
    "add_member",
    clone.id,
    clone.revision - 1,
    { fencer_id: preserved },
    memberRequest,
  ),
  added,
  "membership retry does not duplicate",
);
await assert.rejects(
  () => cmd("add_member", clone.id, clone.revision, { fencer_id: preserved }),
  /duplicate key/,
);
let memberships = await q(
  'select * from public."tTeamMember" where team_id=$1 and removed_at is null',
  [clone.id],
);
const member = memberships.find((m) => m.fencer_id === preserved);
clone = (
  await cmd("remove_member", clone.id, clone.revision, {
    membership_id: member.id,
  })
).team;
const removed = (
  await q('select * from public."tTeamMember" where id=$1', [member.id])
)[0];
assert.ok(removed.removed_at);
assert.equal(removed.removed_by, manager);
assert.equal(removed.added_by, manager);
clone = (
  await cmd("add_member", clone.id, clone.revision, { fencer_id: preserved })
).team;
assert.equal(
  (
    await q(
      'select count(*)::int n from public."tTeamMember" where team_id=$1 and fencer_id=$2',
      [clone.id, preserved],
    )
  )[0].n,
  2,
  "rejoin creates fresh membership evidence",
);
// Complete event: freeze exact roster and appearance. Subsequent roster/name
// changes remain legal, but assignment remains permanently locked.
await q("select public.set_event_status($1,'completed')", [eventA]);
const frozen = (
  await q(
    'select team_snapshot from public."tEventFinalization" where event_id=$1',
    [eventA],
  )
)[0].team_snapshot;
assert.ok(
  frozen
    .find((t) => t.id === clone.id)
    .members.some((m) => m.fencer_id === preserved),
);
const activeMember = (
  await q(
    'select * from public."tTeamMember" where team_id=$1 and fencer_id=$2 and removed_at is null',
    [clone.id, preserved],
  )
)[0];
clone = (
  await cmd("remove_member", clone.id, clone.revision, {
    membership_id: activeMember.id,
  })
).team;
clone = (
  await cmd("edit", clone.id, clone.revision, {
    name: "After event",
    team_color_hex: "#ffffff",
  })
).team;
await assert.rejects(
  () => cmd("edit", clone.id, clone.revision, { event_id: null }),
  /frozen event history/,
);
assert.deepEqual(
  (
    await q(
      'select team_snapshot from public."tEventFinalization" where event_id=$1',
      [eventA],
    )
  )[0].team_snapshot,
  frozen,
);
assert.equal(
  (
    await q(
      'select assignment_locked from public."vTeamInstances" where id=$1',
      [clone.id],
    )
  )[0].assignment_locked,
  true,
);
const another = (
  await cmd("clone", randomUUID(), null, {
    source_id: clone.id,
    event_id: eventB,
  })
).team;
assert.equal(another.event_id, eventB);
await assert.rejects(
  () => cmd("edit", another.id, another.revision, { event_id: eventA }),
  /eligible|frozen|team-format/,
);
await assert.rejects(
  () =>
    q(
      "update public.\"tEvent\" set competition_format='individual' where id=$1",
      [eventB],
    ),
  /Unassign eligible teams/,
);
// Scheduled and played references both block reassignment, including archived
// matches. Fixtures require an explicit detach/regenerate decision.
const cpEvent = randomUUID(),
  cpOther = randomUUID();
await root();
await q(
  "insert into public.\"tEvent\"(id,owner_id,name,mode,competition_format) values($1,$2,$3,'control_point','team'),($4,$2,$3,'control_point','team')",
  [cpEvent, admin, "CP planning", cpOther],
);
await auth(manager);
const cpTeam = (
  await cmd("create", randomUUID(), null, {
    name: "CP reference",
    mode: "control_point",
    event_id: cpEvent,
  })
).team;
const cpMatch = randomUUID();
await root();
await q(
  'insert into public."tControlPointMatch"(id,owner_id,event_id,team_a_id) values($1,$2,$3,$4)',
  [cpMatch, admin, cpEvent, cpTeam.id],
);
await auth(manager);
await assert.rejects(
  () => cmd("edit", cpTeam.id, cpTeam.revision, { event_id: cpOther }),
  /scheduled fixtures/,
);
await root();
await q('update public."tControlPointMatch" set started_at=now() where id=$1', [
  cpMatch,
]);
await auth(manager);
await assert.rejects(
  () => cmd("edit", cpTeam.id, cpTeam.revision, { event_id: null }),
  /match participation/,
);
const cpEdited = (
  await cmd("edit", cpTeam.id, cpTeam.revision, { name: "Still editable" })
).team;
assert.equal(cpEdited.name, "Still editable");
const schemaChecks = await q(
  "select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname=any($1)",
  [["tTeamIdentity", "tImageAsset", "tTeamMember", "tTeamLegacyMap"]],
);
assert.equal(schemaChecks.length, 4);
assert.ok(schemaChecks.every((t) => t.relrowsecurity));
assert.equal(
  (
    await q(
      "select has_function_privilege('anon','public.team_command(uuid,text,uuid,integer,jsonb)','execute') permitted",
    )
  )[0].permitted,
  false,
);
assert.equal(
  (
    await q(
      "select has_function_privilege('authenticated','public.register_image_asset(uuid,text,integer,integer,integer,text,uuid)','execute') permitted",
    )
  )[0].permitted,
  false,
);
// Archived instances do not archive identities or siblings.
await cmd("archive", another.id, another.revision);
assert.equal(
  (await q('select is_archived from public."tTeam" where id=$1', [clone.id]))[0]
    .is_archived,
  false,
);
assert.ok(
  (await q('select * from public."tTeamIdentity" where id=$1', [legacy]))
    .length,
);
// Image registry: only trusted service may reserve/register immutable metadata.
const assetId = randomUUID(),
  hash = "a".repeat(64);
await reject(
  "select public.reserve_image_upload($1,$2,$3)",
  [assetId, hash, manager],
  /permission denied/,
);
await root();
await db.exec("set role service_role");
await q("select public.reserve_image_upload($1,$2,$3)", [
  assetId,
  hash,
  manager,
]);
const asset = (
  await q("select public.register_image_asset($1,'Logo',128,64,1024,$2,$3) a", [
    assetId,
    hash,
    manager,
  ])
)[0].a;
await assert.rejects(
  () =>
    q("select public.register_image_asset($1,'Wrong',513,64,1024,$2,$3)", [
      randomUUID(),
      hash,
      manager,
    ]),
  /reservation/,
);
await auth(manager);
clone = (
  await cmd("edit", clone.id, clone.revision, { logo_image_asset_id: asset.id })
).team;
await q("select public.archive_image_asset($1,true)", [assetId]);
const inherited = (
  await cmd("clone", randomUUID(), null, { source_id: clone.id })
).team;
assert.equal(inherited.logo_image_asset_id, assetId);
const noLogo = (await cmd("create", randomUUID(), null, { name: "No logo" }))
  .team;
await assert.rejects(
  () =>
    cmd("edit", noLogo.id, noLogo.revision, { logo_image_asset_id: assetId }),
  /active image/,
);
await reject(
  'update public."tImageAsset" set width=500 where id=$1',
  [assetId],
  /permission denied/,
);
await reject(
  'delete from public."tImageAsset" where id=$1',
  [assetId],
  /permission denied/,
);
assert.equal(
  (
    await q(
      "select count(*)::int n from public.\"tAudit\" where record_id=$1 and action='UPLOAD' and actor_id=$2",
      [assetId, manager],
    )
  )[0].n,
  1,
);
await root();
await db.exec(
  "grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated",
);
await q(
  "insert into storage.objects(bucket_id,name) values('image-library',$1)",
  [`${assetId}.webp`],
);
await auth(manager);
assert.equal(
  (await q("select * from storage.objects where bucket_id='image-library'"))
    .length,
  1,
  "archived assets remain resolvable",
);
await reject(
  "insert into storage.objects(bucket_id,name) values('image-library',$1)",
  [`${randomUUID()}.webp`],
  /row-level security/,
);
await q("delete from storage.objects where bucket_id='image-library'");
assert.equal(
  (await q("select * from storage.objects where bucket_id='image-library'"))
    .length,
  1,
  "client cannot delete referenced assets",
);
await root();
await q("delete from auth.sessions where user_id=$1", [manager]);
await auth(manager);
await assert.rejects(
  () => cmd("create", randomUUID(), null, { name: "Revoked" }),
  /Active Management/,
);
assert.equal((await q('select * from public."tTeam"')).length, 0);
await auth(outsider);
assert.equal((await q('select * from public."tImageAsset"')).length, 0);
await assert.rejects(
  () => cmd("create", randomUUID(), null, { name: "Outsider" }),
  /Active Management/,
);
await root();
await q('update public."tUser" set is_active=false where id=$1', [other]);
await auth(other);
await assert.rejects(
  () => cmd("create", randomUUID(), null, { name: "Disabled" }),
  /Active Management/,
);
console.log(
  "PASS: legacy team mapping and preserved objects, fresh clone/membership IDs, inactive skips, exact retries, independent edits, two-way assignment, frozen snapshots, editable historical rosters, image permissions and disabled/revoked account gates.",
);
await db.close();
