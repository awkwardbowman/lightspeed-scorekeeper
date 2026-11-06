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
  const [setupPassword, setSetupPassword] = useState(() =>
    ["invite", "recovery"].includes(
      new URLSearchParams(window.location.search).get("auth") ?? "",
    ),
  );
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState("");
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
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setSetupPassword(true);
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
    if (profile.must_change_password || setupPassword)
      return (
        <main className="shell">
          <section className="card">
            <h1>Set your password</h1>
            <PasswordForm
              onDone={async () => {
                const u = new URL(window.location.href);
                u.searchParams.delete("auth");
                window.history.replaceState(null, "", u.toString());
                setSetupPassword(false);
                await refresh();
              }}
            />
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
          <form
            className="editor"
            onSubmit={
              recovery
                ? async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    setNotice("");
                    try {
                      const { error } = await db().auth.resetPasswordForEmail(
                        email.trim(),
                        {
                          redirectTo:
                            "https://lightspeed-scorekeeper.vercel.app/?auth=recovery",
                        },
                      );
                      if (error) throw error;
                      setNotice(
                        "If this email has an account, a password reset link will arrive shortly.",
                      );
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }
                : login
            }
          >
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
            {!recovery && (
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
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Working…"
                : recovery
                  ? "Send password reset link"
                  : "Sign in"}
            </button>
          </form>
        )}
        <button
          className="subtle"
          onClick={() => {
            setRecovery(!recovery);
            setError("");
            setNotice("");
          }}
        >
          {recovery ? "Back to sign in" : "Forgot password?"}
        </button>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        <p className="muted">
          New accounts are invited by existing managers. Only you can reset your
          password.
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
      <p id="password-requirements" className="muted">Use at least 6 characters.</p>
      <label>
        New password
        <input
          type="password"
          required
          minLength={6}
          maxLength={128}
          aria-describedby="password-requirements"
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
          minLength={6}
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
