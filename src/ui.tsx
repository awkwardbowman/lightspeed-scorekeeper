import { useCallback, useEffect, useState, type ReactNode } from "react";
import { db, message, rows } from "./data";
export function useRows<T>(table: string, enabled = true) {
  const [data, setData] = useState<T[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setData(await rows<T>(table));
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [table]);
  useEffect(() => {
    if (enabled) void reload();
  }, [reload, enabled]);
  return { data, error, loading, reload };
}
export function Intro({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <span className="eyebrow">LIGHTSPEED · MANAGEMENT</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
/** Return navigation for read-only details and relationship screens. Forms use Cancel. */
export function BackLink({ href }: { href: string }) {
  return (
    <nav className="page-back" aria-label="Return navigation">
      <a href={href}>← Back</a>
    </nav>
  );
}

export function Notice({
  error,
  success,
  loading,
}: {
  error?: string;
  success?: string;
  loading?: boolean;
}) {
  return (
    <>
      {loading && <p role="status">Loading…</p>}
      {error && (
        <p role="alert" className="notice-feedback notice-error">
          {error}
        </p>
      )}
      {!error && success && (
        <p role="status" className="notice-feedback notice-success">
          {success}
        </p>
      )}
    </>
  );
}
export function useAction(reload?: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      await action();
      await reload?.();
      setStatus("Saved.");
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, status, error, run };
}
export function ArchiveFilter({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />{" "}
      Show archived / void records
    </label>
  );
}
export function Search({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="search">
      Search
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name or ID"
      />
    </label>
  );
}
export function DeleteButton({
  table,
  id,
  name,
  onDone,
}: {
  table: string;
  id: string;
  name: string;
  onDone: () => Promise<void>;
}) {
  const a = useAction(onDone);
  return (
    <>
      <button
        className="danger"
        disabled={a.busy}
        onClick={() => {
          if (
            window.confirm(
              `Permanently delete ${name}? Referenced records may require archiving instead.`,
            )
          )
            void a.run(async () => {
              const { error } = await db().from(table).delete().eq("id", id);
              if (error) throw error;
            });
        }}
      >
        Permanently delete
      </button>
      <Notice error={a.error} success={a.status} />
    </>
  );
}
/** Readable before/after audit summary; relationship resolvers avoid exposing UUIDs. */
export function describeChanges(
  before: unknown,
  after: unknown,
  resolve?: (field: string, value: unknown) => string | undefined,
): string {
  const asRow = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const oldRow = asRow(before), newRow = asRow(after);
  const labels: Record<string, string> = {
    display_name: "Display name", name: "Name", email: "Email",
    affiliation: "Affiliation", notes: "Notes", is_archived: "Archive status",
    is_active: "Account status", team_color_hex: "Team color",
    logo_image_asset_id: "Team logo", event_id: "Event assignment",
    overtime_ms: "Overtime duration", tiebreakers: "Standings tiebreakers",
    penalty_reasons: "Penalty reasons", key_mappings: "Keyboard shortcuts",
    status: "Status", start_date: "Start date", end_date: "End date",
    winner_side: "Winner", result_override: "Official result",
    left_score: "Left score", right_score: "Right score",
  };
  const display = (field: string, value: unknown): string => {
    const resolved = resolve?.(field, value);
    if (resolved !== undefined) return resolved;
    if (value === null || value === undefined || value === "") return "None";
    if (field === "event_id") return "Assigned event";
    if (field === "logo_image_asset_id") return "Selected image";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.length + " entries";
    if (typeof value === "object") return "Updated settings";
    if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return "Updated reference";
    return String(value).slice(0, 120);
  };
  const keys = [...new Set([...Object.keys(oldRow), ...Object.keys(newRow)])]
    .filter((field) => (
      (!/^(?:id|revision|version)$/.test(field) && !/(?:_id|_at|_by)$/.test(field)) ||
      field === "event_id" || field === "logo_image_asset_id"
    ) && JSON.stringify(oldRow[field]) !== JSON.stringify(newRow[field]));
  const changes = keys.map((field) => {
    const label = labels[field] ?? field.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const previous = display(field, oldRow[field]), next = display(field, newRow[field]);
    return previous !== next ? `${label}: ${previous} → ${next}` : `${label} changed`;
  });
  return changes.length ? changes.join("; ") : "Change retained in audit history";
}

export function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
