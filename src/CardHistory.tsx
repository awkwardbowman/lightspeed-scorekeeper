import { useEffect, useState } from "react";
import { db, message } from "./data";
import { type LiveMatch, type Operation, operationLabel } from "./liveMatch";
import { Notice } from "./ui";
export default function CardHistory({
  match,
  operations,
}: {
  match: LiveMatch;
  operations: Operation[];
}) {
  const [history, setHistory] = useState<Operation[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!match.event_id) {
      setHistory(operations);
      return;
    }
    setLoading(true);
    setError("");
    (async () => {
      const ids: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db()
          .from("tTraditionalMatch")
          .select("id")
          .eq("event_id", match.event_id)
          .order("id")
          .range(offset, offset + 999);
        if (error) throw error;
        ids.push(...data.map((m) => m.id));
        if (data.length < 1000) break;
      }
      const all: Operation[] = [];
      // Bound query size and fetch only the disciplinary ledger within this event.
      for (let i = 0; i < ids.length; i += 100) {
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await db()
            .from("tMatchOperation")
            .select("*")
            .in("match_id", ids.slice(i, i + 100))
            .in("kind", ["penalty", "reverse"])
            .order("id")
            .range(offset, offset + 999);
          if (error) throw error;
          all.push(...data);
          if (data.length < 1000) break;
        }
      }
      if (alive) setHistory(all);
    })()
      .catch((e) => {
        if (alive) setError(message(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [match.event_id, operations]);
  const reversed = new Set(
    history.filter((o) => o.kind === "reverse").map((o) => o.data.operationId),
  );
  const cards = history
    .filter(
      (o) =>
        o.kind === "penalty" &&
        (o.match_id === match.id ||
          [match.left_fencer_id, match.right_fencer_id].includes(
            String(o.data.sanctionedFencerId),
          )),
    )
    .sort(
      (a, b) =>
        b.recorded_at.localeCompare(a.recorded_at) || b.sequence - a.sequence,
    );
  return (
    <>
      <Notice error={error} loading={loading} />
      {!loading && !error && !cards.length && (
        <p>
          No prior cards {match.event_id ? "in this event" : "in this match"}.
        </p>
      )}
      {cards.map((o) => (
        <article key={o.id} className={reversed.has(o.id) ? "reversed" : ""}>
          <strong>
            {o.match_id === match.id
              ? o.data.side === "left"
                ? match.current_left_name
                : match.current_right_name
              : o.data.sanctionedFencerId === match.left_fencer_id
                ? match.current_left_name
                : match.current_right_name}
          </strong>
          <p>{operationLabel(o)}</p>
          <time dateTime={o.recorded_at}>
            {new Date(o.recorded_at).toLocaleString()}
          </time>
          {reversed.has(o.id) && <p>Reversed</p>}
        </article>
      ))}
    </>
  );
}
