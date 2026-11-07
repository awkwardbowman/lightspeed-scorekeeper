import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "./Auth";
import {
  db,
  message,
  type Fencer,
  type Preset,
  type Configuration,
} from "./data";
import { claim } from "./db/traditional";
import { useRows, Notice, downloadJson } from "./ui";
import { clockText, uid } from "./match";
import {
  command,
  loadLive,
  loadOperations,
  type LiveMatch,
  type Operation,
  operationLabel,
} from "./liveMatch";
import MatchLog from "./MatchLog";

type Side = "left" | "right";
type Pending = {
  id: string;
  action: string;
  data: Record<string, unknown>;
  revision: number;
};
const key = (user: string) => `lightspeed-live:v2:${user}`;
function stored(user: string): {
  match: LiveMatch | null;
  pending: Pending | null;
} {
  try {
    return (
      JSON.parse(localStorage.getItem(key(user)) ?? "null") ?? {
        match: null,
        pending: null,
      }
    );
  } catch {
    return { match: null, pending: null };
  }
}
export default function Scorekeeper({ active = true }: { active?: boolean }) {
  const { profile } = useAccount();
  const recovery = useRef(stored(profile.id));
  const [match, setMatch] = useState<LiveMatch | null>(recovery.current.match);
  const clockOffset = useRef(0);
  const current = useRef(match);
  current.current = match;
  const [operations, setOperations] = useState<Operation[]>([]);
  const [pending, setPending] = useState<Pending | null>(
    recovery.current.pending,
  );
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const token = useRef(uid());
  const revision = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"prep" | "live" | "report">(
    match ? "live" : "prep",
  );
  const [manage, setManage] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [card, setCard] = useState(false);
  const fencers = useRows<Fencer>("tFencer");
  const presets = useRows<Preset>("tMatchPreset");
  const config = useRows<Configuration>("tConfiguration");
  const [remaining, setRemaining] = useState(match?.remaining_ms ?? 180000);
  useEffect(() => {
    try {
      localStorage.setItem(key(profile.id), JSON.stringify({ match, pending }));
    } catch {
      setError(
        "Device recovery storage is full. Keep this screen open until saved.",
      );
    }
  }, [profile.id, match, pending]);
  async function read(id: string) {
    const [m, ops] = await Promise.all([loadLive(id), loadOperations(id)]);
    clockOffset.current = new Date(m.server_now).getTime() - Date.now();
    setMatch(m);
    current.current = m;
    setOperations(ops);
    revision.current = m.revision;
    setRemaining(m.remaining_ms);
    return m;
  }
  async function open(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const m = await read(id);
      revision.current = null;
      setView(m.phase === "ready" ? "prep" : "live");
      setManage(false);
      setAdmin(false);
      setStatus("Loaded. Tap timer to claim and start.");
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const id = sessionStorage.getItem("openMatch");
    if (id) {
      sessionStorage.removeItem("openMatch");
      void open(id);
    } else if (match) void open(match.id);
  }, []);
  async function send(
    action: string,
    data: Record<string, unknown> = {},
    retry = false,
  ): Promise<boolean> {
    const m = current.current;
    if (!m || lock.current) return false;
    if (pendingRef.current && !retry) {
      setError("Resolve the pending save before making another change.");
      return false;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (revision.current === null) {
        const c = await claim(m.id, token.current);
        revision.current = c.revision;
      }
      const p = retry
        ? pendingRef.current!
        : { id: uid(), action, data, revision: revision.current! };
      // Persist request identity before sending, so a lost response cannot duplicate a penalty.
      setPending(p);
      pendingRef.current = p;
      localStorage.setItem(
        key(profile.id),
        JSON.stringify({ match: m, pending: p }),
      );
      const result = await command(
        m.id,
        token.current,
        p.revision,
        p.id,
        p.action,
        p.data,
      );
      revision.current = result.revision;
      await read(m.id);
      setPending(null);
      pendingRef.current = null;
      setStatus("Saved");
      return true;
    } catch (e) {
      setError(message(e));
      setStatus("Save failed — retry or reload");
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        /^[A-Z0-9]{5}$/.test(String(e.code))
      ) {
        setPending(null);
        pendingRef.current = null;
      }
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // Server stores the deadline. Reconnect displays elapsed time without restarting a paused clock.
  useEffect(() => {
    if (!match) return;
    let expiring = false;
    const tick = () => {
      const left =
        match.phase === "running" && match.clock_deadline
          ? Math.max(
              0,
              new Date(match.clock_deadline).getTime() -
                (Date.now() + clockOffset.current),
            )
          : match.remaining_ms;
      setRemaining(left);
      if (
        left === 0 &&
        match.phase === "running" &&
        !expiring &&
        !lock.current &&
        !pendingRef.current
      ) {
        expiring = true;
        void send("expire").then((ok) => {
          if (!ok) expiring = false;
        });
      }
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [match]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        current.current?.phase === "running" &&
        !lock.current &&
        !pendingRef.current
      )
        void send("checkpoint");
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (pending && current.current?.phase === "running")
      setRemaining(current.current.remaining_ms);
  }, [pending]);
  async function showManage() {
    if (lock.current || pendingRef.current) {
      setError("Resolve the pending save before opening Match Management.");
      return;
    }
    if (match?.phase === "running" && !(await send("pause"))) return;
    setManage(true);
  }
  // Leaving the scoreboard is NOT a void, a finalization, or a score change.
  // The confirmed, paused match remains available from Match History.
  async function abandonMatch() {
    if (lock.current || pendingRef.current) {
      setError("Resolve the pending save before leaving this match.");
      return;
    }
    if (!window.confirm(
      "Abandon this screen and return to the Dashboard? Any unapplied Admin Mode edits will be discarded. Saved calls and match history remain intact; this does not void or finalize the match.",
    )) return;
    if (current.current?.phase === "running" && !(await send("pause"))) return;
    const id = current.current?.id;
    if (id) {
      try {
        await db().rpc("release_match", { p_id: id, p_token: token.current });
      } catch {
        // A paused match stays persisted; a lost release response expires safely.
      }
    }
    setCard(false);
    setAdmin(false);
    setManage(false);
    setMatch(null);
    current.current = null;
    setOperations([]);
    setPending(null);
    pendingRef.current = null;
    revision.current = null;
    setView("prep");
    setStatus("");
    setError("");
    localStorage.removeItem(key(profile.id));
    window.location.hash = "/";
  }
  async function newMatch() {
    if (match) {
      if (match.phase === "running" || pending) {
        setError("Pause and save the current match first.");
        return;
      }
      if (!confirm("Start another match? The saved match remains in History."))
        return;
      try {
        await db().rpc("release_match", {
          p_id: match.id,
          p_token: token.current,
        });
      } catch {
        /* lease expires safely */
      }
    }
    setMatch(null);
    current.current = null;
    setOperations([]);
    setView("prep");
    setManage(false);
    revision.current = null;
    setError("");
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const m = current.current;
      if (
        !m ||
        view !== "live" ||
        manage ||
        lock.current ||
        pendingRef.current ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,select,textarea,button,[role=dialog]"))
      )
        return;
      const action = Object.keys(m.key_snapshot ?? {}).find(
        (k) => m.key_snapshot[k] === e.key.toLowerCase(),
      );
      if (!action) return;
      e.preventDefault();
      if (action === "toggle")
        void send(m.phase === "running" ? "pause" : "start");
      else if (action === "undo") {
        const reversed = new Set(
          operations
            .filter((o) => o.kind === "reverse")
            .map((o) => o.data.operationId),
        );
        const op = operations
          .filter(
            (o) =>
              ["score", "penalty", "admin"].includes(o.kind) &&
              (o.kind !== "admin" ||
                o.left_delta !== 0 ||
                o.right_delta !== 0) &&
              !reversed.has(o.id),
          )
          .at(-1);
        if (
          op &&
          m.phase !== "running" &&
          confirm("Revert the last scoring operation?")
        )
          void send("reverse", { operationId: op.id });
      } else if (m.phase === "paused" && !m.finalized_at) {
        const [side, type, points] = action.split(".");
        if (
          (type === "indirect" && points === "1") ||
          (type === "clean" && points === "3") ||
          (type === "counter" && points === "5")
        )
          void send("score", { side, type, points: Number(points) });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, manage, operations]);
  const live = view === "live" && Boolean(match);
  useEffect(() => {
    document.body.classList.toggle("live-match-active", live && active);
    return () => document.body.classList.remove("live-match-active");
  }, [live, active]);
  const unavailable = busy || Boolean(pending);
  async function prep(values: Record<string, unknown>) {
    if (lock.current) return;
    setBusy(true);
    lock.current = true;
    setError("");
    try {
      let id = match?.id;
      if (!id) {
        id = uid();
        const { error } = await db().from("tTraditionalMatch").insert({
          id,
          owner_id: profile.id,
          left_fencer_id: values.leftFencerId,
          right_fencer_id: values.rightFencerId,
          left_name: values.leftName,
          right_name: values.rightName,
        });
        if (error) throw error;
        await read(id);
        revision.current = null;
      }
    } catch (e) {
      setError(message(e));
      return;
    } finally {
      lock.current = false;
      setBusy(false);
    }
    if (await send("prepare", values)) {
      setView("live");
      if (values.presetId)
        localStorage.setItem(
          `lastPreset:${profile.id}`,
          String(values.presetId),
        );
    }
  }
  const recoveryControls = (
    <>
      <Notice error={error} />
      {pending && (
        <section className="save-warning" role="alert">
          <p>A save needs attention. Further edits are paused.</p>
          <button
            disabled={busy}
            onClick={async () => {
              const action = pending.action;
              if (await send(action, pending.data, true)) {
                if (action === "penalty") {
                  setCard(false);
                  setAdmin(false);
                }
                if (action === "admin") setAdmin(false);
                if (action === "prepare") setView("live");
              }
            }}
          >
            Retry pending save
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "Discard the local pending request and reload authoritative data? A request may already have committed; the report will show it.",
                )
              ) {
                setPending(null);
                pendingRef.current = null;
                if (match) void open(match.id);
              }
            }}
          >
            Reload saved state
          </button>
        </section>
      )}
    </>
  );
  return (
    <div
      className={`single-match-ui ${live ? "live-scoreboard" : ""} ${match?.is_overtime ? "overtime" : ""}`}
    >
      <Notice error={error || fencers.error || presets.error || config.error} />
      {!manage && recoveryControls}
      {view === "prep" ? (
        <>
          <h2>Match Prep</h2>
          <Prep
            key={match?.id ?? "new"}
            match={match}
            fencers={fencers.data}
            presets={presets.data}
            userId={profile.id}
            busy={unavailable}
            onConfirm={prep}
          />
          <a href="#/">Cancel / Dashboard</a>
          {match && match.phase !== "ready" && (
            <button onClick={() => setView("live")}>Return to match</button>
          )}
          <label>
            Recover saved match on this device
            <input
              placeholder="Match ID"
              defaultValue={recovery.current.match?.id ?? ""}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value)
                  void open(e.currentTarget.value);
              }}
            />
          </label>
        </>
      ) : (
        match && (
          <>
            {live ? (
              <>
                <div className="win-condition">
                  {match.is_overtime
                    ? "OVERTIME · Sudden death"
                    : match.match_type === "knockout"
                      ? "Knockout"
                      : "Standard"}{" "}
                  |{" "}
                  {match.is_overtime
                    ? "First score wins"
                    : match.target_score
                      ? `First to ${match.target_score} Points`
                      : "Time limit"}
                </div>
                <div className="live-arena">
                  <SideScore
                    side="left"
                    name={match.current_left_name}
                    score={match.left_score}
                    disabled={
                      unavailable ||
                      match.phase !== "paused" ||
                      Boolean(match.finalized_at)
                    }
                    onScore={(type, points) =>
                      void send("score", { side: "left", type, points })
                    }
                  />
                  <div className="live-clock">
                    <button
                      className={`clock clock-button ${match.phase}`}
                      disabled={
                        unavailable ||
                        Boolean(match.finalized_at) ||
                        match.phase === "ended"
                      }
                      aria-label={`${clockText(remaining)} — ${match.phase === "running" ? "Pause" : "Start"} clock`}
                      onClick={() =>
                        void send(match.phase === "running" ? "pause" : "start")
                      }
                    >
                      {clockText(remaining)}
                    </button>
                    <p role="status">
                      {match.finalized_at
                        ? "Match complete"
                        : match.phase === "ended"
                          ? "Winner unresolved"
                          : match.phase === "running"
                            ? "Running · tap to pause"
                            : "Paused · tap to start"}
                    </p>
                    {match.finalized_at && (
                      <strong>
                        {match.outcome === "draw"
                          ? "Draw"
                          : `${match.winner_side === "left" ? match.current_left_name : match.current_right_name} wins`}
                      </strong>
                    )}
                  </div>
                  <SideScore
                    side="right"
                    name={match.current_right_name}
                    score={match.right_score}
                    disabled={
                      unavailable ||
                      match.phase !== "paused" ||
                      Boolean(match.finalized_at)
                    }
                    onScore={(type, points) =>
                      void send("score", { side: "right", type, points })
                    }
                  />
                </div>
                <div className="live-bottom">
                  <small role="status">{busy ? "Saving…" : status}</small>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void showManage()}
                  >
                    Manage
                  </button>
                </div>
              </>
            ) : (
              <section className="card">
                <h2>Match Report</h2>
                <h3>
                  {match.current_left_name} {match.left_score} –{" "}
                  {match.right_score} {match.current_right_name}
                </h3>
                <p>
                  {match.match_type} · {match.outcome} ·{" "}
                  {match.finalized_at ? "Finalized" : "Not finalized"}
                </p>
                <div className="button-row">
                  <button onClick={() => setView("live")}>
                    Back to scoreboard
                  </button>
                  <button
                    onClick={() =>
                      downloadJson(`match-${match.id}.json`, {
                        match,
                        operations,
                      })
                    }
                  >
                    Export report
                  </button>
                  <button onClick={() => exportCsv(match, operations)}>
                    Export CSV
                  </button>
                  <button onClick={() => void newMatch()}>New match</button>
                  <a href="#/history/matches">Match History</a>
                </div>
                <MatchLog operations={operations} />
                <h3>Settings and provenance</h3>
                <pre>{JSON.stringify(match, null, 2)}</pre>
              </section>
            )}
            {manage && (
              <Dialog
                title="Manage match"
                onClose={() => {
                  if (card) {
                    setCard(false);
                    return;
                  }
                  if (unavailable) {
                    setError("Resolve the pending save before closing Match Management.");
                    return;
                  }
                  if (
                    admin &&
                    !window.confirm(
                      "Leave Admin Mode and discard any unapplied score, timer, target, or result changes?",
                    )
                  )
                    return;
                  setAdmin(false);
                  setManage(false);
                }}
              >
                {!card && recoveryControls}
                <p>
                  {match.current_left_name} {match.left_score} –{" "}
                  {match.right_score} {match.current_right_name} ·{" "}
                  {clockText(match.remaining_ms)}
                </p>
                {!admin ? (
                  <>
                    <div className="button-row">
                      <button
                        disabled={unavailable || match.phase === "running"}
                        onClick={() => setAdmin(true)}
                      >
                        Admin Mode
                      </button>
                      <button
                        disabled={unavailable}
                        onClick={() => {
                          if (
                            confirm(
                              "Complete this match using its current effective scores and selected outcome?",
                            )
                          )
                            void send("complete");
                        }}
                      >
                        Match Complete
                      </button>
                      <button
                        disabled={unavailable}
                        onClick={() => {
                          setManage(false);
                          setView("report");
                        }}
                      >
                        Match Report
                      </button>
                      <button
                        disabled={unavailable}
                        onClick={() => void newMatch()}
                      >
                        New match
                      </button>
                      <a href="#/">Dashboard</a>
                    </div>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Recover an expired referee claim and reload saved data? Unsaved local changes will be discarded.",
                          )
                        )
                          return;
                        try {
                          await claim(match.id, token.current, true);
                          setPending(null);
                          pendingRef.current = null;
                          await read(match.id);
                          setError("");
                        } catch (e) {
                          setError(message(e));
                        }
                      }}
                    >
                      Recover expired claim / reload
                    </button>
                    <h3>Match log</h3>
                    <MatchLog
                      operations={operations}
                      busy={unavailable}
                      onReverse={(id) =>
                        void send("reverse", { operationId: id })
                      }
                    />
                    <button onClick={() => setManage(false)}>
                      Close Manage
                    </button>
                  </>
                ) : (
                  <Admin
                    key={`${match.id}:${match.revision}`}
                    match={match}
                    busy={unavailable}
                    onCancel={() => setAdmin(false)}
                    onAbandon={() => void abandonMatch()}
                    onCard={() => setCard(true)}
                    onApply={async (d) => {
                      const ok = await send("admin", d);
                      if (ok) setAdmin(false);
                      return ok;
                    }}
                  />
                )}
                {card && (
                  <Penalty
                    match={match}
                    feedback={recoveryControls}
                    config={config.data[0]}
                    busy={unavailable}
                    onCancel={() => setCard(false)}
                    onConfirm={async (d) => {
                      if (match.finalized_at) {
                        setError(
                          "Use Resume / reopen in Admin Mode before adding a new card to a finalized match.",
                        );
                        return false;
                      }
                      const ok = await send("penalty", d);
                      if (ok) {
                        setCard(false);
                        setAdmin(false);
                      }
                      return ok;
                    }}
                  />
                )}
              </Dialog>
            )}
          </>
        )
      )}
    </div>
  );
}
function SideScore({
  side,
  name,
  score,
  disabled,
  onScore,
}: {
  side: Side;
  name: string;
  score: number;
  disabled: boolean;
  onScore: (type: string, points: number) => void;
}) {
  return (
    <section className={`live-side ${side}`} aria-label={`${side} fencer`}>
      <h2>{name}</h2>
      <div className="live-score">{score}</div>
      <div className="quick-scores">
        {[
          [1, "indirect"],
          [3, "clean"],
          [5, "counter"],
        ].map(([points, type]) => (
          <button
            key={points}
            disabled={disabled}
            title={String(type)}
            aria-label={`${side} ${type} +${points}`}
            onClick={() => onScore(String(type), Number(points))}
          >
            +{points}
          </button>
        ))}
      </div>
    </section>
  );
}
function Prep({
  match,
  fencers,
  presets,
  userId,
  busy,
  onConfirm,
}: {
  match: LiveMatch | null;
  fencers: Fencer[];
  presets: Preset[];
  userId: string;
  busy: boolean;
  onConfirm: (values: Record<string, unknown>) => Promise<void>;
}) {
  const remembered = presets.find(
    (p) =>
      p.id === localStorage.getItem(`lastPreset:${userId}`) && !p.is_archived,
  );
  const unreg = fencers.find((f) => f.is_unregistered);
  const [left, setLeft] = useState(match?.left_fencer_id ?? "");
  const [right, setRight] = useState(match?.right_fencer_id ?? "");
  const [leftName, setLeftName] = useState(match?.left_name ?? "");
  const [rightName, setRightName] = useState(match?.right_name ?? "");
  const [preset, setPreset] = useState(
    match?.preset_id ?? remembered?.id ?? "",
  );
  const [seconds, setSeconds] = useState(
    (match?.duration_ms ?? remembered?.duration_ms ?? 180000) / 1000,
  );
  const [target, setTarget] = useState<string>(
    String(match?.target_score ?? remembered?.target_score ?? ""),
  );
  const [type, setType] = useState(
    match?.bracket_id && !match.group_id
      ? "knockout"
      : (match?.match_type ?? "standard"),
  );
  const [round, setRound] = useState(match?.round_name ?? "");
  useEffect(() => {
    if (!match && remembered && !preset) {
      setPreset(remembered.id);
      setSeconds(remembered.duration_ms / 1000);
      setTarget(String(remembered.target_score ?? ""));
    }
  }, [remembered?.id]);
  useEffect(() => {
    if (unreg) {
      setLeft((v) => v || unreg.id);
      setRight((v) => v || unreg.id);
    }
  }, [unreg?.id]);
  function picker(side: Side) {
    const id = side === "left" ? left : right,
      name = side === "left" ? leftName : rightName,
      setId = side === "left" ? setLeft : setRight,
      setName = side === "left" ? setLeftName : setRightName;
    return (
      <fieldset>
        <legend>{side === "left" ? "Left" : "Right"} fencer</legend>
        <label>
          Registered fencer
          <select
            required
            disabled={Boolean(match?.event_id) || busy}
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              const f = fencers.find((f) => f.id === e.target.value);
              setName(f?.is_unregistered ? "" : (f?.display_name ?? ""));
            }}
          >
            <option value="">Choose fencer</option>
            {fencers
              .filter((f) => !f.is_archived || f.id === id)
              .filter((f) => !match?.event_id || !f.is_unregistered)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.display_name}
                  {f.affiliation ? ` · ${f.affiliation}` : ""}
                </option>
              ))}
          </select>
        </label>
        {id === unreg?.id && (
          <label>
            Participant name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
      </fieldset>
    );
  }
  return (
    <form
      className="card editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onConfirm({
          leftFencerId: left,
          rightFencerId: right,
          leftName:
            left === unreg?.id
              ? leftName.trim()
              : fencers.find((f) => f.id === left)?.display_name,
          rightName:
            right === unreg?.id
              ? rightName.trim()
              : fencers.find((f) => f.id === right)?.display_name,
          presetId: preset || null,
          durationMs: Math.round(seconds * 1000),
          targetScore: target ? Number(target) : null,
          matchType: type,
          roundName: round,
        });
      }}
    >
      <div className="fields">
        {picker("left")}
        {picker("right")}
        <label>
          Preset
          <select
            value={preset}
            disabled={busy}
            onChange={(e) => {
              setPreset(e.target.value);
              const p = presets.find((p) => p.id === e.target.value);
              if (p) {
                setSeconds(p.duration_ms / 1000);
                setTarget(String(p.target_score ?? ""));
              }
            }}
          >
            <option value="">Custom</option>
            {presets
              .filter(
                (p) =>
                  p.mode === "traditional" &&
                  (!p.is_archived || p.id === preset),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Length (seconds)
          <input
            type="number"
            min={1}
            max={10800}
            required
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
        </label>
        <label>
          Score to Win (blank for no target)
          <input
            type="number"
            min={1}
            max={10000}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <label>
          Match type
          <select
            disabled={Boolean(match?.event_id)}
            value={type}
            onChange={(e) => setType(e.target.value as "standard" | "knockout")}
          >
            <option value="standard">Standard</option>
            <option value="knockout">Knockout</option>
          </select>
        </label>
        <label>
          Round / bout
          <input value={round} onChange={(e) => setRound(e.target.value)} />
        </label>
      </div>
      <button className="primary" disabled={busy || !left || !right}>
        Confirm match — timer stays stopped
      </button>
    </form>
  );
}
function Admin({
  match,
  busy,
  onApply,
  onCancel,
  onAbandon,
  onCard,
}: {
  match: LiveMatch;
  busy: boolean;
  onApply: (data: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
  onAbandon: () => void;
  onCard: () => void;
}) {
  const [left, setLeft] = useState(match.left_score),
    [right, setRight] = useState(match.right_score),
    [time, setTime] = useState(Math.ceil(match.remaining_ms / 1000)),
    [target, setTarget] = useState(match.target_score),
    [outcome, setOutcome] = useState(match.result_override ?? ""),
    [resume, setResume] = useState(false);
  const controls = (
    label: string,
    value: number,
    change: (n: number) => void,
    step = 1,
    max = 30000,
  ) => (
    <div className="stepper">
      <span>
        {label}:{" "}
        <strong>
          {label === "Remaining time" ? clockText(value * 1000) : value}
        </strong>
      </span>
      <button
        type="button"
        disabled={busy || value <= 0}
        aria-label={`Decrease ${label}`}
        onClick={() => change(Math.max(0, value - step))}
      >
        ↓
      </button>
      <button
        type="button"
        disabled={busy || value >= max}
        aria-label={`Increase ${label}`}
        onClick={() => change(Math.min(max, value + step))}
      >
        ↑
      </button>
    </div>
  );
  const dirty =
    left !== match.left_score ||
    right !== match.right_score ||
    time !== Math.ceil(match.remaining_ms / 1000) ||
    target !== match.target_score ||
    outcome !== (match.result_override ?? "") ||
    resume;
  return (
    <section>
      <div className="admin-mode-heading">
        <h3>Admin Mode — staged changes</h3>
        <button className="danger" type="button" disabled={busy} onClick={onAbandon}>
          Abandon Match
        </button>
      </div>
      <p>Changes apply together when saved. The timer remains paused.</p>
      <div className="fields">
        {controls("Left score", left, setLeft)}
        {controls("Right score", right, setRight)}
        <div>
          <strong>Remaining time: {clockText(time * 1000)}</strong>
          {(
            [
              ["Remaining minutes", 60],
              ["Remaining seconds", 1],
            ] as const
          ).map(([label, step]) => (
            <div className="stepper" key={label}>
              <span>{label}</span>
              <button
                type="button"
                aria-label={`Decrease ${label}`}
                disabled={busy || time <= 0}
                onClick={() => setTime((t) => Math.max(0, t - step))}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Increase ${label}`}
                disabled={
                  busy ||
                  time >= (match.is_overtime ? match.overtime_ms / 1000 : 10800)
                }
                onClick={() =>
                  setTime((t) =>
                    Math.min(
                      match.is_overtime ? match.overtime_ms / 1000 : 10800,
                      t + step,
                    ),
                  )
                }
              >
                ↑
              </button>
            </div>
          ))}
        </div>
        {controls(
          "Score to Win",
          target ?? 0,
          (v) => setTarget(v === 0 ? null : v),
          1,
          10000,
        )}
        <p>{target === null ? "No target" : "Match-specific target"}</p>
      </div>
      <h4 className="assign-winner">Assign Winner</h4>
      <div className="assign-winner button-row">
        {[
          ["left", "← Left Victory"],
          ["draw", "Draw"],
          ["incomplete", "Incomplete"],
          ["right", "Right Victory →"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={outcome === value ? "selected" : ""}
            disabled={busy}
            onClick={() => setOutcome(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <button disabled={busy} onClick={() => setOutcome("")}>
        Use score-derived result
      </button>
      {match.finalized_at && (
        <label className="check">
          <input
            type="checkbox"
            checked={resume}
            onChange={(e) => setResume(e.target.checked)}
          />
          Resume / reopen this match (no automatic timer start)
        </label>
      )}
      <div className="button-row">
        <button disabled={busy || dirty} onClick={onCard}>
          Card penalty…
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            if (
              outcome === "incomplete" &&
              !confirm(
                "Save this match as Incomplete? It will credit no result or advancement.",
              )
            )
              return;
            void onApply({
              leftScore: left,
              rightScore: right,
              remainingMs: time * 1000,
              targetScore: target,
              outcome,
              resume,
            });
          }}
        >
          Apply & close Admin Mode
        </button>
        <button disabled={busy} onClick={onCancel}>
          Cancel / discard
        </button>
      </div>
      {dirty && <p>Apply or discard staged changes before recording a card.</p>}
    </section>
  );
}
function Penalty({
  feedback,
  match,
  config,
  busy,
  onCancel,
  onConfirm,
}: {
  match: LiveMatch;
  config?: Configuration;
  busy: boolean;
  onCancel: () => void;
  feedback?: ReactNode;
  onConfirm: (d: Record<string, unknown>) => Promise<boolean>;
}) {
  const [side, setSide] = useState<Side>("left"),
    [card, setCard] = useState("Yellow"),
    [reason, setReason] = useState(""),
    [points, setPoints] = useState(1);
  const [history, setHistory] = useState<Operation[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!match.event_id) return;
    let alive = true;
    void (async () => {
      const ids: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db()
          .from("tTraditionalMatch")
          .select("id")
          .eq("event_id", match.event_id!)
          .order("id")
          .range(offset, offset + 999);
        if (error) throw error;
        ids.push(...(data ?? []).map((m) => m.id));
        if (data.length < 1000) break;
      }
      const ops: Operation[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await db()
            .from("tMatchOperation")
            .select("*")
            .in("match_id", ids.slice(i, i + 100))
            .in("kind", ["penalty", "reverse"])
            .order("id")
            .range(offset, offset + 999);
          if (error) throw error;
          ops.push(...data);
          if (data.length < 1000) break;
        }
      }
      if (alive) setHistory(ops);
    })().catch((e) => {
      if (alive) setError(message(e));
    });
    return () => {
      alive = false;
    };
  }, [match.event_id]);
  const reversed = new Set(
    history.filter((o) => o.kind === "reverse").map((o) => o.data.operationId),
  );
  return (
    <Dialog title="Assign card penalty" onClose={onCancel}>
      {feedback}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onConfirm({ side, card, reason, points });
        }}
      >
        <label>
          Fencer being penalized
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as Side)}
          >
            <option value="left">{match.current_left_name} (left)</option>
            <option value="right">{match.current_right_name} (right)</option>
          </select>
        </label>
        <fieldset>
          <legend>Card</legend>
          <div className="button-row">
            {["Yellow", "Red", "Black", "Double Black"].map((c) => (
              <button
                type="button"
                aria-pressed={card === c}
                className={card === c ? "selected" : ""}
                key={c}
                onClick={() => setCard(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Reason</legend>
          <div className="reason-tiles">
            {(config?.penalty_reasons ?? ["Safety", "Power"]).map((r) => (
              <button
                type="button"
                aria-pressed={reason === r}
                className={reason === r ? "selected" : ""}
                key={r}
                onClick={() => setReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Points awarded to{" "}
          {side === "left" ? match.current_right_name : match.current_left_name}
          <input
            type="number"
            min={0}
            max={10000}
            required
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
          />
        </label>
        <p>No automatic disqualification is applied.</p>
        <Notice error={error} />
        {match.event_id ? (
          <>
            <h4>Cards in this event</h4>
            {(["left", "right"] as const).map((s) => (
              <section key={s}>
                <strong>
                  {s === "left"
                    ? match.current_left_name
                    : match.current_right_name}
                </strong>
                {history
                  .filter(
                    (o) =>
                      o.kind === "penalty" &&
                      o.data.sanctionedFencerId ===
                        (s === "left"
                          ? match.left_fencer_id
                          : match.right_fencer_id),
                  )
                  .map((o) => (
                    <p key={o.id}>
                      {operationLabel(o)} ·{" "}
                      {new Date(o.recorded_at).toLocaleString()}
                      {reversed.has(o.id) ? " · Reversed" : ""}
                    </p>
                  ))}
                {!history.some(
                  (o) =>
                    o.kind === "penalty" &&
                    o.data.sanctionedFencerId ===
                      (s === "left"
                        ? match.left_fencer_id
                        : match.right_fencer_id),
                ) && <p>No prior cards.</p>}
              </section>
            ))}
          </>
        ) : (
          <p>Standalone match — no event card record.</p>
        )}
        <div className="button-row">
          <button className="primary" disabled={busy || !reason}>
            Confirm card & award points
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
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
function exportCsv(match: LiveMatch, operations: Operation[]) {
  const quote = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/^[=+\-@]/, "'$&")
      .replaceAll('"', '""')}"`;
  const rows = [
    ["UTC", "Actor", "Operation", "Left after", "Right after"],
    ...operations.map((o) => [
      o.recorded_at,
      o.actor_id,
      operationLabel(o),
      o.left_after,
      o.right_after,
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\ufeff" + rows.map((r) => r.map(quote).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `match-${match.id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
