import { useState } from "react";
import { db, type EventRecord, type Fencer, type Standing } from "./data";
import { competitorLabel, Notice, Search, useAction, useRows } from "./ui";
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
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name, undefined, {
                sensitivity: "base",
              }) || a.id.localeCompare(b.id),
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
  const allFencers = f.data;
  const r = useRows<{ event_id: string; fencer_id: string }>("tEventFencer");
  const a = useAction(r.reload);
  const [search, setSearch] = useState("");
  const [registrationFilter, setRegistrationFilter] = useState("all");
  const registeredIds = new Set(
    r.data.filter((x) => x.event_id === eventId).map((x) => x.fencer_id),
  );
  const visible = f.data
    .filter(
      (competitor) =>
        !competitor.is_unregistered &&
        (!competitor.is_archived || registeredIds.has(competitor.id)) &&
        `${competitor.display_name} ${competitor.affiliation}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()) &&
        (registrationFilter === "all" ||
          registeredIds.has(competitor.id) ===
            (registrationFilter === "registered")),
    )
    .sort(
      (a, b) =>
        a.display_name.localeCompare(b.display_name, undefined, {
          sensitivity: "base",
        }) || a.id.localeCompare(b.id),
    );
  return (
    <section>
      <h3>Event registrations</h3>
      <Search value={search} onChange={setSearch} />
      <label>
        Registration status
        <select
          value={registrationFilter}
          onChange={(e) => setRegistrationFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="registered">Registered</option>
          <option value="unregistered">Unregistered</option>
        </select>
      </label>
      <p role="status">
        {r.loading || f.loading
          ? "Loading competitors…"
          : `Showing ${visible.length} fencers (${registeredIds.size} registered in this event)`}
      </p>
      <Notice error={r.error || f.error} />
      <div className="selection-list">
        {visible.map((f) => {
          const exists = registeredIds.has(f.id);
          return (
            <label className="check" key={f.id}>
              <input
                type="checkbox"
                checked={exists}
                disabled={a.busy || r.loading || f.is_archived}
                onChange={() => {
                  if (
                    exists &&
                    !window.confirm(
                      `Unregister ${f.display_name} from this event? Removing someone who has already competed may affect live standings. Do not remove played entrants until the post-match registration safeguards are implemented.`,
                    )
                  )
                    return;
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
                  });
                }}
              />
              {competitorLabel(f, allFencers)}{" "}
              {f.is_archived && (
                <small>(Archived · historical registration, read-only)</small>
              )}
            </label>
          );
        })}
      </div>
      {!r.loading && !f.loading && visible.length === 0 && (
        <p role="status">No fencers match this registration filter.</p>
      )}
      <Notice error={a.error} success={a.status} />
    </section>
  );
}
