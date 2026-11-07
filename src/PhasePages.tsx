import { useCallback, useEffect, useState } from "react";
import {
  rpc,
  type EventRecord,
  type Fencer,
  type Preset,
  type MatchRow,
  type Standing,
} from "./data";
import { useHashParams } from "./Images";
import { Intro, Notice, useRows, useAction } from "./ui";
import { EventPicker, StandingsTable } from "./Events";
import { clockText } from "./match";
import {
  usePhaseCommand,
  phaseUrl,
  runPhaseUrl,
  phaseStateLabels,
  sortedPhaseMatches,
  type EventPhase,
  type PhaseRegistration,
  type PhaseBracket,
} from "./phases";
import BracketView from "./BracketView";

function usePhaseData() {
  const phases = useRows<EventPhase>("vEventPhases"),
    registrations = useRows<PhaseRegistration>("tPhaseRegistration"),
    matches = useRows<MatchRow>("vMatchResults"),
    fencers = useRows<Fencer>("tFencer"),
    presets = useRows<Preset>("tMatchPreset"),
    events = useRows<EventRecord>("tEvent"),
    brackets = useRows<PhaseBracket>("tBracket"),
    eventRegistrations = useRows<{ event_id: string; fencer_id: string }>(
      "tEventFencer",
    );
  const reload = useCallback(async () => {
    await Promise.all([
      phases.reload(),
      registrations.reload(),
      matches.reload(),
      brackets.reload(),
      events.reload(),
      eventRegistrations.reload(),
    ]);
  }, [
    phases.reload,
    registrations.reload,
    matches.reload,
    brackets.reload,
    events.reload,
    eventRegistrations.reload,
  ]);
  return {
    phases,
    registrations,
    matches,
    fencers,
    presets,
    events,
    brackets,
    eventRegistrations,
    reload,
    error:
      phases.error ||
      registrations.error ||
      matches.error ||
      fencers.error ||
      presets.error ||
      events.error ||
      brackets.error ||
      eventRegistrations.error,
    loading:
      phases.loading ||
      events.loading ||
      registrations.loading ||
      matches.loading ||
      presets.loading ||
      fencers.loading ||
      eventRegistrations.loading ||
      brackets.loading,
  };
}
type Command = ReturnType<typeof usePhaseCommand>;
function Feedback({ command }: { command: Command }) {
  return (
    <>
      <Notice
        error={command.error}
        success={command.success}
        loading={command.busy}
      />
      {!command.pending && command.error.includes("another device") && (
        <button
          onClick={() => {
            if (
              confirm(
                "Reload saved phase data and discard unapplied form edits?",
              )
            )
              window.location.reload();
          }}
        >
          Reload Saved Phase
        </button>
      )}
      {command.pending && (
        <section className="save-warning" role="alert">
          <p>A phase save is unresolved. Further changes are blocked.</p>
          <button disabled={command.busy} onClick={() => void command.retry()}>
            Retry Phase Save
          </button>
        </section>
      )}
    </>
  );
}
function PhaseSummary({ phase }: { phase: EventPhase }) {
  return (
    <>
      <p className="phase-rules">
        {phase.match_type === "knockout" ? "Knockout" : "Standard"} ·{" "}
        {phase.target_score
          ? `First to ${phase.target_score} Points`
          : "No Target"}{" "}
        · {phase.duration_ms ? clockText(phase.duration_ms) : "Preset Required"}
      </p>
      <p>
        {phase.participant_count} Fencers · {phase.match_count} Matches ·{" "}
        {phase.completed_count} Completed
      </p>
      <span className={`phase-state state-${phase.state}`}>
        {phaseStateLabels[phase.state]}
      </span>
    </>
  );
}
export function PhaseManager() {
  const p = useHashParams(),
    data = usePhaseData();
  const event = p.get("event") ?? sessionStorage.getItem("event") ?? "",
    id = p.get("phase") ?? "",
    mode = p.get("mode") ?? "list",
    origin = p.get("origin") ?? "manage";
  const selected = data.phases.data.find(
      (ph) => ph.id === id && ph.event_id === event,
    ),
    e = data.events.data.find((e) => e.id === event);
  const rawCommand = usePhaseCommand(event, data.reload);
  const cmd = {
    ...rawCommand,
    blocked:
      rawCommand.blocked ||
      Boolean(e && !["draft", "active"].includes(e.status)) ||
      Boolean(selected?.is_archived),
  };
  const back =
    origin === "run"
      ? runPhaseUrl(event, id || undefined)
      : mode === "list"
        ? `#/events?mode=detail&id=${event}`
        : phaseUrl(event);
  const [showArchived, setShowArchived] = useState(false);
  return (
    <>
      {mode !== "create" && mode !== "edit" && (
        <a
          className="page-back secondary"
          href={back}
          onClick={(ev) => {
            if (cmd.busy || cmd.pending) ev.preventDefault();
          }}
        >
          ← Back
        </a>
      )}
      <Intro
        title={
          mode === "create"
            ? "Create Phase"
            : mode === "edit"
              ? "Edit Phase"
              : mode === "registration"
                ? "Phase Registration"
                : mode === "generator"
                  ? "Phase Schedule and Bracket"
                  : "Manage Phases"
        }
      />
      {mode === "list" && (
        <EventPicker
          events={data.events.data}
          id={event}
          onChange={(value) => {
            sessionStorage.setItem("event", value);
            window.location.hash = phaseUrl(value).slice(1);
          }}
        />
      )}
      <Notice error={data.error} loading={data.loading} />
      <Feedback command={cmd} />
      {e && <h3>{e.name}</h3>}
      {e &&
      (e.mode !== "traditional" || e.competition_format !== "individual") ? (
        <p>
          Phase match execution is available for individual Traditional events.
        </p>
      ) : (
        e &&
        !data.loading && (
          <>
            {!["draft", "active"].includes(e.status) && (
              <p>Reopen this event in Run Event before changing phase setup.</p>
            )}
            {mode === "list" ? (
              <>
                <div className="button-row">
                  <a
                    className="primary"
                    href={phaseUrl(event, undefined, "create")}
                  >
                    New Phase
                  </a>
                  <a
                    className="secondary"
                    href={`#/events?mode=relationships&id=${event}`}
                  >
                    Event Registration
                  </a>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(ev) => setShowArchived(ev.target.checked)}
                  />
                  Include Archived Phases
                </label>
                <div className="phase-grid">
                  {data.phases.data
                    .filter(
                      (ph) =>
                        ph.event_id === event &&
                        (showArchived || !ph.is_archived),
                    )
                    .sort(
                      (a, b) =>
                        a.position - b.position || a.name.localeCompare(b.name),
                    )
                    .map((ph) => (
                      <article
                        className={`card phase-tile state-${ph.state}`}
                        key={ph.id}
                      >
                        <h3>
                          {ph.name}
                          {ph.is_archived ? " · Archived" : ""}
                        </h3>
                        <PhaseSummary phase={ph} />
                        <div className="button-row">
                          <a href={phaseUrl(event, ph.id, "edit")}>Setup</a>
                          <a href={phaseUrl(event, ph.id, "registration")}>
                            Registration and Seeds
                          </a>
                          <a href={phaseUrl(event, ph.id, "generator")}>
                            Schedule / Bracket
                          </a>
                          <button
                            disabled={cmd.blocked}
                            onClick={() => {
                              if (
                                confirm(
                                  `${ph.is_archived ? "Restore" : "Archive"} ${ph.name}? Existing historical matches remain retained.`,
                                )
                              )
                                void cmd.execute(
                                  ph.is_archived ? "restore" : "archive",
                                  ph.id,
                                  ph.revision,
                                );
                            }}
                          >
                            {ph.is_archived ? "Restore" : "Archive"}
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
                {!data.phases.data.some(
                  (ph) => ph.event_id === event && !ph.is_archived,
                ) && (
                  <p>
                    No phases yet. Create a phase to assign fencers and a
                    preset.
                  </p>
                )}
              </>
            ) : mode === "create" || selected ? (
              <>
                {selected && (
                  <section className="card">
                    <h3>{selected.name}</h3>
                    <PhaseSummary phase={selected} />
                  </section>
                )}
                {mode === "create" || mode === "edit" ? (
                  <PhaseEditor
                    key={selected?.id ?? "new"}
                    event={e}
                    phase={selected}
                    presets={data.presets.data}
                    matches={data.matches.data}
                    command={cmd}
                  />
                ) : selected && mode === "registration" ? (
                  <PhaseRoster
                    key={selected.id}
                    phase={selected}
                    fencers={data.fencers.data.filter((f) =>
                      data.eventRegistrations.data.some(
                        (r) => r.event_id === event && r.fencer_id === f.id,
                      ),
                    )}
                    registrations={data.registrations.data.filter(
                      (r) => r.phase_id === id,
                    )}
                    command={cmd}
                  />
                ) : selected && mode === "generator" ? (
                  <PhaseGenerator
                    phase={selected}
                    registrations={data.registrations.data.filter(
                      (r) => r.phase_id === id,
                    )}
                    fencers={data.fencers.data}
                    matches={data.matches.data.filter((m) => m.phase_id === id)}
                    brackets={data.brackets.data.filter(
                      (b) => b.phase_id === id,
                    )}
                    command={cmd}
                  />
                ) : null}
              </>
            ) : (
              <p role="alert">Phase not found for this event.</p>
            )}
          </>
        )
      )}
    </>
  );
}
function PhaseEditor({
  event,
  phase,
  presets,
  matches,
  command,
}: {
  event: EventRecord;
  phase?: EventPhase;
  presets: Preset[];
  matches: MatchRow[];
  command: Command;
}) {
  const [id] = useState(() => phase?.id ?? crypto.randomUUID()),
    [revision] = useState(phase?.revision ?? null);
  const [name, setName] = useState(phase?.name ?? ""),
    [kind, setKind] = useState(phase?.kind ?? "group"),
    [preset, setPreset] = useState(phase?.preset_id ?? event.preset_id ?? ""),
    [position, setPosition] = useState(phase?.position ?? 1);
  const original = JSON.stringify({
      name: phase?.name ?? "",
      kind: phase?.kind ?? "group",
      preset: phase?.preset_id ?? event.preset_id ?? "",
      position: phase?.position ?? 1,
    }),
    dirty = original !== JSON.stringify({ name, kind, preset, position });
  const count = matches.filter(
    (m) =>
      m.phase_id === id &&
      !m.is_archived &&
      !m.started_at &&
      (!m.is_void || m.is_bye),
  ).length;
  return (
    <form
      className="card editor"
      onSubmit={async (ev) => {
        ev.preventDefault();
        if (
          phase &&
          preset !== phase.preset_id &&
          !confirm(
            `Update ${count} unplayed fixtures to this phase preset? Played matches keep their snapshots; active referee claims block the change.`,
          )
        )
          return;
        if (
          await command.execute(phase ? "edit" : "create", id, revision, {
            name,
            kind,
            presetId: preset,
            position,
            presetUpdatedAt: presets.find((p) => p.id === preset)?.updated_at,
          })
        )
          window.location.hash = phaseUrl(event.id).slice(1);
      }}
    >
      <fieldset
        disabled={
          command.blocked || !["draft", "active"].includes(event.status)
        }
      >
        <label>
          Phase Name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(ev) => setName(ev.target.value)}
          />
        </label>
        <label>
          Scheduling Format
          <select
            aria-label="Scheduling Format"
            value={kind}
            disabled={Boolean(
              phase && matches.some((m) => m.phase_id === id && !m.is_archived),
            )}
            onChange={(ev) => setKind(ev.target.value as EventPhase["kind"])}
          >
            <option value="group">Round Robin</option>
            <option value="single">Single Elimination</option>
            {phase?.kind === "double" && (
              <option value="double">Double Elimination (Existing)</option>
            )}
          </select>
        </label>
        <label>
          Phase Preset
          <select
            aria-label="Phase Preset"
            required
            value={preset}
            onChange={(ev) => setPreset(ev.target.value)}
          >
            <option value="">Choose Preset</option>
            {[...presets]
              .filter(
                (p) =>
                  !p.is_archived &&
                  p.mode === "traditional" &&
                  (kind === "group" || p.match_type === "knockout"),
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} ·{" "}
                  {p.match_type === "knockout" ? "Knockout" : "Standard"} ·{" "}
                  {clockText(p.duration_ms)} · {p.target_score ?? "No Target"}
                </option>
              ))}
          </select>
        </label>
        <label>
          Phase Display Order
          <input
            type="number"
            min={1}
            max={10000}
            required
            value={position}
            onChange={(ev) => setPosition(Number(ev.target.value))}
          />
        </label>
        <p>
          Saving phase settings updates {count} safe unplayed fixtures. Played
          settings remain preserved.
        </p>
        <button className="primary">
          {phase ? "Save Phase" : "Create Phase"}
        </button>
      </fieldset>
      <a
        className="secondary"
        href={phaseUrl(event.id)}
        onClick={(ev) => {
          if (
            command.busy ||
            command.pending ||
            (dirty && !confirm("Discard unsaved phase changes?"))
          )
            ev.preventDefault();
        }}
      >
        Cancel
      </a>
    </form>
  );
}
function PhaseRoster({
  phase,
  fencers,
  registrations,
  command,
}: {
  phase: EventPhase;
  fencers: Fencer[];
  registrations: PhaseRegistration[];
  command: Command;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const list = [...fencers]
    .filter(
      (f) =>
        !f.is_unregistered &&
        (!f.is_archived || registrations.some((r) => r.fencer_id === f.id)) &&
        f.display_name.toLowerCase().includes(search.toLowerCase()) &&
        (filter === "all" ||
          registrations.some((r) => r.fencer_id === f.id) ===
            (filter === "registered")),
    )
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  return (
    <section className="card">
      <p>
        Fencers must first be registered for this event. Assignments to other
        phases remain unchanged. Seed edits apply to the next generation; the
        saved bracket keeps its existing placements.
      </p>
      <a href={`#/events?mode=relationships&id=${phase.event_id}`}>
        Manage Event Registration
      </a>
      <div className="fields">
        <label>
          Find Phase Fencers
          <input
            type="search"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
          />
        </label>
        <label>
          Phase Registration Filter
          <select
            aria-label="Phase Registration Filter"
            value={filter}
            onChange={(ev) => setFilter(ev.target.value)}
          >
            <option value="all">All</option>
            <option value="registered">Registered</option>
            <option value="unregistered">Unregistered</option>
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Affiliation</th>
              <th>Seed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((f) => {
              const registration = registrations.find(
                (r) => r.fencer_id === f.id,
              );
              return (
                <tr key={f.id}>
                  <td>
                    {f.display_name}
                    {f.is_archived ? " · Archived" : ""}
                  </td>
                  <td>{f.affiliation}</td>
                  <td>
                    {registration ? (
                      <SeedEditor
                        key={`${f.id}:${registration.seed}`}
                        fencer={f}
                        registration={registration}
                        phase={phase}
                        command={command}
                      />
                    ) : (
                      "Not Registered"
                    )}
                  </td>
                  <td>
                    <button
                      disabled={
                        command.blocked || (!registration && f.is_archived)
                      }
                      onClick={() =>
                        void command.execute(
                          registration ? "unregister" : "register",
                          phase.id,
                          phase.revision,
                          { fencerId: f.id, seed: null },
                        )
                      }
                    >
                      {registration ? "Remove" : "Add"} {f.display_name}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!list.length && <p>No matching event registrants.</p>}
    </section>
  );
}
function SeedEditor({
  fencer,
  registration,
  phase,
  command,
}: {
  fencer: Fencer;
  registration: PhaseRegistration;
  phase: EventPhase;
  command: Command;
}) {
  const [seed, setSeed] = useState(String(registration.seed ?? ""));
  return (
    <form
      className="seed-editor"
      onSubmit={(ev) => {
        ev.preventDefault();
        void command.execute("register", phase.id, phase.revision, {
          fencerId: fencer.id,
          seed: seed ? Number(seed) : null,
        });
      }}
    >
      <input
        aria-label={`Seed for ${fencer.display_name}`}
        type="number"
        min={1}
        max={128}
        value={seed}
        onChange={(ev) => setSeed(ev.target.value)}
        disabled={command.blocked}
      />
      <button
        disabled={command.blocked || seed === String(registration.seed ?? "")}
      >
        Save Seed
      </button>
    </form>
  );
}
function PhaseGenerator({
  phase,
  registrations,
  fencers,
  matches,
  brackets,
  command,
}: {
  phase: EventPhase;
  registrations: PhaseRegistration[];
  fencers: Fencer[];
  matches: MatchRow[];
  brackets: PhaseBracket[];
  command: Command;
}) {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [archived, setArchived] = useState(false);
  const current = matches.filter((m) => !m.is_archived),
    members = [...registrations].sort(
      (a, b) => (a.seed ?? 999) - (b.seed ?? 999),
    );
  const selectedBracket = brackets
    .filter((b) => archived || !b.is_archived)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <section className="card">
      <h3>Seeded Schedule</h3>
      <p>
        {phase.kind === "group"
          ? "Round Robin"
          : phase.kind === "double"
            ? "Double Elimination"
            : "Single Elimination"}{" "}
        · {current.length} current matches will be archived on regeneration,
        including manual and completed matches.
      </p>
      <ol>
        {members.map((r) => (
          <li key={r.fencer_id}>
            {fencers.find((f) => f.id === r.fencer_id)?.display_name ??
              "Retained Fencer"}{" "}
            · {r.seed ? `Seed ${r.seed}` : "Seed Required"}
          </li>
        ))}
      </ol>
      <div className="button-row">
        <button
          className="primary"
          disabled={
            command.blocked ||
            members.length < 2 ||
            members.some((r) => !r.seed)
          }
          onClick={() => {
            if (
              confirm(
                `Generate a new schedule for ${phase.name}? Archive ALL ${current.length} current matches in this phase, including manual and played matches. Other phases and historical records remain preserved.`,
              )
            )
              void command.execute("generate", phase.id, phase.revision, {
                confirmArchive: true,
              });
          }}
        >
          Generate Phase Schedule
        </button>
        <button
          className="danger"
          disabled={command.blocked || !current.length}
          onClick={() => {
            if (
              confirm(
                `Archive every current match in ${phase.name} without generating replacements? History remains preserved.`,
              )
            )
              void command.execute(
                "archive_schedule",
                phase.id,
                phase.revision,
                { confirmArchive: true },
              );
          }}
        >
          Archive Current Schedule
        </button>
      </div>
      <h3>Manual Pairing</h3>
      <form
        className="fields"
        onSubmit={(ev) => {
          ev.preventDefault();
          void command.execute("manual", phase.id, phase.revision, {
            leftId: left,
            rightId: right,
          });
        }}
      >
        {(["left", "right"] as const).map((side) => (
          <label key={side}>
            {side === "left" ? "Left Fencer" : "Right Fencer"}
            <select
              aria-label={`Manual ${side} Fencer`}
              required
              value={side === "left" ? left : right}
              disabled={command.blocked}
              onChange={(ev) =>
                (side === "left" ? setLeft : setRight)(ev.target.value)
              }
            >
              <option value="">Choose Fencer</option>
              {members.map((r) => (
                <option value={r.fencer_id} key={r.fencer_id}>
                  {fencers.find((f) => f.id === r.fencer_id)?.display_name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button disabled={command.blocked || left === right}>
          Add Manual Match
        </button>
      </form>
      <label className="check">
        <input
          type="checkbox"
          checked={archived}
          onChange={(ev) => setArchived(ev.target.checked)}
        />
        Include Archived Generations
      </label>
      {selectedBracket.map((b) => (
        <details key={b.id} open={!b.is_archived}>
          <summary>
            {b.is_archived ? "Archived" : "Current"} Bracket ·{" "}
            {new Date(b.created_at).toLocaleString()}
          </summary>
          <BracketView bracket={b} matches={matches} fencers={fencers} />
        </details>
      ))}
    </section>
  );
}

export function PhaseRunner() {
  const p = useHashParams(),
    data = usePhaseData(),
    event = p.get("event") ?? sessionStorage.getItem("event") ?? "",
    id = p.get("phase") ?? "",
    selected = data.phases.data.find(
      (ph) => ph.id === id && ph.event_id === event,
    ),
    e = data.events.data.find((e) => e.id === event);
  const [standings, setStandings] = useState<Standing[]>([]),
    [standingsError, setStandingsError] = useState(""),
    [includeArchived, setIncludeArchived] = useState(false);
  const lifecycle = useAction(data.reload);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void data.reload();
    }, 5000);
    return () => clearInterval(timer);
  }, [data.reload]);
  useEffect(() => {
    let alive = true;
    if (selected)
      void rpc<Standing[]>("phase_standings", { p_phase: selected.id })
        .then((s) => {
          if (alive) {
            setStandings(s);
            setStandingsError("");
          }
        })
        .catch((err) => {
          if (alive) setStandingsError(String(err.message ?? err));
        });
    else setStandings([]);
    return () => {
      alive = false;
    };
  }, [
    selected?.id,
    selected?.completed_count,
    selected?.revision,
    data.matches.data,
  ]);
  const open = (m: MatchRow) => {
    sessionStorage.setItem("event", event);
    sessionStorage.setItem("phase", m.phase_id ?? "");
    sessionStorage.setItem("openMatch", m.id);
    window.location.hash = "/single-match";
  };
  const list = sortedPhaseMatches(
    data.matches.data.filter(
      (m) => m.phase_id === id && (includeArchived || !m.is_archived),
    ),
  );
  return (
    <>
      {id && (
        <a className="page-back secondary" href={runPhaseUrl(event)}>
          ← Back
        </a>
      )}
      <Intro title={selected ? selected.name : "Run Event"} />
      <EventPicker
        events={data.events.data}
        id={event}
        onChange={(value) => {
          sessionStorage.setItem("event", value);
          window.location.hash = runPhaseUrl(value).slice(1);
        }}
      />
      <Notice error={data.error || standingsError} loading={data.loading} />
      {e && (
        <>
          <section className="card event-run-heading">
            <h3>{e.name}</h3>
            <p>Event Status: {e.status}</p>
            <div className="button-row">
              {["draft", "active", "completed"]
                .filter((s) => s !== e.status)
                .map((status) => (
                  <button
                    disabled={lifecycle.busy}
                    key={status}
                    onClick={() => {
                      if (
                        confirm(
                          `Change ${e.name} to ${status}? Completing freezes results; reopening preserves prior versions.`,
                        )
                      )
                        void lifecycle.run(() =>
                          rpc("set_event_status", {
                            p_event: event,
                            p_status: status,
                          }),
                        );
                    }}
                  >
                    {status === "active"
                      ? e.status === "completed"
                        ? "Reopen Event"
                        : "Activate Event"
                      : status === "completed"
                        ? "Complete Event"
                        : "Return to Draft"}
                  </button>
                ))}
            </div>
            <Notice error={lifecycle.error} success={lifecycle.status} />
          </section>
          {e.mode !== "traditional" || e.competition_format !== "individual" ? (
            <p>Team and Control Point execution remain planning only.</p>
          ) : !id ? (
            <>
              <div className="button-row">
                <a className="secondary" href={phaseUrl(event)}>
                  Manage Phases
                </a>
                <a
                  className="secondary"
                  href={`#/events?mode=relationships&id=${event}`}
                >
                  Manage Event Registration
                </a>
              </div>
              <div className="phase-grid">
                {data.phases.data
                  .filter((ph) => ph.event_id === event && !ph.is_archived)
                  .sort(
                    (a, b) =>
                      a.position - b.position || a.name.localeCompare(b.name),
                  )
                  .map((ph) => (
                    <a
                      className={`card phase-tile state-${ph.state}`}
                      href={runPhaseUrl(event, ph.id)}
                      key={ph.id}
                    >
                      <h3>{ph.name}</h3>
                      <PhaseSummary phase={ph} />
                    </a>
                  ))}
              </div>
              {!data.loading &&
                !data.phases.data.some(
                  (ph) => ph.event_id === event && !ph.is_archived,
                ) && <p>No phases yet. Add them under Manage Phases.</p>}
            </>
          ) : selected ? (
            <>
              <section className="card">
                <PhaseSummary phase={selected} />
                <div className="button-row">
                  <a
                    className="secondary"
                    href={phaseUrl(event, id, "registration", "run")}
                  >
                    Phase Registration
                  </a>
                  <a
                    className="secondary"
                    href={phaseUrl(event, id, "generator", "run")}
                  >
                    Bracket Generator
                  </a>
                </div>
                <details>
                  <summary>Registered Fencers</summary>
                  <ul>
                    {data.registrations.data
                      .filter((r) => r.phase_id === id)
                      .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
                      .map((r) => (
                        <li key={r.fencer_id}>
                          {
                            data.fencers.data.find((f) => f.id === r.fencer_id)
                              ?.display_name
                          }{" "}
                          · {r.seed ? `Seed ${r.seed}` : "No Seed"}
                        </li>
                      ))}
                  </ul>
                </details>
              </section>
              <section className="card">
                <h3>Phase Matches</h3>
                <p>
                  Next runnable scheduled match first; remaining matches follow
                  schedule order.
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={includeArchived}
                    onChange={(ev) => setIncludeArchived(ev.target.checked)}
                  />
                  Include Archived Matches
                </label>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Match</th>
                        <th>Score</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((m) => (
                        <tr key={m.id}>
                          <td>{m.match_sequence}</td>
                          <td>
                            {m.current_left_name} vs {m.current_right_name}
                          </td>
                          <td>
                            {m.left_score} – {m.right_score}
                          </td>
                          <td>
                            {m.is_archived
                              ? "Archived"
                              : m.is_bye
                                ? "Bye"
                                : m.is_void
                                  ? "Void"
                                  : m.finalized_at
                                    ? "Complete"
                                    : !m.schedule_ready
                                      ? "Waiting for Results"
                                      : m.phase === "running"
                                        ? "Running"
                                        : m.started_at
                                          ? "In Progress"
                                          : "Scheduled"}
                          </td>
                          <td>
                            <button
                              disabled={
                                m.is_archived ||
                                m.is_void ||
                                !m.schedule_ready ||
                                (e.status !== "active" && !m.finalized_at)
                              }
                              onClick={() => open(m)}
                            >
                              {m.finalized_at
                                ? "Open Report / Correct"
                                : "Run Match"}
                            </button>
                            <button
                              className="danger"
                              disabled={
                                m.is_archived ||
                                m.is_void ||
                                e.status !== "active" ||
                                lifecycle.busy
                              }
                              onClick={() => {
                                if (
                                  confirm(
                                    "Void this match? It will stop counting; calls and audit remain retained. Downstream conflicts prevent invalid changes.",
                                  )
                                )
                                  void lifecycle.run(() =>
                                    rpc("void_match", { p_id: m.id }),
                                  );
                              }}
                            >
                              Void
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!list.length && <p>No scheduled matches in this phase.</p>}
              </section>
              {data.brackets.data
                .filter((b) => b.phase_id === id && !b.is_archived)
                .map((b) => (
                  <BracketView
                    key={b.id}
                    bracket={b}
                    matches={data.matches.data}
                    fencers={data.fencers.data}
                    onOpen={e.status === "active" ? open : undefined}
                  />
                ))}
              <section className="card">
                <h3>Phase Results</h3>
                <StandingsTable data={standings} />
              </section>
            </>
          ) : (
            !data.loading && <p role="alert">Phase not found for this event.</p>
          )}
        </>
      )}
    </>
  );
}
