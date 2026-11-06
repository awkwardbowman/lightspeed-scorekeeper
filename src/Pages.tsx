import { useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from './db/supabase';
import {
  configurationTiles, dashboardTiles, eventTiles, historyTiles, runEventTiles,
  type NavTile, type Route,
} from './navigation';

export type AccessLevel = 'checking' | 'visitor' | 'admin' | 'management' | 'disabled' | 'error';

function Tile({ item, locked = false }: { item: NavTile; locked?: boolean }) {
  const content = <>
    <div className="nav-tile-top"><span className="nav-symbol" aria-hidden="true">{item.icon}</span><span className="nav-tile-status">{locked ? 'Locked' : item.status === 'available' ? 'Available' : item.status === 'admin' ? 'Admin only' : 'Planned'}</span></div>
    <div className="nav-tile-body"><h3>{item.title}</h3><p>{item.description}</p></div>
    <span className="nav-tile-arrow" aria-hidden="true">{locked ? '🔒' : '↗'}</span>
  </>;
  return locked
    ? <div className="nav-tile locked" aria-label={`${item.title} — Admin only`} aria-disabled="true">{content}</div>
    : <a className="nav-tile" href={`#${item.route}`}>{content}</a>;
}

function TileGrid({ tiles, access }: { tiles: NavTile[]; access: AccessLevel }) {
  return <div className="nav-tile-grid">{tiles.map((item) => <Tile key={item.route} item={item} locked={item.status === 'admin' && access !== 'admin'} />)}</div>;
}

function Intro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="page-intro"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{children}</p></div>;
}

function Scaffold({ title, description, details = [] }: { title: string; description: string; details?: string[] }) {
  return <section className="card scaffold-card"><div className="scaffold-head"><span className="scaffold-dot"/>EDITOR PLACEHOLDER</div><h3>{title}</h3><p>{description}</p>{details.length > 0 && <div className="future-features">{details.map((detail) => <span key={detail}>{detail}</span>)}</div>}</section>;
}

function DisabledPicker({ label, option }: { label: string; option: string }) {
  return <label className="scaffold-picker">{label}<select disabled value="none"><option value="none">{option}</option></select></label>;
}

function DraftPreset() {
  const [name, setName] = useState('Standard Traditional');
  const [minutes, setMinutes] = useState('3');
  const [target, setTarget] = useState('');
  return <section className="card draft-card"><div className="section-heading"><h3>Preset design</h3><span>Unsaved preview</span></div>
    <div className="draft-grid">
      <label>Preset name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80}/></label>
      <label>Mode<select value="traditional" disabled><option value="traditional">Traditional (Control Point to follow)</option></select></label>
      <label>Match length (minutes)<input value={minutes} type="number" min="1" max="180" onChange={(event) => setMinutes(event.target.value)}/></label>
      <label>Score to win (optional)<input value={target} type="number" min="1" onChange={(event) => setTarget(event.target.value)} placeholder="Time limit only"/></label>
    </div>
    <p className="muted">Preview: {name || 'Untitled preset'} · {minutes || '—'} minute(s) · {target ? `First to ${target}` : 'No target score'}. This form does not save yet.</p>
    <button type="button" className="subtle" disabled>Save preset (coming soon)</button>
  </section>;
}

function SignIn({ access, email, onSignOut }: { access: AccessLevel; email: string | null; onSignOut: () => Promise<void> }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: address.trim(),
        options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
      });
      if (error) throw error;
      setMessage('Check your inbox for your sign-in link. Only existing accounts can sign in.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send sign-in link.');
    } finally {setBusy(false);}
  }
  return <><Intro eyebrow="ACCOUNT" title="Sign in">Account access is being prepared for Admin and Management users.</Intro>
    <section className="card account-card">{access === 'checking' ? <p>Checking your account…</p>
      : access === 'admin' || access === 'management'
        ? <><h3>Signed in</h3><p>{email || 'Account'} · <strong>{access === 'admin' ? 'Admin' : 'Management'}</strong></p><button className="subtle" onClick={() => void onSignOut()}>Sign out</button></>
        : access === 'disabled' ? <p>This account has been disabled. Please contact the administrator.</p>
        : access === 'error' ? <p>We could not confirm your account role. Try signing in again.</p>
        : <><h3>Existing accounts only</h3><p className="muted">For now, use the existing Supabase email sign-in. Email/password login and admin-created accounts are the next authentication task.</p>
          {supabase ? <form className="account-signin" onSubmit={(event) => void sendLink(event)}>
            <label>Email address<input type="email" required autoComplete="email" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="you@example.com"/></label>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email sign-in link'}</button>
          </form> : <p className="muted">Cloud authentication is not configured in this local build.</p>}</>}
      {message && <p role="status" className="cloud-message">{message}</p>}
    </section></>;
}

