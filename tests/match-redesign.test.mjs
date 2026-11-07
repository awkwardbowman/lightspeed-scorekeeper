process.on("uncaughtException", (e) => {
  console.error(e.message, e.detail ?? "", e.hint ?? "", e.query ?? "");
  process.exit(1);
});
import { transform } from "esbuild";
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
const legacyMatch = randomUUID(),
  legacyCall = randomUUID(),
  legacyOther = randomUUID();
await db.query(
  "insert into public.\"tFencer\"(id,owner_id,display_name) values($1,$2,'Legacy opponent')",
  [legacyOther, admin],
);
await db.query(
  "insert into public.\"tTraditionalMatch\"(id,owner_id,left_fencer_id,right_fencer_id,phase,started_at,remaining_ms) values($1,$2,$3,$4,'running',now(),123456)",
  [legacyMatch, admin, preserved, legacyOther],
);
await db.query(
  "insert into public.\"tTraditionalCall\"(id,match_id,side,call_type,points,match_time_ms) values($1,$2,'left','counter',5,150000)",
  [legacyCall, legacyMatch],
);
const legacyEvent = randomUUID();
await db.query(
  `insert into public."tEvent"(id,owner_id,name,mode,starts_at,ends_at) values($1,$2,'Legacy dates','traditional','2026-11-06 01:30:00+00','2026-11-07 23:30:00+00')`,
  [legacyEvent, admin],
);
await db.exec("set timezone='Pacific/Auckland'");
for (const file of (
  await readdir(new URL("../supabase/migrations", import.meta.url))
).sort()) {
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
await auth(manager);
assert.equal(
  (
    await q(
      `select relrowsecurity from pg_class where oid='public."tMatchOperation"'::regclass`,
    )
  )[0].relrowsecurity,
  true,
  "ledger RLS is enabled",
);
assert.equal(
  (
    await q(
      `select has_function_privilege('anon','public.match_command(uuid,uuid,integer,uuid,text,jsonb)','EXECUTE') allowed`,
    )
  )[0].allowed,
  false,
  "anonymous callers cannot execute match operations",
);
assert.equal(
  (
    await q(
      `select prosecdef from pg_proc where oid='public.match_command(uuid,uuid,integer,uuid,text,jsonb)'::regprocedure`,
    )
  )[0].prosecdef,
  false,
  "operation API is security invoker",
);
assert.equal(
  (
    await q('select phase from public."tTraditionalMatch" where id=$1', [
      legacyMatch,
    ])
  )[0].phase,
  "paused",
  "legacy running snapshot recovers paused",
);
assert.equal(
  (
    await q('select remaining_ms from public."tTraditionalMatch" where id=$1', [
      legacyMatch,
    ])
  )[0].remaining_ms,
  123456,
);
assert.equal(
  (
    await q('select left_score from public."vMatchResults" where id=$1', [
      legacyMatch,
    ])
  )[0].left_score,
  5,
  "legacy call score preserved without double counting",
);
assert.equal(
  (
    await q('select data from public."tMatchOperation" where id=$1', [
      legacyCall,
    ])
  )[0].data.snapshotUnavailable,
  true,
  "missing original snapshots are labeled rather than fabricated",
);
const migratedDate = (
  await q(
    `select start_date::text d,end_date::text e,extract(hour from starts_at at time zone 'UTC') h from public."tEvent" where id=$1`,
    [legacyEvent],
  )
)[0];
assert.equal(migratedDate.d, "2026-11-06");
assert.equal(migratedDate.e, "2026-11-07");
assert.equal(
  Number(migratedDate.h),
  1,
  "source timestamp retained; session timezone does not shift dates",
);
const unreg = (
  await q('select id from public."tFencer" where is_unregistered')
)[0].id;
async function create(type = "standard", duration = 180000, target = null) {
  const id = randomUUID(),
    token = randomUUID();
  await db.query(
    'insert into public."tTraditionalMatch"(id,owner_id,left_fencer_id,right_fencer_id) values($1,$2,$3,$3)',
    [id, manager, unreg],
  );
  let revision = (await q("select public.claim_match($1,$2) c", [id, token]))[0]
    .c.revision;
  async function cmd(
    action,
    data = {},
    request = randomUUID(),
    expected = revision,
  ) {
    const r = (
      await q("select public.match_command($1,$2,$3,$4,$5,$6) c", [
        id,
        token,
        expected,
        request,
        action,
        JSON.stringify(data),
      ])
    )[0].c;
    revision = r.revision;
    return request;
  }
  async function state() {
    return (
      await q('select * from public."vMatchResults" where id=$1', [id])
    )[0];
  }
  await cmd("prepare", {
    leftFencerId: unreg,
    rightFencerId: unreg,
    leftName: "A",
    rightName: "B",
    durationMs: duration,
    targetScore: target,
    matchType: type,
  });
  return {
    id,
    token,
    cmd,
    state,
    get revision() {
      return revision;
    },
  };
}
const m = await create("standard", 180000, 12);
assert.equal((await m.state()).phase, "paused");
assert.equal((await m.state()).remaining_ms, 180000);
await m.cmd("start");
await assert.rejects(
  () => m.cmd("score", { side: "left", type: "indirect", points: 1 }),
  /Pause/,
);
await m.cmd("pause");
await assert.rejects(
  () => m.cmd("score", { side: "left", type: "clean", points: 5 }),
  /Invalid quick/,
);
for (const [points, type] of [
  [1, "indirect"],
  [3, "clean"],
  [5, "counter"],
])
  await m.cmd("score", { side: "left", points, type });
assert.equal((await m.state()).left_score, 9);
const adjustment = await m.cmd("admin", {
  leftScore: 8,
  rightScore: 5,
  remainingMs: 240000,
  targetScore: 20,
  outcome: "",
});
let op = (
  await q('select * from public."tMatchOperation" where id=$1', [adjustment])
)[0];
assert.equal(op.left_delta, -1);
assert.equal(op.right_delta, 5);
assert.equal(op.left_after, 8);
assert.equal(op.right_after, 5);
assert.equal(
  (await m.state()).remaining_ms,
  240000,
  "extra time beyond selected preset",
);
assert.equal(
  (await m.state()).duration_ms,
  180000,
  "preset duration provenance unchanged",
);
const penaltyId = randomUUID();
const rev = m.revision;
await m.cmd(
  "penalty",
  { side: "left", points: 3, card: "Red", reason: "Safety" },
  penaltyId,
);
await m.cmd(
  "penalty",
  { side: "left", points: 3, card: "Red", reason: "Safety" },
  penaltyId,
  rev,
);
assert.equal(
  (await m.state()).right_score,
  8,
  "lost-response retry does not award twice",
);
await assert.rejects(
  () =>
    m.cmd(
      "penalty",
      { side: "left", points: 5, card: "Red", reason: "Safety" },
      penaltyId,
    ),
  /identity/,
);
await assert.rejects(
  () =>
    m.cmd("penalty", {
      side: "left",
      points: 1,
      card: "Yellow",
      reason: "Invented",
    }),
  /configured/,
);
await assert.rejects(
  () => m.cmd("penalty", { side: "left", points: 1, reason: "Safety" }),
  /Choose/,
);
await m.cmd("reverse", { operationId: penaltyId });
assert.equal((await m.state()).right_score, 5);
await assert.rejects(
  () => m.cmd("reverse", { operationId: penaltyId }),
  /cannot be reversed/,
);
assert.equal(
  (
    await q(
      'select count(*)::int n from public."tMatchOperation" where id=$1',
      [penaltyId],
    )
  )[0].n,
  1,
  "reversal retains original penalty",
);
await m.cmd("complete");
assert.equal((await m.state()).winner_side, "left");
assert.equal((await m.state()).outcome, "result", "manual stop derives winner");
await m.cmd("admin", {
  leftScore: 8,
  rightScore: 5,
  remainingMs: 240000,
  targetScore: 20,
  outcome: "draw",
});
assert.equal((await m.state()).outcome, "draw");
assert.equal((await m.state()).winner_side, null);
await m.cmd("admin", {
  leftScore: 10,
  rightScore: 4,
  remainingMs: 240000,
  targetScore: 20,
  outcome: "incomplete",
});
assert.equal((await m.state()).finalized_at, null);
assert.equal((await m.state()).outcome, "incomplete");
assert.equal(
  (await m.state()).left_score,
  10,
  "incomplete atomically applies staged corrections",
);
await assert.rejects(
  () => m.cmd("start", {}, randomUUID(), 0),
  /changed on another device/,
);
await auth(other);
await reject(
  "select public.match_command($1,$2,$3,$4,'pause','{}')",
  [m.id, m.token, m.revision, randomUUID()],
  /Claim/,
);
await auth(manager);
await reject(
  "insert into public.\"tMatchOperation\"(id,match_id,sequence,actor_id,kind,left_after,right_after,request_hash) values($1,$2,9999,$3,'admin',0,0,'fake')",
  [randomUUID(), m.id, manager],
  /versioned|transactional/,
);
await reject(
  'delete from public."tMatchOperation" where match_id=$1',
  [m.id],
  /permission denied/,
);
await reject(
  'update public."tMatchOperation" set left_delta=99 where match_id=$1',
  [m.id],
  /permission denied/,
);
await reject(
  'update public."tTraditionalMatch" set target_score=999 where id=$1',
  [m.id],
  /versioned|claim/,
);

// PR #8: independently applied regions preserve other values and finalize
// explicit outcomes without needing a separate complete command.
const partial = await create("standard", 180000, 12);
await partial.cmd("score", { side: "left", type: "counter", points: 5 });
await partial.cmd("admin", { leftScore: 3 });
assert.equal((await partial.state()).right_score, 0);
assert.equal((await partial.state()).remaining_ms, 180000);
assert.equal((await partial.state()).target_score, 12);
const noOpRevision = partial.revision;
await partial.cmd("admin", { leftScore: 3 });
assert.equal(
  partial.revision,
  noOpRevision,
  "unchanged correction produces no audit/revision",
);
await partial.cmd("admin", { outcome: "right" });
const declared = await partial.state();
assert.ok(declared.finalized_at, "winner confirmation immediately finalizes");
assert.equal(
  declared.winner_side,
  "right",
  "explicit winner beats numeric score",
);
await partial.cmd("admin", { remainingMs: 200000 });
assert.equal(
  (await partial.state()).winner_side,
  "right",
  "timer Apply preserves outcome",
);
assert.equal(
  String((await partial.state()).finalized_at),
  String(declared.finalized_at),
  "correction preserves finalization timestamp",
);
await partial.cmd("admin", { outcome: "incomplete" });
assert.equal((await partial.state()).finalized_at, null);
assert.equal((await partial.state()).remaining_ms, 200000);
await assert.rejects(() => partial.cmd("admin", { leftScore: null }), /bounds/);
const typedPreset = randomUUID();
await db.query(
  `insert into public."tMatchPreset"(id,owner_id,name,match_type,duration_ms,target_score) values($1,$2,'Knockout preset','knockout',120000,9)`,
  [typedPreset, manager],
);
const typed = await create();
await assert.rejects(
  () =>
    typed.cmd("prepare", {
      leftFencerId: unreg,
      rightFencerId: unreg,
      leftName: "A",
      rightName: "B",
      presetId: typedPreset,
      durationMs: 180000,
      targetScore: 9,
      matchType: "knockout",
    }),
  /Preset settings changed/,
);
await typed.cmd("prepare", {
  leftFencerId: unreg,
  rightFencerId: unreg,
  leftName: "A",
  rightName: "B",
  presetId: typedPreset,
  durationMs: 120000,
  targetScore: 9,
  matchType: "knockout",
});
assert.equal((await typed.state()).match_type, "knockout");
await db.query(
  `update public."tMatchPreset" set match_type='standard' where id=$1`,
  [typedPreset],
);
assert.equal(
  (await typed.state()).match_type,
  "knockout",
  "preset edits cannot rewrite effective match snapshot",
);
const dateEvent = randomUUID();
await db.query(
  `insert into public."tEvent"(id,owner_id,name,mode,start_date,end_date) values($1,$2,'Calendar event','traditional','2026-11-06','2026-11-07')`,
  [dateEvent, manager],
);
await reject(
  `update public."tEvent" set end_date='2026-11-05' where id=$1`,
  [dateEvent],
  /End Date/,
);
assert.equal(
  (
    await q('select start_date::text d from public."tEvent" where id=$1', [
      dateEvent,
    ])
  )[0].d,
  "2026-11-06",
);
console.log(
  "PASS: partial Admin Apply, no-op suppression, immediate adjudication, finalization provenance, preset snapshots and calendar dates.",
);

const targetMatch = await create("standard", 180000, 3);
await targetMatch.cmd("score", { side: "right", type: "clean", points: 3 });
assert.equal((await targetMatch.state()).outcome, "result");
assert.ok(
  (await targetMatch.state()).finalized_at,
  "target automatically finalizes",
);
// Tiny configured overtime duration exercises real server deadlines without changing the implementation clock.
await db.query('update public."tConfiguration" set overtime_ms=1000');
const ko = await create("knockout", 1000);
await ko.cmd("start");
await new Promise((r) => setTimeout(r, 1100));
await ko.cmd("expire");
let k = await ko.state();
assert.equal(k.is_overtime, true);
assert.equal(k.remaining_ms, 1000);
assert.equal(k.phase, "paused");
assert.equal(k.finalized_at, null);
await ko.cmd("start");
await ko.cmd("pause");
await ko.cmd("score", { side: "right", type: "indirect", points: 1 });
assert.equal((await ko.state()).winner_side, "right");
assert.ok((await ko.state()).finalized_at, "first overtime score finalizes");
const unresolved = await create("knockout", 1000);
await unresolved.cmd("start");
await new Promise((r) => setTimeout(r, 1100));
await unresolved.cmd("expire");
await unresolved.cmd("start");
await new Promise((r) => setTimeout(r, 1100));
await unresolved.cmd("expire");
k = await unresolved.state();
assert.equal(k.remaining_ms, 0);
assert.equal(k.phase, "ended");
assert.equal(k.finalized_at, null);
assert.equal(k.winner_side, null, "scoreless overtime never fabricates winner");
await unresolved.cmd("admin", {
  leftScore: 0,
  rightScore: 0,
  remainingMs: 0,
  targetScore: null,
  outcome: "left",
});
assert.equal((await unresolved.state()).winner_side, "left");
assert.ok((await unresolved.state()).finalized_at);

// Report calculations consume real saved operations: penalty +3 and correction
// -2 remain Other, while reversal drops ordinary call points from net breakdown.
const transformed = await transform(
  await readFile(new URL("../src/reportModel.ts", import.meta.url), "utf8"),
  { loader: "ts", format: "esm" },
);
const { reportModel } = await import(
  `data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`
);
const reportMatch = await create();
const hit = await reportMatch.cmd("score", {
  side: "left",
  points: 5,
  type: "counter",
});
await reportMatch.cmd("penalty", {
  side: "right",
  points: 3,
  card: "Yellow",
  reason: "Safety",
});
await reportMatch.cmd("admin", { leftScore: 6 });
await reportMatch.cmd("reverse", { operationId: hit });
await reportMatch.cmd("admin", { outcome: "right" });
const reportOps = await q(
  'select * from public."tMatchOperation" where match_id=$1 order by sequence',
  [reportMatch.id],
);
const rm = reportModel(reportOps, 1, 0);
assert.deepEqual(
  rm.breakdown.Other,
  [1, 0],
  "+3 penalty and -2 correction reconcile",
);
assert.deepEqual(rm.breakdown["+5"], [0, 0], "reversed call excluded");
assert.ok(rm.reconciled && rm.graphReconciled);
assert.equal(
  rm.progression.at(-2).left,
  1,
  "reversal retained as a drop in chronology",
);
const legacyOps = await q(
  'select * from public."tMatchOperation" where match_id=$1',
  [legacyMatch],
);
assert.equal(
  reportModel(legacyOps, 5, 0).unavailable,
  true,
  "missing legacy snapshots explicitly signaled",
);
console.log(
  "PASS: report categorization, signed corrections, reversed-call exclusion, progression reconciliation and legacy gaps.",
);

// Views all use adjusted totals and adjudication, including a draw at unequal scores.
const f1 = randomUUID(),
  f2 = randomUUID();
await db.query(
  "insert into public.\"tFencer\"(id,owner_id,display_name) values($1,$3,'First'),($2,$3,'Second')",
  [f1, f2, manager],
);
const stats = await create();
await stats.cmd("prepare", {
  leftFencerId: f1,
  rightFencerId: f2,
  leftName: "First",
  rightName: "Second",
  durationMs: 180000,
  targetScore: null,
  matchType: "standard",
});
await stats.cmd("admin", {
  leftScore: 8,
  rightScore: 5,
  remainingMs: 120000,
  targetScore: null,
  outcome: "draw",
});
await stats.cmd("complete");
const fr = await q(
  'select * from public."vFencerStatistics" where fencer_id=$1',
  [f1],
);
assert.equal(Number(fr[0].points_for), 8);
assert.equal(Number(fr[0].draws), 1);
assert.equal(
  Number(
    (
      await q(
        'select sum(total_points) n from public."vFencerScoring" where fencer_id=$1',
        [f1],
      )
    )[0].n,
  ),
  8,
);
// Event results, disciplinary history scope, frozen finalizations and bracket dependencies.
const event = randomUUID(),
  preset = randomUUID(),
  phase = randomUUID();
await db.query(
  "insert into public.\"tMatchPreset\"(id,owner_id,name,target_score) values($1,$2,'Event rules',3)",
  [preset, manager],
);
await db.query(
  "insert into public.\"tEvent\"(id,owner_id,name,mode,preset_id) values($1,$2,'Ledger event','traditional',$3)",
  [event, manager, preset],
);
await q("select public.set_event_status($1,'active')", [event]);
await db.query(
  'insert into public."tEventFencer"(event_id,fencer_id) values($1,$2),($1,$3)',
  [event, f1, f2],
);
async function openEvent(id) {
  const token = randomUUID();
  let revision = (await q("select public.claim_match($1,$2) c", [id, token]))[0]
    .c.revision;
  return {
    id,
    async cmd(action, data = {}) {
      const r = (
        await q("select public.match_command($1,$2,$3,$4,$5,$6) c", [
          id,
          token,
          revision,
          randomUUID(),
          action,
          JSON.stringify(data),
        ])
      )[0].c;
      revision = r.revision;
    },
    async state() {
      return (
        await q('select * from public."vMatchResults" where id=$1', [id])
      )[0];
    },
    async release() {
      await q("select public.release_match($1,$2)", [id, token]);
    },
  };
}
const emid = randomUUID();
await db.query(
  "insert into public.\"tTraditionalMatch\"(id,owner_id,event_id,left_fencer_id,right_fencer_id,left_name,right_name) values($1,$2,$3,$4,$5,'First','Second')",
  [emid, manager, event, f1, f2],
);
const em = await openEvent(emid);
await em.cmd("prepare", { durationMs: 180000, targetScore: 3 });
await em.cmd("penalty", {
  side: "left",
  points: 3,
  card: "Yellow",
  reason: "Power",
});
assert.equal((await em.state()).winner_side, "right");
const card = (
  await q(
    "select data from public.\"tMatchOperation\" where match_id=$1 and kind='penalty'",
    [emid],
  )
)[0].data;
assert.equal(card.eventId, event);
assert.equal(card.sanctionedFencerId, f1);
assert.equal(card.creditedSide, "right");
let standing = (await q("select public.standings($1) s", [event]))[0].s;
assert.equal(standing.find((x) => x.id === f2).wins, 1);
assert.equal(standing.find((x) => x.id === f2).points_for, 3);
await q("select public.set_event_status($1,'completed')", [event]);
await assert.rejects(
  () =>
    em.cmd("admin", {
      leftScore: 5,
      rightScore: 3,
      remainingMs: 1000,
      targetScore: 3,
      outcome: "left",
    }),
  /Reopen/,
);
const frozen = (
  await q(
    'select standings from public."tEventFinalization" where event_id=$1',
    [event],
  )
)[0].standings;
await q("select public.set_event_status($1,'active')", [event]);
await em.cmd("admin", {
  leftScore: 5,
  rightScore: 3,
  remainingMs: 1000,
  targetScore: 3,
  outcome: "left",
});
assert.equal((await em.state()).winner_side, "left");
assert.deepEqual(
  (
    await q(
      'select standings from public."tEventFinalization" where event_id=$1',
      [event],
    )
  )[0].standings,
  frozen,
);
await em.release();
const f3 = randomUUID(),
  f4 = randomUUID();
await db.query(
  "insert into public.\"tFencer\"(id,owner_id,display_name) values($1,$3,'Third'),($2,$3,'Fourth')",
  [f3, f4, manager],
);
await db.query(
  'insert into public."tEventFencer"(event_id,fencer_id) values($1,$2),($1,$3)',
  [event, f3, f4],
);
await db.query(
  "insert into public.\"tEventPhase\"(id,event_id,name,kind,position) values($1,$2,'Knockout','single',1)",
  [phase, event],
);
const graph = {
  entrants: [f1, f2, f3, f4],
  nodes: [
    { key: "W1.0", left: { seed: 0 }, right: { seed: 1 } },
    { key: "W1.1", left: { seed: 2 }, right: { seed: 3 } },
    {
      key: "W2.0",
      left: { match: "W1.0", outcome: "winner" },
      right: { match: "W1.1", outcome: "winner" },
    },
  ],
};
const bracket = (
  await q("select public.generate_bracket($1,$2,'single') id", [
    phase,
    JSON.stringify(graph),
  ])
)[0].id;
await q("select public.sync_bracket($1)", [bracket]);
const bout = (slot) =>
  q(
    'select * from public."vMatchResults" where bracket_id=$1 and slot_key=$2',
    [bracket, slot],
  ).then((r) => r[0]);
const a = await openEvent((await bout("W1.0")).id);
assert.equal((await a.state()).match_type, "knockout");
await a.cmd("prepare", { durationMs: 1000, targetScore: null });
await a.cmd("start");
await new Promise((r) => setTimeout(r, 1100));
await a.cmd("expire");
await a.cmd("start");
await new Promise((r) => setTimeout(r, 1100));
await a.cmd("expire");
await a.release();
await q("select public.sync_bracket($1)", [bracket]);
assert.equal(
  (await bout("W2.0")).left_fencer_id,
  null,
  "unresolved knockout never supplies arbitrary winner",
);
const aa = await openEvent(a.id);
await aa.cmd("admin", {
  leftScore: 0,
  rightScore: 0,
  remainingMs: 0,
  targetScore: null,
  outcome: "left",
});
await aa.release();
const b = await openEvent((await bout("W1.1")).id);
await b.cmd("prepare", { durationMs: 180000, targetScore: 3 });
await b.cmd("score", { side: "left", type: "clean", points: 3 });
await b.release();
// Sibling bouts already played must not block a correction before the dependent final starts.
const siblingCorrection = await openEvent(a.id);
await siblingCorrection.cmd("admin", {
  leftScore: 0,
  rightScore: 0,
  remainingMs: 0,
  targetScore: null,
  outcome: "right",
});
await siblingCorrection.release();
await q("select public.sync_bracket($1)", [bracket]);
const final = await openEvent((await bout("W2.0")).id);
await final.cmd("prepare", { durationMs: 180000, targetScore: 3 });
await final.cmd("start");
await final.cmd("pause");
await final.release();
const blocked = await openEvent(a.id);
await assert.rejects(
  () =>
    blocked.cmd("admin", {
      leftScore: 0,
      rightScore: 0,
      remainingMs: 0,
      targetScore: null,
      outcome: "left",
    }),
  /Played bracket matches/,
);
assert.equal(
  (await blocked.state()).winner_side,
  "right",
  "rejected correction rolls back atomically",
);
console.log(
  "PASS: event penalty identity, standings, frozen results, unresolved knockout advancement, sibling correction and played-descendant protection.",
);

await root();
await db.query('update public."tUser" set is_active=false where id=$1', [
  manager,
]);
await auth(manager);
await reject(
  "select public.match_command($1,$2,$3,$4,'pause','{}')",
  [m.id, m.token, m.revision, randomUUID()],
  /Active account/,
);
assert.equal(
  (await q('select count(*)::int n from public."tMatchOperation"'))[0].n,
  0,
);
console.log(
  "PASS: new ledger, paused scoring, signed admin corrections, direct card awards, immutable reversal, exact retry, authorization, automatic finalization, sudden death, unresolved overtime and consistent read models.",
);
await db.close();
