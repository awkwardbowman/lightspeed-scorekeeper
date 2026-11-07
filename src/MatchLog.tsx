import { operationLabel, type Operation } from "./liveMatch";
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
  const label = (o: Operation) =>
    names
      ? operationLabel(o).replace(
          /\b(left|right)\b/g,
          (side) => names[side as "left" | "right"],
        )
      : operationLabel(o);
  const reversed = new Set(
    operations
      .filter((o) => o.kind === "reverse")
      .map((o) => String(o.data.operationId)),
  );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Local Time</th>
            <th>Action</th>
            <th>Score after action</th>
            <th>Status</th>
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
                  {label(o)}
                  <details>
                    <summary>Details</summary>
                    <p>
                      UTC: {o.recorded_at} · Actor: {o.actor_id}
                    </p>
                    <pre>{JSON.stringify(o.data, null, 2)}</pre>
                  </details>
                </td>
                <td>
                  {o.data.snapshotUnavailable
                    ? "Legacy snapshot unavailable"
                    : `${o.left_after} – ${o.right_after}`}
                </td>
                <td>
                  {reversed.has(o.id) || o.data.isReversed ? (
                    "Reversed"
                  ) : onReverse &&
                    ["score", "penalty", "admin"].includes(o.kind) ? (
                    <button
                      disabled={
                        busy ||
                        (o.kind === "admin" && !o.left_delta && !o.right_delta)
                      }
                      onClick={() => {
                        if (
                          confirm(
                            `Revert ${label(o)}? This changes the effective score. The original entry and your reversal will remain in history.`,
                          )
                        )
                          onReverse(o.id);
                      }}
                    >
                      Revert
                    </button>
                  ) : (
                    "Retained"
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {!operations.length && (
        <p>No new operations. Earlier calls remain in the historical report.</p>
      )}
    </div>
  );
}
