import { supabase } from "./db/supabase";
export const db = () => {
  if (!supabase) throw new Error("Database connection is not configured.");
  return supabase;
};
export const message = (e: unknown) =>
  e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function manage<T = { ok: boolean }>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db().functions.invoke("manage-users", { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (data.error) throw new Error(data.error);
  return data;
}
export async function rows<T>(table: string): Promise<T[]> {
  const orders: Record<string, string[]> = {
    tEventFencer: ["event_id", "fencer_id"],
    tEventTeam: ["event_id", "team_id"],
    tTeamFencer: ["team_id", "fencer_id"],
    tEventTeamFencer: ["event_id", "team_id", "fencer_id"],
    tEventGroupFencer: ["group_id", "fencer_id"],
    vFencerStatistics: ["fencer_id", "scope"],
    vFencerResults: ["match_id", "fencer_id"],
    vFencerScoring: ["fencer_id", "scope", "call_type", "points"],
  };
  const result: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = db().from(table).select("*");
    for (const key of orders[table] ?? ["id"]) query = query.order(key);
    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    result.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return result;
}
export async function write(
  table: string,
  values: Record<string, unknown>,
  id?: string,
) {
  const query = id
    ? db().from(table).update(values).eq("id", id)
    : db().from(table).insert(values);
  const { error } = await query;
  if (error) throw error;
}
export interface Profile {
  id: string;
  email: string;
  display_name: string;
  app_role: "admin" | "management";
  is_active: boolean;
  must_change_password: boolean;
  is_deleted: boolean;
}
export interface Fencer {
  id: string;
  display_name: string;
  affiliation: string;
  notes: string;
  is_archived: boolean;
  is_unregistered: boolean;
}
export interface Preset {
  id: string;
  name: string;
  duration_ms: number;
  target_score: number | null;
  is_archived: boolean;
  mode: string;
}
export interface EventRecord {
  id: string;
  name: string;
  mode: string;
  competition_format: string;
  status: string;
  preset_id: string | null;
  description: string;
  starts_at: string | null;
  ends_at: string | null;
}
export interface Team {
  id: string;
  name: string;
  mode: string;
  image_url: string | null;
  image_path: string | null;
  is_archived: boolean;
}
export interface Configuration {
  id: boolean;
  tiebreakers: string[];
  key_mappings: Record<string, string>;
  version: number;
}
export interface Standing {
  id: string;
  display_name: string;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  points_for: number;
  differential: number;
}
export interface MatchRow {
  id: string;
  event_id: string | null;
  phase_id: string | null;
  group_id: string | null;
  bracket_id: string | null;
  slot_key: string | null;
  current_left_name: string;
  current_right_name: string;
  left_name: string;
  right_name: string;
  left_fencer_id: string | null;
  right_fencer_id: string | null;
  left_score: number;
  right_score: number;
  phase: string;
  outcome: string;
  winner_side: string | null;
  is_archived: boolean;
  is_void: boolean;
  finalized_at: string | null;
  created_at: string;
  referee_id: string | null;
  revision: number;
}
