import { useState } from "react";
import { useAccount } from "./Auth";
import {
  db,
  rpc,
  write,
  type EventRecord,
  type Fencer,
  type Preset,
  type Standing,
  type MatchRow,
} from "./data";
import { bracketGraph } from "./tournament";
import { ArchiveFilter, BackLink, Intro, Notice, Search, useAction, useRows } from "./ui";
export function useEventSelection() {
  const r = useRows<EventRecord>("tEvent");
  const [id, setIdValue] = useState(
    () => sessionStorage.getItem("event") ?? "",
  );
  function setId(id: string) {
    sessionStorage.setItem("event", id);
    setIdValue(id);
  }
  return { ...r, id, setId, event: r.data.find((e) => e.id === id) };
}
export function EventPicker({
  events,
  id,
  onChange,
  archived = false,
}: {
  events: EventRecord[];
  id: string;
  onChange: (id: string) => void;
  archived?: boolean;
}) {
  return (
    <label className="search">
      Event
      <select value={id} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select an event</option>
        {events
          .filter((e) => archived || e.status !== "archived")
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
            a.id.localeCompare(b.id),
          )
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.status}
            </option>
          ))}
      </select>
    </label>
  );
}
export function StandingsTable({ data }: { data: Standing[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fencer</th>
            <th>W</th>
            <th>L</th>
            <th>D</th>
            <th>Matches</th>
            <th>Points</th>
            <th>Difference</th>
          </tr>
        </thead>
        <tbody>
          {data.map((s) => (
            <tr key={s.id}>
              <td>{s.display_name}</td>
              <td>{s.wins}</td>
              <td>{s.losses}</td>
              <td>{s.draws}</td>
              <td>{s.matches}</td>
              <td>{s.points_for}</td>
              <td>{s.differential}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Registration({ eventId }: { eventId: string }) {
  const f = useRows<Fencer>("tFencer");
  const r = useRows<{ event_id: string; fencer_id: string }>("tEventFencer");
  const a = useAction(r.reload);
  const [search, setSearch] = useState("");
  const [registrationFilter, setRegistrationFilter] = useState("all");
  const registeredIds = new Set(r.data.filter((x) => x.event_id === eventId).map((x) => x.fencer_id));
  const visible = f.data.filter((competitor) =>
    !competitor.is_unregistered &&
    !competitor.is_archived &&
    competitor.display_name.toLowerCase().includes(search.toLowerCase()) &&
    (registrationFilter === "all" ||
      registeredIds.has(competitor.id) === (registrationFilter === "registered")),
  ).sort((a, b) =>
    a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" }) ||
    a.id.localeCompare(b.id),
  );
  return (
    <section>
      <h3>Event registrations</h3>
      <Search value={search} onChange={setSearch} />
      <label>
        Registration status
        <select value={registrationFilter} onChange={(e) => setRegistrationFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="registered">Registered</option>
          <option value="unregistered">Unregistered</option>
        </select>
      </label>
      <p role="status">{r.loading || f.loading ? "Loading competitors…" : `Showing ${visible.length} eligible fencers`}</p>
      <Notice error={r.error || f.error} />
      <div className="selection-list">
        {visible.map((f) => {
            const exists = registeredIds.has(f.id);
            return (
              <label className="check" key={f.id}>
                <input
                  type="checkbox"
                  checked={exists}
                  disabled={a.busy || r.loading}
                  onChange={() =>
                    void a.run(async () => {
                      const q = exists
                        ? db()
                            .from("tEventFencer")
                            .delete()
                            .eq("event_id", eventId)
                            .eq("fencer_id", f.id)
                        : db()
                            .from("tEventFencer")
                            .insert({ event_id: eventId, fencer_id: f.id });
                      const { error } = await q;
                      if (error) throw error;
                    })
                  }
                />
                {f.display_name} {f.affiliation && <small>({f.affiliation})</small>}
              </label>
            );
          })}
      </div>
      <Notice error={a.error} success={a.status} />
    </section>
  );
}
interface Phase {
  id: string;
  event_id: string;
  name: string;
  kind: string;
  position: number;
  preset_id: string | null;
  is_archived: boolean;
}
interface Group {
  id: string;
  phase_id: string;
  name: string;
}
interface Member {
  group_id: string;
  fencer_id: string;
}
interface Bracket {
  id: string;
  phase_id: string;
  format: string;
  is_archived: boolean;
  graph: unknown;
  created_at: string;
}
/** Lifecycle controls are operational actions belonging to Run Event. */
export function EventStatus({ event, onDone }: { event: EventRecord; onDone: () => Promise<void> }) {
  const a = useAction(onDone);
  return (
    <section aria-label="Event lifecycle">
      <h3>Event Status: {event.status}</h3>
      <div className="button-row">
        {["draft", "active", "completed"].filter((s) => s !== event.status).map((s) => (
          <button type="button" key={s} disabled={a.busy}
            onClick={() => {
              if (window.confirm(`Change ${event.name} to ${s}? Completing freezes standings; reopening preserves prior versions.`))
                void a.run(() => rpc("set_event_status", { p_event: event.id, p_status: s }));
            }}>
            {s === "active" && event.status === "completed" ? "Reopen" : s === "active" ? "Activate" : s === "completed" ? "Complete" : "Return to Draft"}
          </button>
        ))}
      </div>
      <Notice error={a.error} success={a.status} />
    </section>
  );
}
export function RunEvent() {
  const { profile } = useAccount();
  const e = useEventSelection();
  const phases = useRows<Phase>("tEventPhase");
  const groups = useRows<Group>("tEventGroup");
  const members = useRows<Member>("tEventGroupFencer");
  const entrants = useRows<{ event_id: string; fencer_id: string }>(
    "tEventFencer",
  );
  const f = useRows<Fencer>("tFencer");
  const matches = useRows<MatchRow>("vMatchResults");
  const brackets = useRows<Bracket>("tBracket");
  const presets = useRows<Preset>("tMatchPreset");
  const [phase, setPhase] = useState("");
  const [group, setGroup] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("group");
  const [preset, setPreset] = useState("");
  const [seeds, setSeeds] = useState<string[]>([]);
  const [standing, setStanding] = useState<Standing[]>([]);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [archived, setArchived] = useState(false);
  const a = useAction(async () => {
    await Promise.all([
      phases.reload(),
      groups.reload(),
      members.reload(),
      matches.reload(),
      brackets.reload(),
      entrants.reload(),
    ]);
    if (e.id)
      setStanding(
        await rpc<Standing[]>("standings", {
          p_event: e.id,
          p_group: group || null,
        }),
      );
  });
  const ph = phases.data.find((p) => p.id === phase);
  const registered = f.data.filter((f) =>
    entrants.data.some((x) => x.event_id === e.id && x.fencer_id === f.id),
  );
  async function voidMatch(id: string) {
    if (
      window.confirm(
        "Void this match? Its result will stop counting; calls and audit history are retained.",
      )
    )
      await a.run(() => rpc("void_match", { p_id: id }));
  }
  const eventMatches = matches.data.filter(
    (m) => m.event_id === e.id && (archived || (!m.is_archived && !m.is_void)),
  );
  function runMatch(m: MatchRow) {
    sessionStorage.setItem("openMatch", m.id);
    window.location.hash = "/single-match";
  }
  return (
    <>
      {new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("from") === "events" ? (
        <BackLink href="#/events" />
      ) : window.location.hash.split("?")[0].replace(/^#/, "") !== "/run-event" ? (
        <BackLink href="#/run-event" />
      ) : null}
      <Intro title="Run Event">
        Select the event to manage its lifecycle and run scheduled matches.
      </Intro>
      <EventPicker
        events={e.data}
        id={e.id}
        onChange={(id) => {
          e.setId(id);
          setPhase("");
          setGroup("");
          setSeeds([]);
          setStanding([]);
        }}
      />
      <Notice
        error={
          e.error ||
          phases.error ||
          matches.error ||
          brackets.error ||
          f.error ||
          groups.error ||
          members.error ||
          entrants.error ||
          presets.error
        }
      />
      {e.event && (
        <section className="card">
          <EventStatus event={e.event} onDone={e.reload} />
        </section>
      )}
      {e.event &&
      (e.event.mode !== "traditional" ||
        e.event.competition_format !== "individual") ? (
        <section className="card">
          <p>
            Team match processing and Control Point rules are deferred. Team
            rosters can be managed under Manage Events.
          </p>
        </section>
      ) : (
        e.event && (
          <>
            <section className="card">
              <p>
                {e.event.name} · {e.event.status}
              </p>
              {e.event.status !== "active" && (
                <p>
                  Use the lifecycle controls above to activate or reopen the event before
                  running matches.
                </p>
              )}
              <p>
                {registered.length} registered fencers.{" "}
                <a href={`#/events?mode=relationships&id=${encodeURIComponent(e.id)}`}>
                  Manage Event Registrations
                </a>
              </p>
              <h3>Competition phases</h3>
              <form
                className="editor inline-editor"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void a.run(() =>
                    write("tEventPhase", {
                      event_id: e.id,
                      name,
                      kind,
                      position:
                        phases.data.filter((p) => p.event_id === e.id).length +
                        1,
                      preset_id: preset || null,
                    }),
                  );
                }}
              >
                <label>
                  Phase name
                  <input
                    required
                    value={name}
                    onChange={(ev) => setName(ev.target.value)}
                  />
                </label>
                <label>
                  Format
                  <select
                    value={kind}
                    onChange={(ev) => setKind(ev.target.value)}
                  >
                    <option value="group">Group round robin</option>
                    <option value="single">Single elimination</option>
                    <option value="double">Double elimination</option>
                  </select>
                </label>
                <label>
                  Phase preset
                  <select
                    value={preset}
                    onChange={(ev) => setPreset(ev.target.value)}
                  >
                    <option value="">Use event default</option>
                    {presets.data
                      .filter((p) => !p.is_archived && p.mode === "traditional")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="primary" disabled={a.busy}>
                  Add phase
                </button>
              </form>
              <label>
                Selected phase
                <select
                  value={phase}
                  onChange={(ev) => {
                    setPhase(ev.target.value);
                    setGroup("");
                    setSeeds([]);
                  }}
                >
                  <option value="">Choose phase</option>
                  {phases.data
                    .filter((p) => p.event_id === e.id && !p.is_archived)
                    .sort((a, b) => a.position - b.position)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.position}. {p.name} · {p.kind}
                      </option>
                    ))}
                </select>
              </label>
              {ph?.kind === "group" && (
                <>
                  <form
                    className="editor inline-editor"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      void a.run(() =>
                        write("tEventGroup", { phase_id: phase, name }),
                      );
                    }}
                  >
                    <label>
                      New group name
                      <input
                        required
                        value={name}
                        onChange={(ev) => setName(ev.target.value)}
                      />
                    </label>
                    <button className="subtle" disabled={a.busy}>
                      Add group
                    </button>
                  </form>
                  <label>
                    Group
                    <select
                      value={group}
                      onChange={(ev) => {
                        setGroup(ev.target.value);
                        setStanding([]);
                      }}
                    >
                      <option value="">All groups / event standings</option>
                      {groups.data
                        .filter((g) => g.phase_id === phase)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {group && (
                    <div className="selection-list">
                      {registered.map((f) => {
                        const exists = members.data.some(
                          (m) => m.group_id === group && m.fencer_id === f.id,
                        );
                        return (
                          <label className="check" key={f.id}>
                            <input
                              type="checkbox"
                              disabled={a.busy}
                              checked={exists}
                              onChange={() =>
                                void a.run(async () => {
                                  const { error } = await (exists
                                    ? db()
                                        .from("tEventGroupFencer")
                                        .delete()
                                        .eq("group_id", group)
                                        .eq("fencer_id", f.id)
                                    : db().from("tEventGroupFencer").insert({
                                        group_id: group,
                                        fencer_id: f.id,
                                      }));
                                  if (error) throw error;
                                })
                              }
                            />
                            {f.display_name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              <div className="button-row">
                <button
                  className="subtle"
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(async () =>
                      setStanding(
                        await rpc<Standing[]>("standings", {
                          p_event: e.id,
                          p_group: group || null,
                        }),
                      ),
                    )
                  }
                >
                  Refresh standings
                </button>
              </div>
              <StandingsTable data={standing} />
              <p className="muted">
                Wins rank first. Equal configured criteria remain tied;
                displayed name order does not award advancement. Management
                chooses qualifiers.
              </p>
              {ph && (
                <>
                  <h3>
                    {ph.kind === "group"
                      ? "Generate group fixtures"
                      : "Bracket placements"}
                  </h3>
                  {ph.kind !== "group" && (
                    <>
                      <div className="button-row">
                        {registered
                          .filter((f) => !seeds.includes(f.id))
                          .map((f) => (
                            <button
                              className="subtle"
                              key={f.id}
                              onClick={() => setSeeds([...seeds, f.id])}
                            >
                              Add {f.display_name}
                            </button>
                          ))}
                      </div>
                      <ol>
                        {seeds.map((id, i) => (
                          <li key={id}>
                            {f.data.find((f) => f.id === id)?.display_name}{" "}
                            <button
                              className="icon-btn"
                              onClick={() =>
                                setSeeds(seeds.filter((x) => x !== id))
                              }
                            >
                              Remove
                            </button>
                            {i > 0 && (
                              <button
                                className="icon-btn"
                                onClick={() => {
                                  const s = [...seeds];
                                  [s[i - 1], s[i]] = [s[i], s[i - 1]];
                                  setSeeds(s);
                                }}
                              >
                                Move up
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  <button
                    className="primary"
                    disabled={
                      a.busy ||
                      e.event.status !== "active" ||
                      (ph.kind === "group" && !group)
                    }
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Generate fresh matches? Any prior generation for this bracket/group, including completed results, will be archived.",
                        )
                      )
                        return;
                      void a.run(async () => {
                        const ids =
                          ph.kind === "group"
                            ? members.data
                                .filter((m) => m.group_id === group)
                                .map((m) => m.fencer_id)
                            : seeds;
                        const graph =
                          ph.kind === "group"
                            ? {
                                entrants: ids,
                                nodes: ids.flatMap((_, i) =>
                                  ids.slice(i + 1).map((_, j) => ({
                                    key: `G${i}.${i + j + 1}`,
                                    left: { seed: i },
                                    right: { seed: i + j + 1 },
                                  })),
                                ),
                              }
                            : bracketGraph(ids, ph.kind === "double");
                        const b = await rpc<string>("generate_bracket", {
                          p_phase: phase,
                          p_graph: graph,
                          p_format: ph.kind,
                          p_group: ph.kind === "group" ? group : null,
                        });
                        await rpc("sync_bracket", { p_bracket: b });
                      });
                    }}
                  >
                    Generate / regenerate
                  </button>
                </>
              )}
              <h3>Manual pairing</h3>
              <div className="editor inline-editor">
                <label>
                  Left
                  <select
                    value={left}
                    onChange={(ev) => setLeft(ev.target.value)}
                  >
                    <option value="">Choose fencer</option>
                    {registered.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Right
                  <select
                    value={right}
                    onChange={(ev) => setRight(ev.target.value)}
                  >
                    <option value="">Choose fencer</option>
                    {registered.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="subtle"
                  disabled={
                    a.busy ||
                    !left ||
                    !right ||
                    left === right ||
                    e.event.status !== "active"
                  }
                  onClick={() =>
                    void a.run(async () => {
                      const p = presets.data.find(
                        (p) => p.id === (ph?.preset_id ?? e.event!.preset_id),
                      );
                      if (!p) throw new Error("Choose a default preset first");
                      await write("tTraditionalMatch", {
                        owner_id: profile.id,
                        event_id: e.id,
                        event_name: e.event!.name,
                        left_fencer_id: left,
                        right_fencer_id: right,
                        left_name: f.data.find((f) => f.id === left)!
                          .display_name,
                        right_name: f.data.find((f) => f.id === right)!
                          .display_name,
                        phase_id: phase || null,
                        group_id: group || null,
                        preset_id: p.id,
                        duration_ms: p.duration_ms,
                        remaining_ms: p.duration_ms,
                        target_score: p.target_score,
                      });
                    })
                  }
                >
                  Schedule match
                </button>
              </div>
              <Notice error={a.error} success={a.status} />
            </section>
            <section className="card">
              <h3>Matches & bracket generations</h3>
              {eventMatches.some(
                (m) =>
                  !m.is_archived &&
                  !m.is_void &&
                  m.phase === "ended" &&
                  !m.finalized_at,
              ) && (
                <p role="alert">
                  Some ended matches have unresolved results. Open them to
                  assign a winner or correct the result before advancing.
                </p>
              )}
              <ArchiveFilter checked={archived} onChange={setArchived} />
              {brackets.data
                .filter(
                  (b) =>
                    phases.data.some(
                      (p) => p.id === b.phase_id && p.event_id === e.id,
                    ) &&
                    (archived || !b.is_archived),
                )
                .map((b) => (
                  <div className="button-row" key={b.id}>
                    <span>
                      {b.format} · {phases.data.find((p) => p.id === b.phase_id)?.name ?? "Event phase"}
                      {b.is_archived ? " · Archived" : ""}
                    </span>
                    {!b.is_archived && (
                      <button
                        className="subtle"
                        disabled={a.busy}
                        onClick={() =>
                          void a.run(() =>
                            rpc("sync_bracket", { p_bracket: b.id }),
                          )
                        }
                      >
                        Advance resolved matches
                      </button>
                    )}
                  </div>
                ))}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Competitors</th>
                      <th>Score</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventMatches.map((m) => (
                      <tr key={m.id}>
                        <td>{m.slot_key ?? "Manual"}</td>
                        <td>
                          {m.current_left_name} / {m.current_right_name}
                        </td>
                        <td>
                          {m.left_score}–{m.right_score}
                        </td>
                        <td>
                          {m.is_archived
                            ? "Archived"
                            : m.is_void
                              ? "Bye / void"
                              : m.finalized_at
                                ? "Final"
                                : m.phase}
                        </td>
                        <td>
                          <button
                            className="subtle"
                            disabled={
                              m.is_archived ||
                              m.is_void ||
                              !m.left_fencer_id ||
                              !m.right_fencer_id
                            }
                            onClick={() => runMatch(m)}
                          >
                            Open
                          </button>
                          {!m.is_archived && !m.is_void && (
                            <button
                              className="danger"
                              disabled={a.busy}
                              aria-label={`Void match: ${m.current_left_name} vs ${m.current_right_name}`}
                              onClick={() => void voidMatch(m.id)}
                            >
                              Void
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      )}
    </>
  );
}
