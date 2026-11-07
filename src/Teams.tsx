import { useRef, useState } from "react";
import {
  rpc,
  type EventRecord,
  type Fencer,
  type ImageAsset,
  type TeamInstance,
  type TeamMember,
} from "./data";
import { ImagePicker, ImagePreview, useHashParams } from "./Images";
import { Intro, Notice, useAction, useRows } from "./ui";
const base = "/events/teams";
function teamHref(mode: string, id?: string, event?: string) {
  return `#${base}?mode=${mode}${id ? `&id=${encodeURIComponent(id)}` : ""}${event ? `&return_event=${encodeURIComponent(event)}` : ""}`;
}
function useTeamCommand() {
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  return async (
    action: string,
    team: string,
    revision: number | null,
    values: Record<string, unknown> = {},
  ) => {
    const key = JSON.stringify({ action, team, revision, values });
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    return rpc<{ team: TeamInstance; skipped: { id: string; name: string }[] }>(
      "team_command",
      {
        p_request_id: pending.current.id,
        p_action: action,
        p_team: team,
        p_revision: revision,
        p_values: values,
      },
    );
  };
}
export function TeamBadge({
  team,
  assets,
}: {
  team: TeamInstance;
  assets: ImageAsset[];
}) {
  return (
    <span className="team-badge">
      <span
        className="team-logo-backdrop"
        style={{ backgroundColor: team.team_color_hex }}
      >
        <ImagePreview
          asset={assets.find((x) => x.id === team.logo_image_asset_id)}
          path={team.image_path}
          url={team.image_url}
          alt={`${team.name} logo`}
        />
      </span>
      <span>
        {team.name}
        <small className="color-label">{team.team_color_hex}</small>
      </span>
    </span>
  );
}
export default function Teams() {
  const p = useHashParams(),
    teams = useRows<TeamInstance>("vTeamInstances"),
    events = useRows<EventRecord>("tEvent"),
    assets = useRows<ImageAsset>("tImageAsset");
  const mode = p.get("mode") ?? "lookup",
    id = p.get("id") ?? "",
    returnEvent = p.get("return_event") ?? undefined,
    selected = teams.data.find((t) => t.id === id);
  const [search, setSearch] = useState(
      () => sessionStorage.getItem("teams:search") ?? "",
    ),
    [filter, setFilter] = useState(
      () => sessionStorage.getItem("teams:filter") ?? "active",
    ),
    [sort, setSort] = useState("name"),
    [notice, setNotice] = useState("");
  const a = useAction(teams.reload),
    command = useTeamCommand();
  const back = returnEvent
    ? `#/events?mode=relationships&id=${encodeURIComponent(returnEvent)}`
    : `#${base}`;
  async function saved(result: {
    team: TeamInstance;
    skipped: { name: string }[];
  }) {
    setNotice(
      `Saved ${result.team.name}.${result.skipped.length ? ` Skipped inactive fencers: ${result.skipped.map((x) => x.name).join(", ")}.` : ""}`,
    );
    await teams.reload();
    window.location.hash = back.slice(1);
  }
  const list = teams.data
    .filter(
      (t) =>
        (filter === "all" ||
          (filter === "unassigned"
            ? !t.event_id && !t.is_archived
            : t.is_archived === (filter === "archived"))) &&
        `${t.name} ${t.id} ${events.data.find((e) => e.id === t.event_id)?.name ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (x, y) =>
        (sort === "event"
          ? String(x.event_id).localeCompare(String(y.event_id))
          : x.name.localeCompare(y.name)) * (sort === "reverse" ? -1 : 1),
    );
  return (
    <div className="team-pages">
      <Intro
        title={
          mode === "create"
            ? "Create team"
            : mode === "clone"
              ? "Clone previous team"
              : mode === "edit"
                ? "Edit team"
                : mode === "roster"
                  ? "Team roster"
                  : mode === "history"
                    ? "Team history"
                    : mode === "archive" || mode === "restore"
                      ? `Confirm ${mode} team`
                      : "Manage Teams"
        }
      >
        Each event entry has its own roster and appearance. Clone a previous
        team to continue its history.
      </Intro>
      {notice && <p role="status">{notice}</p>}
      <Notice
        error={teams.error || events.error || assets.error || a.error}
        success={a.status}
        loading={teams.loading}
      />
      {mode === "lookup" || (mode === "clone" && !selected) ? (
        <section className="card">
          <div className="button-row">
            <a
              className="primary"
              href={teamHref("create", undefined, returnEvent)}
            >
              New team
            </a>
            {mode === "clone" ? (
              <a href={back}>Cancel</a>
            ) : (
              <a href={teamHref("clone", undefined, returnEvent)}>
                Clone previous team
              </a>
            )}
            {returnEvent && <a href={back}>Back to event</a>}
          </div>
          <div className="form-grid">
            <label>
              Search teams
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  sessionStorage.setItem("teams:search", e.target.value);
                }}
              />
            </label>
            <label>
              Team status
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  sessionStorage.setItem("teams:filter", e.target.value);
                }}
              >
                {["active", "archived", "all", "unassigned"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort teams
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name">Name A–Z</option>
                <option value="reverse">Name Z–A</option>
                <option value="event">Event</option>
              </select>
            </label>
          </div>
          {mode === "clone" && (
            <p>
              Choose a source, including archived teams using the status filter.
              The clone gets fresh membership records for active fencers only.
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Team / color</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <TeamBadge team={t} assets={assets.data} />
                      <small title={t.id}>{t.id.slice(0, 8)}</small>
                    </td>
                    <td>
                      {events.data.find((e) => e.id === t.event_id)?.name ??
                        "Unassigned"}
                    </td>
                    <td>
                      {t.is_archived ? "Archived" : "Active"}
                      {t.assignment_locked ? " · Event fixed" : ""}
                    </td>
                    <td>
                      <div className="button-row">
                        {mode === "clone" ? (
                          <a href={teamHref("clone", t.id, returnEvent)}>
                            Clone {t.name}
                          </a>
                        ) : (
                          <>
                            <a href={teamHref("edit", t.id)}>Edit</a>
                            <a href={teamHref("roster", t.id)}>Roster</a>
                            <a href={teamHref("clone", t.id)}>Clone</a>
                            <a href={teamHref("history", t.id)}>History</a>
                            <a
                              href={teamHref(
                                t.is_archived ? "restore" : "archive",
                                t.id,
                              )}
                            >
                              {t.is_archived ? "Restore" : "Archive"}
                            </a>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!list.length && <p>No teams match.</p>}
        </section>
      ) : mode === "create" ||
        ((mode === "edit" || mode === "clone") && selected) ? (
        <TeamEditor
          key={`${mode}:${id}`}
          team={selected}
          mode={mode}
          events={events.data}
          assets={assets.data}
          reloadAssets={assets.reload}
          returnEvent={returnEvent}
          back={back}
          onSaved={saved}
        />
      ) : selected ? (
        <section className="card">
          {(mode === "roster" || mode === "history") && (
            <a href={back}>← Back to lookup</a>
          )}
          <h3>{selected.name}</h3>
          {mode === "roster" ? (
            <Roster team={selected} onChange={teams.reload} />
          ) : mode === "history" ? (
            <TeamHistory
              team={selected}
              teams={teams.data}
              assets={assets.data}
              events={events.data}
            />
          ) : (
            <>
              <p>
                Confirm {mode === "archive" ? "archiving" : "restoring"} this
                instance. Its history and related team instances are retained.
              </p>
              <button
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    await command(mode, selected.id, selected.revision);
                    window.location.hash = base;
                  })
                }
              >
                Confirm {mode}
              </button>{" "}
              <a href={back}>Cancel</a>
            </>
          )}
        </section>
      ) : (
        !teams.loading && (
          <p role="alert">
            Team not found. <a href={`#${base}`}>Return to lookup</a>
          </p>
        )
      )}
    </div>
  );
}
function TeamEditor({
  team,
  mode,
  events,
  assets,
  reloadAssets,
  returnEvent,
  back,
  onSaved,
}: {
  team?: TeamInstance;
  mode: string;
  events: EventRecord[];
  assets: ImageAsset[];
  reloadAssets: () => Promise<void>;
  returnEvent?: string;
  back: string;
  onSaved: (result: {
    team: TeamInstance;
    skipped: { name: string }[];
  }) => Promise<void>;
}) {
  const clone = mode === "clone",
    create = mode === "create";
  const [newId] = useState(() => crypto.randomUUID()),
    [name, setName] = useState(team?.name ?? ""),
    [scoring, setScoring] = useState(team?.mode ?? "traditional"),
    [eventId, setEventId] = useState(
      (clone || create ? returnEvent : team?.event_id) ?? "",
    ),
    [logo, setLogo] = useState(team?.logo_image_asset_id ?? null),
    [color, setColor] = useState(team?.team_color_hex ?? "#334155"),
    [external, setExternal] = useState(team?.image_url ?? ""),
    [legacyPath, setLegacyPath] = useState(team?.image_path ?? null),
    [picker, setPicker] = useState(false);
  const members = useRows<TeamMember>("tTeamMember"),
    fencers = useRows<Fencer>("tFencer"),
    a = useAction(),
    command = useTeamCommand();
  const skipped = clone
    ? members.data
        .filter((m) => m.team_id === team?.id && !m.removed_at)
        .map((m) => fencers.data.find((f) => f.id === m.fencer_id))
        .filter((f) => f && (f.is_archived || f.is_unregistered))
    : [];
  const eligible = events.filter(
    (e) =>
      e.competition_format === "team" &&
      e.mode === scoring &&
      ["draft", "active"].includes(e.status),
  );
  const previewTeam = {
    ...team,
    id: team?.id ?? newId,
    name,
    team_color_hex: /^#[0-9a-f]{6}$/i.test(color) ? color : "#334155",
    logo_image_asset_id: logo,
    image_path: legacyPath,
    image_url: external,
  } as TeamInstance;
  return (
    <section className="card">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            if (!/^#[0-9a-f]{6}$/i.test(color))
              throw new Error("Enter a six-digit color such as #334155.");
            const values = {
              name: name.trim(),
              mode: scoring,
              event_id: eventId || null,
              logo_image_asset_id: logo,
              team_color_hex: color,
              image_url: external.trim() || null,
              clear_legacy_image: legacyPath === null,
              ...(clone ? { source_id: team!.id } : {}),
            };
            const result = await command(
              create ? "create" : clone ? "clone" : "edit",
              create || clone ? newId : team!.id,
              create || clone ? null : team!.revision,
              values,
            );
            await onSaved(result);
          });
        }}
      >
        <fieldset disabled={a.busy || picker}>
          <legend>
            {clone
              ? `Clone ${team?.name}`
              : create
                ? "New team"
                : "Team details"}
          </legend>
          <label>
            Team name
            <input
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Scoring mode
            <select
              disabled={!create}
              value={scoring}
              onChange={(e) => {
                setScoring(e.target.value);
                setEventId("");
              }}
            >
              <option value="traditional">Traditional</option>
              <option value="control_point">
                Control Point (planning only)
              </option>
            </select>
          </label>
          <label>
            Assigned event
            <select
              aria-label="Assigned event"
              disabled={!create && !clone && team?.assignment_locked}
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {eventId && !eligible.some((e) => e.id === eventId) && (
                <option value={eventId}>
                  {events.find((e) => e.id === eventId)?.name ??
                    "Current event"}
                </option>
              )}
              {eligible.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          {!create && !clone && team?.assignment_locked && (
            <p>
              Event assignment is fixed by match or frozen history.{" "}
              <a href={teamHref("clone", team.id)}>Clone this team</a> for
              another event. Its roster and appearance remain editable.
            </p>
          )}
          <div className="button-row">
            <label>
              Team color
              <input
                aria-label="Team color picker"
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#334155"}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <label>
              Color hex
              <input
                required
                pattern="#[0-9a-fA-F]{6}"
                maxLength={7}
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
          </div>
          <TeamBadge team={previewTeam} assets={assets} />
          <button
            className="secondary"
            type="button"
            onClick={() => setPicker(true)}
          >
            Choose logo
          </button>
          <label>
            Legacy external image URL (optional)
            <input
              type="url"
              value={external}
              onChange={(e) => setExternal(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <p>Library logos take priority over retained legacy images.</p>
          {clone && (
            <p>
              Event assignment, scores and results are not copied.{" "}
              {skipped.length
                ? `Skipped inactive fencers: ${skipped.map((f) => f?.display_name).join(", ")}.`
                : "All currently active roster members will be copied."}
            </p>
          )}
          {clone && (
            <Notice
              error={members.error || fencers.error}
              loading={members.loading || fencers.loading}
            />
          )}
          <div className="button-row">
            <button
              className="primary"
              disabled={
                clone &&
                (members.loading ||
                  fencers.loading ||
                  !!members.error ||
                  !!fencers.error)
              }
            >
              {create
                ? "Create team"
                : clone
                  ? "Confirm clone"
                  : "Save changes"}
            </button>
            <a href={back}>Cancel</a>
          </div>
        </fieldset>
        {picker && (
          <ImagePicker
            selected={logo}
            onCancel={() => setPicker(false)}
            onSelect={(id) => {
              setLogo(id);
              if (!id) {
                setLegacyPath(null);
                setExternal("");
              }
              setPicker(false);
              void reloadAssets();
            }}
          />
        )}
      </form>
      <Notice error={a.error} success={a.status} />
    </section>
  );
}
function Roster({
  team,
  onChange,
}: {
  team: TeamInstance;
  onChange: () => Promise<void>;
}) {
  const members = useRows<TeamMember>("tTeamMember"),
    fencers = useRows<Fencer>("tFencer"),
    command = useTeamCommand(),
    [asOf, setAsOf] = useState(""),
    [search, setSearch] = useState("");
  const a = useAction(async () => {
    await Promise.all([members.reload(), onChange()]);
  });
  const timestamp = asOf ? new Date(`${asOf}Z`).getTime() : null;
  const visible = members.data.filter(
    (m) =>
      m.team_id === team.id &&
      (timestamp === null
        ? !m.removed_at
        : Date.parse(m.added_at) <= timestamp &&
          (!m.removed_at || Date.parse(m.removed_at) > timestamp)),
  );
  return (
    <>
      <p>
        The current roster remains editable after an event starts or completes.
        Every addition/removal retains actor and UTC time.
      </p>
      <label>
        Historical roster as of (UTC, blank for current)
        <input
          type="datetime-local"
          step="1"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </label>
      {asOf && (
        <p>
          Historical view. Imported legacy membership is known from the
          migration time; earlier records remain in legacy event history.
        </p>
      )}
      <ul>
        {visible.map((m) => (
          <li key={m.id}>
            {fencers.data.find((f) => f.id === m.fencer_id)?.display_name ??
              m.fencer_id}{" "}
            {fencers.data.find((f) => f.id === m.fencer_id)?.is_archived
              ? "(archived)"
              : ""}
            {!asOf && (
              <button
                disabled={a.busy}
                onClick={() =>
                  void a.run(() =>
                    command("remove_member", team.id, team.revision, {
                      membership_id: m.id,
                    }),
                  )
                }
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!asOf && (
        <>
          <label>
            Find fencer
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="roster-candidates">
            {fencers.data
              .filter(
                (f) =>
                  !f.is_unregistered &&
                  !f.is_archived &&
                  !visible.some((m) => m.fencer_id === f.id) &&
                  `${f.display_name} ${f.affiliation}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((f) => (
                <button
                  key={f.id}
                  disabled={a.busy || team.is_archived}
                  onClick={() =>
                    void a.run(() =>
                      command("add_member", team.id, team.revision, {
                        fencer_id: f.id,
                      }),
                    )
                  }
                >
                  Add {f.display_name}
                </button>
              ))}
          </div>
        </>
      )}
      <h4>Membership history (UTC)</h4>
      <ul>
        {members.data
          .filter((m) => m.team_id === team.id)
          .map((m) => (
            <li key={m.id}>
              {fencers.data.find((f) => f.id === m.fencer_id)?.display_name ??
                m.fencer_id}
              : added {m.added_at} by {m.added_by ?? "legacy import"}
              {m.removed_at
                ? `; removed ${m.removed_at} by ${m.removed_by}`
                : ""}
            </li>
          ))}
      </ul>
      <Notice
        error={members.error || fencers.error || a.error}
        success={a.status}
        loading={members.loading || fencers.loading}
      />
    </>
  );
}
function TeamHistory({
  team,
  teams,
  assets,
  events,
}: {
  team: TeamInstance;
  teams: TeamInstance[];
  assets: ImageAsset[];
  events: EventRecord[];
}) {
  const audits = useRows<{
    id: string;
    table_name: string;
    record_id: string;
    action: string;
    recorded_at: string;
    actor_id: string;
    old_value: unknown;
    new_value: unknown;
  }>("tAudit");
  const instances = teams.filter(
    (t) => t.team_identity_id === team.team_identity_id,
  );
  return (
    <>
      <p>
        Shared team identity: {team.team_identity_id}. Team scoring and
        statistics remain unavailable until team match rules are implemented.
      </p>
      {instances.map((t) => (
        <article className="card" key={t.id}>
          <TeamBadge team={t} assets={assets} />
          <p>
            {events.find((e) => e.id === t.event_id)?.name ?? "Unassigned"} ·{" "}
            {t.is_archived ? "Archived" : "Active"} · {t.id}
          </p>
          <p>
            {t.cloned_from_team_id
              ? `Cloned from ${teams.find((x) => x.id === t.cloned_from_team_id)?.name ?? t.cloned_from_team_id}`
              : "Original instance"}
          </p>
          <a href={teamHref("roster", t.id)}>Current and historical roster</a>
        </article>
      ))}
      <h4>Instance changes (UTC)</h4>
      {audits.data
        .filter(
          (a) =>
            a.table_name === "tTeam" &&
            instances.some((t) => t.id === a.record_id),
        )
        .sort((x, y) => y.recorded_at.localeCompare(x.recorded_at))
        .map((a) => (
          <details key={a.id}>
            <summary>
              {a.action} · {a.recorded_at} · {a.actor_id ?? "migration"}
            </summary>
            <pre>
              {JSON.stringify(
                { before: a.old_value, after: a.new_value },
                null,
                2,
              )}
            </pre>
          </details>
        ))}
      <Notice error={audits.error} />
    </>
  );
}
export function EventTeamAssignments({ event }: { event: EventRecord }) {
  const teams = useRows<TeamInstance>("vTeamInstances"),
    assets = useRows<ImageAsset>("tImageAsset"),
    command = useTeamCommand(),
    a = useAction(teams.reload),
    [search, setSearch] = useState("");
  const eligible =
    event.competition_format === "team" &&
    ["draft", "active"].includes(event.status);
  return (
    <section>
      <h3>Team assignments</h3>
      <p>
        One team instance per event assignment. Clone a team already used
        elsewhere.
      </p>
      <div className="button-row">
        <a href={teamHref("create", undefined, event.id)}>Create team</a>
        <a href={teamHref("clone", undefined, event.id)}>Clone previous team</a>
      </div>
      <h4>Assigned teams</h4>
      {teams.data
        .filter((t) => t.event_id === event.id)
        .map((t) => (
          <article className="card" key={t.id}>
            <TeamBadge team={t} assets={assets.data} />
            <div className="button-row">
              <a href={teamHref("roster", t.id)}>Edit roster</a>
              <a href={teamHref("edit", t.id)}>Edit team</a>
              <a href={teamHref("clone", t.id, event.id)}>Clone</a>
              <button
                disabled={a.busy || t.assignment_locked}
                onClick={() =>
                  void a.run(() =>
                    command("edit", t.id, t.revision, { event_id: null }),
                  )
                }
              >
                Unassign
              </button>
              {t.assignment_locked && (
                <span>Event fixed by fixtures or frozen history.</span>
              )}
            </div>
          </article>
        ))}
      {eligible && (
        <>
          <h4>Available unassigned teams</h4>
          <label>
            Search unassigned teams
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {teams.data
            .filter(
              (t) =>
                !t.event_id &&
                !t.is_archived &&
                t.mode === event.mode &&
                t.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((t) => (
              <article className="card" key={t.id}>
                <TeamBadge team={t} assets={assets.data} />
                <button
                  disabled={a.busy || t.assignment_locked}
                  onClick={() =>
                    void a.run(() =>
                      command("edit", t.id, t.revision, { event_id: event.id }),
                    )
                  }
                >
                  Assign {t.name}
                </button>
              </article>
            ))}
        </>
      )}
      <Notice
        error={teams.error || assets.error || a.error}
        success={a.status}
        loading={teams.loading}
      />
    </section>
  );
}
