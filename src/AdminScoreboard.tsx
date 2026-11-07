import { useEffect, useRef, useState, type ReactNode } from "react";
import { clockText } from "./match";
import { type LiveMatch, type Operation, signed } from "./liveMatch";
import MatchLog from "./MatchLog";
import CardHistory from "./CardHistory";

type Side = "left" | "right";
type Draft = {
  leftScore: number;
  rightScore: number;
  remainingMs: number;
  targetScore: number | null;
};
const values = (m: LiveMatch): Draft => ({
  leftScore: m.left_score,
  rightScore: m.right_score,
  remainingMs: m.remaining_ms,
  targetScore: m.target_score,
});
export default function AdminScoreboard({
  match,
  operations,
  busy,
  feedback,
  status,
  onApply,
  onReverse,
  onComplete,
  onRecover,
  onExit,
  onAbandon,
  onPenalty,
}: {
  match: LiveMatch;
  operations: Operation[];
  busy: boolean;
  feedback: ReactNode;
  status: string;
  onApply: (d: Record<string, unknown>) => Promise<boolean>;
  onReverse: (id: string) => Promise<boolean>;
  onComplete: () => Promise<boolean>;
  onRecover: () => Promise<void>;
  onExit: () => void;
  onAbandon: () => void;
  onPenalty: (side: Side) => void;
}) {
  const [draft, setDraft] = useState(() => values(match));
  const baseline = useRef(values(match));
  // After acknowledgement, rebase only clean fields. Unapplied edits in other
  // regions retain their explicit proposed totals rather than being committed.
  useEffect(() => {
    const before = baseline.current,
      next = values(match);
    setDraft(
      (d) =>
        Object.fromEntries(
          Object.keys(next).map((k) => {
            const key = k as keyof Draft;
            return [key, d[key] === before[key] ? next[key] : d[key]];
          }),
        ) as Draft,
    );
    baseline.current = next;
  }, [match]);
  const [leaving, setLeaving] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const committed = values(match);
  const dirty = (Object.keys(committed) as (keyof Draft)[]).some(
    (k) => draft[k] !== committed[k],
  );
  async function apply(field?: keyof Draft) {
    const patch = field ? { [field]: draft[field] } : draft;
    const ok = await onApply(patch);
    if (ok) {
      // The server may auto-finalize but does not rewrite the requested values.
      setDraft((d) => ({ ...d, ...patch }));
    }
    return ok;
  }
  function exit() {
    if (busy) return;
    if (dirty) setLeaving(true);
    else onExit();
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        exit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const stepper = (
    label: string,
    value: number,
    change: (n: number) => void,
    step = 1,
    max = 30000,
  ) => (
    <div className="stepper">
      <button
        aria-label={`Decrease ${label}`}
        disabled={busy || value <= 0}
        onClick={() => change(Math.max(0, value - step))}
      >
        −
      </button>
      <span>{label}</span>
      <button
        aria-label={`Increase ${label}`}
        disabled={busy || value >= max}
        onClick={() => change(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  );
  const side = (s: Side) => {
    const field = s === "left" ? "leftScore" : "rightScore",
      name = s === "left" ? match.current_left_name : match.current_right_name;
    const original = committed[field],
      proposed = draft[field];
    return (
      <section className={`live-side ${s}`} aria-label={`${s} fencer`}>
        <h2>{name}</h2>
        <button
          className="subtle"
          disabled={busy || dirty || Boolean(match.finalized_at)}
          onClick={() => onPenalty(s)}
          aria-label={`Penalty on ${name}`}
        >
          Penalty
        </button>
        <div className="live-score">{proposed}</div>
        <p className="preview" aria-live="polite">
          Original {original} → Preview {proposed} (
          {signed(proposed - original)})
        </p>
        {stepper(`${s === "left" ? "Left" : "Right"} score`, proposed, (n) =>
          setDraft((d) => ({ ...d, [field]: n })),
        )}
        <button
          disabled={busy || proposed === original}
          aria-label={`Apply ${s} score`}
          onClick={() => void apply(field)}
        >
          Apply
        </button>
      </section>
    );
  };
  return (
    <section className="admin-scoreboard" aria-label="Admin Mode">
      <header className="admin-mode-heading">
        <h2>Admin Mode</h2>
        <button className="danger" disabled={busy} onClick={onAbandon}>
          Abandon Match
        </button>
      </header>
      <div className="win-condition">
        {match.is_overtime
          ? "Overtime · Sudden Death"
          : match.match_type === "knockout"
            ? "Knockout"
            : "Standard"}{" "}
        |{" "}
        {match.target_score
          ? `First to ${match.target_score} Points`
          : "Time Limit"}
      </div>
      {feedback}
      <div className="admin-columns">
        <section className="match-rail log-rail" aria-label="Match Log">
          <h3>Match Log</h3>
          <MatchLog
            names={{
              left: match.current_left_name,
              right: match.current_right_name,
            }}
            operations={operations}
            busy={busy || dirty}
            onReverse={(id) => void onReverse(id)}
          />
        </section>
        <div className="admin-center">
          <div className="live-arena">
            {side("left")}
            <section className="live-clock" aria-label="Timer Corrections">
              <div className="clock">{clockText(draft.remainingMs)}</div>
              <p className="preview">
                Original {clockText(match.remaining_ms)} → Preview{" "}
                {clockText(draft.remainingMs)} (
                {signed((draft.remainingMs - match.remaining_ms) / 1000)}s)
              </p>
              {stepper(
                "Remaining minutes",
                draft.remainingMs,
                (n) => setDraft((d) => ({ ...d, remainingMs: n })),
                60000,
                match.is_overtime ? match.overtime_ms : 10800000,
              )}
              {stepper(
                "Remaining seconds",
                draft.remainingMs,
                (n) => setDraft((d) => ({ ...d, remainingMs: n })),
                1000,
                match.is_overtime ? match.overtime_ms : 10800000,
              )}
              <button
                disabled={busy || draft.remainingMs === match.remaining_ms}
                onClick={() => void apply("remainingMs")}
              >
                Apply Timer
              </button>
              <p>Timer Paused</p>
            </section>
            {side("right")}
          </div>
          <section className="winner-section">
            <h3>Declare Winner</h3>
            <div className="declare-winner">
              {[
                ["left", "←"],
                ["draw", "Tie"],
                ["incomplete", "Incomplete"],
                ["right", "→"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={`winner-${value}`}
                  disabled={busy || dirty}
                  aria-label={
                    value === "left"
                      ? `Left Victory: ${match.current_left_name}`
                      : value === "right"
                        ? `Right Victory: ${match.current_right_name}`
                        : label
                  }
                  aria-pressed={
                    value === "incomplete"
                      ? !match.finalized_at && match.outcome === "incomplete"
                      : Boolean(match.finalized_at) &&
                        (value === "draw"
                          ? match.outcome === "draw"
                          : match.winner_side === value)
                  }
                  onClick={() => setWinner(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {dirty && (
              <p>
                Apply or discard staged edits before declaring a result, adding
                a penalty, or reverting a call.
              </p>
            )}
          </section>
          <details className="match-settings">
            <summary>Match Settings</summary>
            <p>
              Original Score to Win: {match.target_score ?? "No Target"} →
              Preview: {draft.targetScore ?? "No Target"}
            </p>
            {stepper(
              "Score to Win",
              draft.targetScore ?? 0,
              (n) => setDraft((d) => ({ ...d, targetScore: n || null })),
              1,
              10000,
            )}
            <button
              disabled={busy || draft.targetScore === match.target_score}
              onClick={() => void apply("targetScore")}
            >
              Apply Score to Win
            </button>
          </details>
          <div className="button-row secondary-match-actions">
            {!match.finalized_at && (
              <button
                disabled={busy || dirty}
                onClick={() => {
                  if (
                    confirm(
                      "Complete this match using the current saved scores and official outcome?",
                    )
                  )
                    void onComplete();
                }}
              >
                Match Complete
              </button>
            )}
            <button
              className="subtle"
              disabled={busy || dirty}
              onClick={() => void onRecover()}
            >
              Recover Expired Claim
            </button>
          </div>
        </div>
        <section className="match-rail card-rail" aria-label="Previous Cards">
          <h3>Previous Cards</h3>
          <CardHistory match={match} operations={operations} />
        </section>
      </div>
      <footer className="live-bottom">
        <button className="primary" disabled={busy} onClick={exit}>
          Resume
        </button>
        <small role="status">{status}</small>
      </footer>
      {leaving && (
        <ChoiceDialog
          title="Unapplied Changes"
          onClose={() => {
            if (!busy) setLeaving(false);
          }}
        >
          <p>
            Apply your staged changes, discard them, or stay in Admin Mode. The
            clock remains paused.
          </p>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={async () => {
                if (await apply()) onExit();
              }}
            >
              Apply and Resume
            </button>
            <button disabled={busy} onClick={onExit}>
              Discard and Resume
            </button>
            <button disabled={busy} onClick={() => setLeaving(false)}>
              Stay in Admin Mode
            </button>
          </div>
        </ChoiceDialog>
      )}
      {winner && (
        <ChoiceDialog
          title="Confirm Outcome"
          onClose={() => {
            if (!busy) setWinner(null);
          }}
        >
          <p>
            {winner === "incomplete"
              ? "Save as Incomplete? This removes credited results and bracket advancement."
              : winner === "draw"
                ? "Declare an official Tie?"
                : `Declare ${winner === "left" ? match.current_left_name : match.current_right_name} the winner?`}
          </p>
          <p>
            This is an official result decision; numeric scores remain
            unchanged.{" "}
            {match.finalized_at
              ? "This changes a previously finalized result. "
              : ""}
            The selected outcome may override the score-derived result. Knockout
            ties cannot advance.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await onApply({ outcome: winner })) setWinner(null);
              }}
            >
              Confirm Outcome
            </button>
            <button disabled={busy} onClick={() => setWinner(null)}>
              Cancel
            </button>
          </div>
        </ChoiceDialog>
      )}
    </section>
  );
}
export function ChoiceDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (prev instanceof HTMLElement) prev.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="match-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label={`Close ${title}`} onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
