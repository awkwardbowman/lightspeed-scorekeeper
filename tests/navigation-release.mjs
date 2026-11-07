// Full-release-only navigation audit, run inside browser.test.mjs's authenticated
// Playwright + disposable PostgreSQL fixture. This is not part of T0/T1.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const components = [
  "App",
  "Auth",
  "Configuration",
  "Events",
  "History",
  "Images",
  "Management",
  "Pages",
  "RecordPages",
  "Scorekeeper",
  "Teams",
  "ui",
  "MatchLog",
  "AdminScoreboard",
  "CardHistory",
  "MatchReport",
  "PhasePages",
  "BracketView",
];

function jsxTag(node, source) {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
    ? node.tagName.getText(source)
    : null;
}
function hasAttribute(node, key) {
  return (
    node.attributes?.properties.some(
      (p) => ts.isJsxAttribute(p) && p.name.text === key,
    ) ?? false
  );
}
function formAncestor(node, source) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isJsxElement(parent) &&
      parent.openingElement.tagName.getText(source) === "form"
    )
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
    const tree = ts.createSourceFile(
      path.pathname,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    assert.equal(tree.parseDiagnostics.length, 0, `JSX syntax in ${name}`);
    function visit(node) {
      const tag = jsxTag(node, tree);
      if (tag === "button") {
        counts.buttons++;
        if (!hasAttribute(node, "onClick") && !formAncestor(node, tree))
          issues.push(
            `${name}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}: button has no handler or submit form`,
          );
      } else if (tag === "a") {
        counts.links++;
        if (!hasAttribute(node, "href"))
          issues.push(
            `${name}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}: link has no destination`,
          );
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
  assert.ok(
    counts.buttons >= 40 && counts.links >= 30,
    "Control inventory unexpectedly shrank",
  );
  assert.deepEqual(issues, [], "Orphaned JSX controls:\n" + issues.join("\n"));
  return counts;
}

async function readRoutes() {
  const src = await readFile(
    new URL("../src/navigation.ts", import.meta.url),
    "utf8",
  );
  const match = src.match(/export const ALL_ROUTES = \[([\s\S]*?)\] as const;/);
  assert.ok(match, "ALL_ROUTES registry is accessible");
  const routes = [...match[1].matchAll(/"(\/[^"]*)"/g)].map((x) => x[1]);
  assert.equal(
    routes.length,
    new Set(routes).size,
    "Duplicate registered routes",
  );
  assert.ok(
    routes.includes("/history/matches") &&
      routes.includes("/configuration/team-images"),
  );
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
    const targets = await page
      .locator('a[href^="#/"]')
      .evaluateAll((links) =>
        links
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => el.getAttribute("href")),
      );
    for (const target of targets) {
      const pathname = target.slice(1).split("?")[0].replace(/\/$/, "") || "/";
      assert.ok(
        knownRoutes.has(pathname),
        `Dead link from ${route}: ${target}`,
      );
      internalLinks++;
    }
  }

  // Exercise every dashboard and submenu tile rather than just checking href.
  for (const route of ["/", "/history", "/configuration"]) {
    await navigate(route);
    const targets = await page
      .locator(".nav-tile")
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("href")).filter(Boolean),
      );
    for (const href of targets) {
      await navigate(route);
      await page.locator(`.nav-tile[href="${href}"]`).click();
      assert.equal(
        new URL(page.url()).hash,
        href,
        `Tile did not navigate: ${href}`,
      );
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
    assert.equal(
      await page.getByRole("link", { name: /Back to lookup/i }).count(),
      0,
      `Duplicate Back/Cancel in ${hash}`,
    );
    await cancel.click();
    assert.equal(
      new URL(page.url()).hash,
      `#${route}`,
      `Cancel failed: ${hash}`,
    );
  }

  // Cancel must also discard unsaved input, not just change the URL.
  await navigate(`/fencers?mode=edit&id=${fixtures.fencerId}`);
  const fencerName = page.getByLabel("Display name", { exact: true });
  await fencerName.waitFor({ state: "visible" });
  const originalName = await fencerName.inputValue();
  await fencerName.fill("UNSAVED NAVIGATION TEST — DO NOT STORE");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("heading", { name: "Manage Fencers", exact: true })
    .waitFor();
  await navigate(`/fencers?mode=edit&id=${fixtures.fencerId}`);
  await fencerName.waitFor({ state: "visible" });
  assert.equal(
    await fencerName.inputValue(),
    originalName,
    "Cancel must not persist unsaved form edits",
  );

  // Relationship page has only Back to lookup, not a duplicate Cancel.
  await navigate(`/events?mode=relationships&id=${fixtures.eventId}`);
  await page.getByRole("link", { name: /Back to lookup/i }).click();
  assert.equal(new URL(page.url()).hash, "#/events");

  // Team source picker must have a working Cancel, not a self-referential
  // "Clone previous team" link. Team editor, clone, archive, and history exits.
  await navigate("/events/teams?mode=clone");
  assert.equal(
    await page
      .getByRole("link", { name: "Clone previous team", exact: true })
      .count(),
    0,
    "Clone-source screen must not link to itself",
  );
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
  await page
    .getByRole("button", { name: "Upload new image", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel upload", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel selection", exact: true })
    .click();
  assert.equal(
    await page.locator('section[aria-label="Choose team logo"]').count(),
    0,
  );
  assert.equal(await page.getByLabel("Team name", { exact: true }).count(), 1);
  await navigate("/configuration/team-images?mode=upload");
  await page
    .getByRole("button", { name: "Cancel upload", exact: true })
    .click();
  assert.equal(new URL(page.url()).hash, "#/configuration/team-images");
  await navigate(
    `/configuration/team-images?mode=archive&id=${fixtures.imageId}`,
  );
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#/configuration/team-images");

  // Reopen the saved fixture bout after the normal browser test explicitly
  // abandoned the screen; Abandon must never delete or auto-reopen it.
  await navigate("/history/matches");
  await page.evaluate(
    (id) => sessionStorage.setItem("openMatch", id),
    fixtures.matchId,
  );
  await navigate("/single-match");
  await page.getByRole("button", { name: "Match Report", exact: true }).click();
  await page.getByRole("button", { name: "Edit Match", exact: true }).click();
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "Admin is a full-screen scoreboard, not a nested dialog",
  );
  await page
    .getByRole("button", { name: "Increase Left score", exact: true })
    .click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page
    .getByRole("button", { name: "Stay in Admin Mode", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Admin Mode", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Discard and Resume", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit Match", exact: true }).click();
  await fixtures.expireRefereeClaim();
  await page
    .getByRole("button", { name: "Recover Expired Claim", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Incomplete", exact: true })
    .waitFor({ state: "visible" });
  await page
    .getByRole("status")
    .filter({ hasText: "Referee claim recovered" })
    .waitFor();
  await page
    .getByRole("button", { name: "Increase Right score", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply right score", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Apply right score"]')?.disabled,
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page
    .getByRole("heading", { name: "Match Report", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".final-score").innerText(),
    /4[\s\S]*4/,
    "Report refreshes after a finalized score correction",
  );
  await page.getByRole("button", { name: "Edit Match", exact: true }).click();
  // Every result choice is cancellable and leaves authoritative state alone.
  for (const label of [
    "Left Victory:",
    "Tie",
    "Incomplete",
    "Right Victory:",
  ]) {
    await page
      .getByRole("button", {
        name:
          label === "Tie" || label === "Incomplete" ? label : new RegExp(label),
        exact: label === "Tie" || label === "Incomplete",
      })
      .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  // Explicit Incomplete is the only route to reopening a finalized bout.
  await page.getByRole("button", { name: "Incomplete", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm Outcome", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Penalty on Ari", exact: true })
    .click();
  await page.getByRole("button", { name: "Close Assign card penalty" }).click();
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "Penalty X closes its popup only",
  );
  await page
    .getByRole("heading", { name: "Admin Mode", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Penalty on Ari", exact: true })
    .click();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "Penalty Escape closes its popup only",
  );
  await page.getByRole("button", { name: /Left Victory:/ }).click();
  await page
    .getByRole("button", { name: "Confirm Outcome", exact: true })
    .click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page
    .getByRole("heading", { name: "Match Report", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Edit Match", exact: true }).click();
  page.once("dialog", (prompt) => prompt.accept());
  await page
    .getByRole("button", { name: "Abandon Match", exact: true })
    .click();
  await page.waitForURL("**/#/");
  await navigate("/single-match");
  await page
    .getByRole("heading", { name: "Match Prep", exact: true })
    .waitFor();

  // Target completion stays on the scoreboard and exposes a deliberate report.
  await page.getByLabel("Participant name").nth(0).fill("Auto Left");
  await page.getByLabel("Participant name").nth(1).fill("Auto Right");
  await page.getByLabel("Preset", { exact: true }).selectOption("");
  await page.getByLabel("Length (seconds)").fill("180");
  await page.getByLabel("Match type", { exact: true }).selectOption("standard");
  await page.getByLabel("Score to Win (blank for no target)").fill("1");
  await page.getByRole("button", { name: "Start Match", exact: true }).click();
  await page
    .getByRole("button", { name: "left indirect +1", exact: true })
    .click();
  await page.getByRole("button", { name: "Match Report", exact: true }).click();
  await page
    .getByRole("heading", { name: "Auto Left Wins", exact: true })
    .waitFor();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "New Match", exact: true }).click();
  await page
    .getByRole("heading", { name: "Match Prep", exact: true })
    .waitFor();
  console.log(
    `PASS full-release navigation: ${routes.length} routes, ${internalLinks} visible internal links validated, ${counts.buttons} JSX buttons/${counts.links} links audited; Create/Edit/Archive/Restore/Delete Cancel, clone picker, team/image exits, penalty X/Escape, staged Resume choices, confirmed outcomes, expired referee recovery, refreshed report and Abandon Match return.`,
  );
}
