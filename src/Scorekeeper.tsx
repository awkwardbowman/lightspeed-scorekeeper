import { useEffect, useRef, useState } from "react";
import { useAccount } from "./Auth";
import { useRows, Notice } from "./ui";
import { type Fencer, type Preset, type Configuration, message } from "./data";
import { loadTraditionalMatch } from "./db/traditional";
import useMatchSession from "./useMatchSession";
import {
  clockText,
  countFor,
  downloadCsv,
  initialMatch,
  POINT_VALUES,
  SCORE_LABELS,
  scoreFor,
  targetReached,
  uid,
  type CallType,
  type Match,
  type PointValue,
  type Side,
} from "./match";

const STORAGE_KEY = "lightspeed-scorekeeper:v1";
const TYPES: CallType[] = ["indirect", "clean", "counter"];
function recover(userId: string): Match {
  try {
    const value = localStorage.getItem(`${STORAGE_KEY}:${userId}`);
    if (value) {
      const stored = JSON.parse(value) as Match;
      if (
        stored.id &&
        Array.isArray(stored.calls) &&
        typeof stored.remainingMs === "number"
      ) {
        // A match must never silently continue its timer after a page refresh.
        return stored.phase === "running"
          ? { ...stored, phase: "paused" }
          : stored;
      }
    }
  } catch {
    /* gracefully recover corrupted browser storage */
  }
  return initialMatch();
}

