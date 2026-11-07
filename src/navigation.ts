export const ALL_ROUTES = [
  "/",
  "/account",
  "/users",
  "/fencers",
  "/events",
  "/events/teams",
  "/presets",
  "/run-event",
  "/run-event/standings",
  "/run-event/standings/team",
  "/run-event/matches",
  "/run-event/matches/run",
  "/run-event/bracket",
  "/single-match",
  "/history",
  "/history/events",
  "/history/matches",
  "/history/fencers",
  "/configuration",
  "/configuration/team-images",
  "/configuration/key-mappings",
  "/configuration/general",
] as const;

export type Route = (typeof ALL_ROUTES)[number];

export interface NavTile {
  route: Route;
  title: string;
  description: string;
  icon: string;
  status?: "available" | "planned" | "admin";
}

export const dashboardTiles: NavTile[] = [
  {
    route: "/users",
    title: "Accounts & Invitations",
    description: "Invite managers by email and manage account access.",
    icon: "◈",
    status: "available",
  },
  {
    route: "/fencers",
    title: "Manage Fencers",
    description: "Create fencer profiles and update their details.",
    icon: "♟",
    status: "planned",
  },
  {
    route: "/events",
    title: "Manage Events",
    description: "Create events, configure details, and register fencers or teams.",
    icon: "▦",
    status: "planned",
  },
  {
    route: "/events/teams",
    title: "Manage Teams",
    description: "Find, create, edit, and clone reusable team instances.",
    icon: "♟",
    status: "available",
  },
  {
    route: "/presets",
    title: "Manage Match Presets",
    description: "Set up reusable match times and target scores.",
    icon: "◷",
    status: "planned",
  },
  {
    route: "/run-event",
    title: "Run Event",
    description:
      "Manage event status, review standings, and open scheduled matches.",
    icon: "⚑",
    status: "planned",
  },
  {
    route: "/single-match",
    title: "Run Single Match",
    description: "Start a standalone Traditional match and record its calls.",
    icon: "⚔",
    status: "available",
  },
  {
    route: "/history",
    title: "View History",
    description: "Explore past events, matches, and fencer results.",
    icon: "▤",
    status: "planned",
  },
  {
    route: "/configuration",
    title: "Configuration",
    description: "Customize team images, hotkeys, and other settings.",
    icon: "⚙",
    status: "planned",
  },
];

export const eventTiles: NavTile[] = [
  {
    route: "/events/teams",
    title: "Teams for Event",
    description: "Choose an event, then add or edit its teams and roster.",
    icon: "♟",
    status: "planned",
  },
];

export const runEventTiles: NavTile[] = [
  {
    route: "/run-event/standings",
    title: "View Standings",
    description: "Rank teams, track results, and inspect each team’s history.",
    icon: "▥",
    status: "planned",
  },
  {
    route: "/run-event/matches",
    title: "View Matches",
    description: "See scheduled and finished matches, then select one to run.",
    icon: "⚔",
    status: "planned",
  },
  {
    route: "/run-event/bracket",
    title: "Create Bracket",
    description: "Set up event rounds and match pairings.",
    icon: "◇",
    status: "planned",
  },
];

export const historyTiles: NavTile[] = [
  {
    route: "/history/events",
    title: "Event History",
    description: "Review past events, team rosters, matches, and standings.",
    icon: "▦",
    status: "planned",
  },
  {
    route: "/history/matches",
    title: "Match History",
    description: "Review match scores, scoring calls, cards, and corrections.",
    icon: "⚔",
    status: "planned",
  },
  {
    route: "/history/fencers",
    title: "Fencer History",
    description: "Browse a fencer’s scoring statistics and previous matches.",
    icon: "♟",
    status: "planned",
  },
];

export const configurationTiles: NavTile[] = [
  {
    route: "/configuration/team-images",
    title: "Image Library",
    description: "Upload optimized images and reuse team logos.",
    icon: "▧",
    status: "planned",
  },
  {
    route: "/configuration/key-mappings",
    title: "Key Mappings",
    description: "Choose keyboard shortcuts for scoring and match control.",
    icon: "⌘",
    status: "planned",
  },
  {
    route: "/configuration/general",
    title: "Match & Ranking Settings",
    description: "Set penalty reasons, overtime duration, and standings tiebreakers."
    icon: "⚙",
    status: "planned",
  },
];

export const titles: Record<Route, string> = {
  "/": "Dashboard",
  "/account": "My Account",
  "/users": "Manage Users",
  "/fencers": "Manage Fencers",
  "/events": "Manage Events",
  "/events/teams": "Manage Teams",
  "/presets": "Manage Match Presets",
  "/run-event": "Run Event",
  "/run-event/standings": "Event Standings",
  "/run-event/standings/team": "Team History",
  "/run-event/matches": "Event Matches",
  "/run-event/matches/run": "Run Event Match",
  "/run-event/bracket": "Create Bracket",
  "/single-match": "Run Single Match",
  "/history": "View History",
  "/history/events": "Event History",
  "/history/matches": "Match History",
  "/history/fencers": "Fencer History",
  "/configuration": "Configuration",
  "/configuration/team-images": "Image Library",
  "/configuration/key-mappings": "Key Mappings",
  "/configuration/general": "Match & Ranking Settings",
};

const routeSet: ReadonlySet<string> = new Set(ALL_ROUTES);
export function readRoute(): Route {
  const value =
    window.location.hash.split("?")[0].replace(/^#/, "").replace(/\/$/, "") ||
    "/";
  return routeSet.has(value) ? (value as Route) : "/";
}

export function parentRoute(route: Route): Route {
  if (route === "/") return "/";
  const parent = route.slice(0, route.lastIndexOf("/")) || "/";
  return routeSet.has(parent) ? (parent as Route) : "/";
}
