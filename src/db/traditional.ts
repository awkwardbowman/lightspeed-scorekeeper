import type {
  Match,
  Phase,
  Side,
  CallType,
  PointValue,
  EndReason,
} from "../match";
import { db, rpc } from "../data";
export interface CloudMatchSummary {
  id: string;
  event_name: string;
  round_name: string;
  left_name: string;
  right_name: string;
  phase: Phase;
  created_at: string;
}
export async function listTraditionalMatches(): Promise<CloudMatchSummary[]> {
  const { data, error } = await db()
    .from("tTraditionalMatch")
    .select("id,event_name,round_name,left_name,right_name,phase,created_at")
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data as CloudMatchSummary[];
}
export async function loadTraditionalMatch(id: string): Promise<Match> {
  const { data: r, error } = await db()
    .from("vMatchResults")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  const { data: c, error: ce } = await db()
    .from("tTraditionalCall")
    .select("*")
    .eq("match_id", id)
    .eq("is_reversed", false)
    .order("recorded_at");
  if (ce) throw ce;
  return {
    id: r.id,
    eventId: r.event_id ?? undefined,
    bracketId: r.bracket_id ?? undefined,
    groupId: r.group_id ?? undefined,
    presetId: r.preset_id ?? undefined,
    leftFencerId: r.left_fencer_id ?? undefined,
    rightFencerId: r.right_fencer_id ?? undefined,
    eventName: r.event_name,
    roundName: r.round_name,
    leftName: r.current_left_name,
    rightName: r.current_right_name,
    durationMs: r.duration_ms,
    remainingMs: r.remaining_ms,
    targetScore: r.target_score,
    phase: r.phase === "running" ? "paused" : (r.phase as Phase),
    endReason: r.end_reason as EndReason,
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    winnerSide: r.winner_side ?? undefined,
    finalized: Boolean(r.finalized_at),
    calls: (c ?? []).map((c) => ({
      id: c.id,
      side: c.side as Side,
      type: c.call_type as CallType,
      points: c.points as PointValue,
      matchTimeMs: c.match_time_ms,
      timestamp: c.recorded_at,
    })),
  };
}
export async function newStandalone(match: Match, owner: string) {
  const { error } = await db()
    .from("tTraditionalMatch")
    .insert({
      id: match.id,
      owner_id: owner,
      event_name: "",
      round_name: match.roundName,
      left_name: match.leftName,
      right_name: match.rightName,
      left_fencer_id: match.leftFencerId,
      right_fencer_id: match.rightFencerId,
      preset_id: match.presetId ?? null,
      duration_ms: match.durationMs,
      remaining_ms: match.durationMs,
      target_score: match.targetScore,
    });
  if (error && error.code !== "23505") throw error;
}
export interface Claim {
  revision: number;
  lease_token: string;
}
export async function claim(id: string, token: string, takeover = false) {
  return rpc<Claim>("claim_match", {
    p_id: id,
    p_token: token,
    p_takeover: takeover,
  });
}
