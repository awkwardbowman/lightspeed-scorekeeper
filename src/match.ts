export type Side = "left" | "right";
export type CallType = "indirect" | "clean" | "counter";
export type Phase = "ready" | "running" | "paused" | "ended";
export type EndReason = "time" | "target" | "manual" | null;

export const POINT_VALUES = [1, 3, 5] as const;
export type PointValue = (typeof POINT_VALUES)[number];
export const SCORE_LABELS: Record<CallType, string> = {
  indirect: "Indirect",
  clean: "Clean hit",
  counter: "Counter",
};

export interface ScoreCall {
  id: string;
  side: Side;
  type: CallType;
  points: PointValue;
  matchTimeMs: number;
  timestamp: string;
}

export interface Match {
  id: string;
  leftFencerId?: string;
  rightFencerId?: string;
  eventId?: string;
  bracketId?: string;
  groupId?: string;
  presetId?: string;
  winnerSide?: Side;
  finalized?: boolean;
  eventName: string;
  roundName: string;
  leftName: string;
  rightName: string;
  durationMs: number;
  remainingMs: number;
  targetScore: number | null;
  phase: Phase;
  endReason: EndReason;
  calls: ScoreCall[];
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function initialMatch(): Match {
  return {
    id: uid(),
    eventName: "",
    roundName: "",
    leftName: "Fencer A",
    rightName: "Fencer B",
    durationMs: 180_000,
    remainingMs: 180_000,
    targetScore: null,
    phase: "ready",
    endReason: null,
    calls: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
  };
}

export function scoreFor(match: Match, side: Side): number {
  return match.calls.reduce(
    (total, call) => total + (call.side === side ? call.points : 0),
    0,
  );
}

export function countFor(
  match: Match,
  side: Side,
  type: CallType,
  points: PointValue,
): number {
  return match.calls.filter(
    (call) =>
      call.side === side && call.type === type && call.points === points,
  ).length;
}

export function targetReached(match: Match): boolean {
  return (
    match.targetScore !== null &&
    (scoreFor(match, "left") >= match.targetScore ||
      scoreFor(match, "right") >= match.targetScore)
  );
}

export function clockText(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function csvFor(match: Match): string {
  const escape = (text: unknown) => {
    const value =
      typeof text === "string" && /^[=+\-@]/.test(text)
        ? `'${text}`
        : String(text ?? "");
    return `"${value.replaceAll('"', '""')}"`;
  };
  const header = [
    "Match ID",
    "Event",
    "Event ID",
    "Left Fencer ID",
    "Right Fencer ID",
    "Round",
    "Date UTC",
    "Fencer",
    "Side",
    "Call type",
    "Points",
    "Elapsed seconds",
    "Recorded UTC",
  ];
  const rows = match.calls.map((call) => [
    match.id,
    match.eventName,
    match.eventId,
    match.leftFencerId,
    match.rightFencerId,
    match.roundName,
    match.createdAt,
    call.side === "left" ? match.leftName : match.rightName,
    call.side,
    SCORE_LABELS[call.type],
    call.points,
    ((match.durationMs - call.matchTimeMs) / 1000).toFixed(1),
    call.timestamp,
  ]);
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

export function downloadCsv(match: Match) {
  const blob = new Blob(["\ufeff", csvFor(match)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lightspeed-${match.id.slice(0, 8)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
