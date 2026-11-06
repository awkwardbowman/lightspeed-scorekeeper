import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import { db, manage, message, rpc, type Profile } from "./data";
import { supabase } from "./db/supabase";
const Context = createContext<{
  profile: Profile;
  refresh: () => Promise<void>;
} | null>(null);
export function useAccount() {
  const value = useContext(Context);
  if (!value) throw new Error("Account unavailable");
  return value;
}
export default function Auth({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  async function refresh() {
    const current = ++request.current;
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      const next = data.session
        ? await rpc<Profile | null>("account_status")
        : null;
      if (current !== request.current) return;
      setProfile(next);
      setError("");
    } catch (e) {
      if (current !== request.current) return;
      setProfile(null);
      setError(message(e));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const subscription = supabase?.auth.onAuthStateChange(() => {
      setTimeout(() => void refresh(), 0);
    }).data.subscription;
    const interval = setInterval(() => void refresh(), 15000);
    return () => {
      subscription?.unsubscribe();
      clearInterval(interval);
    };
  }, []);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await db().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword("");
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="shell">
        <p role="status">Checking account…</p>
      </main>
    );
  if (profile?.is_active && !profile.is_deleted) {
    if (profile.must_change_password)
      return (
        <main className="shell">
          <section className="card">
            <h1>Change your temporary password</h1>
            <PasswordForm onDone={refresh} />
            <button className="subtle" onClick={() => void db().auth.signOut()}>
              Sign out
            </button>
          </section>
        </main>
      );
    return (
      <Context.Provider value={{ profile, refresh }}>
        {children}
      </Context.Provider>
    );
  }
  return (
    <main className="shell">
      <section className="card account-card">
        <span className="eyebrow">LIGHTSPEED · FENCING</span>
        <h1>Scorekeeper</h1>
        <p>Sign in with your Admin or Management account.</p>
        {profile && (
          <p role="alert">
            This account is disabled. Contact the administrator.
          </p>
        )}
        {!supabase ? (
          <p role="alert">Authentication is not configured.</p>
        ) : (
          <form className="editor" onSubmit={login}>
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
        <p className="muted">
          Accounts and password resets are managed by your administrator.
        </p>
      </section>
    </main>
  );
}
export function PasswordForm({ onDone }: { onDone: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== confirmation) {
          setStatus("Passwords must match.");
          return;
        }
        setBusy(true);
        try {
          await manage({ action: "password", password });
          setPassword("");
          setConfirmation("");
          setStatus("Password changed.");
          await onDone();
        } catch (e) {
          setStatus(message(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        New password
        <input
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Confirm password
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      <button className="primary" disabled={busy}>
        Change password
      </button>
      <p role="status">{status}</p>
    </form>
  );
}
