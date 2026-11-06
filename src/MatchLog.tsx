import { operationLabel, type Operation } from "./liveMatch";
export default function MatchLog({
  operations,
  busy = false,
  onReverse,
}: {
  operations: Operation[];
  busy?: boolean;
  onReverse?: (id: string) => void;
}) {
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
            <th>UTC / referee</th>
            <th>Action</th>
            <th>Score after action</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((o) => (
            <tr
              key={o.id}
              className={
                reversed.has(o.id) || o.data.isReversed ? "reversed" : ""
              }
            >
              <td>
                {o.recorded_at}
                <small>{o.actor_id}</small>
              </td>
              <td>
                {operationLabel(o)}
                <details>
                  <summary>Details</summary>
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
                          "Revert this scoring operation? The original entry and your reversal will remain in history.",
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
