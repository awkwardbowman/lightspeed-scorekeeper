import { TeamBadge } from "./Teams";
import MatchLog from "./MatchLog";
import { type Operation } from "./liveMatch";
import { useState } from "react";
import {
  type TeamInstance,
  type ImageAsset,
  type EventRecord,
  type Fencer,
  type MatchRow,
  type Standing,
  type Profile,
} from "./data";
import { EventPicker, StandingsTable } from "./Events";
import {
  ArchiveFilter,
  BackLink,
  Intro,
  Notice,
  Search,
  useRows,
} from "./ui";
export function History({ kind }: { kind: "events" | "matches" | "fencers" }) {
  const operations = useRows<Operation>("tMatchOperation");
  const events = useRows<EventRecord>("tEvent");
  const users = useRows<Profile>("tUser");
  const fencers = useRows<Fencer>("tFencer");
  const matches = useRows<MatchRow>("vMatchResults");
  const calls = useRows<{
    id: string;
    match_id: string;
    side: string;
    call_type: string;
    points: number;
    match_time_ms: number;
    recorded_at: string;
    is_reversed: boolean;
  }>("tTraditionalCall");
  const audit = useRows<{
    id: string;
    record_id: string;
    table_name: string;
    action: string;
    actor_id: string | null;
    old_value: unknown;
    new_value: unknown;
    recorded_at: string;
  }>("tAudit");
  const stats = useRows<{
    fencer_id: string;
    display_name: string;
    scope: string;
    matches: number;
    wins: number;
    losses: number;
    draws: number;
    points_for: number;
    points_against: number;
  }>("vFencerStatistics");
  const scoring = useRows<{
    fencer_id: string;
    scope: string;
    call_type: string;
    points: number;
    calls: number;
    total_points: number;
  }>("vFencerScoring");
  const snapshots = useRows<{
    id: string;
    event_id: string;
    created_at: string;
    standings: Standing[];
    configuration: unknown;
    group_standings: Record<string, { name: string; standings: Standing[] }>;
    participants: Fencer[];
    team_snapshot:
      | (TeamInstance & {
          members: { id: string; fencer_id: string; fencer_name: string }[];
        })[]
      | null;
  }>("tEventFinalization");
  const phases = useRows<{
    id: string;
    event_id: string;
    name: string;
    kind: string;
  }>("tEventPhase");
  const groups = useRows<{ id: string; phase_id: string; name: string }>(
    "tEventGroup",
  );
  const brackets = useRows<{
    id: string;
    phase_id: string;
    format: string;
    is_archived: boolean;
    graph: unknown;
  }>("tBracket");
  const teams = useRows<TeamInstance>("vTeamInstances");
  const assets = useRows<ImageAsset>("tImageAsset");
  const memberships = useRows<{
    event_id: string;
    team_id: string;
    fencer_id: string;
  }>("tEventTeamFencer");
  const [id, setId] = useState("");
  const [matchId, setMatchId] = useState("");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [scope, setScope] = useState("all");
  const [matchOrder, setMatchOrder] = useState("newest");
  const [snapshotId, setSnapshotId] = useState("");
  const match = matches.data.find((m) => m.id === matchId);
  const list = matches.data.filter(
    (m) =>
      (archived || (!m.is_archived && !m.is_void)) &&
      (kind === "events"
        ? m.event_id === id
        : kind === "fencers"
          ? m.left_fencer_id === id || m.right_fencer_id === id
          : true) &&
      (scope === "all" ||
        (scope === "event" ? Boolean(m.event_id) : !m.event_id)) &&
      `${m.current_left_name} ${m.current_right_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  ).sort((a, b) => matchOrder === "oldest"
    ? a.created_at.localeCompare(b.created_at)
    : b.created_at.localeCompare(a.created_at));
  const finalized = snapshots.data
    .filter((s) => s.event_id === id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const snap = finalized.find((s) => s.id === snapshotId) ?? finalized[0];
  const selectedPhases = phases.data.filter((p) => p.event_id === id);
  return (
    <>
      <Intro
        title={`${kind === "events" ? "Event" : kind === "fencers" ? "Fencer" : "Match"} History`}
      >
        Search shared results, inspect calls and corrections, and reveal
        archived generations when needed.
      </Intro>
      <BackLink href="#/history" />
      <Notice
        error={
          events.error ||
          fencers.error ||
          matches.error ||
          calls.error ||
          audit.error ||
          stats.error ||
          scoring.error ||
          snapshots.error ||
          phases.error ||
          groups.error ||
          brackets.error ||
          teams.error ||
          memberships.error
        }
        loading={matches.loading}
      />
      <section className="card">
        <ArchiveFilter checked={archived} onChange={setArchived} />
        <Search value={search} onChange={setSearch} />
        {kind === "events" && (
          <EventPicker
            events={events.data}
            id={id}
            onChange={(v) => {
              setId(v);
              setMatchId("");
              setSnapshotId("");
            }}
            archived={archived}
          />
        )}
        {kind === "fencers" && (
          <label>
            Fencer
            <select
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setMatchId("");
              }}
            >
              <option value="">Select registered fencer</option>
              {fencers.data
                .filter(
                  (f) =>
                    !f.is_unregistered &&
                    (archived || !f.is_archived),
                )
                .sort((a, b) =>
                  a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" }) ||
                  a.id.localeCompare(b.id),
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.display_name}{f.affiliation ? ` · ${f.affiliation}` : ""}
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind === "events" && id && (
          <>
            <h3>{events.data.find((e) => e.id === id)?.name}</h3>
            <p>{events.data.find((e) => e.id === id)?.description}</p>
            <h4>Phases, groups and bracket generations</h4>
            {selectedPhases.map((p) => (
              <section key={p.id}>
                <h4>
                  {p.name} · {p.kind}
                </h4>
                <p>
                  {groups.data
                    .filter((g) => g.phase_id === p.id)
                    .map((g) => g.name)
                    .join(", ")}
                </p>
                {brackets.data
                  .filter(
                    (b) => b.phase_id === p.id && (archived || !b.is_archived),
                  )
                  .map((b) => (
                    <details key={b.id}>
                      <summary>
                        {b.format} · {p.name}
                        {b.is_archived ? " · Archived" : ""}
                      </summary>
                      <p>Bracket generation retained. Matches and results are shown below.</p>
                    </details>
                  ))}
              </section>
            ))}
            <h4>Team instances and current rosters</h4>
            {teams.data
              .filter((t) => t.event_id === id)
              .map((t) => (
                <article className="card" key={t.id}>
                  <TeamBadge team={t} assets={assets.data} />
                  <a href={`#/events/teams?mode=roster&id=${t.id}`}>
                    Current / historical roster
                  </a>{" "}
                  ·{" "}
                  <a href={`#/events/teams?mode=history&id=${t.id}`}>
                    Team lineage and history
                  </a>
                </article>
              ))}
            {snap?.team_snapshot && (
              <>
                <h4>Frozen team rosters at selected finalization</h4>
                {snap.team_snapshot.map((t) => (
                  <article className="card" key={t.id}>
                    <TeamBadge team={t} assets={assets.data} />
                    <ul>
                      {t.members.map((m) => (
                        <li key={m.id}>
                          {m.fencer_name}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </>
            )}
            <h4>
              Legacy event roster evidence (before team-instance migration)
            </h4>
            {memberships.data
              .filter((m) => m.event_id === id)
              .map((m) => (
                <p key={`${m.team_id}:${m.fencer_id}`}>
                  {teams.data.find((t) => t.id === m.team_id)?.name} ·{" "}
                  {fencers.data.find((f) => f.id === m.fencer_id)?.display_name}
                </p>
              ))}
            {snap && (
              <>
                <h4>Frozen final standings</h4>
                {Object.entries(snap.group_standings ?? {}).map(([id, g]) => (
                  <section key={id}>
                    <h4>{g.name}</h4>
                    <StandingsTable
                      data={g.standings.map((s) => ({
                        ...s,
                        display_name:
                          fencers.data.find((f) => f.id === s.id)
                            ?.display_name ?? s.display_name,
                      }))}
                    />
                  </section>
                ))}
                <label>
                  Finalization
                  <select
                    value={snap.id}
                    onChange={(e) => setSnapshotId(e.target.value)}
                  >
                    {finalized.map((s) => (
                      <option key={s.id} value={s.id}>
                        {new Date(s.created_at).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <StandingsTable
                  data={snap.standings.map((s) => ({
                    ...s,
                    display_name:
                      fencers.data.find((f) => f.id === s.id)?.display_name ??
                      s.display_name,
                  }))}
                />
                <p className="muted">The original ranking configuration is retained with this finalized standings snapshot.</p>
              </>
            )}
          </>
        )}
        {kind === "fencers" && id && (
          <>
            <h3>Performance</h3>
            <h4>Scoring breakdown</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Call type</th>
                    <th>Value</th>
                    <th>Calls</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {scoring.data
                    .filter((s) => s.fencer_id === id)
                    .map((s) => (
                      <tr key={`${s.scope}:${s.call_type}:${s.points}`}>
                        <td>{s.scope}</td>
                        <td>{s.call_type}</td>
                        <td>{s.points}</td>
                        <td>{s.calls}</td>
                        <td>{s.total_points}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Matches</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Draws</th>
                    <th>Points for / against</th>
                  </tr>
                </thead>
                <tbody>
                  {["overall", "event", "standalone"].map((scope) => {
                    const selected = stats.data.filter(
                      (s) =>
                        s.fencer_id === id &&
                        (scope === "overall" || s.scope === scope),
                    );
                    return (
                      <tr key={scope}>
                        <td>{scope}</td>
                        {(["matches", "wins", "losses", "draws"] as const).map(
                          (k) => (
                            <td key={k}>
                              {selected.reduce((v, s) => v + Number(s[k]), 0)}
                            </td>
                          ),
                        )}
                        <td>
                          {selected.reduce(
                            (v, s) => v + Number(s.points_for),
                            0,
                          )}{" "}
                          /{" "}
                          {selected.reduce(
                            (v, s) => v + Number(s.points_against),
                            0,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {kind !== "events" && (
          <label>
            Match scope
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All</option>
              <option value="event">Event</option>
              <option value="standalone">Standalone</option>
            </select>
          </label>
        )}
        {kind === "matches" && (
          <label>
            Match order
            <select value={matchOrder} onChange={(e) => setMatchOrder(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        )}
        <div className="selection-list">
          {list.map((m) => {
            // The authoritative adjudicated winner can differ from the
            // numeric score following an audited referee override.
            const leftWon = Boolean(m.finalized_at) && !m.is_void &&
              m.outcome !== "draw" && m.winner_side === "left";
            const rightWon = Boolean(m.finalized_at) && !m.is_void &&
              m.outcome !== "draw" && m.winner_side === "right";
            const result = !m.finalized_at
              ? "Incomplete"
              : m.outcome === "draw"
                ? "Draw"
                : leftWon
                  ? `${m.current_left_name} Wins`
                  : rightWon
                    ? `${m.current_right_name} Wins`
                    : m.outcome;
            return (
              <button
                className="list-item"
                key={m.id}
                aria-pressed={matchId === m.id}
                onClick={() => setMatchId(m.id)}
              >
                <span className="match-history-summary">
                  <span className={leftWon ? "match-winner" : ""}>{m.current_left_name}</span>
                  <span className="match-vs">vs</span>
                  <span className={rightWon ? "match-winner" : ""}>{m.current_right_name}</span>
                  <span className="match-history-score">
                    [ <span className={leftWon ? "match-winner" : ""}>{m.left_score}</span>
                    {" "}to{" "}
                    <span className={rightWon ? "match-winner" : ""}>{m.right_score}</span> ]
                  </span>
                  <span className="match-history-outcome">{result}</span>
                </span>
                <small>
                  {new Date(m.created_at).toLocaleString()}
                  {m.is_archived
                    ? " · Archived"
                    : m.is_void
                      ? " · Void"
                      : ""}
                </small>
              </button>
            );
          })}
          {kind === "matches" && !matches.loading && list.length === 0 && (
            <p role="status">No matches match your filters.</p>
          )}
        </div>
      </section>
      {match && (
        <section className="card">
          <h3>
            {match.current_left_name} vs {match.current_right_name}
          </h3>
          <p>
            {match.left_score}–{match.right_score} · {match.outcome} · Referee{" "}
            {users.data.find((u) => u.id === match.referee_id)?.display_name ?? (match.referee_id ? "Recorded referee" : "Not recorded")}
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={match.is_archived || match.is_void}
              onClick={() => {
                sessionStorage.setItem("openMatch", match.id);
                window.location.hash = "/single-match";
              }}
            >
              Open / correct match
            </button>
          </div>
          <h4>Audited match operations</h4>
          <Notice error={operations.error} />
          <MatchLog
            operations={operations.data
              .filter((o) => o.match_id === match.id)
              .sort((a, b) => a.sequence - b.sequence)}
          />
          <h4>Original calls (including reversals)</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>UTC</th>
                  <th>Side / call</th>
                  <th>Points</th>
                  <th>Clock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {calls.data
                  .filter((c) => c.match_id === match.id)
                  .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
                  .map((c) => (
                    <tr key={c.id}>
                      <td>{c.recorded_at}</td>
                      <td>
                        {c.side} · {c.call_type}
                      </td>
                      <td>{c.points}</td>
                      <td>{(c.match_time_ms / 1000).toFixed(1)}s</td>
                      <td>{c.is_reversed ? "Reversed" : "Counted"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <h4>Match details</h4>
          <p>
            {match.event_id ? events.data.find((e) => e.id === match.event_id)?.name ?? "Historical event" : "Standalone match"}
            {" · "}{match.slot_key ? `Bracket slot ${match.slot_key}` : "Manual pairing"}
            {" · "}{match.finalized_at ? `Finalized ${new Date(match.finalized_at).toLocaleString()}` : "Not finalized"}
          </p>
          <h4>Correction audit</h4>
          {audit.data
            .filter(
              (a) =>
                a.record_id === match.id ||
                calls.data.some(
                  (c) => c.id === a.record_id && c.match_id === match.id,
                ),
            )
            .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
            .map((a) => (
              <details key={a.id}>
                <summary>
                  {new Date(a.recorded_at).toLocaleString()} · {a.action} · {users.data.find((u) => u.id === a.actor_id)?.display_name ?? "System"}
                </summary>
                <p>Correction details remain available in the retained audit evidence.</p>
              </details>
            ))}
        </section>
      )}
    </>
  );
}
