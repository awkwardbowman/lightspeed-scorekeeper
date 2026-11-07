import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function runPhaseBrowser({
  page,
  q,
  auth,
  admin,
  setDropNextPhase,
}) {
  await auth(admin);
  const event = randomUUID(),
    standard = randomUUID(),
    knockout = randomUUID(),
    fs = Array.from({ length: 4 }, () => randomUUID());
  await q(
    `insert into public."tMatchPreset"(id,owner_id,name,match_type,duration_ms,target_score) values($1,$3,'Browser Phase Standard','standard',60000,10),($2,$3,'Browser Phase Knockout','knockout',300000,24)`,
    [standard, knockout, admin],
  );
  await q(
    `insert into public."tEvent"(id,owner_id,name,mode,preset_id) values($1,$2,'Phase Browser Event','traditional',$3)`,
    [event, admin, standard],
  );
  for (let i = 0; i < 4; i++) {
    await q(
      "insert into public.\"tFencer\"(id,owner_id,display_name,affiliation) values($1,$2,$3,'Phase Academy')",
      [fs[i], admin, `Phase Fencer ${i + 1}`],
    );
    await q('insert into public."tEventFencer" values($1,$2)', [event, fs[i]]);
  }
  const go = (hash) => page.goto(`http://127.0.0.1:5187/${hash}`);
  const manager = `#/events/phases?event=${event}`;
  const run = `#/run-event?event=${event}`;
  async function create(name, kind, preset) {
    await go(manager);
    await page.getByRole("link", { name: "New Phase", exact: true }).click();
    await page.getByLabel("Phase Name", { exact: true }).fill(name);
    await page
      .getByRole("combobox", { name: "Scheduling Format", exact: true })
      .selectOption(kind);
    await page
      .getByRole("combobox", { name: "Phase Preset", exact: true })
      .selectOption(preset);
    await page
      .getByRole("button", { name: "Create Phase", exact: true })
      .click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    return (
      await q(
        'select id from public."tEventPhase" where event_id=$1 and name=$2',
        [event, name],
      )
    )[0].id;
  }
  async function roster(phase, n) {
    await go(`${manager}&phase=${phase}&mode=registration`);
    assert.equal(
      await page
        .getByRole("button", { name: "Activate Event", exact: true })
        .count(),
      0,
      "no event lifecycle controls in setup",
    );
    for (let i = 0; i < n; i++) {
      const name = `Phase Fencer ${i + 1}`;
      await page
        .getByRole("button", { name: `Add ${name}`, exact: true })
        .click();
      const input = page.getByLabel(`Seed for ${name}`, { exact: true });
      await input.fill(String(i + 1));
      await input
        .locator("..")
        .getByRole("button", { name: "Save Seed", exact: true })
        .click();
      await page.waitForFunction((label) => {
        const input = document.querySelector(`input[aria-label="${label}"]`);
        return input?.parentElement?.querySelector("button")?.disabled;
      }, `Seed for ${name}`);
    }
    await page
      .getByRole("combobox", { name: "Phase Registration Filter", exact: true })
      .selectOption("registered");
    assert.equal(
      await page.getByRole("button", { name: /^Remove Phase Fencer/ }).count(),
      n,
    );
    await page
      .getByRole("combobox", { name: "Phase Registration Filter", exact: true })
      .selectOption("unregistered");
    assert.equal(
      await page.getByRole("button", { name: /^Add Phase Fencer/ }).count(),
      4 - n,
    );
  }
  async function generate(phase, drop = false) {
    await go(`${manager}&phase=${phase}&mode=generator`);
    if (drop) setDropNextPhase();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Generate Phase Schedule", exact: true })
      .click();
    if (drop) {
      await page
        .getByRole("button", { name: "Retry Phase Save", exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", { name: "Retry Phase Save", exact: true })
        .click();
    }
    await page
      .getByRole("region", { name: "Phase Bracket", exact: true })
      .waitFor();
  }
  const group = await create("Browser Group A", "group", standard);
  await go(run);
  await page
    .locator(".phase-tile.state-empty")
    .filter({ hasText: "Browser Group A" })
    .waitFor();
  assert.equal(
    await page.getByRole("checkbox").count(),
    0,
    "Run Event has no embedded registration editor",
  );
  await roster(group, 4);
  await generate(group, true);
  assert.equal(
    (
      await q(
        'select count(*)::int n from public."tBracket" where phase_id=$1',
        [group],
      )
    )[0].n,
    1,
    "lost response/regeneration retry keeps one generation",
  );
  assert.equal(
    (
      await q(
        'select count(*)::int n from public."tTraditionalMatch" where phase_id=$1',
        [group],
      )
    )[0].n,
    6,
  );
  await go(run);
  await page
    .locator(".phase-tile.state-scheduled")
    .filter({ hasText: "Browser Group A" })
    .waitFor();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Activate Event", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete Event", exact: true })
    .waitFor();
  await page
    .locator(".phase-tile")
    .filter({ hasText: "Browser Group A" })
    .click();
  assert.equal(
    await page.getByRole("checkbox").count(),
    1,
    "phase execution only has archived-match filter",
  );
  const first = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: "Run Match", exact: true }),
    })
    .first();
  await first.getByRole("button", { name: "Run Match", exact: true }).click();
  await page
    .getByRole("heading", { name: "Match Prep", exact: true })
    .waitFor();
  await page.getByText(/Phase Browser Event · Browser Group A/).waitFor();
  assert.equal(await page.getByLabel("Length (seconds)").inputValue(), "60");
  await page.getByRole("button", { name: "Start Match", exact: true }).click();
  await page
    .getByRole("button", { name: "left counter +5", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".live-side.left .live-score")?.textContent ===
      "5",
  );
  await page
    .getByRole("button", { name: "left counter +5", exact: true })
    .click();
  await page.getByRole("button", { name: "Match Report", exact: true }).click();
  await page
    .getByText(/Event: Phase Browser Event · Phase: Browser Group A/)
    .waitFor();
  await page.getByRole("button", { name: "Edit Match", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Abandon Match", exact: true })
    .click();
  await go(run);
  await page
    .locator(".phase-tile.state-active")
    .filter({ hasText: "Browser Group A" })
    .waitFor();
  // A later phase may be created while earlier group matches remain unplayed.
  const winner = await create("Browser Winners", "single", knockout);
  await roster(winner, 3);
  await generate(winner);
  assert.equal(
    (
      await q(
        'select count(*)::int n from public."tPhaseRegistration" where fencer_id=$1 and event_id=$2',
        [fs[0], event],
      )
    )[0].n,
    2,
  );
  await go(`${run}&phase=${winner}`);
  await page
    .getByRole("region", { name: "Phase Bracket", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("row")
      .filter({ hasText: "Waiting for Results" })
      .count(),
    1,
  );
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: "Run Match", exact: true }),
    })
    .filter({ hasText: "Scheduled" })
    .first()
    .getByRole("button", { name: "Run Match", exact: true })
    .click();
  await page.getByRole("button", { name: "Start Match", exact: true }).click();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: /Left Victory:/ }).click();
  await page
    .getByRole("button", { name: "Confirm Outcome", exact: true })
    .click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Match Report", exact: true }).click();
  await page.getByText(/Phase: Browser Winners/).waitFor();
  await page.getByRole("button", { name: "Edit Match", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Abandon Match", exact: true })
    .click();
  await go(`${run}&phase=${winner}`);
  assert.equal(
    await page
      .getByRole("row")
      .filter({ hasText: "Waiting for Results" })
      .count(),
    0,
    "final populated without a sync control",
  );
  await page
    .getByRole("region", { name: "Phase Bracket", exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/phase-bracket-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/phase-bracket-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "phase/bracket page contains horizontal overflow within the bracket viewport",
  );
  await page
    .getByRole("link", { name: "Phase Registration", exact: true })
    .click();
  await page.getByRole("link", { name: "← Back", exact: true }).click();
  assert.equal(
    new URL(page.url()).hash,
    `${run}&phase=${winner}`,
    "phase registration returns to the invoking execution context",
  );
  await go("#/");
  console.log(
    "PASS phase browser → API → PostgreSQL → UI: phase creation, seeded multi-phase registration/filtering, draft generation/lost response/reload, state tiles, scoped match prep/report, automatic byes/winner advancement, later phases and mobile bracket layout.",
  );
}
