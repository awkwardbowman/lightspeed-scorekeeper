import type { Match, Phase, CallType, PointValue, Side, EndReason } from '../match';
import { supabase } from './supabase';

export interface CloudMatchSummary {
  id: string;
  event_name: string;
  round_name: string;
  left_name: string;
  right_name: string;
  phase: Phase;
  created_at: string;
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured in this environment.');
  return supabase;
}

/** Saves one paused, ready, or ended Traditional match and its calls. */
export async function saveTraditionalMatch(match: Match, ownerId: string): Promise<void> {
  if (match.phase === 'running') throw new Error('Pause the match before saving to the cloud.');
  const db = client();
  const { error: matchError } = await db.from('tTraditionalMatch').upsert({
    id: match.id,
    owner_id: ownerId,
    event_name: match.eventName,
    round_name: match.roundName,
    left_name: match.leftName,
    right_name: match.rightName,
    duration_ms: Math.round(match.durationMs),
    remaining_ms: Math.round(match.remainingMs),
    target_score: match.targetScore,
    phase: match.phase,
    end_reason: match.endReason,
    created_at: match.createdAt,
    started_at: match.startedAt,
    ended_at: match.endedAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (matchError) throw matchError;

  // Add/update the calls first. The last step removes calls that were undone,
  // so retries after a partial failure are safe and preserve each call's UUID.
  if (match.calls.length) {
    const { error: callError } = await db.from('tTraditionalCall').upsert(
      match.calls.map((call) => ({
        id: call.id,
        match_id: match.id,
        side: call.side,
        call_type: call.type,
        points: call.points,
        match_time_ms: Math.round(call.matchTimeMs),
        recorded_at: call.timestamp,
      })),
      { onConflict: 'id' },
    );
    if (callError) throw callError;
  }

  const { data: remoteCalls, error: listError } = await db
    .from('tTraditionalCall').select('id').eq('match_id', match.id);
  if (listError) throw listError;
  const currentIds = new Set(match.calls.map((call) => call.id));
  const removedIds = (remoteCalls ?? []).filter((call) => !currentIds.has(call.id)).map((call) => call.id);
  if (removedIds.length) {
    const { error: deleteError } = await db.from('tTraditionalCall').delete().in('id', removedIds);
    if (deleteError) throw deleteError;
  }
}

export async function listTraditionalMatches(): Promise<CloudMatchSummary[]> {
  const { data, error } = await client().from('tTraditionalMatch')
    .select('id,event_name,round_name,left_name,right_name,phase,created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as CloudMatchSummary[];
}

export async function loadTraditionalMatch(id: string): Promise<Match> {
  const db = client();
  const { data: row, error } = await db.from('tTraditionalMatch')
    .select('id,event_name,round_name,left_name,right_name,duration_ms,remaining_ms,target_score,phase,end_reason,created_at,started_at,ended_at')
    .eq('id', id).single();
  if (error) throw error;
  const { data: calls, error: callError } = await db.from('tTraditionalCall')
    .select('id,side,call_type,points,match_time_ms,recorded_at')
    .eq('match_id', id)
    .order('recorded_at', { ascending: true });
  if (callError) throw callError;

  // Never restart a running timer implicitly when loading a saved record.
  const phase = row.phase as Phase;
  return {
    id: row.id,
    eventName: row.event_name,
    roundName: row.round_name,
    leftName: row.left_name,
    rightName: row.right_name,
    durationMs: row.duration_ms,
    remainingMs: row.remaining_ms,
    targetScore: row.target_score,
    phase: phase === 'running' ? 'paused' : phase,
    endReason: row.end_reason as EndReason,
    calls: (calls ?? []).map((call) => ({
      id: call.id,
      side: call.side as Side,
      type: call.call_type as CallType,
      points: call.points as PointValue,
      matchTimeMs: call.match_time_ms,
      timestamp: call.recorded_at,
    })),
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}
