// Full-release-only navigation audit, run inside browser.test.mjs's authenticated
// Playwright + disposable PostgreSQL fixture. This is not part of T0/T1.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const components = [
  "App", "Auth", "Configuration", "Events", "History", "Images",
  "Management", "Pages", "RecordPages", "Scorekeeper", "Teams", "ui",
  "MatchLog",
];

function jsxTag(node, source) {
  return (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    ? node.tagName.getText(source)
    : null;
}
function hasAttribute(node, key) {
  return node.attributes?.properties.some(
    (p) => ts.isJsxAttribute(p) && p.name.text === key,
  ) ?? false;
}
function formAncestor(node, source) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "form")
      return true;
  }
  return false;
}

// This static half checks EVERY JSX button, link, and native dialog (including
// branches not reachable with these fixtures). It cannot prove that handlers
// complete correctly; interactive checks below cover the dangerous exits.
export async function auditDeclaredControls() {
  const issues = [];
  const counts = { buttons: 0, links: 0, dialogs: 0 };
  for (const name of components) {
    const path = new URL(`../src/${name}.tsx`, import.meta.url);
    const code = await readFile(path, "utf8");
    const tree = ts.createSourceFile(path.pathname, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(tree.parseDiagnostics.length, 0, `JSX syntax in ${name}`);
    function visit(node) {
      const tag = jsxTag(node, tree);
      if (tag === "button") {
        counts.buttons++;
        if (!hasAttribute(node, "onClick") && !formAncestor(node, tree))
          issues.push(`${name}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}: button has no handler or submit form`);
      } else if (tag === "a") {
        counts.links++;
        if (!hasAttribute(node, "href"))
          issues.push(`${name}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}: link has no destination`);
      } else if (tag === "dialog") {
        counts.dialogs++;
        if (!hasAttribute(node, "onCancel"))
          issues.push(`${name}: native dialog has no Escape/cancel handler`);
      } else if (tag === "Dialog") {
        if (!hasAttribute(node, "onClose"))
          issues.push(`${name}: custom Dialog has no close handler`);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  assert.ok(counts.buttons >= 40 && counts.links >= 30, "Control inventory unexpectedly shrank");
  assert.deepEqual(issues, [], "Orphaned JSX controls:\n" + issues.join("\n"));
  return counts;
}

async function readRoutes() {
  const src = await readFile(new URL("../src/navigation.ts", import.meta.url), "utf8");
  const match = src.match(/export const ALL_ROUTES = \[([\s\S]*?)\] as const;/);
  assert.ok(match, "ALL_ROUTES registry is accessible");
  const routes = [...match[1].matchAll(/"(\/[^"]*)"/g)].map((x) => x[1]);
  assert.equal(routes.length, new Set(routes).size, "Duplicate registered routes");
  assert.ok(routes.includes("/history/matches") && routes.includes("/configuration/team-images"));
  return routes;
}

export async function runNavigationReleaseAudit({ page, baseUrl, fixtures }) {
  const counts = await auditDeclaredControls();
  const routes = await readRoutes();
  const knownRoutes = new Set(routes);
  let internalLinks = 0;
  const navigate = (hash) => page.goto(`${baseUrl}/#${hash}`);

  // Visit EVERY registered route with live Auth, fixtures, and React routing.
  // Check every visible internal link has a registered destination (including
  // dynamically created row links); no production service is contacted.
  for (const route of routes) {
    await navigate(route);
    await page.locator("main").waitFor();
    if (route !== "/single-match")
      await page.locator(".app-breadcrumb").waitFor({ state: "visible" });
    const targets = await page.locator('a[href^="#/"]').evaluateAll((links) =>
      links.filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getAttribute("href")),
    );
    for (const target of targets) {
      const pathname = target.slice(1).split("?")[0].replace(/\/$/, "") || "/";
      assert.ok(knownRoutes.has(pathname), `Dead link from ${route}: ${target}`);
      internalLinks++;
    }
  }

  // Exercise every dashboard and submenu tile rather than just checking href.
  for (const route of ["/", "/history", "/configuration"]) {
    await navigate(route);
    const targets = await page.locator(".nav-tile").evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")).filter(Boolean),
    );
    for (const href of targets) {
      await navigate(route);
      await page.locator(`.nav-tile[href="${href}"]`).click();
      assert.equal(new URL(page.url()).hash, href, `Tile did not navigate: ${href}`);
    }
  }

  // Record management: opening Create/Edit/Archive/Restore/Delete then
  // cancelling must exit without making an accidental database mutation.
  const records = [
    ["/users", "create"],
    ["/users", "edit", fixtures.managerId],
    ["/users", "archive", fixtures.managerId],
    ["/users", "delete", fixtures.managerId],
    ["/fencers", "create"],
    ["/fencers", "edit", fixtures.fencerId],
    ["/fencers", "archive", fixtures.fencerId],
    ["/fencers", "restore", fixtures.archivedFencerId],
    ["/presets", "create"],
    ["/presets", "edit", fixtures.presetId],
    ["/presets", "archive", fixtures.presetId],
    ["/events", "create"],
    ["/events", "edit", fixtures.eventId],
    ["/events", "archive", fixtures.eventId],
  ];
  for (const [route, mode, id] of records) {
    const hash = `${route}?mode=${mode}${id ? `&id=${id}` : ""}`;
    await navigate(hash);
    const cancel = page.getByRole("link", { name: "Cancel", exact: true });
    await cancel.waitFor({ state: "visible" });
    assert.equal(await cancel.count(), 1, `Expected one Cancel for ${hash}`);
    assert.equal(await page.getByRole("link", { name: /Back to lookup/i }).count(), 0,
      `Duplicate Back/Cancel in ${hash}`);
    await cancel.click();
    assert.equal(new URL(page.url()).hash, `#${route}`, `Cancel failed: ${hash}`);
  }

  // Relationship page has only Back to lookup, not a duplicate Cancel.
  await navigate(`/events?mode=relationships&id=${fixtures.eventId}`);
  await page.getByRole("link", { name: /Back to lookup/i }).click();
  assert.equal(new URL(page.url()).hash, "#/events");

  // Team source picker must have a working Cancel, not a self-referential
  // "Clone previous team" link. Team editor, clone, archive, and history exits.
  await navigate("/events/teams?mode=clone");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#/events/teams");
  for (const mode of ["create", "edit", "clone", "archive", "restore"]) {
    const hash = `/events/teams?mode=${mode}${mode === "create" ? "" : `&id=${fixtures.teamId}`}`;
    await navigate(hash);
    const cancel = page.getByRole("link", { name: "Cancel", exact: true });
    await cancel.waitFor({ state: "visible" });
    assert.equal(await cancel.count(), 1, `Team ${mode} has one Cancel`);
    await cancel.click();
    assert.equal(new URL(page.url()).hash, "#/events/teams");
  }
  for (const mode of ["roster", "history"]) {
    await navigate(`/events/teams?mode=${mode}&id=${fixtures.teamId}`);
    await page.getByRole("link", { name: /Back to lookup/i }).click();
    assert.equal(new URL(page.url()).hash, "#/events/teams");
  }

  // Nested image picker and upload cancellations must return to the correct
  // level; the editor and its unsaved data must remain present.
  await navigate(`/events/teams?mode=edit&id=${fixtures.teamId}`);
  await page.getByRole("button", { name: "Choose logo", exact: true }).click();
  await page.getByRole("button", { name: "Upload new image", exact: true }).click();
  await page.getByRole("button", { name: "Cancel upload", exact: true }).click();
  await page.getByRole("button", { name: "Cancel selection", exact: true }).click();
  assert.equal(await page.locator('section[aria-label="Choose team logo"]').count(), 0);
  assert.equal(await page.getByLabel("Team name", { exact: true }).count(), 1);
  await navigate("/configuration/team-images?mode=upload");
  await page.getByRole("button", { name: "Cancel upload", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#/configuration/team-images");
  await navigate(`/configuration/team-images?mode=archive&id=${fixtures.imageId}`);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#/configuration/team-images");

  // A real previously broken control: X / Escape on Manage while its nested
  // Admin mode is displayed. A native confirm must protect staged changes.
  await navigate("/single-match");
  await page.getByRole("button", { name: "Manage", exact: true }).waitFor();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Admin Mode", exact: true }).click();
  const closeManage = page.getByRole("button", { name: "Close Manage match" });
  await closeManage.waitFor();
  page.once("dialog", (prompt) => prompt.dismiss());
  await closeManage.click();
  assert.equal(await page.locator('dialog[open]').count(), 1,
    "Rejecting the discard confirmation must preserve the Admin dialog");
  page.once("dialog", (prompt) => prompt.accept());
  await closeManage.click();
  await page.locator('dialog[open]').waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Admin Mode", exact: true }).click();
  await page.getByRole("button", { name: "Card penalty…" }).click();
  await page.getByRole("button", { name: "Close Assign card penalty" }).click();
  assert.equal(await page.locator('dialog[open]').count(), 1,
    "Penalty X should close only the nested penalty dialog");
  page.once("dialog", (prompt) => prompt.accept());
  await page.keyboard.press("Escape");
  await page.locator('dialog[open]').waitFor({ state: "detached" });

  console.log(
    `PASS full-release navigation: ${routes.length} routes, ${internalLinks} visible internal links validated, ${counts.buttons} JSX buttons/${counts.links} links audited; Create/Edit/Archive/Restore/Delete Cancel, clone picker, team/image exits, nested penalty X, Manage X/Escape.`,
  );
}
