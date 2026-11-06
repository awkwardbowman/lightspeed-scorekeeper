import { useState } from "react";
import { PasswordForm, useAccount } from "./Auth";
import {
  db,
  manage,
  write,
  type Fencer,
  type Preset,
  type Profile,
} from "./data";
import {
  ArchiveFilter,
  DeleteButton,
  Intro,
  Notice,
  Search,
  useAction,
  useRows,
} from "./ui";
export function Account() {
  const { profile, refresh } = useAccount();
  const [name, setName] = useState(profile.display_name);
  const a = useAction(refresh);
  return (
    <>
      <Intro title="My account">
        {profile.email} · {profile.app_role}
      </Intro>
      <section className="card">
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(() => manage({ action: "profile", display_name: name }));
          }}
        >
          <label>
            Display name
            <input
              value={name}
              required
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="primary" disabled={a.busy}>
            Save name
          </button>
        </form>
        <Notice error={a.status} />
        <h3>Change password</h3>
        <PasswordForm onDone={refresh} />
        <button className="subtle" onClick={() => void db().auth.signOut()}>
          Sign out
        </button>
      </section>
    </>
  );
}
export function Users() {
  const { profile } = useAccount();
  const r = useRows<Profile>("tUser");
  const a = useAction(r.reload);
  const [selectedId, setSelectedId] = useState("");
  const selected = r.data.find((p) => p.id === selectedId) ?? null;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  if (profile.app_role !== "admin")
    return <Intro title="Admin access required" />;
  function select(p: Profile | null) {
    setSelectedId(p?.id ?? "");
    setName(p?.display_name ?? "");
    setEmail(p?.email ?? "");
    setPassword("");
  }
  return (
    <>
      <Intro title="Manage Users">
        Create Management accounts and issue temporary passwords. Disabled
        accounts immediately lose data access.
      </Intro>
      <Notice error={r.error} loading={r.loading} />
      <div className="workspace-columns">
        <section className="card">
          <button className="primary" onClick={() => select(null)}>
            New Management user
          </button>
          {r.data.map((p) => (
            <button className="list-item" key={p.id} onClick={() => select(p)}>
              <strong>{p.display_name}</strong>
              <small>
                {p.email} · {p.app_role} ·{" "}
                {p.is_deleted ? "Deleted" : p.is_active ? "Active" : "Disabled"}
              </small>
            </button>
          ))}
        </section>
        <section className="card">
          <h3>{selected ? "Edit account" : "Create Management account"}</h3>
          <form
            className="editor"
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(() =>
                manage({
                  action: selected ? "edit" : "create",
                  id: selected?.id,
                  email,
                  display_name: name,
                  password,
                }),
              );
            }}
          >
            <label>
              Display name
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {(!selected || selected.app_role !== "admin") && (
              <>
                <label>
                  Temporary password
                  <input
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={12}
                    required={!selected}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button
                    type="button"
                    className="subtle"
                    onClick={() => {
                      setPassword(
                        Array.from(
                          crypto.getRandomValues(new Uint8Array(24)),
                          (v) => v.toString(16).padStart(2, "0"),
                        ).join(""),
                      );
                      setShow(true);
                    }}
                  >
                    Generate password
                  </button>
                  <button
                    type="button"
                    className="subtle"
                    onClick={() => setShow(!show)}
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="muted">
                  Share this password privately. The user must replace it at
                  their next sign-in.
                </p>
              </>
            )}
            <button
              className="primary"
              disabled={a.busy || selected?.app_role === "admin"}
            >
              {selected ? "Save account" : "Create user"}
            </button>
          </form>
          {selected?.app_role === "management" && (
            <div className="button-row">
              <button
                className="subtle"
                disabled={a.busy || password.length < 12}
                onClick={() =>
                  void a.run(() =>
                    manage({ action: "reset", id: selected.id, password }),
                  )
                }
              >
                Issue reset password
              </button>
              <button
                className="subtle"
                disabled={a.busy || selected.is_deleted}
                onClick={() =>
                  void a.run(() =>
                    manage({
                      action: selected.is_active ? "disable" : "enable",
                      id: selected.id,
                    }),
                  )
                }
              >
                {selected.is_active ? "Disable" : "Enable"}
              </button>
              <button
                className="danger"
                disabled={a.busy || selected.is_deleted}
                onClick={() => {
                  const confirm = window.prompt(
                    "Type the account email to delete access. Historical attribution will be retained.",
                  );
                  if (confirm)
                    void a.run(() =>
                      manage({ action: "delete", id: selected.id, confirm }),
                    );
                }}
              >
                Delete access
              </button>
            </div>
          )}
          <Notice error={a.status} />
        </section>
      </div>
    </>
  );
}
export function Fencers() {
  const { profile } = useAccount();
  const r = useRows<Fencer>("tFencer");
  const a = useAction(r.reload);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const selected = r.data.find((f) => f.id === selectedId) ?? null;
  const [name, setName] = useState("");
  const [club, setClub] = useState("");
  const [notes, setNotes] = useState("");
  function select(f: Fencer | null) {
    setSelectedId(f?.id ?? "");
    setName(f?.display_name ?? "");
    setClub(f?.affiliation ?? "");
    setNotes(f?.notes ?? "");
  }
  return (
    <>
      <Intro title="Manage Fencers">
        Registered fencers keep the same identity through name changes.
        Duplicate names are allowed.
      </Intro>
      <Notice error={r.error} loading={r.loading} />
      <div className="workspace-columns">
        <section className="card">
          <Search value={search} onChange={setSearch} />
          <ArchiveFilter checked={archived} onChange={setArchived} />
          <button className="primary" onClick={() => select(null)}>
            New fencer
          </button>
          {r.data
            .filter(
              (f) =>
                !f.is_unregistered &&
                (archived || !f.is_archived) &&
                `${f.display_name} ${f.id}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            )
            .map((f) => (
              <button
                className="list-item"
                key={f.id}
                onClick={() => select(f)}
              >
                <strong>
                  {f.display_name}
                  {f.is_archived ? " · Archived" : ""}
                </strong>
                <small>
                  {f.affiliation} · {f.id.slice(0, 8)}
                </small>
              </button>
            ))}
        </section>
        <section className="card">
          <form
            className="editor"
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(() =>
                write(
                  "tFencer",
                  {
                    display_name: name.trim(),
                    affiliation: club,
                    notes,
                    ...(!selected ? { owner_id: profile.id } : {}),
                  },
                  selected?.id,
                ),
              );
            }}
          >
            <label>
              Display name
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Club / affiliation
              <input value={club} onChange={(e) => setClub(e.target.value)} />
            </label>
            <label>
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <button className="primary" disabled={a.busy}>
              Save fencer
            </button>
          </form>
          {selected && (
            <div className="button-row">
              <button
                className="subtle"
                disabled={a.busy}
                onClick={() =>
                  void a.run(() =>
                    write(
                      "tFencer",
                      { is_archived: !selected.is_archived },
                      selected.id,
                    ),
                  )
                }
              >
                {selected.is_archived ? "Restore" : "Archive"}
              </button>
              {profile.app_role === "admin" && (
                <DeleteButton
                  table="tFencer"
                  id={selected.id}
                  name={selected.display_name}
                  onDone={async () => {
                    await r.reload();
                    select(null);
                  }}
                />
              )}
            </div>
          )}
          <Notice error={a.status} />
        </section>
      </div>
    </>
  );
}
export function Presets() {
  const { profile } = useAccount();
  const r = useRows<Preset>("tMatchPreset");
  const a = useAction(r.reload);
  const [archived, setArchived] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState(3);
  const [target, setTarget] = useState("");
  const chosen = r.data.find((p) => p.id === id);
  return (
    <>
      <Intro title="Match Presets">
        Global Traditional presets. Each bout keeps its own applied settings.
      </Intro>
      <Notice error={r.error} loading={r.loading} />
      <ArchiveFilter checked={archived} onChange={setArchived} />
      <section className="card">
        <label>
          Preset
          <select
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              const p = r.data.find((p) => p.id === e.target.value);
              setName(p?.name ?? "");
              setMinutes((p?.duration_ms ?? 180000) / 60000);
              setTarget(p?.target_score?.toString() ?? "");
            }}
          >
            <option value="">New preset</option>
            {r.data
              .filter(
                (p) => p.mode === "traditional" && (archived || !p.is_archived),
              )
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                  {p.is_archived ? " · Archived" : ""}
                </option>
              ))}
          </select>
        </label>
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(() =>
              write(
                "tMatchPreset",
                {
                  name: name.trim(),
                  mode: "traditional",
                  duration_ms: Math.round(minutes * 60000),
                  target_score: target ? Number(target) : null,
                  ...(!id ? { owner_id: profile.id } : {}),
                },
                id || undefined,
              ),
            );
          }}
        >
          <label>
            Name
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Duration (minutes)
            <input
              required
              type="number"
              min={1 / 60}
              max={180}
              step="any"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <label>
            Target score (optional)
            <input
              type="number"
              min={1}
              max={10000}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          <button className="primary" disabled={a.busy}>
            Save preset
          </button>
        </form>
        {chosen && (
          <div className="button-row">
            <button
              className="subtle"
              disabled={a.busy}
              onClick={() =>
                void a.run(() =>
                  write(
                    "tMatchPreset",
                    { is_archived: !chosen.is_archived },
                    id,
                  ),
                )
              }
            >
              {chosen.is_archived ? "Restore" : "Archive"}
            </button>
            {profile.app_role === "admin" && (
              <DeleteButton
                table="tMatchPreset"
                id={id}
                name={name}
                onDone={async () => {
                  setId("");
                  await r.reload();
                }}
              />
            )}
          </div>
        )}
        <Notice error={a.status} />
      </section>
    </>
  );
}
