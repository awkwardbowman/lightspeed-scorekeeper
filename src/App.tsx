import { Fragment, useEffect, useState } from "react";
import Auth, { useAccount } from "./Auth";
import Pages from "./Pages";
import Scorekeeper from "./Scorekeeper";
import { titles, parentRoute, readRoute, type Route } from "./navigation";
export default function App() {
  return (
    <Auth>
      <Workspace />
    </Auth>
  );
}
function Workspace() {
  const { profile } = useAccount();
  const [route, setRoute] = useState<Route>(readRoute);
  const [matchKey, setMatchKey] = useState(0);
  const breadcrumbs: Route[] = [];
  for (let current = route; current !== "/"; current = parentRoute(current)) {
    breadcrumbs.unshift(current);
  }
  useEffect(() => {
    const update = () => {
      if (sessionStorage.getItem("openMatch")) setMatchKey((k) => k + 1);
      setRoute(readRoute());
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    document.title = `${titles[route]} · Lightspeed Scorekeeper`;
  }, [route]);
  return (
    <main className="shell app-shell">
      <header className="site-header">
        <a className="site-identity" href="#/">
          <span className="site-mark" aria-hidden="true">
            ⚔
          </span>
          <span>
            <span className="eyebrow">LIGHTSPEED · FENCING</span>
            <strong>
              Scorekeeper<span className="accent">.</span>
            </strong>
          </span>
        </a>
        <div className="site-actions">
          <span className="account-status">
            {profile.display_name} · {profile.app_role}
          </span>
          <a href="#/account" className="nav-account">
            My account
          </a>
        </div>
      </header>
      <nav className="app-breadcrumb" aria-label="Breadcrumb">
        <a href="#/" aria-current={route === "/" ? "page" : undefined}>
          Dashboard
        </a>
        {breadcrumbs.map((crumb, index) => (
          <Fragment key={crumb}>
            <span aria-hidden="true">/</span>
            {index === breadcrumbs.length - 1 ? (
              <strong aria-current="page">{titles[crumb]}</strong>
            ) : (
              <a href={`#${crumb}`}>{titles[crumb]}</a>
            )}
          </Fragment>
        ))}
      </nav>
      <section className="app-screen" hidden={route === "/single-match"}>
        <Pages key={route} route={route} />
      </section>
      <section className="app-screen" hidden={route !== "/single-match"}>
        <Scorekeeper
          active={route === "/single-match"}
          key={`${profile.id}:${matchKey}`}
        />
      </section>
      <footer className="site-footer">
        Lightspeed Scorekeeper · <a href="#/">Dashboard</a>
      </footer>
    </main>
  );
}
