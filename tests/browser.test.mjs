import { transform } from "esbuild";
import WebPDecoder from "../supabase/functions/image-assets/vendor/webp_dec.js";
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
// Run the actual trusted image handler and decoder; only transport/Storage
// bytes are local fixtures. All registry/team commands execute real PostgreSQL.
const imageObjects = new Map();
const imageShared = await transform(
  await readFile(
    new URL("../supabase/functions/_shared/image.ts", import.meta.url),
    "utf8",
  ),
  { loader: "ts", format: "esm" },
);
const { validateProcessed } = await import(
  `data:text/javascript;base64,${Buffer.from(imageShared.code).toString("base64")}`
);
const imageSource = (
  await readFile(
    new URL("../supabase/functions/image-assets/index.ts", import.meta.url),
    "utf8",
  )
)
  .replace(
    /import \{ createClient \} from ["'][^"']+["'];/,
    "const createClient=deps.createClient;",
  )
  .replace(
    /import \{ validateProcessed \} from ["'][^"']+["'];/,
    "const validateProcessed=deps.validateProcessed;",
  )
  .replace(
    /import WebPDecoder from ["'][^"']+["'];/,
    "const WebPDecoder=deps.WebPDecoder;",
  )
  .replaceAll("import.meta.url", "deps.moduleUrl");
