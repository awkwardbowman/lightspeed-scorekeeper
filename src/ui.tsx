import { useCallback, useEffect, useState, type ReactNode } from "react";
import { db, message, rows } from "./data";
export function useRows<T>(table: string) {
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
    void reload();
  }, [reload]);
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
