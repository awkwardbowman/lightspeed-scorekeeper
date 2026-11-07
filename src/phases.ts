import { useCallback, useEffect, useRef, useState } from "react";
import { message, rpc, type MatchRow } from "./data";
import { useAccount } from "./Auth";
export interface EventPhase {
  id: string;
  event_id: string;
  name: string;
  kind: "group" | "single" | "double";
  position: number;
  preset_id: string | null;
  revision: number;
  workflow_enabled: boolean;
  is_archived: boolean;
  preset_snapshot: Record<string, unknown> | null;
  preset_name: string;
  match_type: "standard" | "knockout";
  duration_ms: number | null;
  target_score: number | null;
  participant_count: number;
  match_count: number;
  completed_count: number;
  state: "empty" | "scheduled" | "active" | "complete";
}
export interface PhaseRegistration {
  phase_id: string;
  event_id: string;
  fencer_id: string;
  seed: number | null;
  registered_at: string;
}
export interface PhaseBracket {
  id: string;
  phase_id: string;
  format: string;
  graph: import("./tournament").BracketGraph;
  is_archived: boolean;
  created_at: string;
}
export const phaseUrl = (
  event: string,
  phase?: string,
  mode = "list",
  origin = "manage",
) =>
  `#/events/phases?event=${encodeURIComponent(event)}${phase ? `&phase=${encodeURIComponent(phase)}` : ""}&mode=${mode}&origin=${origin}`;
export const runPhaseUrl = (event: string, phase?: string) =>
  `#/run-event?event=${encodeURIComponent(event)}${phase ? `&phase=${encodeURIComponent(phase)}` : ""}`;
export const phaseStateLabels = {
  empty: "No Matches",
  scheduled: "Scheduled",
  active: "In Progress",
  complete: "Complete",
};
export function sortedPhaseMatches(matches: MatchRow[]) {
  const rank = (m: MatchRow) =>
    m.is_archived
      ? 5
      : m.is_void
        ? 4
        : m.finalized_at
          ? 3
          : m.phase === "running"
            ? 1
            : m.schedule_ready && m.left_fencer_id && m.right_fencer_id
              ? 0
              : 2;
  return [...matches].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.match_sequence ?? 0) - (b.match_sequence ?? 0) ||
      a.id.localeCompare(b.id),
  );
}
type Pending = {
  id: string;
  event: string;
  phase: string;
  revision: number | null;
  action: string;
  data: Record<string, unknown>;
};
export function usePhaseCommand(event: string, reload: () => Promise<void>) {
  const { profile } = useAccount();
  const key = `phase-pending:v1:${profile.id}:${event}`;
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") as Pending | null;
    } catch {
      return null;
    }
  };
  const [pending, setPending] = useState<Pending | null>(read),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const current = useRef(pending);
  const lock = useRef(false);
  useEffect(() => {
    const p = read();
    current.current = p;
    setPending(p);
    setError("");
    setSuccess("");
  }, [key]);
  const send = useCallback(
    async (p: Pending) => {
      if (lock.current) return false;
      lock.current = true;
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        localStorage.setItem(key, JSON.stringify(p));
        current.current = p;
        setPending(p);
        await rpc("phase_command", {
          p_request: p.id,
          p_event: p.event,
          p_phase: p.phase,
          p_revision: p.revision,
          p_action: p.action,
          p_data: p.data,
        });
        await reload();
        localStorage.removeItem(key);
        current.current = null;
        setPending(null);
        setSuccess("Saved.");
        return true;
      } catch (e) {
        setError(
          e && typeof e === "object" && "code" in e && e.code === "23505"
            ? "That seed is already assigned in this phase. Choose another seed or clear the existing assignment."
            : message(e),
        );
        if (
          e &&
          typeof e === "object" &&
          "code" in e &&
          /^[A-Z0-9]{5}$/.test(String(e.code))
        ) {
          localStorage.removeItem(key);
          current.current = null;
          setPending(null);
        }
        return false;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [key, reload],
  );
  const execute = (
    action: string,
    phase: string,
    revision: number | null,
    data: Record<string, unknown> = {},
  ) => {
    if (current.current) {
      setError("Retry the pending save before another change.");
      return Promise.resolve(false);
    }
    return send({
      id: crypto.randomUUID(),
      event,
      phase,
      revision,
      action,
      data,
    });
  };
  return {
    execute,
    retry: () =>
      current.current ? send(current.current) : Promise.resolve(false),
    pending,
    busy,
    blocked: busy || Boolean(pending),
    error,
    success,
  };
}
