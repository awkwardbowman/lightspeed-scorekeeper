import { useEffect, useRef, useState } from 'react';
import CloudPanel from './CloudPanel';
import { clockText, countFor, downloadCsv, initialMatch, POINT_VALUES, SCORE_LABELS, scoreFor, targetReached, uid, type CallType, type Match, type PointValue, type Side } from './match';

const STORAGE_KEY = 'lightspeed-scorekeeper:v1';
const TYPES: CallType[] = ['indirect', 'clean', 'counter'];
function recover(): Match {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value) {
      const stored = JSON.parse(value) as Match;
      if (stored.id && Array.isArray(stored.calls) && typeof stored.remainingMs === 'number') {
        // A match must never silently continue its timer after a page refresh.
        return stored.phase === 'running' ? { ...stored, phase: 'paused' } : stored;
      }
    }
  } catch { /* gracefully recover corrupted browser storage */ }
  return initialMatch();
}

export default function Scorekeeper() {
  const [match, setMatch] = useState<Match>(recover);
  const [page, setPage] = useState<'match' | 'report'>('match');
  const [confirmReset, setConfirmReset] = useState(false);
  const deadline = useRef<number | null>(null);
  const lastSaved = useRef(match);
  lastSaved.current = match;

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(match)); }, [match]);

  useEffect(() => {
    if (match.phase !== 'running') { deadline.current = null; return; }
    // A monotonic clock prevents interval drift and catches time lost in background tabs.
    deadline.current = performance.now() + match.remainingMs;
    const id = window.setInterval(() => {
      const left = Math.max(0, (deadline.current ?? performance.now()) - performance.now());
      setMatch((current) => {
        if (current.phase !== 'running') return current;
        return left <= 0
          ? { ...current, remainingMs: 0, phase: 'ended', endReason: 'time', endedAt: new Date().toISOString() }
          : { ...current, remainingMs: left };
      });
    }, 70);
    return () => window.clearInterval(id);
  // Only restart a countdown on a phase transition, not on each display tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.phase]);

  function start() {
    if (match.phase === 'ended' || targetReached(match) || match.remainingMs <= 0) return;
    setMatch((m) => ({ ...m, phase: 'running', startedAt: m.startedAt ?? new Date().toISOString() }));
  }
  function pause() {
    if (match.phase !== 'running') return;
    const left = Math.max(0, (deadline.current ?? performance.now()) - performance.now());
    setMatch((m) => left === 0
      ? { ...m, remainingMs: 0, phase: 'ended', endReason: 'time', endedAt: new Date().toISOString() }
      : { ...m, remainingMs: left, phase: 'paused' });
  }
  function addCall(side: Side, type: CallType, points: PointValue) {
    setMatch((m) => {
      if (m.phase !== 'paused' || targetReached(m)) return m;
      const next: Match = {
        ...m,
        calls: [...m.calls, { id: uid(), side, type, points, matchTimeMs: m.remainingMs, timestamp: new Date().toISOString() }],
      };
      return targetReached(next) ? { ...next, phase: 'ended', endReason: 'target', endedAt: new Date().toISOString() } : next;
    });
  }
  function removeCall(id: string) {
    setMatch((m) => {
      if (m.phase === 'running') return m;
      const next = { ...m, calls: m.calls.filter((call) => call.id !== id) };
      if (m.endReason === 'target' && !targetReached(next)) {
        return { ...next, phase: 'paused', endReason: null, endedAt: null };
      }
      return next;
    });
  }
  function reset() {
    setMatch(initialMatch());
    setPage('match');
    setConfirmReset(false);
  }
  function updateSetup(key: 'eventName' | 'roundName' | 'leftName' | 'rightName', value: string) {
    setMatch((m) => m.phase === 'ready' ? { ...m, [key]: value } : m);
  }
  const leftScore = scoreFor(match, 'left');
  const rightScore = scoreFor(match, 'right');
  const finished = match.phase === 'ended';
  const editable = match.phase === 'ready';
  const winner = leftScore === rightScore ? 'Tie' : leftScore > rightScore ? match.leftName : match.rightName;

  return <section className="single-match-ui">
    <header className="app-header">
      <div><span className="eyebrow">TRADITIONAL · STANDALONE</span><h2>Single Match<span className="accent">.</span></h2></div>
      <div className="header-actions"><span className="local-tag">● Local session · optional cloud backup</span><button className="subtle" onClick={() => setConfirmReset(true)}>New match</button></div>
    </header>

    {confirmReset && <div className="backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-label="Confirm new match"><h2>Start a new match?</h2><p>The current match will be replaced on this device. Save it to the cloud or export its report first if you need to keep it.</p><div className="modal-actions"><button className="subtle" onClick={() => setConfirmReset(false)}>Cancel</button><button className="danger" onClick={reset}>Replace match</button></div></div></div>}

    <nav className="tabs" aria-label="Screen navigation"><button className={page === 'match' ? 'selected' : ''} onClick={() => setPage('match')}>Match control</button><button className={page === 'report' ? 'selected' : ''} onClick={() => setPage('report')}>Match report</button></nav>

    <CloudPanel match={match} onLoad={(cloudMatch) => { setMatch(cloudMatch); setPage('match'); setConfirmReset(false); }} />

    {page === 'match' ? <>
      <section className="setup card">
        <div className="section-heading"><h2>Match setup</h2><span>{editable ? 'Editable until timer starts' : 'Locked once started'}</span></div>
        <div className="fields">
          <label>Event<input disabled={!editable} placeholder="Event name (optional)" value={match.eventName} onChange={(e) => updateSetup('eventName', e.target.value)}/></label>
          <label>Round / bout<input disabled={!editable} placeholder="Round (optional)" value={match.roundName} onChange={(e) => updateSetup('roundName', e.target.value)}/></label>
          <label>Match length (minutes)<input disabled={!editable} type="number" min="1" max="180" value={match.durationMs / 60000} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1 && n <= 180) setMatch((m) => ({ ...m, durationMs: n * 60000, remainingMs: n * 60000 })); }}/></label>
          <label>Target score (optional)<input disabled={!editable} type="number" min="1" max="10000" placeholder="No target" value={match.targetScore ?? ''} onChange={(e) => { const n = Number(e.target.value); setMatch((m) => ({ ...m, targetScore: e.target.value === '' ? null : n >= 1 && n <= 10000 ? Math.floor(n) : m.targetScore })); }}/></label>
        </div>
      </section>
      <section className={`arena card ${finished ? 'is-finished' : ''}`}>
        <div className="timer-area"><div className="status-line"><span className={`status-dot ${match.phase}`}/> {match.phase === 'ready' ? 'READY TO START' : match.phase === 'running' ? 'MATCH IN PROGRESS' : match.phase === 'paused' ? 'MATCH PAUSED · RECORD THE CALL' : `MATCH COMPLETE · ${match.endReason === 'target' ? 'TARGET REACHED' : match.endReason === 'time' ? 'TIME EXPIRED' : 'ENDED'}`}</div><div className="clock" aria-live="off">{clockText(match.remainingMs)}</div><div className="time-hint">{match.targetScore ? `First to ${match.targetScore} points or time expires` : 'Match ends when time expires'}</div></div>
        {finished && <div className="finished-banner"><strong>MATCH COMPLETE</strong><span>{winner === 'Tie' ? 'Match tied' : `${winner} leads`}</span><button onClick={() => setPage('report')}>View match report →</button></div>}
        <div className="fencers">
          {(['left', 'right'] as Side[]).map((side) => <div className={`fencer ${side}`} key={side}>
            <label className="fencer-name-label">{side === 'left' ? 'FENCER A' : 'FENCER B'}<input aria-label={`${side} fencer name`} disabled={!editable} value={side === 'left' ? match.leftName : match.rightName} onChange={(e) => updateSetup(side === 'left' ? 'leftName' : 'rightName', e.target.value)}/></label>
            <div className="score">{side === 'left' ? leftScore : rightScore}</div><div className="points-label">POINTS</div>
            <div className="score-grid"><div className="score-grid-head"><span>Call type</span>{POINT_VALUES.map((points) => <span key={points}>+{points}</span>)}</div>{TYPES.map((type) => <div className="score-grid-row" key={type}><span>{SCORE_LABELS[type]}</span>{POINT_VALUES.map((points) => <button key={points} aria-label={`${SCORE_LABELS[type]} ${points} points for ${side === 'left' ? match.leftName : match.rightName}`} onClick={() => addCall(side, type, points)} disabled={match.phase !== 'paused' || targetReached(match)}>+{points}</button>)}</div>)}</div>
          </div>)}
        </div>
        <div className="controls">{match.phase === 'running' ? <button className="primary large" onClick={pause}>Ⅱ Pause for call</button> : <button className="primary large" onClick={start} disabled={finished}>▶ {match.phase === 'ready' ? 'Start match' : 'Resume match'}</button>}{match.phase === 'paused' && <button className="subtle large" onClick={() => setMatch((m) => ({ ...m, phase: 'ended', endReason: 'manual', endedAt: new Date().toISOString() }))}>End match</button>}</div>
        <p className="rules-note">To record a score, pause the clock first. Choose the scoring category and its 1-, 3-, or 5-point value. Resume after recording the call.</p>
      </section>
      <section className="card history"><div className="section-heading"><h2>Call history</h2><span>{match.calls.length} recorded</span></div>{match.calls.length === 0 ? <p className="muted">No calls yet. Start the match, pause, and enter the referee's decision.</p> : <div className="history-items">{[...match.calls].reverse().map((call) => <div className="history-row" key={call.id}><span className="call-time">{clockText(call.matchTimeMs)}</span><span><strong>{call.side === 'left' ? match.leftName : match.rightName}</strong><small>{SCORE_LABELS[call.type]}</small></span><b>+{call.points}</b><button className="icon-btn" title="Remove incorrect call" aria-label={`Remove ${SCORE_LABELS[call.type]} for ${call.side === 'left' ? match.leftName : match.rightName}`} disabled={match.phase === 'running'} onClick={() => removeCall(call.id)}>Undo</button></div>)}</div>}</section>
    </> : <section className="card report"><div className="section-heading"><h2>Match report</h2><span>{finished ? 'Final' : 'In progress · provisional'}</span></div><p className="muted">{match.eventName || 'Untitled event'}{match.roundName ? ` · ${match.roundName}` : ''} · {new Date(match.createdAt).toLocaleString()}</p><div className="report-score"><div><strong>{match.leftName}</strong><span>{leftScore}</span></div><b>—</b><div><strong>{match.rightName}</strong><span>{rightScore}</span></div></div><p className="report-outcome">{finished ? (winner === 'Tie' ? 'Final result: Tie' : `Final result: ${winner} leads`) : `Current status: ${match.phase}`}</p><div className="table-wrap"><table><thead><tr><th>Scoring category</th><th>{match.leftName}</th><th>{match.rightName}</th></tr></thead><tbody>{TYPES.flatMap((type) => POINT_VALUES.map((points) => <tr key={`${type}-${points}`}><td>{SCORE_LABELS[type]} (+{points})</td><td>{countFor(match, 'left', type, points)}</td><td>{countFor(match, 'right', type, points)}</td></tr>))}<tr className="total"><td>Total points</td><td>{leftScore}</td><td>{rightScore}</td></tr></tbody></table></div><div className="report-actions"><button className="primary" onClick={() => downloadCsv(match)}>Export scoring CSV</button><button className="subtle" onClick={() => window.print()}>Print report</button><button className="subtle" onClick={() => setPage('match')}>Back to match</button></div><p className="muted footnote">CSV includes each individual scoring call, its point value, match clock, and recording timestamp. This browser stores the current match automatically; cloud saving is available from the Cloud storage panel.</p></section>}
  </section>;
}
