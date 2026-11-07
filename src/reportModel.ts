import type { Operation } from "./liveMatch";
export function reportModel(
  operations: Operation[],
  finalLeft: number,
  finalRight: number,
) {
  const ordered = [...operations].sort((a, b) => a.sequence - b.sequence);
  const reversed = new Set(
    ordered
      .filter((o) => o.kind === "reverse")
      .map((o) => String(o.data.operationId)),
  );
  const breakdown: Record<string, [number, number]> = {
    "+1": [0, 0],
    "+3": [0, 0],
    "+5": [0, 0],
    Other: [0, 0],
  };
  let unavailable = false;
  const progression: { sequence: number; left: number; right: number }[] = [];
  for (const o of ordered) {
    if (o.data.snapshotUnavailable) unavailable = true;
    else
      progression.push({
        sequence: o.sequence,
        left: o.left_after,
        right: o.right_after,
      });
    if (reversed.has(o.id) || o.data.isReversed) continue;
    if (o.kind === "score") {
      const key =
        o.data.type === "indirect" && Number(o.data.points) === 1
          ? "+1"
          : o.data.type === "clean" && Number(o.data.points) === 3
            ? "+3"
            : o.data.type === "counter" && Number(o.data.points) === 5
              ? "+5"
              : "Other";
      breakdown[key][o.data.side === "left" ? 0 : 1] += Number(o.data.points);
    } else if (o.kind === "penalty" || o.kind === "admin") {
      breakdown.Other[0] += o.left_delta;
      breakdown.Other[1] += o.right_delta;
    }
  }
  const totals = Object.values(breakdown).reduce(
    (sum, p) => [sum[0] + p[0], sum[1] + p[1]] as [number, number],
    [0, 0],
  );
  const reconciled = totals[0] === finalLeft && totals[1] === finalRight;
  // Never label a fabricated historical point as an operation. The current
  // database score is rendered separately if source snapshots cannot reach it.
  const end = progression.at(-1);
  const graphReconciled = Boolean(
    end && end.left === finalLeft && end.right === finalRight,
  );
  return {
    breakdown,
    totals,
    progression,
    unavailable,
    reconciled,
    graphReconciled,
  };
}