const imageCode = (
  await transform(imageSource, { loader: "ts", format: "esm" })
).code;
let imageHandler;
const imageCaller = {
  auth: {
    getUser: async () => ({ data: { user: { id: admin } }, error: null }),
  },
  rpc: async () => ({
    data: (await q("select public.account_status() p"))[0].p,
    error: null,
  }),
};
const imageService = {
  rpc: async (name, args) => {
    try {
      const data = await db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        const entries = Object.entries(args);
        return (
          await tx.query(
            `select public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(",")}) result`,
            entries.map(([, v]) => v),
          )
        ).rows[0].result;
      });
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  },
  storage: {
    from: (bucket) => ({
      upload: async (path, bytes) => {
        const key = `${bucket}/${path}`;
        if (imageObjects.has(key))
          return { error: { message: "Already exists" } };
        imageObjects.set(key, new Uint8Array(bytes));
        return { error: null };
      },
      download: async (path) =>
        imageObjects.has(`${bucket}/${path}`)
          ? {
              data: new Blob([imageObjects.get(`${bucket}/${path}`)]),
              error: null,
            }
          : { error: { message: "Not found" } },
    }),
  },
};
new Function("Deno", "deps", imageCode)(
  {
    env: {
      get: (name) =>
        name === "SUPABASE_URL"
          ? "https://test.invalid"
          : name === "SUPABASE_SERVICE_ROLE_KEY"
            ? "service"
            : "anon",
    },
    serve: (fn) => (imageHandler = fn),
    readFile: async () =>
      new Uint8Array(
        await readFile(
          new URL(
            "../supabase/functions/image-assets/vendor/webp_dec.wasm",
            import.meta.url,
          ),
        ),
      ),
  },
  {
    createClient: (_url, key) =>
      key === "service" ? imageService : imageCaller,
    validateProcessed,
    WebPDecoder,
    moduleUrl: new URL(
      "../supabase/functions/image-assets/index.ts",
      import.meta.url,
    ).href,
  },
);
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
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (v) =>
    JSON.stringify(v, (_, x) => (typeof x === "bigint" ? Number(x) : x));
  let dropNextPenalty = false;
  let dropNextImage = false;
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const path = url.pathname.split("/");
    try {
      let result = null;
      if (path[1] === "functions" && path[3] === "image-assets") {
        const response = await imageHandler(
          new Request(req.url(), {
            method: "POST",
            headers: req.headers(),
            body: req.postDataBuffer(),
          }),
        );
        if (dropNextImage && response.status === 200) {
          dropNextImage = false;
          await route.abort("failed");
          return;
        }
        await route.fulfill({
          status: response.status,
          contentType: "application/json",
          body: await response.text(),
        });
        return;
      }
      const body = req.postDataJSON();
      if (path[1] === "storage") {
        if (path[4] === "sign") {
          result = {
            signedURL: `/object/sign/${path.slice(5).join("/")}?token=fixture`,
          };
        } else {
          throw new Error("unsupported Storage fixture");
        }
        if (req.method() === "GET") {
          const data = imageObjects.get(path.slice(5).join("/"));
          if (!data) throw new Error("Image not found");
          await route.fulfill({
            status: 200,
            contentType: "image/webp",
            body: Buffer.from(data),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: json(result),
        });
        return;
      }
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
            args.push(
              table === "tConfiguration" && k === "id"
                ? v.slice(3) === "true"
                : v.slice(3),
            );
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
            vals.map(([, v]) =>
              typeof v === "object" && v !== null ? json(v) : v,
            ),
          );
        } else if (req.method() === "PATCH") {
          const vals = Object.entries(body);
          result = await q(
            `update public."${table}" set ${vals.map(([k], i) => `"${k}"=$${args.length + i + 1}`).join(",")}${filter} returning *`,
            [
              ...args,
              ...vals.map(([, v]) =>
                typeof v === "object" && v !== null ? json(v) : v,
              ),
            ],
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
  if (!process.env.TEAM_ONLY) {
    // The shared RecordPage lookup powers Users, Fencers, Presets and Events.
    const assertIdFirst = async () => {
      await page
        .getByRole("columnheader", { name: "ID", exact: true })
        .waitFor();
      assert.deepEqual(
        await page
          .locator("table thead th")
          .allTextContents()
          .then((labels) => labels.slice(0, 2).map((label) => label.trim())),
        ["ID", "Name"],
        "Management lookup must show ID before Name",
      );
    };
    await page.goto("http://127.0.0.1:5187/#/fencers");
    await page.getByRole("link", { name: "New Fencer", exact: true }).click();
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Browser Fencer");
    await page.getByLabel("Club / affiliation").fill("Academy");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("Keyboard and touch notes");
    await page
      .getByRole("button", { name: "Create Fencer", exact: true })
      .click();
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor();
    await assertIdFirst();
    await page
      .locator(".notice-success")
      .filter({ hasText: "Saved successfully." })
      .waitFor();
    // Fencer lookup filters are independent Name + Affiliation searches,
    // followed by Status and Sort. Other entity lookups retain broad Search.
    assert.deepEqual(
      await page
        .locator(".record-lookup .fields > label")
        .evaluateAll((labels) =>
          labels.map((label) => label.firstChild?.textContent?.trim()),
        ),
      ["Name", "Affiliation", "Status", "Sort"],
      "Fencer filters must be ordered Name, Affiliation, Status, Sort",
    );
    const nameFilter = page.getByRole("searchbox", {
      name: "Name",
      exact: true,
    });
    await nameFilter.fill("OwS");
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor();
    await nameFilter.fill("ACADE");
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor({ state: "hidden" }); // Affiliation text must not match Name.
    await nameFilter.fill("fEnC");
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor();
    // Affiliation is a case-insensitive substring search, not an exact dropdown.
    const affiliationFilter = page.getByRole("searchbox", {
      name: "Affiliation",
      exact: true,
    });
    await affiliationFilter.fill("cAdE");
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor();
    await nameFilter.fill("OTHER NAME");
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor({ state: "hidden" }); // Matching Affiliation cannot override Name.
    await nameFilter.fill("fEnC");
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor();
    await affiliationFilter.fill("unmatched affiliation");
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor({ state: "hidden" });
    await page
      .getByRole("status")
      .filter({ hasText: "No records match your filters." })
      .waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Showing 0 of" })
      .waitFor();
    await page
      .getByRole("button", { name: "Clear Filters", exact: true })
      .click();
    assert.equal(await nameFilter.inputValue(), "");
    assert.equal(await affiliationFilter.inputValue(), "");
    assert.equal(
      await page.getByRole("button", { name: "Clear Filters" }).count(),
      0,
    );
    await page
      .getByRole("cell", { name: "Browser Fencer", exact: true })
      .waitFor();
    // Notes stay in the editor/database, not in the Fencer lookup table.
    assert.equal(
      await page
        .getByRole("columnheader", { name: "Affiliation", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page
        .getByRole("row")
        .filter({ hasText: "Browser Fencer" })
        .getByText("Notes", { exact: true })
        .count(),
      0,
      "Fencer lookup must not expose an expandable Notes control",
    );
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
    assert.equal(
      await page.getByLabel("Notes", { exact: true }).inputValue(),
      "Keyboard and touch notes",
      "Fencer notes must still be stored and editable",
    );
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Renamed Browser Fencer");
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
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
    ]) {
      await page.goto(`http://127.0.0.1:5187/#/${route}`);
      await assertIdFirst();
      await page
        .getByRole("link", {
          name: `New ${entity[0].toUpperCase() + entity.slice(1)}`,
          exact: true,
        })
        .click();
      await page.getByLabel("Name", { exact: true }).fill(`Browser ${entity}`);
      if (entity === "event") {
        await page.getByLabel("Start Date", { exact: true }).fill("2026-11-06");
        await page.getByLabel("End Date", { exact: true }).fill("2026-11-07");
      }

      await page
        .getByRole("button", {
          name: `Create ${entity[0].toUpperCase() + entity.slice(1)}`,
          exact: true,
        })
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
        .getByRole("button", { name: "Save Changes", exact: true })
        .click();
      await page
        .getByRole("cell", { name: `Edited ${entity}`, exact: true })
        .waitFor();
    }
    await page.goto("http://127.0.0.1:5187/#/users");
    await assertIdFirst();
    assert.deepEqual(
      await page
        .locator("table thead th")
        .allTextContents()
        .then((labels) => labels.map((label) => label.trim())),
      ["ID", "Name", "Email", "Role", "Status", "Actions"],
      "Users lookup must give Email and Role independent columns",
    );
    const managerRow = page.getByRole("row").filter({
      has: page.getByRole("cell", {
        name: `${manager}@test.invalid`,
        exact: true,
      }),
    });
    await managerRow.waitFor();
    assert.equal(
      await managerRow.locator("td").nth(2).innerText(),
      `${manager}@test.invalid`,
    );
    assert.equal(
      await managerRow.locator("td").nth(3).innerText(),
      "Management",
      "Role must not be concatenated into the Email cell",
    );
    await page.getByRole("link", { name: "New User", exact: true }).click();
    await page
      .getByRole("heading", { name: "Invite User", exact: true })
      .waitFor();
    assert.equal(await page.getByLabel("Email", { exact: true }).count(), 1);
    assert.equal(await page.locator("input[type=password]").count(), 0);
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await page.goto("http://127.0.0.1:5187/#/");
    await page.getByRole("link", { name: "Manage Match Presets" }).click();
    assert.equal(new URL(page.url()).hash, "#/presets");
    await page.goto(`http://127.0.0.1:5187/#/users?mode=edit&id=${manager}`);
    const dangerZone = page.getByRole("region", { name: "Danger Zone" });
    await dangerZone
      .getByRole("link", { name: "Delete Account Access…" })
      .click();
    await page
      .getByRole("heading", { name: "Confirm Delete User Access" })
      .waitFor();
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    assert.equal(
      (
        await q('select count(*)::int n from public."tUser" where id=$1', [
          manager,
        ])
      )[0].n,
      1,
      "Cancelling Delete Account Access must preserve the user",
    );
    await page.goto("http://127.0.0.1:5187/#/");
    await page.getByRole("link", { name: /Manage Teams/i }).click();
    await page
      .getByRole("heading", { name: "Manage Teams", exact: true })
      .waitFor();
    await page.goto("http://127.0.0.1:5187/#/single-match");
    await page
      .getByRole("heading", { name: "Match Prep", exact: true })
      .waitFor();
    await page.getByLabel("Participant name").nth(0).fill("Ari");
    await page.getByLabel("Participant name").nth(1).fill("Jordan");
    await page
      .getByLabel("Preset", { exact: true })
      .selectOption({ label: "Edited preset" });
    assert.equal(await page.getByLabel("Length (seconds)").isDisabled(), true);
    assert.equal(
      await page.getByLabel("Match type", { exact: true }).isDisabled(),
      true,
    );
    await page.getByLabel("Preset", { exact: true }).selectOption("");
    assert.equal(
      await page.getByLabel("Length (seconds)").inputValue(),
      "",
      "Custom clears preset-owned length",
    );
    assert.equal(
      await page.getByLabel("Score to Win (blank for no target)").inputValue(),
      "",
    );
    assert.equal(
      await page.getByLabel("Match type", { exact: true }).inputValue(),
      "",
    );
    await page.getByLabel("Length (seconds)").fill("180");
    await page
      .getByLabel("Match type", { exact: true })
      .selectOption("standard");
    await page.getByLabel("Score to Win (blank for no target)").fill("12");
    await page.getByRole("button", { name: "Start Match" }).click();
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
    await page.getByRole("heading", { name: "Match Log", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Previous Cards", exact: true }).waitFor();
    assert.equal(await page.locator("details.match-rail").count(), 0, "Admin side panels cannot collapse");
    assert.equal(await page.locator(".log-rail pre").count(), 0, "Live log cannot show JSON payloads");
    assert.equal(await page.getByRole("button", { name: /Nullify log entry:/ }).count(), 1, "Saved scoring calls must offer Nullify");
    await page
      .getByRole("button", { name: "Increase Left score", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Increase Remaining minutes", exact: true })
      .click();
    await page.getByText("Match Settings", { exact: true }).click();
    await page
      .getByRole("button", { name: "Increase Score to Win", exact: true })
      .click();
    const beforeApply = (
      await q(`select * from public."vMatchResults" where left_name='Ari'`)
    )[0];
    assert.equal(
      beforeApply.left_score,
      3,
      "preview must not persist before Apply",
    );
    await page
      .getByRole("button", { name: "Apply left score", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Apply left score", exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Apply left score"]')?.disabled,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Apply Timer", exact: true })
        .isEnabled(),
      true,
      "unapplied timer preview survives score save",
    );
    await page
      .getByRole("button", { name: "Apply Timer", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent === "Apply Timer",
        )?.disabled,
    );
    await page
      .getByRole("button", { name: "Apply Score to Win", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent === "Apply Score to Win",
        )?.disabled,
    );
    await page
      .getByRole("button", { name: "Penalty on Ari", exact: true })
      .click();
    await page.screenshot({
      path: "test-results/penalty-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Red", exact: true }).click();
    await page.getByRole("button", { name: "Safety", exact: true }).click();
    await page.getByLabel("Points awarded to Jordan").fill("3");
    // Commit but lose its response, then retry with the same persisted request identity.
    dropNextPenalty = true;
    await page
      .getByRole("button", { name: "Confirm card & award points" })
      .click();
    await page.getByRole("button", { name: "Retry pending save" }).click();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
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
      path: new URL("../test-results/live-desktop.png", import.meta.url)
        .pathname,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: new URL("../test-results/live-mobile.png", import.meta.url)
        .pathname,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "mobile has no horizontal overflow",
    );
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    await page.getByRole("button", { name: "Penalty on Ari" }).click();
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
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Match Complete", exact: true })
      .click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page
      .getByRole("button", { name: "Match Report", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Match Report", exact: true })
      .waitFor();
    await page.getByRole("img", { name: /Score progression/ }).waitFor();
    assert.match(await page.locator(".report-breakdown").innerText(), /Other/);
    await page.screenshot({
      path: "test-results/report-mobile.png",
      fullPage: true,
    });
    const official = (
      await q("select * from public.\"vMatchResults\" where left_name='Ari'")
    )[0];
    assert.equal(official.left_score, 4);
    assert.equal(official.right_score, 3);
    assert.equal(official.winner_side, "left");
    assert.ok(official.finalized_at);
    await page.reload();
    await page
      .getByRole("button", { name: "Match Report", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".live-side.left .live-score").innerText(),
      "4",
    );
    // Abandon exits the fullscreen scoreboard; it never voids the saved bout.
    await page
      .getByRole("button", { name: "Match Report", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit Match", exact: true }).click();
    const abandon = page.getByRole("button", {
      name: "Abandon Match",
      exact: true,
    });
    await abandon.waitFor({ state: "visible" });
    page.once("dialog", (dialog) => dialog.dismiss());
    await abandon.click();
    assert.equal(
      await page
        .getByRole("heading", { name: "Admin Mode", exact: true })
        .count(),
      1,
      "Declining Abandon Match must keep the current Admin Mode",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await abandon.click();
    await page.waitForURL("**/#/");
    const savedBout = (
      await q(
        "select id,is_void,finalized_at,left_score,right_score from public.\"vMatchResults\" where left_name='Ari'",
      )
    )[0];
    assert.equal(savedBout.is_void, false, "Abandon must not void the bout");
    assert.ok(
      savedBout.finalized_at,
      "Abandon must retain historical finalization",
    );
    assert.equal(savedBout.left_score, 4);
    assert.equal(savedBout.right_score, 3);
    await page.goto("http://127.0.0.1:5187/#/single-match");
    await page
      .getByRole("heading", { name: "Match Prep", exact: true })
      .waitFor();
    await page.goto("http://127.0.0.1:5187/#/history/matches");
    await page
      .getByRole("combobox", { name: "Match order" })
      .selectOption("oldest");
    await page
      .getByRole("combobox", { name: "Match order" })
      .selectOption("newest");
    const savedHistoryRow = page
      .getByRole("button")
      .filter({ hasText: "Ari Wins" });
    await savedHistoryRow.waitFor();
    assert.deepEqual(
      await savedHistoryRow.locator(".match-winner").allTextContents(),
      ["Ari", "4"],
      "History highlights only the adjudicated winner and their score",
    );
    assert.match(
      await savedHistoryRow.locator(".match-history-score").innerText(),
      /\[\s*4\s+to\s+3\s*\]/,
      "History preserves effective numeric totals",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser → API → PostgreSQL → UI: fencer create/edit/archive/cancel, prep, stopped timer, fixed quick scores, running scoring disabled, staged admin/time/target, penalty retry and cancel, manual completion/report/reload, confirmed Abandon Match exit with preserved results, desktop/mobile.",
    );
    await page.goto("http://127.0.0.1:5187/#/fencers");
    await page.locator(".site-header").waitFor({ state: "visible" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await q(
    "insert into public.\"tEvent\"(id,owner_id,name,mode,competition_format) values($1,$2,'Browser team event','traditional','team')",
    [randomUUID(), admin],
  );
  await q('insert into public."tFencer"(owner_id,display_name) values($1,$2)', [
    admin,
    "Team Browser Fencer",
  ]);
  const teamEvent = (
    await q("select * from public.\"tEvent\" where name='Browser team event'")
  )[0];
  await page.goto("http://127.0.0.1:5187/#/events/teams");
  await page.getByRole("link", { name: "New team", exact: true }).click();
  await page.getByLabel("Team name", { exact: true }).fill("Browser team");
  await page
    .getByLabel("Assigned event", { exact: true })
    .selectOption(teamEvent.id);
  await page.getByLabel("Color hex", { exact: true }).fill("#1a2b3c");
  await page.getByRole("button", { name: "Choose logo", exact: true }).click();
  await page
    .getByRole("button", { name: "Upload new image", exact: true })
    .click();
  const original = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 800;
    const x = c.getContext("2d");
    x.fillStyle = "blue";
    x.fillRect(100, 100, 1200, 500);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Choose image", { exact: true }).setInputFiles({
    name: "Blue team.png",
    mimeType: "image/png",
    buffer: Buffer.from(original, "base64"),
  });
  await page.getByAltText("Processed image preview", { exact: true }).waitFor();
  await page.getByText(/512 × 256 px/).waitFor();
  await page
    .getByRole("combobox", { name: "Maximum size" })
    .selectOption("256");
  await page.getByText(/256 × 128 px/).waitFor();
  const firstPreviewUrl = await page
    .getByAltText("Processed image preview")
    .getAttribute("src");
  await page.getByRole("combobox", { name: "Quality" }).selectOption("0.9");
  await page.waitForFunction((previous) => {
    const img = document.querySelector('img[alt="Processed image preview"]');
    return Boolean(
      img?.getAttribute("src") && img.getAttribute("src") !== previous,
    );
  }, firstPreviewUrl);
  await page.getByText("Preview automatically updated.").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Update preview" }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Approve preview and upload" })
      .isEnabled(),
    true,
  );
  assert.equal(
    (await q('select count(*)::int n from public."tImageAsset"'))[0].n,
    0,
    "preview approval happens before upload",
  );
  dropNextImage = true;
  await page
    .getByRole("button", { name: "Approve preview and upload", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: /Failed to send|fetch|request/i })
    .waitFor();
  await page
    .locator(".notice-error")
    .filter({ hasText: /Failed to send|fetch|request/i })
    .waitFor();
  await page.getByAltText("Processed image preview", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Approve preview and upload", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose logo", exact: true })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Browser team" }).waitFor();
  const browserTeam = (
    await q("select * from public.\"tTeam\" where name='Browser team'")
  )[0];
  assert.equal(browserTeam.event_id, teamEvent.id);
  assert.equal(browserTeam.team_color_hex, "#1a2b3c");
  const image = (await q('select * from public."tImageAsset"'))[0];
  assert.equal(image.width, 256);
  assert.equal(image.height, 128);
  assert.equal(imageObjects.size, 1, "retry reuses one stored object");
  await page
    .getByRole("row")
    .filter({ hasText: "Browser team" })
    .getByRole("link", { name: "Roster", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Team Browser Fencer", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove", exact: true }).waitFor();
  await page.goto(
    `http://127.0.0.1:5187/#/events/teams?mode=clone&id=${browserTeam.id}`,
  );
  await page
    .getByLabel("Team name", { exact: true })
    .fill("Browser cloned team");
  assert.equal(
    await page.getByLabel("Assigned event", { exact: true }).inputValue(),
    "",
  );
  await page
    .getByRole("button", { name: "Confirm clone", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "Browser cloned team" })
    .waitFor();
  const cloned = (
    await q("select * from public.\"tTeam\" where name='Browser cloned team'")
  )[0];
  assert.notEqual(cloned.id, browserTeam.id);
  assert.equal(cloned.team_identity_id, browserTeam.team_identity_id);
  assert.equal(cloned.logo_image_asset_id, browserTeam.logo_image_asset_id);
  assert.equal(
    (
      await q(
        'select count(*)::int n from public."tTeamMember" where team_id=$1',
        [cloned.id],
      )
    )[0].n,
    1,
  );
  await page.goto(
    `http://127.0.0.1:5187/#/events?mode=relationships&id=${teamEvent.id}`,
  );
  await page
    .getByRole("button", { name: "Assign Browser cloned team", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Available unassigned teams", exact: true })
    .waitFor();
  await page.getByText("Saved.", { exact: true }).waitFor();
  assert.equal(
    (await q('select event_id from public."tTeam" where id=$1', [cloned.id]))[0]
      .event_id,
    teamEvent.id,
  );
  await page.goto(
    `http://127.0.0.1:5187/#/events/teams?mode=edit&id=${cloned.id}`,
  );
  await page.getByLabel("Color hex", { exact: true }).fill("#eeffee");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Browser cloned team" })
    .waitFor();
  assert.equal(
    (
      await q('select team_color_hex from public."tTeam" where id=$1', [
        browserTeam.id,
      ])
    )[0].team_color_hex,
    "#1a2b3c",
  );
  await page.screenshot({
    path: new URL("../test-results/team-instances-desktop.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `http://127.0.0.1:5187/#/events/teams?mode=edit&id=${cloned.id}`,
  );
  await page.getByLabel("Team name", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile team editor stays within viewport",
  );
  await page.screenshot({
    path: new URL("../test-results/team-editor-mobile.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:5187/#/configuration/team-images");
  await page.getByRole("heading", { name: "Blue team", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Archive Blue team", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await page
    .getByLabel("Image status", { exact: true })
    .selectOption("archived");
  await page.getByRole("heading", { name: "Blue team", exact: true }).waitFor();
  assert.equal(
    (
      await q('select is_archived from public."tImageAsset" where id=$1', [
        image.id,
      ])
    )[0].is_archived,
    true,
  );
  await page.goto(
    `http://127.0.0.1:5187/#/configuration/team-images?mode=archive&id=${image.id}`,
  );
  await page.getByRole("heading", { name: "Confirm Image Restore" }).waitFor();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  assert.equal(
    (
      await q('select is_archived from public."tImageAsset" where id=$1', [
        image.id,
      ])
    )[0].is_archived,
    true,
    "Cancelling image restore must preserve archived status",
  );
  assert.equal(imageObjects.size, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS team/image browser → real handler/decoder → PostgreSQL → UI: canvas optimization, preview approval, lost upload response, shared logos, clone rosters/lineage, independent colors, event-side assignment, archival retention and mobile layout.",
  );
  // Saving one configuration section must not overwrite another dirty section.
  await page.goto("http://127.0.0.1:5187/#/configuration/general");
  const reasons = page.getByLabel("Selectable reason tiles");
  await reasons.fill("Safety\nPower\nUnapplied reason");
  await page
    .getByRole("button", { name: "Save ranking rules", exact: true })
    .click();
  await page.locator(".notice-success").filter({ hasText: "Saved." }).waitFor();
  assert.equal(await reasons.inputValue(), "Safety\nPower\nUnapplied reason");
  assert.equal(
    (
      await q('select penalty_reasons from public."tConfiguration"')
    )[0].penalty_reasons.includes("Unapplied reason"),
    false,
  );
  await page.goto("http://127.0.0.1:5187/#/configuration/key-mappings");
  await page.getByLabel("Shortcut left.clean.3", { exact: true }).fill("x");
  await page.getByLabel("Shortcut right.clean.3", { exact: true }).fill("x");
  await page
    .getByRole("alert")
    .filter({ hasText: "Each shortcut must be unique" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Save shared mappings", exact: true })
      .isDisabled(),
    true,
  );
  console.log(
    "PASS: Configuration section saves preserve other dirty input; keyboard collisions block saving.",
  );
  // Full-release-only navigation/dismissal verification reuses the same
  // authenticated Playwright + disposable PostgreSQL fixture.
  if (
    process.env.SCOREKEEPER_FULL_RELEASE_NAV === "1" &&
    !process.env.TEAM_ONLY
  ) {
    const { runNavigationReleaseAudit } = await import(
      "./navigation-release.mjs"
    );
    const oneId = async (table, name) => {
      const field = table === "tFencer" ? "display_name" : "name";
      const result = await q(
        `select id from public."${table}" where "${field}"=$1`,
        [name],
      );
      assert.equal(result.length, 1, `Missing navigation fixture: ${name}`);
      return result[0].id;
    };
    await page.setViewportSize({ width: 1440, height: 1000 });
    await runNavigationReleaseAudit({
      page,
      baseUrl: "http://127.0.0.1:5187",
      fixtures: {
        managerId: manager,
        fencerId: await oneId("tFencer", "Team Browser Fencer"),
        archivedFencerId: await oneId("tFencer", "Renamed Browser Fencer"),
        presetId: await oneId("tMatchPreset", "Edited preset"),
        eventId: teamEvent.id,
        teamId: cloned.id,
        imageId: image.id,
        expireRefereeClaim: async () => {
          await root();
          await db.exec(
            `do $$ declare m public."tTraditionalMatch"; begin select * into m from public."tTraditionalMatch" where left_name='Ari'; perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);update public."tTraditionalMatch" set lease_until=now()-interval '1 second' where id=m.id;end $$;`,
          );
          await auth(admin);
        },
        matchId: (
          await q(
            "select id from public.\"vMatchResults\" where left_name='Ari'",
          )
        )[0].id,
      },
    });
    assert.deepEqual(
      errors,
      [],
      "Navigation audit triggered a browser runtime error",
    );
  }
} catch (e) {
  for (const p of browser.contexts().flatMap((c) => c.pages())) {
    console.error(
      "BROWSER FAILURE:",
      p.url(),
      await p.locator("body").innerText(),
      await p.locator("label").evaluateAll((es) => es.map((e) => e.outerHTML)),
    );
    await p.screenshot({ path: "test-results/failure.png", fullPage: true });
  }
  throw e;
} finally {
  await browser.close();
  dev.kill();
  await db.close();
}
