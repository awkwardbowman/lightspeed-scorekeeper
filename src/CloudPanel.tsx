import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Match } from './match';
import { cloudConfigured, supabase } from './db/supabase';
import { listTraditionalMatches, loadTraditionalMatch, saveTraditionalMatch, type CloudMatchSummary } from './db/traditional';

interface CloudPanelProps {
  match: Match;
  onLoad: (match: Match) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function CloudPanel({ match, onLoad }: CloudPanelProps) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<CloudMatchSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const currentUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) { setChecking(false); return; }
    let mounted = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (mounted) {
        const next = error ? null : data.user;
        currentUserId.current = next?.id ?? null;
        setUser(next);
        setChecking(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        const next = session?.user ?? null;
        if (currentUserId.current !== (next?.id ?? null)) {
          setSaved([]);
          setSelectedId('');
          currentUserId.current = next?.id ?? null;
        }
        setUser(next);
        setChecking(false);
      }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void listTraditionalMatches().then((items) => {
      if (active) setSaved(items);
    }).catch((error: unknown) => {
      if (active) setMessage(`Cloud list failed: ${errorMessage(error)}`);
    });
    return () => { active = false; };
  }, [user?.id]);

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setMessage('Check your inbox for the sign-in link. Return to this page after signing in.');
    } catch (error) { setMessage(`Sign-in failed: ${errorMessage(error)}`); }
    finally { setBusy(false); }
  }

  async function refreshList() {
    try {
      const items = await listTraditionalMatches();
      setSaved(items);
      return items;
    } catch (error) {
      setMessage(`Unable to list matches: ${errorMessage(error)}`);
      return [];
    }
  }

  async function save() {
    if (!user || match.phase === 'running') return;
    setBusy(true); setMessage('');
    try {
      await saveTraditionalMatch(match, user.id);
      await refreshList();
      setSelectedId(match.id);
      setMessage('Match saved to your Supabase account.');
    } catch (error) { setMessage(`Save failed: ${errorMessage(error)}`); }
    finally { setBusy(false); }
  }

  async function load() {
    if (!selectedId) return;
    if (!window.confirm('Load this cloud match? Your current local match will be replaced. Save it first if needed.')) return;
    setBusy(true); setMessage('');
    try {
      const remote = await loadTraditionalMatch(selectedId);
      onLoad(remote);
      setMessage('Cloud match loaded. The timer is paused for safety.');
    } catch (error) { setMessage(`Load failed: ${errorMessage(error)}`); }
    finally { setBusy(false); }
  }

  if (!cloudConfigured) return <section className="card cloud-panel" aria-label="Cloud storage"><h2>Cloud storage</h2><p className="muted">Database connection is not configured for this build. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</p></section>;

  return <section className="card cloud-panel" aria-label="Cloud storage">
    <div className="section-heading"><h2>Cloud storage · Traditional</h2><span>{checking ? 'Checking sign-in…' : user ? `Signed in: ${user.email ?? 'Account'}` : 'Sign in to save'}</span></div>
    {checking ? <p className="muted">Checking session…</p> : !user ? <>
      <p className="muted">Sign in by email to save and retrieve matches across devices. The current match stays on this device until you choose Save.</p>
      <form className="cloud-auth" onSubmit={(event) => void sendLink(event)}>
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Sending…' : 'Email sign-in link'}</button>
      </form>
    </> : <>
      <p className="muted">Cloud saving is manual for now. Pause the clock before saving. Stored matches can be loaded on another signed-in device.</p>
      <div className="cloud-actions">
        <button className="primary" onClick={() => void save()} disabled={busy || match.phase === 'running'}>{busy ? 'Working…' : 'Save current match to cloud'}</button>
        <label>Saved matches<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={busy}>
          <option value="">Choose a saved match</option>
          {saved.map((item) => <option key={item.id} value={item.id}>{item.left_name} vs {item.right_name} · {item.event_name || 'Untitled'} · {new Date(item.created_at).toLocaleDateString()}</option>)}
        </select></label>
        <button className="subtle" onClick={() => void load()} disabled={busy || !selectedId || match.phase === 'running'}>Load selected</button>
        <button className="subtle" onClick={() => void refreshList()} disabled={busy}>Refresh</button>
        <button className="subtle" onClick={() => { void supabase?.auth.signOut(); }} disabled={busy}>Sign out</button>
      </div>
    </>}
    {message && <p role="status" className="cloud-message">{message}</p>}
  </section>;
}
