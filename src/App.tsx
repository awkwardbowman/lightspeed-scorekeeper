import { useEffect, useState } from 'react';
import Pages, { type AccessLevel } from './Pages';
import Scorekeeper from './Scorekeeper';
import { titles, parentRoute, readRoute, type Route } from './navigation';
import { supabase } from './db/supabase';

interface AccessState {
  level: AccessLevel;
  email: string | null;
}

function useAccess(): AccessState {
  const [state, setState] = useState<AccessState>({ level: 'checking', email: null });

  useEffect(() => {
    if (!supabase) { setState({ level: 'visitor', email: null }); return; }
    const client = supabase;
    let mounted = true;
    let request = 0;

    async function verifyAccount(userId: string | undefined, email: string | null) {
      const current = ++request;
      if (!userId) {
        if (mounted) setState({ level: 'visitor', email: null });
        return;
      }
      const { data, error } = await client.from('tUser').select('app_role, is_active').eq('id', userId).maybeSingle();
      if (!mounted || current !== request) return;
      if (error) { setState({ level: 'error', email }); return; }
      if (!data || !data.is_active) { setState({ level: 'disabled', email }); return; }
      setState({ level: data.app_role === 'admin' ? 'admin' : 'management', email });
    }

    void client.auth.getUser().then(({ data, error }) => {
      if (mounted) void verifyAccount(error ? undefined : data.user?.id, data.user?.email ?? null);
    }).catch(() => {
      if (mounted) setState({ level: 'error', email: null });
    });

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      // Defer data API calls until after Supabase's auth-change callback has completed.
      window.setTimeout(() => {
        if (mounted) void verifyAccount(session?.user.id, session?.user.email ?? null);
      }, 0);
    });
    return () => { mounted = false; request++; subscription.unsubscribe(); };
  }, []);

  return state;
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const access = useAccess();

  useEffect(() => {
    const updateRoute = () => setRoute(readRoute());
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  useEffect(() => { document.title = `${titles[route]} · Lightspeed Scorekeeper`; }, [route]);

  async function signOut() { await supabase?.auth.signOut(); }
  const ancestors: Route[] = [];
  let current = parentRoute(route);
  while (current !== '/') {
    ancestors.unshift(current);
    current = parentRoute(current);
  }

  return <main className="shell app-shell">
    <header className="site-header">
      <a className="site-identity" href="#/" aria-label="Lightspeed Scorekeeper dashboard">
        <span className="site-mark" aria-hidden="true">⚔</span>
        <span><span className="eyebrow">LIGHTSPEED · FENCING</span><strong>Scorekeeper<span className="accent">.</span></strong></span>
      </a>
      <div className="site-actions">
        <span className="account-status">{access.level === 'admin' ? 'Admin' : access.level === 'management' ? 'Management' : access.level === 'checking' ? 'Checking account' : 'Guest / local mode'}</span>
        <a href="#/account" className="nav-account">{access.level === 'admin' || access.level === 'management' ? 'My account' : 'Sign in'}</a>
      </div>
    </header>
    <nav className="app-breadcrumb" aria-label="Breadcrumb">
      <a href="#/">Dashboard</a>
      {route !== '/' && <>
        <span aria-hidden="true">/</span>
        {ancestors.map((ancestor) => <span className="crumb-step" key={ancestor}><a href={`#${ancestor}`}>{titles[ancestor]}</a><span aria-hidden="true">/</span></span>)}
        <strong aria-current="page">{titles[route]}</strong>
      </>}
    </nav>

    <section className="app-screen" hidden={route === '/single-match'}>
      <Pages route={route} access={access.level} email={access.email} onSignOut={signOut}/>
    </section>
    {/* Keep the timer mounted while navigating, so a running bout continues accurately. */}
    <section className="app-screen" hidden={route !== '/single-match'}>
      <Scorekeeper />
    </section>

    <footer className="site-footer">Lightspeed Scorekeeper · Navigation preview · <a href="#/">Return to dashboard</a></footer>
  </main>;
}
