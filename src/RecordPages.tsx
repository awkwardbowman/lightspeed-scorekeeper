import { useEffect, useState, type ReactNode } from "react";
import { useAccount } from "./Auth";
import { manage, rpc, write, type EventRecord, type Preset } from "./data";
import { BackLink, Intro, Notice, useAction, useRows, DeleteButton } from "./ui";
import { EventTeamAssignments } from "./Teams";
import { CopyId } from "./Images";
import { Registration } from "./Events";

type Entity = "fencers" | "presets" | "users" | "events" | "teams";
type Row = { id: string; [key: string]: unknown };
type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: [string, string][];
  min?: number;
  max?: number;
};
const definitions: Record<
  Entity,
  {
    table: string;
    name: string;
    fields: Field[];
    defaults: Record<string, unknown>;
  }
> = {
  fencers: {
    table: "tFencer",
    name: "fencer",
    fields: [
      { key: "display_name", label: "Display name", required: true },
      { key: "affiliation", label: "Club / affiliation" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    defaults: { display_name: "", affiliation: "", notes: "" },
  },
  presets: {
    table: "tMatchPreset",
    name: "preset",
    fields: [
      { key: "name", label: "Name", required: true },
      {
        key: "match_type",
        label: "Match Type",
        required: true,
        options: [
          ["standard", "Standard"],
          ["knockout", "Knockout"],
        ],
      },
      {
        key: "duration_ms",
        label: "Duration (seconds)",
        type: "number",
        min: 1,
        max: 10800,
        required: true,
      },
      {
        key: "target_score",
        label: "Score to Win (blank for no target)",
        type: "number",
        min: 1,
        max: 10000,
      },
    ],
    defaults: {
      name: "",
      mode: "traditional",
      match_type: "standard",
      duration_ms: 180000,
      target_score: null,
    },
  },
  users: {
    table: "tUser",
    name: "user",
    fields: [
      { key: "display_name", label: "Display name", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ],
    defaults: { email: "", display_name: "" },
  },
  events: {
    table: "tEvent",
    name: "event",
    fields: [
      { key: "name", label: "Name", required: true },
      {
        key: "mode",
        label: "Scoring mode",
        options: [
          ["traditional", "Traditional"],
          ["control_point", "Control Point (planning only)"],
        ],
      },
      {
        key: "competition_format",
        label: "Competition format",
        options: [
          ["individual", "Individual"],
          ["team", "Team (planning only)"],
        ],
      },
      { key: "preset_id", label: "Default preset", options: [] },
      { key: "start_date", label: "Start Date", type: "date" },
      { key: "end_date", label: "End Date", type: "date" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    defaults: {
      name: "",
      mode: "traditional",
      competition_format: "individual",
      preset_id: null,
      start_date: null,
      end_date: null,
      description: "",
    },
  },
  teams: {
    table: "tTeam",
    name: "team",
    fields: [
      { key: "name", label: "Name", required: true },
      {
        key: "mode",
        label: "Scoring mode",
        options: [
          ["traditional", "Traditional"],
          ["control_point", "Control Point (planning only)"],
        ],
      },
    ],
    defaults: { name: "", mode: "traditional" },
  },
};
function query() {
  return new URLSearchParams(window.location.hash.split("?")[1] ?? "");
}
export function RecordPage({ entity }: { entity: Entity }) {
  const def = definitions[entity];
  const { profile } = useAccount();
  const r = useRows<Row>(def.table);
  const presets = useRows<Preset>("tMatchPreset");
  const eventRegistrations = useRows<{ event_id: string; fencer_id: string }>("tEventFencer", entity === "events");
  const eventTeams = useRows<{ id: string; event_id: string | null; is_archived: boolean }>("vTeamInstances", entity === "events");
  const [params, setParams] = useState(query);
  useEffect(() => {
    const change = () => setParams(query());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const storage = `lookup:${entity}`;
  const [search, setSearch] = useState(
    () => sessionStorage.getItem(storage + ":search") ?? "",
  );
  const [status, setStatus] = useState(
    () => sessionStorage.getItem(storage + ":status") ?? "active",
  );
  const [sort, setSort] = useState(
    () => sessionStorage.getItem(storage + ":sort") ?? "name",
  );
  const [affiliation, setAffiliation] = useState(
    () => sessionStorage.getItem(storage + ":affiliation") ?? "",
  );
  const [notice, setNotice] = useState("");
  useEffect(() => {
    for (const [k, v] of Object.entries({ search, status, sort, affiliation }))
      sessionStorage.setItem(`${storage}:${k}`, v);
  }, [storage, search, status, sort, affiliation]);
  const mode = params.get("mode") ?? "lookup",
    id = params.get("id") ?? "";
  const selected = r.data.find((x) => x.id === id);
  const base = entity === "teams" ? "/events/teams" : `/${entity}`;
  const href = (mode: string, id?: string) =>
    `#${base}?mode=${mode}${id ? `&id=${encodeURIComponent(id)}` : ""}`;
  const name = (x: Row) => String(x.display_name ?? x.name ?? "");
  const eventCount = (x: Row) =>
    x.competition_format === "team"
      ? new Set(eventTeams.data.filter((t) => t.event_id === x.id && !t.is_archived).map((t) => t.id)).size
      : new Set(eventRegistrations.data.filter((f) => f.event_id === x.id).map((f) => f.fencer_id)).size;
  const eventCountLoading = eventRegistrations.loading || eventTeams.loading;
  const inactive = (x: Row) =>
    entity === "users"
      ? !x.is_active
      : entity === "events"
        ? x.status === "archived"
        : Boolean(x.is_archived);
  const allowed = (x: Row) =>
    !x.is_unregistered && !(entity === "presets" && x.mode !== "traditional");
  const matchesFilters = (x: Row) =>
    (status === "all" || inactive(x) === (status === "inactive")) &&
    (!affiliation.trim() ||
      String(x.affiliation ?? "")
        .toLowerCase()
        .includes(affiliation.trim().toLowerCase())) &&
    (entity === "fencers"
      ? name(x).toLowerCase().includes(search.trim().toLowerCase())
      : `${name(x)} ${x.email ?? ""} ${x.affiliation ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()));
  const totalCount = r.data.filter(allowed).length;
  const matchingCount = r.data.filter(allowed).filter(matchesFilters).length;
  const filtersChanged =
    Boolean(search || affiliation) || status !== "active" || sort !== "name";
  const clearFilters = () => {
    setSearch("");
    setAffiliation("");
    setStatus("active");
    setSort("name");
  };
  const a = useAction(r.reload);
  async function done(action: () => Promise<unknown>) {
    if (await a.run(action)) {
      setNotice("Saved successfully.");
      window.location.hash = base;
    }
  }
  const mayEdit = (x?: Row) =>
    entity !== "users" ||
    (profile.app_role === "admin" && x?.app_role !== "admin" && !x?.is_deleted);
  const backHref = mode === "relationships" && params.get("return") === "detail"
    ? href("detail", id)
    : `#${base}`;
  const title =
    mode === "delete"
      ? "Confirm delete user access"
      : mode === "create"
        ? entity === "users"
          ? "Invite user"
          : `Create ${titleCase(def.name)}`
        : mode === "edit"
          ? `Edit ${def.name}`
          : mode === "archive"
            ? `Confirm ${entity === "users" ? "disable" : "archive"} ${def.name}`
            : mode === "restore"
              ? `Confirm ${entity === "users" ? "enable" : "restore"} ${def.name}`
              : mode === "relationships"
                ? `Manage ${def.name} relationships`
                : mode === "detail"
                  ? "Event Details"
                  : `Manage ${entity}`;
  return (
    <>
      <Intro title={titleCase(title)} />
      {(mode === "relationships" || mode === "detail") && <BackLink href={backHref} />}
      <Notice error={r.error || presets.error || (entity === "events" ? eventRegistrations.error || eventTeams.error : "")} loading={r.loading} />
      {notice && (
        <p role="status" className="notice-feedback notice-success">
          {notice}
        </p>
      )}
      {mode === "lookup" ? (
        <section className="card record-lookup">
          <div className="button-row">
            <a className="primary" href={href("create")}>
              New {titleCase(def.name)}
            </a>
            {entity === "events" && <a href="#/events/teams">Manage teams</a>}
            {entity === "users" && <InvitationPolicy />}
          </div>
          <div className="fields">
            <label>
              {entity === "fencers" ? "Name" : "Search"}
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {entity === "fencers" && (
              <label>
                Affiliation
                <input
                  type="search"
                  placeholder="Search affiliations"
                  value={affiliation}
                  onChange={(e) => setAffiliation(e.target.value)}
                />
              </label>
            )}
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">
                  {entity === "users" ? "Disabled" : "Archived"}
                </option>
                <option value="all">All</option>
              </select>
            </label>
            <label>
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name">Name A–Z</option>
                <option value="reverse">Name Z–A</option>
                <option value="status">Status</option>
                <option value="id">ID</option>
                {entity === "fencers" && (
                  <option value="affiliation">Affiliation</option>
                )}
              </select>
            </label>
          </div>
          <div className="record-result-summary">
            <span role="status">
              {r.loading
                ? "Loading records…"
                : `Showing ${matchingCount} of ${totalCount} records`}
            </span>
            {filtersChanged && (
              <button type="button" className="subtle" onClick={clearFilters}>
                Clear Filters
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  {entity === "users" ? (
                    <>
                      <th>Email</th>
                      <th>Role</th>
                    </>
                  ) : entity === "events" ? (
                    <>
                      <th>Scoring Mode</th>
                      <th>Competition Format</th>
                      <th>Start Date</th>
                      <th>End Date</th>
                      <th>Registered Fencers / Teams</th>
                    </>
                  ) : (
                    <th>{entity === "fencers" ? "Affiliation" : "Details"}</th>
                  )}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {r.data
                  .filter(allowed)
                  .filter(matchesFilters)
                  .sort((x, y) =>
                    sort === "id"
                      ? x.id.localeCompare(y.id)
                      : sort === "status"
                        ? Number(inactive(x)) - Number(inactive(y)) ||
                          name(x).localeCompare(name(y))
                        : sort === "affiliation"
                          ? String(x.affiliation).localeCompare(
                              String(y.affiliation),
                            )
                          : name(x).localeCompare(name(y)) *
                            (sort === "reverse" ? -1 : 1),
                  )
                  .map((x) => (
                    <tr key={x.id}>
                      <td>
                        <CopyId id={x.id} />
                      </td>
                      <td>
                        {entity === "events" ? (
                          <a href={href("detail", x.id)}>{name(x)}</a>
                        ) : (
                          name(x)
                        )}
                      </td>
                      {entity === "users" ? (
                        <>
                          <td>{String(x.email ?? "")}</td>
                          <td>
                            {String(x.app_role ?? "").replace(/^./, (letter) =>
                              letter.toUpperCase(),
                            )}
                          </td>
                        </>
                      ) : entity === "events" ? (
                        <>
                          <td>{displayScoringMode(x.mode)}</td>
                          <td>{displayCompetitionFormat(x.competition_format)}</td>
                          <td>{displayDate(x.start_date)}</td>
                          <td>{displayDate(x.end_date)}</td>
                          <td>{eventCountLoading ? "Loading…" : `${eventCount(x)} ${x.competition_format === "team" ? "teams" : "fencers"}`}</td>
                        </>
                      ) : (
                        <td>
                          {entity === "fencers" ? String(x.affiliation ?? "") : String(x.mode ?? "")}
                          {entity === "presets" &&
                            ` · ${x.match_type === "knockout" ? "Knockout" : "Standard"} · ${Number(x.duration_ms) / 1000}s · ${x.target_score ?? "No Target"}`}
                        </td>
                      )}
                      <td>
                        {titleCase(String(
                          x.status ??
                            (inactive(x)
                              ? entity === "users"
                                ? "Disabled"
                                : "Archived"
                              : "Active"),
                        ))}
                      </td>
                      <td>
                        <div className="button-row">
                          {mayEdit(x) && (
                            <>
                              <a href={href("edit", x.id)}>Edit</a>
                              <a
                                href={href(
                                  inactive(x) ? "restore" : "archive",
                                  x.id,
                                )}
                              >
                                {inactive(x)
                                  ? "Restore"
                                  : entity === "users"
                                    ? "Disable"
                                    : "Archive"}
                              </a>
                            </>
                          )}
                          {(entity === "events" || entity === "teams") && (
                            <a href={href("relationships", x.id)}>
                              {x.competition_format === "team"
                                ? "Team Assignments"
                                : "Registrations"}
                            </a>
                          )}
                          {entity === "events" && (
                            <a href="#/run-event?from=events" onClick={() => sessionStorage.setItem("event", x.id)}>
                              Run Event
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!r.loading && !r.error && matchingCount === 0 && (
            <p role="status">
              {totalCount === 0
                ? "No records yet."
                : "No records match your filters."}
            </p>
          )}
        </section>
      ) : mode === "create" || selected ? (
        <section className="card">
          {mode === "create" || mode === "edit" ? (
            <RecordForm
              key={`${entity}:${mode}:${id}`}
              entity={entity}
              selected={mode === "edit" ? selected : undefined}
              presets={presets.data}
              busy={a.busy}
              allowed={mode === "create" || mayEdit(selected)}
              onSave={(values) =>
                done(async () => {
                  if (entity === "users")
                    await manage(
                      mode === "create"
                        ? { action: "invite", ...values }
                        : { action: "edit", id, ...values },
                    );
                  else
                    await write(
                      def.table,
                      {
                        ...values,
                        ...(mode === "create" ? { owner_id: profile.id } : {}),
                      },
                      mode === "edit" ? id : undefined,
                    );
                })
              }
            />
          ) : mode === "archive" || mode === "restore" ? (
            <>
              <h3>{selected && name(selected)}</h3>
              <p>
                {mode === "archive"
                  ? "This record will no longer be available in active selections. Historical matches, attribution and audit records will be preserved."
                  : "This record will become available again."}
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={a.busy || !mayEdit(selected)}
                  onClick={() =>
                    void done(() =>
                      entity === "users"
                        ? manage({
                            action: mode === "archive" ? "disable" : "enable",
                            id,
                          })
                        : entity === "events"
                          ? rpc("set_event_status", {
                              p_event: id,
                              p_status:
                                mode === "archive" ? "archived" : "draft",
                            })
                          : write(
                              def.table,
                              { is_archived: mode === "archive" },
                              id,
                            ),
                    )
                  }
                >
                  Confirm{" "}
                  {mode === "archive"
                    ? entity === "users"
                      ? "disable"
                      : "archive"
                    : "restore"}
                </button>
                <a href={`#${base}`}>Cancel</a>
              </div>
            </>
          ) : mode === "delete" &&
            entity === "users" &&
            selected &&
            mayEdit(selected) ? (
            <DeleteUserAccess
              user={selected}
              busy={a.busy}
              onCancel={`#${base}`}
              onDelete={() =>
                done(() =>
                  manage({
                    action: "delete",
                    id,
                    confirm: String(selected.email),
                  }),
                )
              }
            />
          ) : mode === "detail" && selected && entity === "events" ? (
            <section>
              <h3>{name(selected)}</h3>
              <p>
                {String(selected.status)} · {displayDate(selected.start_date)} –{" "}
                {displayDate(selected.end_date)}
              </p>
              <p>{String(selected.description ?? "")}</p>
              {(selected.mode !== "traditional" ||
                selected.competition_format === "team") && (
                <p>
                  Planning Only: match execution and standings for this format
                  are not available.
                </p>
              )}
              <nav className="button-row" aria-label="Event Management">
                <a className="secondary" href={href("edit", id)}>
                  Edit Event
                </a>
                <a className="secondary" href={href("relationships", id) + "&return=detail"}>
                  {selected.competition_format === "team"
                    ? "Team Assignments"
                    : "Registrations"}
                </a>
              </nav>
            </section>
          ) : mode === "relationships" && selected ? (
            <>
              <h3>{name(selected)}</h3>
              {entity === "events" ? (
                <>
                  {selected.competition_format === "team" ? (
                    <EventTeamAssignments
                      event={selected as unknown as EventRecord}
                    />
                  ) : (
                    <Registration eventId={id} />
                  )}
                </>
              ) : (
                <a href="#/events/teams">Manage team instances and rosters</a>
              )}
            </>
          ) : (
            <p>Unknown page.</p>
          )}
          <Notice error={a.error} success={a.status} />
          {mode === "edit" &&
            entity === "users" &&
            selected &&
            mayEdit(selected) && (
              <section className="danger-zone" aria-label="Danger Zone">
                <h3>Danger Zone</h3>
                <p>
                  Delete this user's account access only when disabling it is
                  insufficient. This preserves historical attribution and
                  requires a separate email-confirmation screen.
                </p>
                <a className="danger" href={href("delete", id)}>
                  Delete Account Access…
                </a>
              </section>
            )}
          {mode === "edit" &&
            selected &&
            profile.app_role === "admin" &&
            entity !== "users" && (
              <DeleteButton
                table={def.table}
                id={id}
                name={name(selected)}
                onDone={async () => {
                  await r.reload();
                  window.location.hash = base;
                }}
              />
            )}
        </section>
      ) : (
        !r.loading && (
          <p role="alert">
            Record not found. <a href={`#${base}`}>Return to lookup</a>
          </p>
        )
      )}
    </>
  );
}
function RecordForm({
  entity,
  selected,
  presets,
  busy,
  allowed,
  onSave,
}: {
  entity: Entity;
  selected?: Row;
  presets: Preset[];
  busy: boolean;
  allowed: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const def = definitions[entity];
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...def.defaults,
    ...selected,
  }));
  const creating = !selected;
  const dirty =
    JSON.stringify(values) !== JSON.stringify({ ...def.defaults, ...selected });
  const [validation, setValidation] = useState("");
  const base = entity === "teams" ? "/events/teams" : `/${entity}`;
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!allowed) return;
        if (
          entity === "events" &&
          values.start_date &&
          values.end_date &&
          String(values.end_date) < String(values.start_date)
        ) {
          setValidation("End Date must not be before Start Date.");
          return;
        }
        const v: Record<string, unknown> = {};
        for (const key of Object.keys(def.defaults)) v[key] = values[key];
        for (const key of ["name", "display_name"])
          if (typeof v[key] === "string") v[key] = (v[key] as string).trim();
        void onSave(v);
      }}
    >
      {def.fields.map((field) => {
        const f =
          field.key === "preset_id"
            ? {
                ...field,
                options: presets
                  .filter(
                    (p) =>
                      p.mode === values.mode &&
                      (!p.is_archived || p.id === values.preset_id),
                  )
                  .map((p) => [p.id, p.name] as [string, string]),
              }
            : field;
        const value = values[f.key];
        const disabled =
          busy ||
          !allowed ||
          (entity === "users" && !creating && f.key === "email") ||
          (entity === "events" &&
            Boolean(selected && selected.status !== "draft") &&
            ["mode", "competition_format"].includes(f.key));
        let input: ReactNode;
        const change = (s: string) =>
          setValues((v) => ({
            ...v,
            [f.key]:
              f.type === "number"
                ? s === ""
                  ? null
                  : Number(s) * (f.key === "duration_ms" ? 1000 : 1)
                : f.type === "date"
                  ? s || null
                  : f.key === "preset_id"
                    ? s || null
                    : s,
            ...(f.key === "mode" ? { preset_id: null } : {}),
          }));
        if (f.options)
          input = (
            <select
              aria-label={f.label}
              required={
                f.required &&
                !(creating && entity === "users" && f.key === "display_name")
              }
              disabled={disabled}
              value={String(value ?? "")}
              onChange={(e) => change(e.target.value)}
            >
              <option value="">Select</option>
              {f.options.map(([v, n]) => (
                <option value={v} key={v}>
                  {n}
                </option>
              ))}
            </select>
          );
        else if (f.type === "textarea")
          input = (
            <textarea
              aria-label={f.label}
              disabled={disabled}
              value={String(value ?? "")}
              onChange={(e) => change(e.target.value)}
            />
          );
        else
          input = (
            <input
              aria-label={f.label}
              required={
                f.required &&
                !(creating && entity === "users" && f.key === "display_name")
              }
              disabled={disabled}
              type={f.type ?? "text"}
              min={
                f.key === "end_date" ? String(values.start_date ?? "") : f.min
              }
              max={f.max}
              maxLength={f.type === "number" ? undefined : 160}
              value={
                f.type === "datetime-local"
                  ? String(value ?? "").slice(0, 16)
                  : f.key === "duration_ms"
                    ? Number(value) / 1000
                    : String(value ?? "")
              }
              onChange={(e) => change(e.target.value)}
            />
          );
        return (
          <label key={f.key}>
            {f.label}
            {input}
          </label>
        );
      })}
      <div className="button-row">
        <button className="primary" disabled={busy || !allowed}>
          {creating
            ? entity === "users"
              ? "Send Invitation"
              : `Create ${titleCase(def.name)}`
            : "Save Changes"}
        </button>
        <a
          className="secondary"
          href={`#${base}`}
          onClick={(e) => {
            if (busy || (dirty && !confirm("Discard unsaved changes?")))
              e.preventDefault();
          }}
        >
          Cancel
        </a>
      </div>
      <Notice error={validation} />
    </form>
  );
}
function InvitationPolicy() {
  const { profile } = useAccount();
  const p = useRows<{ id: boolean; invitations_paused: boolean }>(
    "tAccountPolicy",
  );
  const a = useAction(p.reload);
  return (
    <>
      {profile.app_role === "admin" && (
        <button
          disabled={a.busy || !p.data[0]}
          onClick={() =>
            void a.run(() =>
              rpc("set_invitations_paused", {
                p_paused: !p.data[0].invitations_paused,
              }),
            )
          }
        >
          {p.data[0]?.invitations_paused ? "Resume" : "Pause"} invitations
        </button>
      )}
      <span className="muted">
        {p.data[0]?.invitations_paused
          ? "Invitations are paused."
          : "Managers are invited by email."}
      </span>
      <Notice error={p.error || a.error} success={a.status} />
    </>
  );
}
function DeleteUserAccess({
  user,
  busy,
  onCancel,
  onDelete,
}: {
  user: Row;
  busy: boolean;
  onCancel: string;
  onDelete: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState("");
  return (
    <section>
      <h3>{String(user.display_name)}</h3>
      <p>
        Delete this account’s access while retaining its identity and historical
        attribution. This cannot be used for the sole Admin.
      </p>
      <label>
        Type the account email to confirm
        <input
          type="email"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      <div className="button-row">
        <button
          className="danger"
          disabled={busy || confirm !== user.email}
          onClick={() => void onDelete()}
        >
          Confirm delete access
        </button>
        <a href={onCancel}>Cancel</a>
      </div>
    </section>
  );
}

function titleCase(s: string) {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
function displayDate(value: unknown) {
  if (!value) return "Unscheduled";
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

function displayScoringMode(value: unknown) {
  return value === "traditional" ? "Traditional" : value === "control_point" ? "Control Point" : titleCase(String(value ?? "Unknown"));
}
function displayCompetitionFormat(value: unknown) {
  return value === "individual" ? "Individual" : value === "team" ? "Team" : titleCase(String(value ?? "Unknown"));
}
