#!/usr/bin/env node
// Select test coverage by risk, feature area, or changed files.
// Keep this registry synchronized with docs/TESTING.md.
import { spawnSync } from "node:child_process";

const tests = {
  tournament: "tests/tournament.test.mjs",
  match: "tests/match-redesign.test.mjs",
  account: "tests/account-endpoint.test.mjs",
  database: "tests/database.test.mjs",
  teams: "tests/team-instances.test.mjs",
  images: "tests/image-assets.test.mjs",
  browser: "tests/browser.test.mjs",
};
const suiteOrder = Object.keys(tests);
const nonBrowser = suiteOrder.filter((name) => name !== "browser");
const smoke = ["tournament", "match"];
const areas = {
  match: ["match", "database", "tournament"],
  tournament: ["tournament", "match", "database"],
  account: ["account", "database"],
  database: ["database", "match", "teams", "tournament"],
  teams: ["teams", "database", "images"],
  images: ["images", "teams"],
  events: ["tournament", "match", "database", "teams"],
  history: ["match", "database", "teams"],
  configuration: ["database", "account", "match", "teams"],
  ui: ["browser"],
  all: nonBrowser,
};
const args = process.argv.slice(2);
const has = (flag) => args.includes("--" + flag);
function get(flag) {
  const inline = args.find((arg) => arg.startsWith("--" + flag + "="));
  if (inline) return inline.slice(flag.length + 3);
  const index = args.indexOf("--" + flag);
  return index === -1 ? null : args[index + 1] ?? null;
}
function csv(value) {
  return (value ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}
function fail(message) {
  console.error("TEST SELECTION ERROR: " + message);
  process.exit(2);
}
function run(cmd, commandArgs, options = {}) {
  const result = spawnSync(cmd, commandArgs, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32" && cmd === "npm",
  });
  if (result.error || result.status !== 0) {
    if (options.capture) return null;
    console.error("Failed: " + cmd + " " + commandArgs.join(" "));
    process.exit(result.status || 1);
  }
  return options.capture ? result.stdout.trim() : "";
}
function changedFiles() {
  const base = get("base") || "origin/main";
  const committed = run("git", ["diff", "--name-only", "--diff-filter=ACMR", base + "...HEAD"], { capture: true });
  const local = run("git", ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], { capture: true });
  const newFiles = run("git", ["ls-files", "--others", "--exclude-standard"], { capture: true });
  if ([committed, local, newFiles].some((result) => result === null)) return null;
  return [...new Set([committed, local, newFiles].flatMap((part) => part.split(/\r?\n/)).filter(Boolean))];
}
function isDocumentation(path) {
  return path === "README.md" || path.startsWith("docs/") || path.endsWith(".md");
}
function affected(path) {
  const p = path.replaceAll("\\", "/");
  if (isDocumentation(p)) return [];
  // Release/toolchain, migration, or unknown changes require broad coverage.
  if (/^(package(-lock)?\.json|tsconfig\.json|vite\.config\.ts|\.github\/|scripts\/)/.test(p) ||
      p === "tests/schema-baseline.sql" || p.startsWith("supabase/migrations/") ||
      p.startsWith("src/db/")) return [...nonBrowser, "browser"];
  const exactTest = Object.entries(tests).find(([, file]) => file === p);
  if (exactTest) return [exactTest[0]];
  if (p.startsWith("tests/fixtures/")) return ["images", "browser"];
  if (p.startsWith("tests/")) return [...nonBrowser, "browser"];
  if (p.startsWith("supabase/functions/manage-users/")) return [...areas.account, "browser"];
  if (p.startsWith("supabase/functions/image-assets/") || p.startsWith("supabase/functions/_shared/image")) return [...areas.images, "browser"];
  if (p.startsWith("supabase/")) return [...nonBrowser, "browser"];
  if (/^src\/(Scorekeeper|MatchLog|match|liveMatch|useMatchSession)\./.test(p)) return [...areas.match, "browser"];
  if (/^src\/tournament\./.test(p)) return [...areas.tournament, "browser"];
  if (/^src\/Auth\./.test(p)) return [...areas.account, "browser"];
  if (/^src\/Teams\./.test(p)) return [...areas.teams, "browser"];
  if (/^src\/(Images|imageProcessing)\./.test(p)) return [...areas.images, "browser"];
  if (/^src\/(Events|RecordPages)\./.test(p)) return [...areas.events, "browser"];
  if (/^src\/History\./.test(p)) return [...areas.history, "browser"];
  if (/^src\/Configuration\./.test(p)) return [...areas.configuration, "browser"];
  if (/^src\/(App|Pages|Management|navigation|main|ui|data|styles|vite-env)\./.test(p) ||
      p === "index.html") return ["browser"];
  return [...nonBrowser, "browser"];
}

if (has("list")) {
  console.log("Suites: " + suiteOrder.join(", "));
  console.log("Scopes: " + Object.keys(areas).join(", "));
  console.log("Tiers: smoke, integration, full");
  process.exit(0);
}
const selected = new Set();
let source = "";
if (get("only") !== null) {
  const names = csv(get("only"));
  if (!names.length || names.some((name) => !tests[name])) fail("--only must name one or more known suites");
  names.forEach((name) => selected.add(name));
  source = "explicit test override";
} else if (get("scope") !== null) {
  const names = csv(get("scope"));
  if (!names.length || names.some((name) => !areas[name])) fail("--scope must name one or more known scopes");
  smoke.forEach((name) => selected.add(name));
  names.flatMap((name) => areas[name]).forEach((name) => selected.add(name));
  source = "scope: " + names.join(", ");
} else if (has("changed")) {
  const files = changedFiles();
  if (files === null) {
    console.warn("Could not resolve Git diff; selecting all suites (conservative fallback).");
    [...nonBrowser, "browser"].forEach((name) => selected.add(name));
  } else if (!files.length) {
    smoke.forEach((name) => selected.add(name));
  } else if (files.some((path) => !isDocumentation(path.replaceAll("\\", "/")))) {
    smoke.forEach((name) => selected.add(name));
    files.flatMap(affected).forEach((name) => selected.add(name));
  }
  source = files === null ? "unknown diff" : "changed files (" + files.length + "): " + (files.join(", ") || "none");
} else {
  const tier = get("tier");
  if (tier === "smoke") smoke.forEach((name) => selected.add(name));
  else if (tier === "integration") nonBrowser.forEach((name) => selected.add(name));
  else if (tier === "full") suiteOrder.forEach((name) => selected.add(name));
  else fail("Choose --tier=smoke|integration|full, --changed, --scope=<area>, --only=<suite>, or --list");
  source = "tier: " + tier;
}

const browserSuggested = selected.has("browser");
if (browserSuggested && !has("browser") && get("tier") !== "full") selected.delete("browser");
const chosen = suiteOrder.filter((name) => selected.has(name));
console.log("Selection: " + source);
console.log("Running: " + (chosen.join(", ") || "no tests (documentation only)"));
if (browserSuggested && !chosen.includes("browser")) {
  console.warn("Browser coverage is relevant but deferred. Add --browser or run npm run test:full before release.");
}
if (has("dry-run")) process.exit(0);
if (!chosen.length) process.exit(0);
if (!has("no-build")) run("npm", ["run", "build"]);
for (const name of chosen) {
  console.log("\n== " + name + " ==");
  run(process.execPath, [tests[name]]);
}
console.log("\nPASS: " + chosen.length + " selected test suite(s).");
