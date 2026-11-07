import type { LiveMatch, Operation } from "./liveMatch";
import MatchLog from "./MatchLog";
import { reportModel } from "./reportModel";
export default function MatchReport({
  match,
  operations,
  busy,
  onEdit,
  onBack,
  onNew,
  onExport,
  onCsv,
}: {
  match: LiveMatch;
  operations: Operation[];
  busy: boolean;
  onEdit: () => void;
  onBack: () => void;
  onNew: () => void;
  onExport: () => void;
  onCsv: () => void;
}) {
  const report = reportModel(operations, match.left_score, match.right_score);
  const official =
    Boolean(match.finalized_at) &&
    !match.is_void &&
    !match.is_archived &&
    match.outcome !== "incomplete";
  const names = [match.current_left_name, match.current_right_name];
  const max = Math.max(
    1,
    ...report.progression.flatMap((p) => [p.left, p.right]),
    match.left_score,
    match.right_score,
  );
  const points = (side: "left" | "right") =>
    report.progression
      .map(
        (p, i) =>
          `${40 + (i * 520) / Math.max(1, report.progression.length - 1)},${210 - (p[side] * 180) / max}`,
      )
      .join(" ");
  return (
    <section className="match-report">
      <header>
        <h2>Match Report</h2>
        {match.phase_id && (
          <p>
            Event: {match.event_name} · Phase:{" "}
            {match.phase_name ?? match.phase_name_snapshot}
            {match.phase_name_snapshot &&
            match.phase_name_snapshot !== match.phase_name
              ? ` · Played in ${match.phase_name_snapshot}`
              : ""}
          </p>
        )}
        <div className="button-row">
          <button disabled={busy} onClick={onEdit}>
            Edit Match
          </button>
          <button onClick={onBack}>Back to Scoreboard</button>
          <button disabled={busy} onClick={onNew}>
            New Match
          </button>
          <a href="#/history/matches">Match History</a>
        </div>
      </header>
      <div className="report-columns">
        <section className="report-log match-rail">
          <h3>Match Log</h3>
          <MatchLog
            names={{
              left: match.current_left_name,
              right: match.current_right_name,
            }}
            operations={operations}
          />
        </section>
        <section className="report-result">
          <h3>
            {!official
              ? "Result Not Finalized"
              : match.outcome === "draw"
                ? `Tie · ${names.join(" & ")}`
                : `${match.winner_side === "left" ? names[0] : names[1]} Wins`}
          </h3>
          <div className="final-score">
            <span>
              {names[0]}
              <strong>{match.left_score}</strong>
            </span>
            <span aria-hidden="true">–</span>
            <span>
              {names[1]}
              <strong>{match.right_score}</strong>
            </span>
          </div>
          <h3>Score Progression</h3>
          <p>
            Scoring and correction order · Left: solid amber · Right: dashed
            blue
          </p>
          {report.unavailable && (
            <p role="status">
              Legacy score snapshots unavailable. Earlier progression cannot be
              reconstructed.
            </p>
          )}
          {report.progression.length ? (
            <svg
              viewBox="0 0 600 250"
              role="img"
              aria-label={`Score progression by saved operation order. Final score ${names[0]} ${match.left_score}, ${names[1]} ${match.right_score}`}
            >
              <line x1="40" y1="210" x2="560" y2="210" stroke="currentColor" />
              <line x1="40" y1="30" x2="40" y2="210" stroke="currentColor" />
              <text x="4" y="35" fill="currentColor">
                {max}
              </text>
              <text x="15" y="215" fill="currentColor">
                0
              </text>
              <polyline
                points={points("left")}
                fill="none"
                stroke="#F0BA70"
                strokeWidth="3"
              />
              <polyline
                points={points("right")}
                fill="none"
                stroke="#78A9D3"
                strokeWidth="3"
                strokeDasharray="7 4"
              />
              {report.progression.map((p, i) => (
                <g key={p.sequence}>
                  <circle
                    cx={
                      40 +
                      (i * 520) / Math.max(1, report.progression.length - 1)
                    }
                    cy={210 - (p.left * 180) / max}
                    r="3"
                    fill="#F0BA70"
                  >
                    <title>
                      Operation {p.sequence}: Left {p.left}
                    </title>
                  </circle>
                  <circle
                    cx={
                      40 +
                      (i * 520) / Math.max(1, report.progression.length - 1)
                    }
                    cy={210 - (p.right * 180) / max}
                    r="3"
                    fill="#78A9D3"
                  >
                    <title>
                      Operation {p.sequence}: Right {p.right}
                    </title>
                  </circle>
                </g>
              ))}
              <text x="40" y="240" fill="currentColor">
                Earlier operations
              </text>
              <text x="420" y="240" fill="currentColor">
                Latest
              </text>
            </svg>
          ) : (
            <p>No historical score snapshots available.</p>
          )}
          {!report.graphReconciled && (
            <p>
              Current authoritative endpoint: {match.left_score} –{" "}
              {match.right_score}. Historical snapshots do not provide this
              endpoint.
            </p>
          )}
          <details>
            <summary>Progression Data</summary>
            <table>
              <thead>
                <tr>
                  <th>Operation</th>
                  <th>{names[0]}</th>
                  <th>{names[1]}</th>
                </tr>
              </thead>
              <tbody>
                {report.progression.map((p) => (
                  <tr key={p.sequence}>
                    <td>{p.sequence}</td>
                    <td>{p.left}</td>
                    <td>{p.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="report-breakdown match-rail">
          <h3>Scoring Breakdown</h3>
          <p>Net awarded points</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reason</th>
                  {names.map((n, i) => (
                    <th key={i}>{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.breakdown).map(([key, values]) => (
                  <tr key={key}>
                    <th>
                      {key}{" "}
                      {key === "+1"
                        ? "Indirect"
                        : key === "+3"
                          ? "Clean Hit"
                          : key === "+5"
                            ? "Counter"
                            : "Penalties / Corrections"}
                    </th>
                    <td>{values[0]}</td>
                    <td>{values[1]}</td>
                  </tr>
                ))}
                <tr>
                  <th>Total</th>
                  <td>{report.totals[0]}</td>
                  <td>{report.totals[1]}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {!report.reconciled && (
            <p role="alert">
              Historical breakdown does not reconcile with the saved score.
              Refer to the authoritative final score and audit details.
            </p>
          )}
        </section>
      </div>
      <details>
        <summary>Settings and Provenance</summary>
        <pre>{JSON.stringify(match, null, 2)}</pre>
      </details>
      <div className="button-row">
        <button onClick={onExport}>Export Report</button>
        <button onClick={onCsv}>Export CSV</button>
      </div>
    </section>
  );
}
