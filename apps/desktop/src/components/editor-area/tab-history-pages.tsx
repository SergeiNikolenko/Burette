import { useLayoutEffect, useState } from "react";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { type Location } from "./page-kinds";
import { TabMemoryRouter, TabPageRoutes } from "./tab-router";
import type { PageComponentProps } from "./page-kinds/types";

function locationKey(location: Location) {
  return `${location.kind}:${"path" in location ? location.path : ""}`;
}

// Keep the last three visited pages in the visible tab. Inactive tabs retain
// only their current page; unsaved grids are never evicted. History entries
// that have never been visited do not instantiate a molecular runtime.
export function TabHistoryPages({ tab, state, actions, isActive }: {
  tab: MoleculeTab;
} & Omit<PageComponentProps<Location>, "location" | "tabId">) {
  const [visited, setVisited] = useState<Location[]>([tab.location]);
  const key = locationKey;
  const currentKey = key(tab.location);
  const reachable = new Set([tab.location, ...tab.back, ...tab.forward].map(key));
  const candidates = visited.filter(location => key(location) !== currentKey && location.kind === "file");
  const recent = isActive ? candidates.filter(location => reachable.has(key(location))).slice(-2) : [];
  const protectedIds = new Set(state.dirtyGridDocuments);
  for (const document of state.documents ?? []) {
    if (document.sceneUnsaved || (document.sceneSourcePaths?.length ?? 0) > 1) protectedIds.add(document.id);
  }
  const dirty = candidates.filter(location => location.kind === "file" && protectedIds.has(location.documentId ?? ""));
  const orphaned = dirty.filter(location => !reachable.has(key(location)));
  useLayoutEffect(() => {
    if (orphaned.length === 0) return;
    // A new navigation branch can drop Forward entries. Unsaved views must
    // remain reachable in this same tab: moving them into a new tab would
    // recreate their iframe and lose the edits we are protecting.
    useMoleculeStore.setState(current => ({
      tabs: current.tabs.map(currentTab => {
        if (currentTab.id !== tab.id) return currentTab;
        const existing = new Set([currentTab.location, ...currentTab.back, ...currentTab.forward].map(key));
        const missing = orphaned.filter(location => !existing.has(key(location)));
        return missing.length ? { ...currentTab, back: [...missing, ...currentTab.back] } : currentTab;
      }),
    }));
  }, [tab.id, orphaned]);
  const locations = [...new Set([...dirty, ...recent]), tab.location];
  if (visited.length !== locations.length || visited.some((location, index) => location !== locations[index])) setVisited(locations);
  // Keep surviving DOM nodes in a fixed order. Reordering an iframe ancestor
  // reloads its browsing context even when React preserves the keyed node.
  return [...locations].sort((a, b) => key(a).localeCompare(key(b))).map(location => {
    const active = key(location) === currentKey;
    const pageTab = active ? tab : { ...tab, location };
    return <div key={key(location)} className="tab-history-page" hidden={!active} style={{ width: "100%", height: "100%" }}>
      <TabMemoryRouter tab={pageTab}>
        <TabPageRoutes tabId={tab.id} location={location} state={state} actions={actions} isActive={isActive && active} />
      </TabMemoryRouter>
    </div>;
  });
}
