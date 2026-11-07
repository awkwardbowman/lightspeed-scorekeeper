import { operationLabel, signed, type Operation } from "./liveMatch";
import { type Profile } from "./data";
import { useRows } from "./ui";
export default function MatchLog({
  operations,
  busy = false,
  onReverse,
  names,
}: {
  operations: Operation[];
  names?: { left: string; right: string };
  busy?: boolean;
  onReverse?: (id: string) => void;
}) {
  const users = useRows<Profile>("tUser");
  const actor = (o: Operation) => users.data.find((u) => u.id === o.actor_id)?.display_name ?? (o.actor_id ? "Former referee" : "System");
  const label = (o: Operation) =>
    names
      ? operationLabel(o).replace(
          /\b(left|right)\b/g,
          (side) => names[side as "left" | "right"],
        )
      : operationLabel(o);
  const reversed = new Set(
    operations.filter((o) => o.kind === "reverse").map((o) => String(o.data.operationId)),
  );
  const operationById = new Map(operations.map((o) => [o.id, o]));
  const reversible = (o: Operation) =>
    ["score", "penalty"].includes(o.kind) ||
    (o.kind === "admin" &&
      (o.left_delta !== 0 || o.right_delta !== 0) &&
      !("remainingMs" in o.data) &&
      !("targetScore" in o.data) &&
      !("outcome" in o.data) &&
      !("resume" in o.data));
  const humanLabel = (o: Operation) => {
    if (o.kind === "reverse") {
      const original = operationById.get(String(o.data.operationId));
      return original ? `Nullified: ${label(original)}` : "Nullified earlier scoring entry";
    }
    return label(o);
  };
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Local Time</th>
            <th>Action</th>
            <th>Recorded score then</th>
            <th>Status / Override</th>
          </tr>
        </thead>
        <tbody>
          {[...operations]
            .sort(
              (a, b) =>
                b.recorded_at.localeCompare(a.recorded_at) ||
                b.sequence - a.sequence,
            )
            .map((o) => (
              <tr
                key={o.id}
                className={
                  reversed.has(o.id) || o.data.isReversed ? "reversed" : ""
                }
              >
                <td>
                  <time dateTime={o.recorded_at}>
                    {new Date(o.recorded_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </td>
                <td>
                  {humanLabel(o)}
                  <small className="muted"> · by {actor(o)}</small>
                </td>
                <td>
                  {o.data.snapshotUnavailable
                    ? "Legacy snapshot unavailable"
                    : `${o.left_after} – ${o.right_after}`}
                </td>
                <td>
                  {reversed.has(o.id) || o.data.isReversed ? (
                    "Nullified"
                  ) : onReverse && reversible(o) ? (
                    <button
                      type="button"
                      className="subtle log-nullify"
                      aria-label={`Nullify log entry: ${label(o)}`}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Nullify ${label(o)}?\nRecorded: ${new Date(o.recorded_at).toLocaleString()} by ${actor(o)}\nScore effect being reversed: ${names?.left ?? "Left"} ${signed(o.left_delta)}, ${names?.right ?? "Right"} ${signed(o.right_delta)}.\nThe original entry and the new override will remain in the audit history.`))
                          onReverse(o.id);
                      }}
                    >
                      Nullify
                    </button>
                  ) : (
                    "Recorded"
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {!operations.length && (
        <p>No operations recorded yet.</p>
      )}
      {Boolean(onReverse) && (
        <p className="muted">The score shown for each entry is the historical total at that time; later Nullify operations change the effective score. Nullify scoring calls, cards and score corrections here. Timer, target and outcome changes use dedicated Admin controls. Every override remains in the audit history.</p>
      )}
    </div>
  );
}
