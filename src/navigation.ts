export const ALL_ROUTES = [
  '/', '/account', '/users', '/fencers', '/events', '/events/teams',
  '/presets', '/run-event', '/run-event/standings', '/run-event/standings/team',
  '/run-event/matches', '/run-event/matches/run', '/run-event/bracket',
  '/single-match', '/history', '/history/events', '/history/matches',
  '/history/fencers', '/configuration', '/configuration/team-images',
  '/configuration/key-mappings', '/configuration/general',
] as const;

export type Route = (typeof ALL_ROUTES)[number];

export interface NavTile {
  route: Route;
  title: string;
  description: string;
  icon: string;
  status?: 'available' | 'planned' | 'admin';
}

export const dashboardTiles: NavTile[] = [
  { route: '/users', title: 'Manage Users', description: 'Add management accounts and reset their access.', icon: '◈', status: 'admin' },
  { route: '/fencers', title: 'Manage Fencers', description: 'Create fencer profiles and update their details.', icon: '♟', status: 'planned' },
  { route: '/events', title: 'Manage Events', description: 'Create events and manage the teams in each event.', icon: '▦', status: 'planned' },
  { route: '/presets', title: 'Create Match Preset', description: 'Set up reusable match times and target scores.', icon: '◷', status: 'planned' },
  { route: '/run-event', title: 'Run Event', description: 'Open an event, review standings, run bouts, and build a bracket.', icon: '⚑', status: 'planned' },
  { route: '/single-match', title: 'Run Single Match', description: 'Start a standalone Traditional match and record its calls.', icon: '⚔', status: 'available' },
  { route: '/history', title: 'View History', description: 'Explore past events, matches, and fencer results.', icon: '▤', status: 'planned' },
  { route: '/configuration', title: 'Configuration', description: 'Customize team images, hotkeys, and other settings.', icon: '⚙', status: 'planned' },
];

export const eventTiles: NavTile[] = [
  { route: '/events/teams', title: 'Teams for Event', description: 'Choose an event, then add or edit its teams and roster.', icon: '♟', status: 'planned' },
];

export const runEventTiles: NavTile[] = [
  { route: '/run-event/standings', title: 'View Standings', description: 'Rank teams, track results, and inspect each team’s history.', icon: '▥', status: 'planned' },
  { route: '/run-event/matches', title: 'View Matches', description: 'See scheduled and finished matches, then select one to run.', icon: '⚔', status: 'planned' },
  { route: '/run-event/bracket', title: 'Create Bracket', description: 'Set up event rounds and match pairings.', icon: '◇', status: 'planned' },
];

export const historyTiles: NavTile[] = [
  { route: '/history/events', title: 'View Event', description: 'Find an event and drill into teams, matches, and results.', icon: '▦', status: 'planned' },
  { route: '/history/matches', title: 'View Match', description: 'Find a bout and review its score and individual calls.', icon: '⚔', status: 'planned' },
  { route: '/history/fencers', title: 'View Fencer', description: 'Select a fencer to browse their match history.', icon: '♟', status: 'planned' },
];

export const configurationTiles: NavTile[] = [
  { route: '/configuration/team-images', title: 'Team Images', description: 'Upload and assign team logos or photos.', icon: '▧', status: 'planned' },
  { route: '/configuration/key-mappings', title: 'Key Mappings', description: 'Choose keyboard shortcuts for scoring and match control.', icon: '⌘', status: 'planned' },
  { route: '/configuration/general', title: 'General Settings', description: 'Additional options as the scorekeeper expands.', icon: '⚙', status: 'planned' },
];

export const titles: Record<Route, string> = {
  '/': 'Dashboard', '/account': 'Sign In', '/users': 'Manage Users', '/fencers': 'Manage Fencers',
  '/events': 'Manage Events', '/events/teams': 'Event Teams', '/presets': 'Create Match Preset',
  '/run-event': 'Run Event', '/run-event/standings': 'Event Standings',
  '/run-event/standings/team': 'Team History', '/run-event/matches': 'Event Matches',
  '/run-event/matches/run': 'Run Event Match', '/run-event/bracket': 'Create Bracket',
  '/single-match': 'Run Single Match', '/history': 'View History',
  '/history/events': 'Event History', '/history/matches': 'Match History',
  '/history/fencers': 'Fencer History', '/configuration': 'Configuration',
  '/configuration/team-images': 'Team Images', '/configuration/key-mappings': 'Key Mappings',
  '/configuration/general': 'General Settings',
};

const routeSet: ReadonlySet<string> = new Set(ALL_ROUTES);
export function readRoute(): Route {
  const value = window.location.hash.replace(/^#/, '').replace(/\/$/, '') || '/';
  return routeSet.has(value) ? value as Route : '/';
}

export function parentRoute(route: Route): Route {
  if (route === '/') return '/';
  const parent = route.slice(0, route.lastIndexOf('/')) || '/';
  return routeSet.has(parent) ? parent as Route : '/';
}
