import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
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
for (const file of (
  await readdir(new URL("../supabase/migrations/", import.meta.url))
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
import { chromium } from "playwright";
await auth(admin);
// Test-only API transport executes the real migration/functions in disposable PostgreSQL.
// No production account or hosted database is contacted.
const dev = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5187",
    "--strictPort",
  ],
  {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
    },
    stdio: "ignore",
  },
);
for (let i = 0; i < 100; i++) {
  try {
    await fetch("http://127.0.0.1:5187/");
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
process.on("exit", () => dev.kill());

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (v) =>
    JSON.stringify(v, (_, x) => (typeof x === "bigint" ? Number(x) : x));
  let dropNextPenalty = false;
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const path = url.pathname.split("/");
    try {
      let result = null;
      const body = req.postDataJSON();
      if (path[1] === "auth") {
        result = {
          user: {
            id: admin,
            email: "maya@test.invalid",
            role: "authenticated",
          },
        };
      } else if (path[3] === "rpc") {
        const fn = path[4];
        const entries = Object.entries(body ?? {});
        assert.match(fn, /^[a-z_]+$/);
        result = (
          await q(
            `select public.${fn}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(",")}) result`,
            entries.map(([, v]) =>
              typeof v === "object" && v !== null ? json(v) : v,
            ),
          )
        )[0].result;
        if (
          fn === "match_command" &&
          body.p_action === "penalty" &&
          dropNextPenalty
        ) {
          dropNextPenalty = false;
          await route.abort("failed");
          return;
        }
      } else {
        const table = path[3];
        assert.match(table, /^[a-zA-Z]+$/);
        const args = [];
        const where = [];
        for (const [k, v] of url.searchParams) {
          if (["select", "order", "offset", "limit"].includes(k)) continue;
          assert.match(k, /^[a-z_]+$/);
          if (v.startsWith("eq.")) {
            args.push(v.slice(3));
            where.push(`"${k}"=$${args.length}`);
          } else if (v.startsWith("in.(")) {
            const vals = v.slice(4, -1).split(",");
            args.push(vals);
            where.push(`"${k}"=any($${args.length})`);
          } else throw Error("unsupported filter " + v);
        }
        const filter = where.length ? " where " + where.join(" and ") : "";
        if (req.method() === "GET") {
          const selected = url.searchParams.get("select") ?? "*";
          assert.match(selected, /^[a-zA-Z_,*]+$/);
          const select =
            selected === "*"
              ? "*"
              : selected
                  .split(",")
                  .map((k) => `"${k}"`)
                  .join(",");
          let order = "";
          if (url.searchParams.has("order"))
            order =
              " order by " +
              url.searchParams
                .get("order")
                .split(",")
                .map((x) => {
                  const [k, d] = x.split(".");
                  assert.match(k, /^[a-z_]+$/);
                  return `"${k}" ${d === "desc" ? "desc" : "asc"}`;
                })
                .join(",");
          result = await q(
            `select ${select} from public."${table}"${filter}${order}`,
            args,
          );
          const offset = Number(url.searchParams.get("offset") ?? 0),
            limit = Number(url.searchParams.get("limit") ?? 1000);
          result = result.slice(offset, offset + limit);
          if (req.headers().accept?.includes("vnd.pgrst.object"))
            result = result[0] ?? null;
        } else if (req.method() === "POST") {
          const vals = Object.entries(body);
          result = await q(
            `insert into public."${table}"(${vals.map(([k]) => `"${k}"`).join(",")}) values(${vals.map((_, i) => "$" + (i + 1)).join(",")}) returning *`,
            vals.map(([, v]) => v),
          );
        } else if (req.method() === "PATCH") {
          const vals = Object.entries(body);
          result = await q(
            `update public."${table}" set ${vals.map(([k], i) => `"${k}"=$${args.length + i + 1}`).join(",")}${filter} returning *`,
            [...args, ...vals.map(([, v]) => v)],
          );
        } else if (req.method() === "DELETE")
          result = await q(
            `delete from public."${table}"${filter} returning *`,
            args,
          );
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: json(result),
        headers: { "access-control-allow-origin": "*" },
      });
    } catch (e) {
      console.log("API ERROR", req.url(), e.message);
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: json({ message: e.message, code: e.code }),
      });
    }
  });
  await page.addInitScript(
    ({ id, session }) => {
      const jwt =
        btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
        "." +
        btoa(
          JSON.stringify({
            sub: id,
            exp: Math.floor(Date.now() / 1000) + 36000,
            session_id: session,
          }),
        ) +
        ".fixture";
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: jwt,
          refresh_token: "fixture",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 36000,
          expires_in: 36000,
          user: {
            id,
            email: "maya@test.invalid",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { id: admin, session: sessions.get(admin) },
  );
  await page.goto("http://127.0.0.1:5187/#/fencers");
  await page.getByRole("link", { name: "New fencer", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Browser Fencer");
  await page.getByLabel("Club / affiliation").fill("Academy");
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Keyboard and touch notes");
  await page
    .getByRole("button", { name: "Create fencer", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Browser Fencer", exact: true })
    .waitFor();
  assert.equal(
    (
      await q(
        "select count(*)::int n from public.\"tFencer\" where display_name='Browser Fencer'",
      )
    )[0].n,
    1,
  );
  await page
    .getByRole("row")
    .filter({ hasText: "Browser Fencer" })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Renamed Browser Fencer");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("cell", { name: "Renamed Browser Fencer", exact: true })
    .waitFor();
  assert.equal(
    (
      await q(
        "select count(*)::int n from public.\"tFencer\" where affiliation='Academy'",
      )
    )[0].n,
    1,
    "edit did not duplicate",
  );
  await page
    .getByRole("row")
    .filter({ hasText: "Renamed Browser Fencer" })
    .getByRole("link", { name: "Archive", exact: true })
    .click();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  assert.equal(
    (
      await q(
        "select is_archived from public.\"tFencer\" where affiliation='Academy'",
      )
    )[0].is_archived,
    false,
  );
  await page
    .getByRole("row")
    .filter({ hasText: "Renamed Browser Fencer" })
    .getByRole("link", { name: "Archive", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: /^Status/ })
    .selectOption("inactive");
  await page
    .getByRole("cell", { name: "Renamed Browser Fencer", exact: true })
    .waitFor();
  for (const [route, entity] of [
    ["presets", "preset"],
    ["events", "event"],
    ["events/teams", "team"],
  ]) {
    await page.goto(`http://127.0.0.1:5187/#/${route}`);
    await page
      .getByRole("link", { name: `New ${entity}`, exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(`Browser ${entity}`);
    await page
      .getByRole("button", { name: `Create ${entity}`, exact: true })
      .click();
    await page
      .getByRole("cell", { name: `Browser ${entity}`, exact: true })
      .waitFor();
    await page
      .getByRole("row")
      .filter({ hasText: `Browser ${entity}` })
      .getByRole("link", { name: "Edit", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(`Edited ${entity}`);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page
      .getByRole("cell", { name: `Edited ${entity}`, exact: true })
      .waitFor();
  }
  await page.goto("http://127.0.0.1:5187/#/users");
  await page.getByRole("link", { name: "New user", exact: true }).click();
  await page
    .getByRole("heading", { name: "Invite user", exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Email", { exact: true }).count(), 1);
  assert.equal(await page.locator("input[type=password]").count(), 0);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.goto("http://127.0.0.1:5187/#/single-match");
  await page
    .getByRole("heading", { name: "Match Prep", exact: true })
    .waitFor();
  await page.getByLabel("Participant name").nth(0).fill("Ari");
  await page.getByLabel("Participant name").nth(1).fill("Jordan");
  await page.getByLabel("Score to Win (blank for no target)").fill("12");
  await page
    .getByRole("button", { name: "Confirm match — timer stays stopped" })
    .click();
  await page.getByRole("button", { name: "03:00 — Start clock" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "left indirect +1" }).count(),
    1,
  );
  assert.equal(await page.locator(".quick-scores button").count(), 6);
  await page.getByRole("button", { name: "left clean +3" }).click();
  await page
    .locator(".live-side.left .live-score")
    .filter({ hasText: "3" })
    .waitFor();
  await page.getByRole("button", { name: "03:00 — Start clock" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".clock-button")?.classList.contains("running"),
  );
  assert.equal(
    await page.getByRole("button", { name: "left indirect +1" }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Admin Mode", exact: true }).click();
  await page
    .getByRole("button", { name: "Increase Left score", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Increase Remaining minutes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Increase Score to Win", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply & close Admin Mode" }).click();
  await page.getByRole("button", { name: "Admin Mode", exact: true }).waitFor();
  await page.getByRole("button", { name: "Admin Mode", exact: true }).click();
  await page.getByRole("button", { name: "Card penalty…" }).click();
  await page.getByRole("button", { name: "Red", exact: true }).click();
  await page.getByRole("button", { name: "Safety", exact: true }).click();
  await page.getByLabel("Points awarded to Jordan").fill("3");
  // Commit but lose its response, then retry with the same persisted request identity.
  dropNextPenalty = true;
  await page
    .getByRole("button", { name: "Confirm card & award points" })
    .click();
  await page.getByRole("button", { name: "Retry pending save" }).click();
  await page.getByRole("button", { name: "Admin Mode", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close Manage", exact: true }).click();
  assert.equal(
    await page.locator(".live-side.left .live-score").innerText(),
    "4",
  );
  assert.equal(
    await page.locator(".live-side.right .live-score").innerText(),
    "3",
  );
  assert.equal(
    (
      await q(
        "select count(*)::int n from public.\"tMatchOperation\" where kind='penalty'",
      )
    )[0].n,
    1,
  );
  await page.screenshot({
    path: new URL("../test-results/live-desktop.png", import.meta.url).pathname,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL("../test-results/live-mobile.png", import.meta.url).pathname,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile has no horizontal overflow",
  );
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Admin Mode", exact: true }).click();
  await page.getByRole("button", { name: "Card penalty…" }).click();
  await page.getByRole("button", { name: "Power", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    (
      await q(
        "select count(*)::int n from public.\"tMatchOperation\" where kind='penalty'",
      )
    )[0].n,
    1,
    "cancel awards nothing",
  );
  await page
    .getByRole("button", { name: "Cancel / discard", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Match Complete", exact: true })
    .click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Match Report", exact: true }).click();
  await page
    .getByRole("heading", { name: "Match Report", exact: true })
    .waitFor();
  const official = (
    await q("select * from public.\"vMatchResults\" where left_name='Ari'")
  )[0];
  assert.equal(official.left_score, 4);
  assert.equal(official.right_score, 3);
  assert.equal(official.winner_side, "left");
  assert.ok(official.finalized_at);
  await page.reload();
  await page.getByRole("button", { name: "Manage", exact: true }).waitFor();
  assert.equal(
    await page.locator(".live-side.left .live-score").innerText(),
    "4",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS browser → API → PostgreSQL → UI: fencer create/edit/archive/cancel, prep, stopped timer, fixed quick scores, running scoring disabled, staged admin/time/target, penalty retry and cancel, manual completion/report/reload, desktop/mobile.",
  );
  await page.goto("http://127.0.0.1:5187/#/fencers");
  await page.locator(".site-header").waitFor({ state: "visible" });
} finally {
  await browser.close();
  dev.kill();
  await db.close();
}