export default function Scorekeeper() {
  const { profile } = useAccount();
  const [match, setMatch] = useState<Match>(() => recover(profile.id));
  const fencers = useRows<Fencer>("tFencer");
  const presets = useRows<Preset>("tMatchPreset");
  const configuration = useRows<Configuration>("tConfiguration");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const restoredPreset = useRef<string>("");
  const session = useMatchSession(match);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [page, setPage] = useState<"match" | "report">("match");
  const [confirmReset, setConfirmReset] = useState(false);
  const deadline = useRef<number | null>(null);
  const lastLocalWrite = useRef(0);
  const lastSaved = useRef(match);
  lastSaved.current = match;

  useEffect(() => {
    if (match.phase === "running" && Date.now() - lastLocalWrite.current < 1000)
      return;
    lastLocalWrite.current = Date.now();
    try {
      localStorage.setItem(
        `${STORAGE_KEY}:${profile.id}`,
        JSON.stringify(match),
      );
      localStorage.setItem(
        `${STORAGE_KEY}:${profile.id}:${match.id}`,
        JSON.stringify(match),
      );
    } catch {
      setError(
        "Device recovery storage is full. Keep this page open until the match is saved.",
      );
    }
  }, [match, profile.id]);
  useEffect(() => {
    if (restoredPreset.current === match.id || !presets.data.length) return;
    restoredPreset.current = match.id;
    const p = presets.data.find(
      (p) =>
        p.id === localStorage.getItem(`lastPreset:${profile.id}`) &&
        !p.is_archived &&
        p.mode === "traditional",
    );
    if (p && !match.startedAt && !match.eventId && !match.presetId)
      setMatch((m) => ({
        ...m,
        presetId: p.id,
        durationMs: p.duration_ms,
        remainingMs: p.duration_ms,
        targetScore: p.target_score,
      }));
  }, [presets.data, match.id]);
  useEffect(() => {
    const id = sessionStorage.getItem("openMatch");
    if (id) {
      sessionStorage.removeItem("openMatch");
      setWorking(true);
      void loadTraditionalMatch(id)
        .then((m) => {
          session.forget();
          setMatch(m);
          setPage("match");
        })
        .catch((e) => setError(message(e)))
        .finally(() => setWorking(false));
    }
  }, []);
  useEffect(() => {
    if (match.phase === "ready")
      setBindings(configuration.data[0]?.key_mappings ?? {});
  }, [configuration.data, match.id, match.phase]);
  useEffect(() => {
    const unreg = fencers.data.find((f) => f.is_unregistered);
    if (unreg && !match.startedAt && !match.eventId)
      setMatch((m) => ({
        ...m,
        leftFencerId: m.leftFencerId ?? unreg.id,
        rightFencerId: m.rightFencerId ?? unreg.id,
      }));
  }, [fencers.data]);

  useEffect(() => {
    if (match.phase !== "running") {
      deadline.current = null;
      return;
    }
    // A monotonic clock prevents interval drift and catches time lost in background tabs.
    deadline.current = performance.now() + match.remainingMs;
    const id = window.setInterval(() => {
      const left = Math.max(
        0,
        (deadline.current ?? performance.now()) - performance.now(),
      );
      setMatch((current) => {
        if (current.phase !== "running") return current;
        return left <= 0
          ? {
              ...current,
              remainingMs: 0,
              phase: "ended",
              endReason: "time",
              endedAt: new Date().toISOString(),
            }
          : { ...current, remainingMs: left };
      });
    }, 70);
    return () => window.clearInterval(id);
    // Only restart a countdown on a phase transition, not on each display tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.phase]);

  async function start() {
    if (
      match.phase === "ended" ||
      targetReached(match) ||
      match.remainingMs <= 0
    )
      return;
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await session.persist();
    } catch (e) {
      setError(message(e));
      setWorking(false);
      return;
    }
    setWorking(false);
    setMatch((m) => ({
      ...m,
      finalized: false,
      phase: "running",
      startedAt: m.startedAt ?? new Date().toISOString(),
    }));
  }
  function pause() {
    if (match.phase !== "running") return;
    const left = Math.max(
      0,
      (deadline.current ?? performance.now()) - performance.now(),
    );
    setMatch((m) =>
      left === 0
        ? {
            ...m,
            remainingMs: 0,
            phase: "ended",
            endReason: "time",
            endedAt: new Date().toISOString(),
          }
        : { ...m, remainingMs: left, phase: "paused" },
    );
  }
  useEffect(() => {
    if (session.failed && match.phase === "running") pause();
  }, [session.failed]);
  function addCall(side: Side, type: CallType, points: PointValue) {
    setMatch((m) => {
      if (m.phase !== "paused" && m.phase !== "ended") return m;
      const next: Match = {
        ...m,
        finalized: false,
        winnerSide: undefined,
        calls: [
          ...m.calls,
          {
            id: uid(),
            side,
            type,
            points,
            matchTimeMs: m.remainingMs,
            timestamp: new Date().toISOString(),
          },
        ],
      };
      return targetReached(next)
        ? {
            ...next,
            phase: "ended",
            endReason: "target",
            endedAt: new Date().toISOString(),
          }
        : next;
    });
  }
  function removeCall(id: string) {
    setMatch((m) => {
      if (m.phase === "running") return m;
      const next = {
        ...m,
        finalized: false,
        winnerSide: undefined,
        calls: m.calls.filter((call) => call.id !== id),
      };
      if (m.endReason === "target" && !targetReached(next)) {
        return next.remainingMs <= 0
          ? { ...next, phase: "ended", endReason: "time" }
          : { ...next, phase: "paused", endReason: null, endedAt: null };
      }
      return next;
    });
  }
  function reset() {
    if (match.startedAt && session.status !== "Saved") {
      setError("Save the current match before starting a new one.");
      return;
    }
    void session.release().catch((e) => setError(message(e)));
    setMatch(initialMatch());
    setPage("match");
    setConfirmReset(false);
  }
  function updateSetup(
    key: "eventName" | "roundName" | "leftName" | "rightName",
    value: string,
  ) {
    setMatch((m) => (m.phase === "ready" ? { ...m, [key]: value } : m));
  }
  async function openReport() {
    if (match.phase !== "ended") {
      setPage("report");
      return;
    }
    setWorking(true);
    try {
      await session.persist(true);
      setMatch((m) => ({ ...m, finalized: true }));
      await session.release();
      setPage("report");
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking(false);
    }
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        document.querySelector('[role="dialog"]') ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest(
            "input,textarea,select,[contenteditable=true],[role=dialog]",
          ))
      )
        return;
      const action = Object.keys(bindings).find(
        (k) => bindings[k] === e.key.toLowerCase(),
      );
      if (!action) return;
      e.preventDefault();
      if (action === "toggle") {
        if (match.phase === "running") pause();
        else void start();
      } else if (action === "undo") {
        const call = match.calls.at(-1);
        if (call) removeCall(call.id);
      } else {
        const [side, type, points] = action.split(".");
        addCall(side as Side, type as CallType, Number(points) as PointValue);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const leftScore = scoreFor(match, "left");
  const rightScore = scoreFor(match, "right");
  const finished = match.phase === "ended";
  const editable = match.phase === "ready";
  const winner =
    leftScore === rightScore
      ? match.winnerSide
        ? match.winnerSide === "left"
          ? match.leftName
          : match.rightName
        : match.endReason === "time"
          ? "Tie"
          : "No result"
      : leftScore > rightScore
        ? match.leftName
        : match.rightName;

  return (
    <section className="single-match-ui">
      <label className="search">
        Recover another session on this device
        <select
          value=""
          onChange={(e) => {
            const value = localStorage.getItem(e.target.value);
            if (
              value &&
              window.confirm(
                "Recover this device session? Save your current bout first.",
              )
            ) {
              const restored = JSON.parse(value) as Match;
              session.forget();
              setMatch({
                ...restored,
                phase: restored.phase === "running" ? "paused" : restored.phase,
              });
              setPage("match");
            }
          }}
        >
          <option value="">Choose a device recovery snapshot</option>
          {Object.keys(localStorage)
            .filter(
              (k) =>
                k.startsWith(`${STORAGE_KEY}:${profile.id}:`) &&
                !k.endsWith(match.id),
            )
            .map((k) => {
              try {
                const m = JSON.parse(localStorage.getItem(k)!) as Match;
                return (
                  <option key={k} value={k}>
                    {m.leftName} / {m.rightName} · {m.id.slice(0, 8)}
                  </option>
                );
              } catch {
                return null;
              }
            })}
        </select>
      </label>
      <Notice
        error={error || fencers.error || presets.error || configuration.error}
      />
      <header className="app-header">
        <div>
          <span className="eyebrow">
            TRADITIONAL · {match.eventId ? "EVENT" : "STANDALONE"}
          </span>
          <h2>
            Single Match<span className="accent">.</span>
          </h2>
        </div>
        <div className="header-actions">
          <span className="local-tag">{session.status}</span>
          <button className="subtle" onClick={() => setConfirmReset(true)}>
            New match
          </button>
        </div>
      </header>

      {confirmReset && (
        <div className="backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm new match"
          >
            <h2>Start a new match?</h2>
            <p>
              The current match will be replaced on this device. Save it to the
              cloud or export its report first if you need to keep it.
            </p>
            <div className="modal-actions">
              <button className="subtle" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button className="danger" onClick={reset}>
                Replace match
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="tabs" aria-label="Screen navigation">
        <button
          className={page === "match" ? "selected" : ""}
          onClick={() => setPage("match")}
        >
          Match control
        </button>
        <button
          className={page === "report" ? "selected" : ""}
          onClick={() => void openReport()}
        >
          Match report
        </button>
      </nav>

      <section className="card">
        <div className="button-row">
          <span role="status">{session.status}</span>
          <button
            className="subtle"
            disabled={working}
            onClick={() =>
              void session.persist().catch((e) => setError(message(e)))
            }
          >
            Save / retry
          </button>
          {session.failed && (
            <button
              className="subtle"
              onClick={() => {
                if (
                  window.confirm(
                    "Recover an expired referee claim? Unsaved changes from the other session may be lost.",
                  )
                ) {
                  session.forget();
                  void session
                    .persist(false, true)
                    .catch((e) => setError(message(e)));
                }
              }}
            >
              Recover expired claim
            </button>
          )}
        </div>
      </section>

      {page === "match" ? (
        <>
          <section className="setup card">
            <label>
              Match preset
              <select
                disabled={!editable}
                value={match.presetId ?? ""}
                onChange={(e) => {
                  const p = presets.data.find((p) => p.id === e.target.value);
                  if (!p) {
                    setMatch((m) => ({ ...m, presetId: undefined }));
                    return;
                  }
                  if (p) {
                    localStorage.setItem(`lastPreset:${profile.id}`, p.id);
                    setMatch((m) => ({
                      ...m,
                      presetId: p.id,
                      durationMs: p.duration_ms,
                      remainingMs: p.duration_ms,
                      targetScore: p.target_score,
                    }));
                  }
                }}
              >
                <option value="">Custom settings</option>
                {presets.data
                  .filter((p) => !p.is_archived && p.mode === "traditional")
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="section-heading">
              <h2>Match setup</h2>
              <span>
                {editable
                  ? "Editable until timer starts"
                  : "Locked once started"}
              </span>
            </div>
            <div className="fields">
              <label>
                Event
                <input
                  disabled
                  placeholder="Standalone"
                  value={match.eventName}
                  onChange={(e) => updateSetup("eventName", e.target.value)}
                />
              </label>
              <label>
                Round / bout
                <input
                  disabled={!editable}
                  placeholder="Round (optional)"
                  value={match.roundName}
                  onChange={(e) => updateSetup("roundName", e.target.value)}
                />
              </label>
              <label>
                Match length (minutes)
                <input
                  disabled={!editable}
                  type="number"
                  min="1"
                  max="180"
                  value={match.durationMs / 60000}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 1 && n <= 180)
                      setMatch((m) => ({
                        ...m,
                        durationMs: n * 60000,
                        remainingMs: n * 60000,
                      }));
                  }}
                />
              </label>
              <label>
                Target score (optional)
                <input
                  disabled={!editable}
                  type="number"
                  min="1"
                  max="10000"
                  placeholder="No target"
                  value={match.targetScore ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setMatch((m) => ({
                      ...m,
                      targetScore:
                        e.target.value === ""
                          ? null
                          : n >= 1 && n <= 10000
                            ? Math.floor(n)
                            : m.targetScore,
                    }));
                  }}
                />
              </label>
            </div>
          </section>
          <section className={`arena card ${finished ? "is-finished" : ""}`}>
            <div className="timer-area">
              <div className="status-line">
                <span className={`status-dot ${match.phase}`} />{" "}
                {match.phase === "ready"
                  ? "READY TO START"
                  : match.phase === "running"
                    ? "MATCH IN PROGRESS"
                    : match.phase === "paused"
                      ? "MATCH PAUSED · RECORD THE CALL"
                      : `MATCH COMPLETE · ${match.endReason === "target" ? "TARGET REACHED" : match.endReason === "time" ? "TIME EXPIRED" : "ENDED"}`}
              </div>
              <div className="clock" aria-live="off">
                {clockText(match.remainingMs)}
              </div>
              <div className="time-hint">
                {match.targetScore
                  ? `First to ${match.targetScore} points or time expires`
                  : "Match ends when time expires"}
              </div>
            </div>
            {finished && (
              <div className="finished-banner">
                <strong>MATCH COMPLETE</strong>
                <span>
                  {winner === "Tie"
                    ? "Match tied"
                    : winner === "No result"
                      ? "No result"
                      : `${winner} leads`}
                </span>
                <button onClick={() => void openReport()}>
                  View match report →
                </button>
              </div>
            )}
            <div className="fencers">
              {(["left", "right"] as Side[]).map((side) => (
                <div className={`fencer ${side}`} key={side}>
                  <label className="fencer-name-label">
                    {side === "left" ? "FENCER A" : "FENCER B"}
                    <select
                      aria-label={`${side} registered fencer`}
                      disabled={!editable || Boolean(match.eventId)}
                      value={
                        (side === "left"
                          ? match.leftFencerId
                          : match.rightFencerId) ?? ""
                      }
                      onChange={(e) => {
                        const f = fencers.data.find(
                          (f) => f.id === e.target.value,
                        );
                        if (f)
                          setMatch((m) => ({
                            ...m,
                            [side === "left"
                              ? "leftFencerId"
                              : "rightFencerId"]: f.id,
                            [side === "left" ? "leftName" : "rightName"]:
                              f.is_unregistered
                                ? side === "left"
                                  ? "Fencer A"
                                  : "Fencer B"
                                : f.display_name,
                          }));
                      }}
                    >
                      <option value="">Choose competitor</option>
                      {fencers.data
                        .filter(
                          (f) =>
                            !f.is_archived &&
                            (!match.eventId || !f.is_unregistered),
                        )
                        .map((f) => (
                          <option value={f.id} key={f.id}>
                            {f.is_unregistered
                              ? "Unregistered (type name below)"
                              : `${f.display_name} · ${f.id.slice(0, 8)}`}
                          </option>
                        ))}
                    </select>
                    <input
                      aria-label={`${side} fencer name`}
                      disabled={
                        !editable ||
                        !fencers.data.find(
                          (f) =>
                            f.id ===
                            (side === "left"
                              ? match.leftFencerId
                              : match.rightFencerId),
                        )?.is_unregistered
                      }
                      value={side === "left" ? match.leftName : match.rightName}
                      onChange={(e) =>
                        updateSetup(
                          side === "left" ? "leftName" : "rightName",
                          e.target.value,
                        )
                      }
                    />
                  </label>
                  <div className="score">
                    {side === "left" ? leftScore : rightScore}
                  </div>
                  <div className="points-label">POINTS</div>
                  <div className="score-grid">
                    <div className="score-grid-head">
                      <span>Call type</span>
                      {POINT_VALUES.map((points) => (
                        <span key={points}>+{points}</span>
                      ))}
                    </div>
                    {TYPES.map((type) => (
                      <div className="score-grid-row" key={type}>
                        <span>{SCORE_LABELS[type]}</span>
                        {POINT_VALUES.map((points) => (
                          <button
                            key={points}
                            aria-label={`${SCORE_LABELS[type]} ${points} points for ${side === "left" ? match.leftName : match.rightName}`}
                            onClick={() => addCall(side, type, points)}
                            disabled={
                              working ||
                              (match.phase !== "paused" &&
                                match.phase !== "ended")
                            }
                          >
                            +{points}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {finished &&
              match.bracketId &&
              !match.groupId &&
              leftScore === rightScore && (
                <label className="search">
                  Referee tiebreak winner
                  <select
                    value={match.winnerSide ?? ""}
                    onChange={(e) =>
                      setMatch((m) => ({
                        ...m,
                        winnerSide: e.target.value as Side,
                        finalized: false,
                      }))
                    }
                  >
                    <option value="">Resolve tiebreak</option>
                    <option value="left">{match.leftName}</option>
                    <option value="right">{match.rightName}</option>
                  </select>
                </label>
              )}
            <div className="controls">
              {match.phase === "running" ? (
                <button className="primary large" onClick={pause}>
                  Ⅱ Pause for call
                </button>
              ) : (
                <button
                  className="primary large"
                  onClick={() => void start()}
                  disabled={finished || working}
                >
                  ▶ {match.phase === "ready" ? "Start match" : "Resume match"}
                </button>
              )}
              {match.phase === "paused" && (
                <button
                  className="subtle large"
                  onClick={() =>
                    setMatch((m) => ({
                      ...m,
                      phase: "ended",
                      endReason: "manual",
                      endedAt: new Date().toISOString(),
                    }))
                  }
                >
                  End match
                </button>
              )}
            </div>
            <p className="rules-note">
              To record a score, pause the clock first. Choose the scoring
              category and its 1-, 3-, or 5-point value. Resume after recording
              the call.
            </p>
          </section>
          <section className="card history">
            <div className="section-heading">
              <h2>Call history</h2>
              <span>{match.calls.length} recorded</span>
            </div>
            {match.calls.length === 0 ? (
              <p className="muted">
                No calls yet. Start the match, pause, and enter the referee's
                decision.
              </p>
            ) : (
              <div className="history-items">
                {[...match.calls].reverse().map((call) => (
                  <div className="history-row" key={call.id}>
                    <span className="call-time">
                      {clockText(call.matchTimeMs)}
                    </span>
                    <span>
                      <strong>
                        {call.side === "left"
                          ? match.leftName
                          : match.rightName}
                      </strong>
                      <small>{SCORE_LABELS[call.type]}</small>
                    </span>
                    <b>+{call.points}</b>
                    <button
                      className="icon-btn"
                      title="Remove incorrect call"
                      aria-label={`Remove ${SCORE_LABELS[call.type]} for ${call.side === "left" ? match.leftName : match.rightName}`}
                      disabled={match.phase === "running"}
                      onClick={() => removeCall(call.id)}
                    >
                      Undo
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="card report">
          <div className="section-heading">
            <h2>Match report</h2>
            <span>{finished ? "Final" : "In progress · provisional"}</span>
          </div>
          <p className="muted">
            {match.eventName || "Untitled event"}
            {match.roundName ? ` · ${match.roundName}` : ""} ·{" "}
            {new Date(match.createdAt).toLocaleString()}
          </p>
          <div className="report-score">
            <div>
              <strong>{match.leftName}</strong>
              <span>{leftScore}</span>
            </div>
            <b>—</b>
            <div>
              <strong>{match.rightName}</strong>
              <span>{rightScore}</span>
            </div>
          </div>
          <p className="report-outcome">
            {finished
              ? match.endReason === "manual"
                ? "Incomplete / no result (manually ended)"
                : winner === "Tie"
                  ? "Final result: Tie"
                  : `Final result: ${winner} leads`
              : `Current status: ${match.phase}`}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scoring category</th>
                  <th>{match.leftName}</th>
                  <th>{match.rightName}</th>
                </tr>
              </thead>
              <tbody>
                {TYPES.flatMap((type) =>
                  POINT_VALUES.map((points) => (
                    <tr key={`${type}-${points}`}>
                      <td>
                        {SCORE_LABELS[type]} (+{points})
                      </td>
                      <td>{countFor(match, "left", type, points)}</td>
                      <td>{countFor(match, "right", type, points)}</td>
                    </tr>
                  )),
                )}
                <tr className="total">
                  <td>Total points</td>
                  <td>{leftScore}</td>
                  <td>{rightScore}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="report-actions">
            <button className="primary" onClick={() => downloadCsv(match)}>
              Export scoring CSV
            </button>
            <button className="subtle" onClick={() => window.print()}>
              Print report
            </button>
            <button className="subtle" onClick={() => setPage("match")}>
              Back to match
            </button>
          </div>
          <p className="muted footnote">
            CSV includes each individual scoring call, its point value, match
            clock, and recording timestamp. Changes are autosaved with a referee
            claim and immutable correction history.
          </p>
        </section>
      )}
    </section>
  );
}
