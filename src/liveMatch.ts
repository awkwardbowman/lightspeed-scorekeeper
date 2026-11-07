import { db, rpc, type MatchRow } from "./data";
export interface LiveMatch extends MatchRow {
  server_now: string;
  duration_ms: number;
  remaining_ms: number;
  target_score: number | null;
  end_reason: string | null;
  started_at: string | null;
  ended_at: string | null;
  preset_id: string | null;
  round_name: string;
  event_name: string;
  match_type: "standard" | "knockout";
  is_overtime: boolean;
  overtime_ms: number;
  clock_deadline: string | null;
  key_snapshot: Record<string, string>;
  result_override: "left" | "right" | "draw" | null;
  ledger_enabled: boolean;
}
export interface Operation {
  id: string;
  match_id: string;
  sequence: number;
  actor_id: string;
  recorded_at: string;
  kind: string;
  left_delta: number;
  right_delta: number;
  left_after: number;
  right_after: number;
  data: Record<string, unknown>;
}
export async function loadLive(id: string): Promise<LiveMatch> {
  const { data, error } = await db()
    .from("vMatchResults")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}
export async function loadOperations(id: string): Promise<Operation[]> {
  const all: Operation[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db()
      .from("tMatchOperation")
      .select("*")
      .eq("match_id", id)
      .order("sequence")
      .range(offset, offset + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
}
export const command = (
  id: string,
  token: string,
  revision: number,
  request: string,
  action: string,
  data: Record<string, unknown>,
) =>
  rpc<{ revision: number }>("match_command", {
    p_id: id,
    p_token: token,
    p_revision: revision,
    p_request: request,
    p_action: action,
    p_data: data,
  });
export function operationLabel(o: Operation) {
  if (o.kind === "score")
    return `${o.data.side} +${o.data.points} ${o.data.type}`;
  if (o.kind === "penalty")
    return `${o.data.card} card on ${o.data.side} · ${o.data.reason} → ${o.data.creditedSide} +${o.data.points}`;
  if (o.kind === "admin") {
    if (o.data.outcome)
      return `Official outcome: ${o.data.outcome === "draw" ? "Tie" : o.data.outcome}`;
    if (o.left_delta || o.right_delta)
      return `Score correction · left ${signed(o.left_delta)}, right ${signed(o.right_delta)}`;
    if ("remainingMs" in o.data) return "Timer correction";
    if ("targetScore" in o.data) return "Score to Win correction";
    return "Match settings correction";
  }
  if (o.kind === "reverse") return "Scoring reversal";
  return o.kind;
}
export function signed(n: number) {
  return n >= 0 ? `+${n}` : String(n);
}
