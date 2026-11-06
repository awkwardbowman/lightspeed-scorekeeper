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
  const policy = useRows<{
    id: boolean;
    invitations_paused: boolean;
    email_ready: boolean;
  }>("tAccountPolicy");
  const users = useRows<Profile>("tUser");
  const a = useAction(async () => {
    await policy.reload();
    await users.reload();
  });
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const p = policy.data[0];
  return (
    <>
      <Intro title="Accounts & Invitations">
        Invite a new manager by email. Each person sets and resets their own
        password.
      </Intro>
      <Notice error={policy.error || users.error} />
      <section className="card">
        <p>
          {!p?.email_ready
            ? "Email delivery is awaiting setup."
            : p.invitations_paused
              ? "New account invitations are paused by Admin."
              : "New account invitations are open."}
        </p>
        {profile.app_role === "admin" && (
          <button
            className="subtle"
            disabled={a.busy || !p}
            onClick={() =>
              void a.run(async () => {
                const { error } = await db().rpc("set_invitations_paused", {
                  p_paused: !p!.invitations_paused,
                });
                if (error) throw error;
              })
            }
          >
            {p?.invitations_paused
              ? "Resume new accounts"
              : "Pause new accounts"}
          </button>
        )}
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(() =>
              manage({ action: "invite", email, display_name: name }),
            );
          }}
        >
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Display name (optional)
            <input
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={a.busy || !p?.email_ready || p.invitations_paused}
          >
            Send invitation
          </button>
        </form>
        <Notice error={a.status} />
      </section>
      {profile.app_role === "admin" && (
        <section className="card">
          <h3>Account access</h3>
          {users.data.map((u) => (
            <div className="button-row" key={u.id}>
              <span>
                {u.display_name} · {u.email} ·{" "}
                {u.is_active ? "Active" : "Disabled"}
              </span>
              {u.app_role !== "admin" && !u.is_deleted && (
                <button
                  className="subtle"
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(() =>
                      manage({
                        action: u.is_active ? "disable" : "enable",
                        id: u.id,
                      }),
                    )
                  }
                >
                  {u.is_active ? "Disable" : "Enable"}
                </button>
              )}
              {u.app_role !== "admin" && !u.is_deleted && (
                <button
                  className="subtle"
                  onClick={() => {
                    setEditId(u.id);
                    setEditName(u.display_name);
                    setConfirmEmail("");
                  }}
                >
                  Edit access
                </button>
              )}
              {editId === u.id && !u.is_deleted && (
                <form
                  className="editor"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void a.run(() =>
                      manage({
                        action: "edit",
                        id: u.id,
                        email: u.email,
                        display_name: editName,
                      }),
                    );
                  }}
                >
                  <label>
                    Display name
                    <input
                      required
                      maxLength={120}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </label>
                  <button disabled={a.busy}>Save name</button>
                  <label>
                    Type this account's email to delete access
                    <input
                      type="email"
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={a.busy || confirmEmail !== u.email}
                    onClick={() =>
                      void a.run(() =>
                        manage({
                          action: "delete",
                          id: u.id,
                          confirm: confirmEmail,
                        }),
                      )
                    }
                  >
                    Delete access
                  </button>
                </form>
              )}
            </div>
          ))}
        </section>
      )}
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
      <div className="workspace-columns fencer-workspace">
        <section className="card fencer-browser" aria-label="Find a fencer">
          <Search value={search} onChange={setSearch} />
          <div className="fencer-browser-tools">
            <label className="check">
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Show archived
            </label>
            <button className="subtle" disabled={a.busy} onClick={() => select(null)}>
              New fencer
            </button>
          </div>
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
                className={`list-item${selectedId === f.id ? " is-selected" : ""}`}
                key={f.id}
                aria-pressed={selectedId === f.id}
                disabled={a.busy}
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
        <section className="card" aria-label="Fencer details">
          <h3 className="fencer-editor-title">{selectedId ? "Edit fencer" : "New fencer"}</h3>
          <form
            className="editor"
            onSubmit={(e) => {
              e.preventDefault();
              if (a.busy) return;
              void a.run(async () => {
                const values = { display_name: name.trim(), affiliation: club, notes };
                if (selectedId) {
                  await write("tFencer", values, selectedId);
                } else {
                  const { data, error } = await db().from("tFencer")
                    .insert({ ...values, owner_id: profile.id }).select("id").single();
                  if (error) throw error;
                  setSelectedId(data.id);
                }
              });
            }}
          >
            <label>
              ID
              <input className="fencer-id" readOnly value={selectedId || "NEW"} />
            </label>
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
              {selectedId ? "Save changes" : "Save new fencer"}
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
