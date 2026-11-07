import { useEffect, useState, type ReactNode } from "react";
import { useAccount } from "./Auth";
import { manage, rpc, write, type EventRecord, type Preset } from "./data";
import { Intro, Notice, useAction, useRows, DeleteButton } from "./ui";
import { EventTeamAssignments } from "./Teams";
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
      { key: "starts_at", label: "Start (UTC)", type: "datetime-local" },
      { key: "ends_at", label: "End (UTC)", type: "datetime-local" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    defaults: {
      name: "",
      mode: "traditional",
      competition_format: "individual",
      preset_id: null,
      starts_at: null,
      ends_at: null,
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
  const inactive = (x: Row) =>
    entity === "users"
      ? !x.is_active
      : entity === "events"
        ? x.status === "archived"
        : Boolean(x.is_archived);
  const allowed = (x: Row) =>
    !x.is_unregistered && !(entity === "presets" && x.mode !== "traditional");
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
  const title =
    mode === "delete"
      ? "Confirm delete user access"
      : mode === "create"
        ? entity === "users"
          ? "Invite user"
          : `Create ${def.name}`
        : mode === "edit"
          ? `Edit ${def.name}`
          : mode === "archive"
            ? `Confirm ${entity === "users" ? "disable" : "archive"} ${def.name}`
            : mode === "restore"
              ? `Confirm ${entity === "users" ? "enable" : "restore"} ${def.name}`
              : mode === "relationships"
                ? `Manage ${def.name} relationships`
                : `Manage ${entity}`;
  return (
    <>
      <Intro title={title} />
      <Notice error={r.error || presets.error} loading={r.loading} />
      {notice && <p role="status">{notice}</p>}
      {mode === "lookup" ? (
        <section className="card">
          <div className="button-row">
            <a className="primary" href={href("create")}>
              New {def.name}
            </a>
            {entity === "events" && <a href="#/events/teams">Manage teams</a>}
          </div>
          {entity === "users" && <InvitationPolicy />}
          <div className="fields">
            <label>
              Search
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Archived / disabled</option>
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
            {entity === "fencers" && (
              <label>
                Affiliation
                <select
                  value={affiliation}
                  onChange={(e) => setAffiliation(e.target.value)}
                >
                  <option value="">All affiliations</option>
                  {[...new Set(r.data.map((x) => String(x.affiliation ?? "")))]
                    .filter(Boolean)
                    .sort()
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </label>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>
                    {entity === "fencers" ? "Affiliation" : "Details"}
                  </th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {r.data
                  .filter(allowed)
                  .filter(
                    (x) =>
                      (status === "all" ||
                        inactive(x) === (status === "inactive")) &&
                      (!affiliation || x.affiliation === affiliation) &&
                      `${name(x)} ${x.id} ${x.email ?? ""} ${x.affiliation ?? ""}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
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
                      <td>{name(x)}</td>
                      <td>
                        <small title={x.id}>{x.id.slice(0, 8)}</small>
                      </td>
                      <td>
                        {entity === "fencers"
                          ? String(x.affiliation ?? "")
                          : String(x.email ?? x.mode ?? "")}
                        {entity === "events" && ` · ${x.competition_format}`}
                        {entity === "users" && ` · ${x.app_role}`}
                      </td>
                      <td>
                        {String(
                          x.status ??
                            (inactive(x)
                              ? entity === "users"
                                ? "Disabled"
                                : "Archived"
                              : "Active"),
                        )}
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
                              Registration / roster
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {r.data.filter(allowed).length === 0 && !r.loading && (
            <p>No records yet.</p>
          )}
        </section>
      ) : mode === "create" || selected ? (
        <section className="card">
          {mode === "relationships" && (
            <a href={`#${base}`}>← Back to lookup</a>
          )}
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
              <p>ID: {id}</p>
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
                  <EventStatus
                    event={selected as unknown as EventRecord}
                    onDone={r.reload}
                  />
                  <a
                    href="#/run-event"
                    onClick={() => sessionStorage.setItem("event", id)}
                  >
                    Run event
                  </a>
                </>
              ) : (
                <a href="#/events/teams">Manage team instances and rosters</a>
              )}
            </>
          ) : (
            <p>Unknown page.</p>
          )}
          <Notice error={a.status} />
          {mode === "edit" &&
            entity === "users" &&
            selected &&
            mayEdit(selected) && (
              <a className="danger" href={href("delete", id)}>
                Delete account access…
              </a>
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
  const base = entity === "teams" ? "/events/teams" : `/${entity}`;
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!allowed) return;
        const v: Record<string, unknown> = {};
        for (const key of Object.keys(def.defaults)) v[key] = values[key];
        for (const key of ["name", "display_name"])
          if (typeof v[key] === "string") v[key] = (v[key] as string).trim();
        void onSave(v);
      }}
    >
      <label>
        Record ID
        <input readOnly value={selected?.id ?? "NEW"} />
      </label>
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
                : f.type === "datetime-local"
                  ? s
                    ? new Date(s + "Z").toISOString()
                    : null
                  : f.key === "preset_id"
                    ? s || null
                    : s,
            ...(f.key === "mode" ? { preset_id: null } : {}),
          }));
        if (f.options)
          input = (
            <select
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
              disabled={disabled}
              value={String(value ?? "")}
              onChange={(e) => change(e.target.value)}
            />
          );
        else
          input = (
            <input
              required={
                f.required &&
                !(creating && entity === "users" && f.key === "display_name")
              }
              disabled={disabled}
              type={f.type ?? "text"}
              min={f.min}
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
              ? "Send invitation"
              : `Create ${def.name}`
            : "Save changes"}
        </button>
        <a href={`#${base}`}>Cancel</a>
      </div>
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
      <p>
        {p.data[0]?.invitations_paused
          ? "Invitations are paused."
          : "Invite managers by email. Each person sets their own password."}
      </p>
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
      <Notice error={p.error || a.status} />
    </>
  );
}
function EventStatus({
  event,
  onDone,
}: {
  event: EventRecord;
  onDone: () => Promise<void>;
}) {
  const a = useAction(onDone);
  return (
    <>
      <h3>Event status: {event.status}</h3>
      <div className="button-row">
        {["draft", "active", "completed"]
          .filter((s) => s !== event.status)
          .map((s) => (
            <button
              key={s}
              disabled={a.busy}
              onClick={() => {
                if (
                  confirm(
                    `Change ${event.name} to ${s}? Completing freezes standings; reopening preserves prior versions.`,
                  )
                )
                  void a.run(() =>
                    rpc("set_event_status", { p_event: event.id, p_status: s }),
                  );
              }}
            >
              {s === "active" && event.status === "completed" ? "Reopen" : s}
            </button>
          ))}
      </div>
      <Notice error={a.status} />
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