export interface PageProps {
  route: Route;
  access: AccessLevel;
  email: string | null;
  onSignOut: () => Promise<void>;
}

export default function Pages({ route, access, email, onSignOut }: PageProps) {
  switch(route) {
    case '/': return <>
      <Intro eyebrow="MANAGEMENT HOME" title="What would you like to do?">Create and run matches, organize an event, or manage your records. Start anywhere; the unfinished sections show the layout we'll build into.</Intro>
      <TileGrid tiles={dashboardTiles} access={access}/>
      <p className="dashboard-note">Traditional single-match scoring and optional cloud backup already work. The other sections are navigation scaffolds, not live editors.</p>
    </>;
    case '/account': return <SignIn access={access} email={email} onSignOut={onSignOut}/>;
    case '/users': return access === 'checking' ? <Scaffold title="Checking Admin access" description="Confirming your role with the database…" /> : access !== 'admin'
      ? <><Intro eyebrow="RESTRICTED" title="Admin access required">Only the designated Admin can manage accounts.</Intro><Scaffold title="Not authorized" description="Sign in with your Admin account to access this section."/></>
      : <><Intro eyebrow="ADMIN ONLY" title="Manage Users">A deliberately small administration area for Management accounts. No Supabase organization access will be given to these users.</Intro>
        <div className="scaffold-two"><Scaffold title="Create Management user" description="Add a user's email and name, issue initial credentials, and require a password change." details={['Create account', 'Temporary password', 'Management role']}/><Scaffold title="Reset or disable access" description="Select an existing Management user to reset a password, reactivate, or disable the account." details={['User list', 'Password reset', 'Enable / disable']}/></div></>;
    case '/fencers': return <><Intro eyebrow="MANAGEMENT" title="Manage Fencers">Create profiles once and reuse the same fencers in single matches, event bouts, and history.</Intro><Scaffold title="Fencer directory & editor" description="A searchable fencer list, a create form, and profile-editing controls will go here." details={['Search profiles','Create fencer','Edit details']}/></>;
    case '/events': return <><Intro eyebrow="MANAGEMENT" title="Manage Events">Create Traditional and Control Point events. Teams are managed inside the event they belong to.</Intro><Scaffold title="Event directory & editor" description="This will list upcoming and past events, with a form for name, date, and scoring mode." details={['Traditional / Control Point','Event dates','Edit event']}/><h3 className="subnav-title">Within an event</h3><TileGrid tiles={eventTiles} access={access}/></>;
    case '/events/teams': return <><Intro eyebrow="MANAGE EVENTS / TEAMS" title="Event Teams">Select an event first, then create teams and assign fencers to that event's roster.</Intro><DisabledPicker label="Event" option="Event selection coming soon"/><Scaffold title="Team & roster editor" description="Teams will be managed in the context of a selected event, rather than as a standalone main-menu tool." details={['Team name','Fencer roster','Team image']}/></>;
    case '/presets': return <><Intro eyebrow="MATCH SETUP" title="Create Match Preset">Prepare repeatable defaults so a referee can select a format without re-entering timer and target score settings.</Intro><DraftPreset/><Scaffold title="Saved preset library" description="Once preset persistence is implemented, you'll be able to create, edit, and choose saved presets here."/></>;
    case '/run-event': return <><Intro eyebrow="EVENT OPERATIONS" title="Run Event">Select an event to oversee standings, matches, and its bracket from one place.</Intro><DisabledPicker label="Active event" option="Event picker coming soon"/><TileGrid tiles={runEventTiles} access={access}/></>;
    case '/run-event/standings': return <><Intro eyebrow="RUN EVENT / STANDINGS" title="View Standings">Team rankings for the selected event, with access to each team's bout history.</Intro><DisabledPicker label="Active event" option="Select an event later"/><TileGrid tiles={[{route:'/run-event/standings/team',title:'View Team History',description:'Open a team’s past and current event results.',icon:'▤',status:'planned'}]} access={access}/><Scaffold title="Standings table" description="The rankings, win/loss record, and event-specific scoring summary will appear here."/></>;
    case '/run-event/standings/team': return <><Intro eyebrow="RUN EVENT / STANDINGS" title="Team History">Drill into a team's results within an event.</Intro><DisabledPicker label="Team" option="Choose a team after event selection"/><Scaffold title="Team match history" description="This will display matches, opponents, and per-match results for the selected team."/></>;
    case '/run-event/matches': return <><Intro eyebrow="RUN EVENT / MATCHES" title="View Matches">Find scheduled, running, and completed matches for the selected event.</Intro><DisabledPicker label="Active event" option="Select an event later"/><TileGrid tiles={[{route:'/run-event/matches/run',title:'Run Event Match',description:'Launch an event-linked bout with its event, teams, and match settings.',icon:'⚔',status:'planned'}]} access={access}/><Scaffold title="Match list" description="This page will show upcoming match pairings and completed results, with a Run Match action on each applicable row."/></>;
    case '/run-event/matches/run': return <><Intro eyebrow="RUN EVENT / MATCHES" title="Run Event Match">The event-bound match runner will load its fencers or teams and record the event ID with the result.</Intro><Scaffold title="Event match runner" description="This will connect to a selected event and its match schedule. Until then, Run Single Match remains independent of events."/></>;
    case '/run-event/bracket': return <><Intro eyebrow="RUN EVENT / BRACKET" title="Create Bracket">Set up rounds and pairings for a selected event.</Intro><Scaffold title="Bracket builder" description="Seeding, match assignment, progression, and standings integration will be added here."/></>;
    case '/history': return <><Intro eyebrow="RESULTS ARCHIVE" title="View History">Look up saved results by event, individual match, or fencer, then drill into the details.</Intro><TileGrid tiles={historyTiles} access={access}/></>;
    case '/history/events': return <><Intro eyebrow="HISTORY" title="View Event">Select a historical event to see its teams, standings, brackets, and recorded matches.</Intro><DisabledPicker label="Event" option="Searchable event picker coming soon"/><Scaffold title="Event history" description="Event summary and links to individual matches will be shown here."/></>;
    case '/history/matches': return <><Intro eyebrow="HISTORY" title="View Match">Choose an individual match to inspect its result and scoring call breakdown.</Intro><DisabledPicker label="Match" option="Searchable match picker coming soon"/><Scaffold title="Match report" description="Match settings, fencer or team identities, the final result, and every recorded scoring action will appear here."/></>;
    case '/history/fencers': return <><Intro eyebrow="HISTORY" title="View Fencer">Select a fencer to review match history across events and standalone bouts.</Intro><DisabledPicker label="Fencer" option="Searchable fencer picker coming soon"/><Scaffold title="Fencer profile and history" description="Fencer details, match records, and results over time will appear here."/></>;
    case '/configuration': return <><Intro eyebrow="SETTINGS" title="Configuration">Customize the application and event presentation. Changes will be scoped appropriately when settings persistence is added.</Intro><TileGrid tiles={configurationTiles} access={access}/></>;
    case '/configuration/team-images': return <><Intro eyebrow="CONFIGURATION" title="Team Images">Upload or assign images used for teams in events and on match displays.</Intro><Scaffold title="Team image library" description="This will include file upload, image previews, and team selection. No files are uploaded yet."/></>;
    case '/configuration/key-mappings': return <><Intro eyebrow="CONFIGURATION" title="Key Mappings">Choose keyboard actions for pausing the clock, entering calls, and navigating a match.</Intro><Scaffold title="Shortcut editor" description="Keyboard controls will be configurable by action and mode, with conflict detection."/></>;
    case '/configuration/general': return <><Intro eyebrow="CONFIGURATION" title="General Settings">Additional display and workflow preferences can go here as requirements emerge.</Intro><Scaffold title="Application preferences" description="Future options may include display density, defaults, and event display settings."/></>;
    case '/single-match': return null;
  }
}
