import { useState } from "react";
import { db, type EventRecord, type Fencer, type Standing } from "./data";
import { Notice, Search, useAction, useRows } from "./ui";
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
  const r = useRows<{ event_id: string; fencer_id: string }>("tEventFencer");
  const a = useAction(r.reload);
  const [search, setSearch] = useState("");
  return (
    <section>
      <h3>Registered competitors</h3>
      <Search value={search} onChange={setSearch} />
      <Notice error={r.error || f.error} />
      <div className="selection-list">
        {f.data
          .filter(
            (f) =>
              !f.is_unregistered &&
              !f.is_archived &&
              f.display_name.toLowerCase().includes(search.toLowerCase()),
          )
          .sort(
            (a, b) =>
              a.display_name.localeCompare(b.display_name, undefined, {
                sensitivity: "base",
              }) || a.id.localeCompare(b.id),
          )
          .map((f) => {
            const exists = r.data.some(
              (x) => x.event_id === eventId && x.fencer_id === f.id,
            );
            return (
              <label className="check" key={f.id}>
                <input
                  type="checkbox"
                  checked={exists}
                  disabled={a.busy}
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
                {f.display_name} <small>{f.id.slice(0, 8)}</small>
              </label>
            );
          })}
      </div>
      <Notice error={a.error} success={a.status} />
    </section>
  );
}
