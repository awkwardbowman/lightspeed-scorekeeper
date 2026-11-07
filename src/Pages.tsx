import Teams from "./Teams";
import ImageLibrary from "./Images";
import { RecordPage } from "./RecordPages";
import { Account } from "./Management";
import { PhaseManager, PhaseRunner as RunEvent } from "./PhasePages";
import { History } from "./History";
import Configuration from "./Configuration";
import { Intro } from "./ui";
import {
  dashboardTiles,
  configurationTiles,
  historyTiles,
  type Route,
} from "./navigation";
export default function Pages({ route }: { route: Route }) {
  const tiles =
    route === "/"
      ? dashboardTiles
      : route === "/history"
        ? historyTiles
        : configurationTiles;
  switch (route) {
    case "/":
    case "/history":
    case "/configuration":
      return (
        <>
          <Intro
            title={
              route === "/"
                ? "What would you like to do?"
                : route === "/history"
                  ? "View History"
                  : "Configuration"
            }
          />
          <div className="nav-tile-grid">
            {tiles.map((t) => (
              <a className="nav-tile" href={`#${t.route}`} key={t.route}>
                <span className="nav-symbol">{t.icon}</span>
                <div className="nav-tile-body">
                  <h3>{t.title}</h3>
                  <p>{t.description}</p>
                </div>
                <span className="nav-tile-arrow">↗</span>
              </a>
            ))}
          </div>
        </>
      );
    case "/account":
      return <Account />;
    case "/users":
      return <RecordPage entity="users" />;
    case "/fencers":
      return <RecordPage entity="fencers" />;
    case "/presets":
      return <RecordPage entity="presets" />;
    case "/events":
      return <RecordPage entity="events" />;
    case "/events/phases":
      return <PhaseManager />;
    case "/events/teams":
      return <Teams />;
    case "/run-event":
    case "/run-event/matches":
    case "/run-event/matches/run":
    case "/run-event/bracket":
    case "/run-event/standings":
    case "/run-event/standings/team":
      return <RunEvent />;
    case "/history/events":
      return <History kind="events" />;
    case "/history/matches":
      return <History kind="matches" />;
    case "/history/fencers":
      return <History kind="fencers" />;
    case "/configuration/general":
      return <Configuration kind="general" />;
    case "/configuration/key-mappings":
      return <Configuration kind="key-mappings" />;
    case "/configuration/team-images":
      return <ImageLibrary />;
    case "/single-match":
      return null;
  }
}
