export type Source =
  | { seed: number }
  | { match: string; outcome: "winner" | "loser" };
export interface BracketNode {
  key: string;
  left: Source;
  right: Source;
  reset?: boolean;
}
export interface BracketGraph {
  entrants: string[];
  nodes: BracketNode[];
}
export function bracketGraph(entrants: string[], double = false): BracketGraph {
  if (
    entrants.length < 2 ||
    entrants.length > 128 ||
    new Set(entrants).size !== entrants.length
  )
    throw new Error("Choose 2–128 distinct entrants in seed order.");
  const size = 2 ** Math.ceil(Math.log2(entrants.length));
  const rounds = Math.log2(size);
  const nodes: BracketNode[] = [];
  const win = (match: string): Source => ({ match, outcome: "winner" });
  const lose = (match: string): Source => ({ match, outcome: "loser" });
  for (let r = 1; r <= rounds; r++)
    for (let i = 0; i < size / 2 ** r; i++)
      nodes.push({
        key: `W${r}.${i}`,
        left: r === 1 ? { seed: i * 2 } : win(`W${r - 1}.${i * 2}`),
        right: r === 1 ? { seed: i * 2 + 1 } : win(`W${r - 1}.${i * 2 + 1}`),
      });
  if (double) {
    if (rounds === 1) {
      nodes.push({ key: "GF", left: win("W1.0"), right: lose("W1.0") });
    } else {
      for (let i = 0; i < size / 4; i++)
        nodes.push({
          key: `L1.${i}`,
          left: lose(`W1.${i * 2}`),
          right: lose(`W1.${i * 2 + 1}`),
        });
      for (let wr = 2; wr <= rounds; wr++) {
        const count = size / 2 ** wr;
        const lr = 2 * wr - 2;
        for (let i = 0; i < count; i++)
          nodes.push({
            key: `L${lr}.${i}`,
            left: win(`L${lr - 1}.${i}`),
            right: lose(`W${wr}.${count - 1 - i}`),
          });
        if (wr < rounds)
          for (let i = 0; i < count / 2; i++)
            nodes.push({
              key: `L${lr + 1}.${i}`,
              left: win(`L${lr}.${i * 2}`),
              right: win(`L${lr}.${i * 2 + 1}`),
            });
      }
      nodes.push({
        key: "GF",
        left: win(`W${rounds}.0`),
        right: win(`L${2 * rounds - 2}.0`),
      });
    }
    nodes.push({
      key: "RESET",
      left: win("GF"),
      right: lose("GF"),
      reset: true,
    });
  }
  return { entrants, nodes };
}
export function roundRobin(entrants: string[]): Array<[string, string]> {
  if (
    new Set(entrants).size !== entrants.length ||
    entrants.length < 2 ||
    entrants.length > 128
  )
    throw new Error("Choose 2–128 distinct participants.");
  return entrants.flatMap((a, i) =>
    entrants.slice(i + 1).map((b): [string, string] => [a, b]),
  );
}
