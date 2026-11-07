import type { MatchRow, Fencer } from "./data";
import type { PhaseBracket } from "./phases";
import type { Source } from "./tournament";
export default function BracketView({
  bracket,
  matches,
  fencers,
  onOpen,
}: {
  bracket: PhaseBracket;
  matches: MatchRow[];
  fencers: Fencer[];
  onOpen?: (m: MatchRow) => void;
}) {
  const rounds = new Map<string, typeof bracket.graph.nodes>();
  for (const node of bracket.graph.nodes) {
    const round = node.key.startsWith("R")
      ? "Round Robin"
      : node.key.includes(".")
        ? node.key.split(".")[0]
        : node.key;
    rounds.set(round, [...(rounds.get(round) ?? []), node]);
  }
  const source = (s: Source) =>
    "seed" in s
      ? `Seed ${s.seed + 1}: ${fencers.find((f) => f.id === bracket.graph.entrants[s.seed])?.display_name ?? "Bye"}`
      : `${s.outcome === "winner" ? "Winner" : "Loser"} of ${s.match}`;
  return (
    <section aria-label="Phase Bracket" className="bracket-scroll">
      <div className="bracket-rounds">
        {[...rounds].map(([round, nodes]) => (
          <section className="bracket-round" key={round}>
            <h3>{round}</h3>
            {nodes.map((node) => {
              const m = matches.find(
                (m) => m.bracket_id === bracket.id && m.slot_key === node.key,
              );
              return (
                <article
                  className={`bracket-match ${m?.finalized_at ? "finished" : ""}`}
                  key={node.key}
                >
                  <h4>{node.key}</h4>
                  <p>
                    <strong>
                      {m?.left_fencer_id
                        ? m.current_left_name
                        : source(node.left)}
                    </strong>
                    {m?.finalized_at ? ` · ${m.left_score}` : ""}
                  </p>
                  <p>
                    <strong>
                      {m?.right_fencer_id
                        ? m.current_right_name
                        : source(node.right)}
                    </strong>
                    {m?.finalized_at ? ` · ${m.right_score}` : ""}
                  </p>
                  <small>
                    {m?.is_bye
                      ? "Bye — advanced automatically"
                      : m?.is_void
                        ? "Void"
                        : m?.finalized_at
                          ? `Winner: ${m.winner_side === "left" ? m.current_left_name : m.winner_side === "right" ? m.current_right_name : "Tie"}`
                          : m?.schedule_ready
                            ? "Scheduled"
                            : "Waiting for Results"}
                  </small>
                  {m && onOpen && !m.is_void && m.schedule_ready && (
                    <button onClick={() => onOpen(m)}>
                      Open Match {m.match_sequence}
                    </button>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </section>
  );
}
