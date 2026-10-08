import { useMemo, type ComponentType, type ReactNode } from "react";
import { createPath, parsePath, Router, Route, Routes, type Navigator, type To } from "react-router";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { normalizeSettingsSection } from "../../lib/settings-sections";
import { deserializeLocation, registeredPageKinds, type Location, type SerializedLocation } from "./page-kinds";
import type { PageComponentProps } from "./page-kinds/types";

function routePath(location: Location) {
  return location.kind === "settings" ? `/settings/${location.section}` : `/${location.kind}`;
}

function routeLocation(to: To, state: unknown): Location {
  const pathname = typeof to === "string" ? parsePath(to).pathname : to.pathname;
  if (pathname === "/launcher") return { kind: "launcher" };
  const settings = /^\/settings\/([^/]+)$/.exec(pathname ?? "");
  if (settings && normalizeSettingsSection(settings[1]) === settings[1]) {
    return { kind: "settings", section: normalizeSettingsSection(settings[1]) };
  }
  if (state && typeof state === "object" && "kind" in state) {
    const location = deserializeLocation(state as SerializedLocation);
    if (location && routePath(location) === pathname) return location;
  }
  throw new Error("A workspace route requires a matching document location");
}

export function TabMemoryRouter({ tab, children }: { tab: MoleculeTab; children: ReactNode }) {
  const navigator = useMemo<Navigator>(() => ({
    createHref: (to) => typeof to === "string" ? to : createPath(to),
    go: (delta) => useMoleculeStore.getState().navigateTabHistory(tab.id, delta),
    push: (to, state) => useMoleculeStore.getState().navigateTabLocation(tab.id, routeLocation(to, state), "push"),
    replace: (to, state) => useMoleculeStore.getState().navigateTabLocation(tab.id, routeLocation(to, state), "replace"),
  }), [tab.id]);
  return (
    <Router navigator={navigator} location={{ pathname: routePath(tab.location), state: tab.location, key: tab.id }}>
      {children}
    </Router>
  );
}

export function TabPageRoutes(props: PageComponentProps<Location>) {
  return <Routes>{registeredPageKinds.map(kind => {
    const Page = kind.Component as ComponentType<PageComponentProps<Location>>;
    return <Route key={kind.kind} path={kind.kind === "settings" ? "/settings/:section" : `/${kind.kind}`} element={<Page {...props} />} />;
  })}</Routes>;
}
