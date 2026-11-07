process.on("uncaughtException", (e) => {
  console.error(e.stack, e.query ?? "");
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
const legacy = {
  event: randomUUID(),
  phase: randomUUID(),
  groupA: randomUUID(),
  groupB: randomUUID(),
  matchA: randomUUID(),
  matchB: randomUUID(),
  preset: randomUUID(),
  bracketPhase: randomUUID(),
  bracket: randomUUID(),
  fencers: Array.from({ length: 4 }, () => randomUUID()),
};
for (const file of (
  await readdir(new URL("../supabase/migrations/", import.meta.url))
).sort()) {
  if (file.includes("event_phase_workflow")) {
    await db.query(
      `insert into public."tMatchPreset"(id,owner_id,name) values($1,$2,'Legacy pool rules')`,
      [legacy.preset, admin],
    );
    await db.query(
      `insert into public."tEvent"(id,owner_id,name,mode,status,preset_id) values($1,$2,'Legacy pools','traditional','active',$3)`,
      [legacy.event, admin, legacy.preset],
    );
    for (let i = 0; i < 4; i++) {
      await db.query(
        'insert into public."tFencer"(id,owner_id,display_name) values($1,$2,$3)',
        [legacy.fencers[i], admin, `Legacy ${i}`],
      );
      await db.query('insert into public."tEventFencer" values($1,$2)', [
        legacy.event,
        legacy.fencers[i],
      ]);
    }
    await db.query(
      `insert into public."tEventPhase"(id,event_id,name,kind,position,preset_id) values($1,$2,'Pools','group',1,$3)`,
      [legacy.phase, legacy.event, legacy.preset],
    );
    await db.query(
      `insert into public."tEventGroup"(id,phase_id,name) values($1,$3,'Group A'),($2,$3,'Group B')`,
      [legacy.groupA, legacy.groupB, legacy.phase],
    );
    for (let i = 0; i < 4; i++)
      await db.query('insert into public."tEventGroupFencer" values($1,$2)', [
        i < 2 ? legacy.groupA : legacy.groupB,
        legacy.fencers[i],
      ]);
    for (const [mid, g, l, r] of [
      [legacy.matchA, legacy.groupA, legacy.fencers[0], legacy.fencers[1]],
      [legacy.matchB, legacy.groupB, legacy.fencers[2], legacy.fencers[3]],
    ])
      await db.query(
        'insert into public."tTraditionalMatch"(id,owner_id,event_id,phase_id,group_id,left_fencer_id,right_fencer_id) values($1,$2,$3,$4,$5,$6,$7)',
        [mid, admin, legacy.event, legacy.phase, g, l, r],
      );
    const legacyKnockout = randomUUID();
    await db.query(
      `insert into public."tMatchPreset"(id,owner_id,name,match_type) values($1,$2,'Legacy elimination','knockout')`,
      [legacyKnockout, admin],
    );
    await db.query(
      `insert into public."tEventPhase"(id,event_id,name,kind,position,preset_id) values($1,$2,'Legacy knockout','single',2,$3)`,
      [legacy.bracketPhase, legacy.event, legacyKnockout],
    );
    const graph = {
      entrants: legacy.fencers.slice(0, 3),
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
    await db.query(
      `insert into public."tBracket"(id,phase_id,format,graph) values($1,$2,'single',$3)`,
      [legacy.bracket, legacy.bracketPhase, JSON.stringify(graph)],
    );
    for (const [slot, left, right, voided] of [
      ["W1.0", legacy.fencers[0], legacy.fencers[1], false],
      ["W1.1", legacy.fencers[2], null, true],
      ["W2.0", null, null, false],
    ]) {
      await db.query(
        `insert into public."tTraditionalMatch"(owner_id,event_id,phase_id,bracket_id,slot_key,preset_id,left_fencer_id,right_fencer_id,is_void) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          admin,
          legacy.event,
          legacy.bracketPhase,
          legacy.bracket,
          slot,
          legacyKnockout,
          left,
          right,
          voided,
        ],
      );
    }
    await db.query("select set_config('scorekeeper.claim','',false)");
    await db.query(
      `update public."tTraditionalMatch" set phase='ended',ledger_enabled=true,started_at=now(),ended_at=now(),finalized_at=now() where id=$1`,
      [legacy.matchA],
    );
  }
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

// Exercise the authoritative SQL generator, including seeded byes and reset paths.
for (const count of [2, 3, 4, 5, 7, 8, 9, 16, 31, 32, 63, 64, 127, 128]) {
  const entrants = Array.from({ length: count }, (_, i) => String(i));
  for (const kind of ["group", "single", "double"]) {
    const graph = (
      await q("select scorekeeper_private.phase_graph($1,$2) graph", [
        JSON.stringify(entrants),
        kind,
      ])
    )[0].graph;
    if (kind === "group") {
      assert.equal(graph.nodes.length, (count * (count - 1)) / 2);
      assert.equal(
        new Set(graph.nodes.map((n) => `${n.left.seed}:${n.right.seed}`)).size,
        graph.nodes.length,
      );
      continue;
    }
    for (let trial = 0; trial < 5; trial++) {
      const results = new Map(),
        losses = new Map(entrants.map((id) => [id, 0]));
      for (const node of graph.nodes) {
        const resolve = (src) =>
          "seed" in src
            ? (entrants[src.seed] ?? null)
            : results.get(src.match)[src.outcome];
        const left = resolve(node.left),
          right = resolve(node.right);
        if (node.reset && results.get("GF").side === "left") {
          results.set(node.key, {
            winner: results.get("GF").winner,
            loser: null,
          });
          continue;
        }
        assert.ok(!left || !right || left !== right);
        if (!left || !right) {
          results.set(node.key, { winner: left ?? right, loser: null });
          continue;
        }
        const limit = kind === "double" ? 2 : 1;
        assert.ok(losses.get(left) < limit && losses.get(right) < limit);
        const side =
          (trial + node.key.length + Number(left)) % 2 ? "left" : "right";
        const winner = side === "left" ? left : right,
          loser = side === "left" ? right : left;
        losses.set(loser, losses.get(loser) + 1);
        results.set(node.key, { winner, loser, side });
      }
      const champion = results.get(
        kind === "double" ? "RESET" : `W${Math.ceil(Math.log2(count))}.0`,
      ).winner;
      for (const [id, lossesCount] of losses)
        assert.equal(
          id === champion
            ? lossesCount < (kind === "double" ? 2 : 1)
            : lossesCount === (kind === "double" ? 2 : 1),
          true,
        );
    }
  }
}
await auth(manager);
const legacySlots = await q(
  'select * from public."tTraditionalMatch" where bracket_id=$1 order by slot_key',
  [legacy.bracket],
);
assert.equal(legacySlots[1].is_bye, true, "legacy structural bye reconciled");
assert.equal(
  legacySlots[2].schedule_ready,
  false,
  "legacy unresolved final cannot be claimed",
);
await assert.rejects(
  () =>
    q("select public.claim_match($1,$2)", [legacySlots[2].id, randomUUID()]),
  /Waiting/,
);
const legacyPhases = await q(
  'select * from public."tEventPhase" where legacy_parent_phase_id=$1 order by name',
  [legacy.phase],
);
assert.deepEqual(
  legacyPhases.map((p) => p.name),
  ["Group A", "Group B"],
);
assert.equal(
  (
    await q('select is_archived from public."tEventPhase" where id=$1', [
      legacy.phase,
    ])
  )[0].is_archived,
  true,
);
assert.equal(
  (
    await q(
      'select count(*)::int n from public."tPhaseRegistration" where event_id=$1',
      [legacy.event],
    )
  )[0].n,
  7,
);
const preservedMatch = (
  await q('select * from public."vMatchResults" where id=$1', [legacy.matchA])
)[0];
assert.equal(preservedMatch.phase_id, legacyPhases[0].id);
assert.ok(preservedMatch.finalized_at);
assert.equal(preservedMatch.phase_name_snapshot, "Pools / Group A");
const event = randomUUID(),
  standard = randomUUID(),
  knockout = randomUUID(),
  longer = randomUUID();
await db.query(
  `insert into public."tMatchPreset"(id,owner_id,name,duration_ms,target_score,match_type) values($1,$4,'Group rules',60000,10,'standard'),($2,$4,'Knockout rules',300000,24,'knockout'),($3,$4,'Updated rules',120000,15,'standard')`,
  [standard, knockout, longer, manager],
);
await db.query(
  `insert into public."tEvent"(id,owner_id,name,mode,status,preset_id) values($1,$2,'Phase event','traditional','draft',$3)`,
  [event, manager, standard],
);
const fs = Array.from({ length: 5 }, () => randomUUID());
for (let i = 0; i < fs.length; i++) {
  await db.query(
    'insert into public."tFencer"(id,owner_id,display_name) values($1,$2,$3)',
    [fs[i], manager, `Fencer ${i + 1}`],
  );
  await db.query('insert into public."tEventFencer" values($1,$2)', [
    event,
    fs[i],
  ]);
}
async function phase(name, kind = "group", presetId = standard) {
  const id = randomUUID();
  let rev = null;
  const api = {
    id,
    async cmd(action, data = {}, request = randomUUID(), revision = rev) {
      const r = (
        await q("select public.phase_command($1,$2,$3,$4,$5,$6) c", [
          request,
          event,
          id,
          revision,
          action,
          JSON.stringify(data),
        ])
      )[0].c;
      rev = r.revision;
      return r;
    },
    async state() {
      return (
        await q('select * from public."vEventPhases" where id=$1', [id])
      )[0];
    },
    get revision() {
      return rev;
    },
  };
  await api.cmd("create", { name, kind, presetId, position: 1 });
  return api;
}
async function play(id) {
  const token = randomUUID();
  let revision = (await q("select public.claim_match($1,$2) c", [id, token]))[0]
    .c.revision;
  return {
    async cmd(action, data = {}, request = randomUUID(), expected = revision) {
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
      return r;
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
const group = await phase("Group A"),
  winners = await phase("Winners' Bracket", "single", knockout);
assert.equal((await group.state()).state, "empty");
for (let i = 0; i < 4; i++)
  await group.cmd("register", { fencerId: fs[i], seed: i + 1 });
await winners.cmd("register", { fencerId: fs[0], seed: 1 });
assert.equal(
  (
    await q(
      'select count(*)::int n from public."tPhaseRegistration" where fencer_id=$1',
      [fs[0]],
    )
  )[0].n,
  2,
  "same fencer in multiple phases",
);
await assert.rejects(
  () => group.cmd("register", { fencerId: fs[4], seed: 1 }),
  /unique|duplicate/i,
);
const beforeRev = group.revision;
const generated = await group.cmd("generate", { confirmArchive: true });
assert.equal(
  (await group.state()).match_count,
  6,
  "four entrants make six round robin matches",
);
assert.equal((await group.state()).state, "scheduled");
const bouts = () =>
  q(
    'select * from public."vMatchResults" where phase_id=$1 and not is_archived order by match_sequence',
    [group.id],
  );
let ms = await bouts();
assert.deepEqual(
  ms.map((m) => m.match_sequence),
  [1, 2, 3, 4, 5, 6],
);
assert.equal(ms[0].match_type, "standard");
assert.equal(ms[0].started_at, null);
assert.equal(
  ms[0].ledger_enabled,
  true,
  "managed fixtures reject legacy scoring writes before preparation",
);
// Exact replay cannot archive its own replacements.
const repeat = randomUUID();
const originalRevision = group.revision;
const once = await group.cmd("generate", { confirmArchive: true }, repeat);
const twice = await group.cmd(
  "generate",
  { confirmArchive: true },
  repeat,
  originalRevision,
);
assert.equal(once.bracketId, twice.bracketId);
await assert.rejects(
  () =>
    group.cmd(
      "register",
      { fencerId: fs[4], seed: 5 },
      repeat,
      originalRevision,
    ),
  /identity/,
);
await assert.rejects(
  () => group.cmd("edit", { name: "Stale" }, randomUUID(), beforeRev),
  /another device/,
);
await q("select public.set_event_status($1,'active')", [event]);
ms = await bouts();
const first = await play(ms[0].id);
await first.cmd("prepare", {
  durationMs: 60000,
  targetScore: 10,
  presetId: standard,
});
await first.cmd("score", { side: "left", points: 3, type: "clean" });
assert.equal((await group.state()).state, "active");
await first.cmd("complete");
await first.release();
const firstSnapshot = await first.state();
await group.cmd("edit", { presetId: longer, name: "Group A Renamed" });
assert.equal(
  (await first.state()).duration_ms,
  60000,
  "played snapshot retained",
);
assert.equal((await first.state()).phase_name_snapshot, "Group A");
assert.equal((await first.state()).phase_name, "Group A Renamed");
assert.equal(
  (await bouts())[1].duration_ms,
  120000,
  "unplayed fixture updated",
);
const leased = await play((await bouts())[1].id);
await assert.rejects(
  () => group.cmd("edit", { presetId: standard }),
  /Release unplayed/,
);
await leased.release();
const prepared = await play((await bouts())[1].id);
await prepared.cmd("prepare", {
  durationMs: 120000,
  targetScore: 15,
  presetId: longer,
});
await prepared.release();
await group.cmd("edit", { presetId: standard });
await group.cmd("edit", { presetId: longer });
assert.equal(
  (await bouts())[1].duration_ms,
  120000,
  "released, prepared but unplayed fixtures accept safe preset changes",
);
// Starting every remaining match still leaves orange until every result finalizes.
for (const m of (await bouts()).slice(1)) {
  const p = await play(m.id);
  await p.cmd("prepare", {
    durationMs: 120000,
    targetScore: 15,
    presetId: longer,
  });
  await p.cmd("start");
  await p.cmd("pause");
  await p.release();
}
assert.equal((await group.state()).state, "active");
for (const m of (await bouts()).slice(1)) {
  const p = await play(m.id);
  await p.cmd("complete");
  await p.release();
}
assert.equal((await group.state()).state, "complete");
// A later phase can run independently of earlier unfinished phases.
for (let i = 1; i < 3; i++)
  await winners.cmd("register", { fencerId: fs[i], seed: i + 1 });
const ko = await winners.cmd("generate", { confirmArchive: true });
let kms = await q(
  'select * from public."vMatchResults" where bracket_id=$1 order by match_sequence',
  [ko.bracketId],
);
assert.equal(kms.filter((m) => m.is_bye).length, 1);
const semifinal = kms.find((m) => m.schedule_ready && !m.is_bye);
const final = kms.at(-1);
await assert.rejects(() => play(final.id), /Waiting/);
const semi = await play(semifinal.id);
await semi.cmd("prepare", {
  durationMs: 300000,
  targetScore: 24,
  presetId: knockout,
});
const winRequest = randomUUID();
await semi.cmd("admin", { outcome: "left" }, winRequest);
kms = await q(
  'select * from public."vMatchResults" where bracket_id=$1 order by match_sequence',
  [ko.bracketId],
);
assert.equal(
  kms.at(-1).schedule_ready,
  true,
  "winner advanced without sync RPC",
);
assert.ok(
  [kms.at(-1).left_fencer_id, kms.at(-1).right_fencer_id].includes(
    semifinal.left_fencer_id,
  ),
);
await semi.release();
const fp = await play(final.id);
await fp.cmd("prepare", {
  durationMs: 300000,
  targetScore: 24,
  presetId: knockout,
});
await fp.cmd("start");
await fp.cmd("pause");
const correction = await play(semifinal.id);
await assert.rejects(
  () => correction.cmd("admin", { outcome: "right" }),
  /Played bracket|Played downstream/,
);
await correction.release();
const finalRequest = randomUUID(),
  finalRevision = (await fp.state()).revision;
const finalReceipt = await fp.cmd(
  "admin",
  { outcome: "left" },
  finalRequest,
  finalRevision,
);
assert.equal((await winners.state()).state, "complete");
// Archive every current phase match, including a manual fixture and played results.
await group.cmd("manual", { leftId: fs[0], rightId: fs[1] });
const beforeArchive = await bouts();
await group.cmd("generate", { confirmArchive: true });
assert.equal(
  (
    await q(
      'select count(*)::int n from public."tTraditionalMatch" where phase_id=$1 and is_archived',
      [group.id],
    )
  )[0].n,
  13,
);
assert.equal(
  (
    await q(
      'select count(*)::int n from public."tTraditionalCall" where match_id=$1',
      [firstSnapshot.id],
    )
  )[0].n,
  1,
  "played calls retained",
);
assert.equal(
  (await winners.state()).state,
  "complete",
  "other phase untouched",
);
await group.cmd("archive_schedule", { confirmArchive: true });
assert.equal((await group.state()).state, "empty");
await group.cmd("unregister", { fencerId: fs[0] });
assert.equal(
  (await winners.state()).participant_count,
  3,
  "removal in one phase leaves another intact",
);
await assert.rejects(
  () => group.cmd("manual", { leftId: fs[0], rightId: fs[1] }),
  /registered in this phase/,
);
await q("select public.set_event_status($1,'completed')", [event]);
assert.deepEqual(
  await fp.cmd("admin", { outcome: "left" }, finalRequest, finalRevision),
  finalReceipt,
  "exact match retry survives event freeze",
);
await fp.release();
const frozen = (
  await q(
    'select phase_snapshot from public."tEventFinalization" where event_id=$1 order by created_at desc limit 1',
    [event],
  )
)[0].phase_snapshot;
assert.ok(frozen.find((p) => p.id === winners.id).standings.length);
await assert.rejects(
  () => winners.cmd("edit", { name: "Forbidden" }),
  /Reopen/,
);
await q("select public.set_event_status($1,'active')", [event]);
await winners.cmd("edit", { name: "Winners Renamed" });
assert.equal(
  (
    await q(
      'select phase_snapshot from public."tEventFinalization" where event_id=$1 order by created_at desc limit 1',
      [event],
    )
  )[0].phase_snapshot.find((p) => p.id === winners.id).name,
  "Winners' Bracket",
);
await assert.rejects(
  () =>
    db.query(`update public."tEventPhase" set name='Bypass' where id=$1`, [
      group.id,
    ]),
  /versioned/,
);
await assert.rejects(
  () =>
    db.query(
      'insert into public."tPhaseRegistration"(phase_id,event_id,fencer_id) values($1,$2,$3)',
      [group.id, event, fs[0]],
    ),
  /versioned/,
);
await assert.rejects(
  () =>
    db.query('delete from public."tPhaseOperation" where phase_id=$1', [
      group.id,
    ]),
  /permission denied/,
);
await auth(outsider);
assert.equal(
  (await q('select count(*)::int n from public."tPhaseRegistration"'))[0].n,
  0,
);
await assert.rejects(() => rpcBad(), /Active account/);
async function rpcBad() {
  return q(`select public.phase_command($1,$2,$3,0,'archive','{}')`, [
    randomUUID(),
    event,
    group.id,
  ]);
}
console.log(
  "PASS: populated legacy flattening, independent seeded memberships, draft scheduling, exact retries, partial settings, phase states, byes/automatic advancement, descendant guards, whole-phase archival, frozen snapshots and RLS.",
);
await db.close();
