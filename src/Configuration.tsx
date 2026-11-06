import { useEffect, useState } from "react";
import { db, type Configuration as Config, type Team, write } from "./data";
import { Intro, Notice, useAction, useRows } from "./ui";
const actions = [
  "toggle",
  "undo",
  ...["left", "right"].flatMap((side) =>
    ["indirect.1", "clean.3", "counter.5"].map((call) => `${side}.${call}`),
  ),
];
export default function Configuration({
  kind,
}: {
  kind: "general" | "key-mappings" | "team-images";
}) {
  const r = useRows<Config>("tConfiguration");
  const teams = useRows<Team>("tTeam");
  const a = useAction(async () => {
    await r.reload();
    await teams.reload();
  });
  const [reasons, setReasons] = useState("Safety\nPower");
  const [overtime, setOvertime] = useState(60);
  const [order, setOrder] = useState<string[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [id, setId] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (r.data[0]) {
      setOrder(r.data[0].tiebreakers);
      setReasons((r.data[0].penalty_reasons ?? ["Safety", "Power"]).join("\n"));
      setOvertime((r.data[0].overtime_ms ?? 60000) / 1000);
      setKeys(
        Object.fromEntries(
          Object.entries(r.data[0].key_mappings).filter(([key]) =>
            actions.includes(key),
          ),
        ),
      );
    }
  }, [r.data]);
  const team = teams.data.find((t) => t.id === id);
  useEffect(() => {
    let mounted = true;
    setPreview("");
    if (team?.image_path)
      void db()
        .storage.from("team-images")
        .createSignedUrl(team.image_path, 3600)
        .then(({ data }) => {
          if (mounted) setPreview(data?.signedUrl ?? "");
        });
    else setPreview(team?.image_url ?? "");
    return () => {
      mounted = false;
    };
  }, [team]);
  return (
    <>
      <Intro
        title={
          kind === "general"
            ? "Ranking Configuration"
            : kind === "key-mappings"
              ? "Keyboard Mappings"
              : "Team Images"
        }
      >
        Shared settings for all Management and Admin users. Changes are audited.
      </Intro>
      <Notice error={r.error || teams.error} loading={r.loading} />
      <section className="card">
        {kind === "general" && (
          <>
            <h3>Card penalty reasons</h3>
            <label>
              Selectable reason tiles (one per line)
              <textarea
                value={reasons}
                onChange={(e) => setReasons(e.target.value)}
              />
            </label>
            <label>
              Knockout overtime maximum (seconds)
              <input
                type="number"
                min={1}
                max={60}
                value={overtime}
                onChange={(e) => setOvertime(Number(e.target.value))}
              />
            </label>
            <button
              disabled={a.busy}
              onClick={() =>
                void a.run(() =>
                  write(
                    "tConfiguration",
                    {
                      penalty_reasons: [
                        ...new Set(
                          reasons
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        ),
                      ],
                      overtime_ms: Math.round(overtime * 1000),
                    },
                    "true",
                  ),
                )
              }
            >
              Save match configuration
            </button>
            <p>
              Overtime is sudden death. New matches capture this duration;
              existing matches keep their snapshot.
            </p>
            <h3>Standings tiebreak priority</h3>
            <p>
              Match wins always rank first. Choose secondary criteria in order.
              Equal criteria remain tied; no automatic qualifiers are selected.
            </p>
            <p className="muted">
              No secondary order is assumed. Head-to-head requires further rules
              for multiway ties and is deferred.
            </p>
            <ol>
              <li>Match wins (fixed)</li>
              {order.map((k, i) => (
                <li key={k}>
                  {k === "differential"
                    ? "Point differential"
                    : "Total points scored"}{" "}
                  <button
                    className="icon-btn"
                    onClick={() => setOrder(order.filter((x) => x !== k))}
                  >
                    Remove
                  </button>
                  {i > 0 && (
                    <button
                      className="icon-btn"
                      onClick={() => {
                        const next = [...order];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        setOrder(next);
                      }}
                    >
                      Move up
                    </button>
                  )}
                </li>
              ))}
            </ol>
            <div className="button-row">
              {["differential", "points_for"]
                .filter((k) => !order.includes(k))
                .map((k) => (
                  <button
                    key={k}
                    className="subtle"
                    onClick={() => setOrder([...order, k])}
                  >
                    Add{" "}
                    {k === "differential"
                      ? "point differential"
                      : "total points"}
                  </button>
                ))}
              <button
                className="primary"
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    const { error } = await db()
                      .from("tConfiguration")
                      .update({ tiebreakers: order })
                      .eq("id", true);
                    if (error) throw error;
                  })
                }
              >
                Save ranking rules
              </button>
            </div>
            <p className="muted">
              Completed event snapshots retain their original ranking
              configuration.
            </p>
          </>
        )}
        {kind === "key-mappings" && (
          <>
            <p>
              Use unique single letters, digits, or Space. Blank fields disable
              the shortcut. A match captures these mappings before it starts.
            </p>
            <div className="editor key-editor">
              {actions.map((action) => (
                <label key={action}>
                  {action}
                  <input
                    maxLength={1}
                    aria-label={`Shortcut ${action}`}
                    value={keys[action] ?? ""}
                    onChange={(e) => {
                      const next = { ...keys };
                      if (e.target.value)
                        next[action] = e.target.value.toLowerCase();
                      else delete next[action];
                      setKeys(next);
                    }}
                    placeholder="None"
                  />
                </label>
              ))}
            </div>
            <button
              className="primary"
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  const values = Object.values(keys);
                  if (
                    values.some((k) => !/[a-z0-9 ]/.test(k)) ||
                    new Set(values).size !== values.length
                  )
                    throw new Error("Choose unique letters, digits or Space.");
                  const { error } = await db()
                    .from("tConfiguration")
                    .update({ key_mappings: keys })
                    .eq("id", true);
                  if (error) throw error;
                })
              }
            >
              Save shared mappings
            </button>
          </>
        )}
        {kind === "team-images" && (
          <>
            <label>
              Reusable team
              <select
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setUrl(
                    teams.data.find((t) => t.id === e.target.value)
                      ?.image_url ?? "",
                  );
                }}
              >
                <option value="">Select team</option>
                {teams.data
                  .filter((t) => !t.is_archived)
                  .map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            {id && (
              <>
                <label>
                  External image URL
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </label>
                <button
                  className="primary"
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(async () => {
                      const parsed = new URL(url);
                      if (
                        parsed.protocol !== "https:" ||
                        parsed.username ||
                        parsed.password
                      )
                        throw new Error("Use an HTTPS image URL.");
                      await write(
                        "tTeam",
                        { image_url: parsed.href, image_path: null },
                        id,
                      );
                    })
                  }
                >
                  Save image URL
                </button>
                <label>
                  Or upload PNG, JPEG or WebP (maximum 2 MB)
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={a.busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void a.run(async () => {
                        if (
                          !["image/png", "image/jpeg", "image/webp"].includes(
                            file.type,
                          ) ||
                          file.size > 2 * 1024 * 1024
                        )
                          throw new Error(
                            "Choose a PNG, JPEG or WebP no larger than 2 MB.",
                          );
                        const bitmap = await createImageBitmap(file);
                        bitmap.close();
                        const path = `${id}/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp"}`;
                        const { error } = await db()
                          .storage.from("team-images")
                          .upload(path, file, { contentType: file.type });
                        if (error) throw error;
                        await write(
                          "tTeam",
                          { image_path: path, image_url: null },
                          id,
                        );
                      });
                    }}
                  />
                </label>
                {preview && (
                  <img
                    className="team-preview"
                    src={preview}
                    alt={`${team?.name} team image`}
                    referrerPolicy="no-referrer"
                  />
                )}
              </>
            )}
          </>
        )}
        <Notice error={a.status} />
      </section>
      <ConfigurationAudit />
    </>
  );
}
function ConfigurationAudit() {
  const a = useRows<{
    id: string;
    table_name: string;
    recorded_at: string;
    actor_id: string;
    old_value: unknown;
    new_value: unknown;
  }>("tAudit");
  return (
    <section className="card">
      <h3>Configuration audit</h3>
      <Notice error={a.error} />
      {a.data
        .filter(
          (a) => a.table_name === "tConfiguration" || a.table_name === "tTeam",
        )
        .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
        .map((a) => (
          <details key={a.id}>
            <summary>
              {a.recorded_at} · {a.actor_id ?? "System"} · {a.table_name}
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
    </section>
  );
}
