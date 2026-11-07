import { useEffect, useState } from "react";
import { db, type Configuration as Config, write } from "./data";
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
  kind: "general" | "key-mappings";
}) {
  const r = useRows<Config>("tConfiguration");
  const a = useAction(async () => {
    await r.reload();
  });
  const [reasons, setReasons] = useState("Safety\nPower");
  const [overtime, setOvertime] = useState(60);
  const [order, setOrder] = useState<string[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
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
      <Notice error={r.error} loading={r.loading} />
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
        <Notice error={a.error} success={a.status} />
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
