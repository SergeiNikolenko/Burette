import { deserializeLocation, serializeLocation, type Location, type SerializedLocation } from "../editor-area/page-kinds";
import { useMoleculeStore, type MoleculeTab, type TabPane } from "../../stores/molecule-store";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";

export type TabTransferPosition = { x: number; y: number };
export type TabTransferPlacement = {
  title?: string;
  index: number;
  pinned: boolean;
  back?: SerializedLocation[];
  forward?: SerializedLocation[];
};

export function captureTabPlacement(tab: MoleculeTab, index: number): TabTransferPlacement {
  const serialize = (locations: Location[]) => locations.map(serializeLocation).filter((location): location is SerializedLocation => location !== null);
  return { title: tab.title, index, pinned: tab.pinned === true, back: serialize(tab.back ?? []), forward: serialize(tab.forward ?? []) };
}

export function resolveTabTransferTarget(point: TabTransferPosition, viewportWidth?: number) {
  const scale = viewportWidth && viewportWidth > 0 ? window.innerWidth / viewportWidth : 1;
  const x = point.x * scale, y = point.y * scale;
  const strip = document.elementFromPoint(x, y)?.closest<HTMLElement>(".tab-strip[data-workspace-group]");
  const group = strip?.dataset.workspaceGroup;
  if (!strip || !["main", "right", "bottom", "floating"].includes(group ?? "")) return null;
  return { strip, x, pane: group === "main" ? null : group as TabPane };
}

export function applyTransferredTabPlacement(tabId: string, placement: TabTransferPlacement, point?: TabTransferPosition, viewportWidth?: number, resolvedTarget?: NonNullable<ReturnType<typeof resolveTabTransferTarget>>) {
  const decode = (locations: SerializedLocation[] = []) => locations.flatMap(value => {
    const location = deserializeLocation(value);
    if (!location) return [];
    if (location.kind === "file" || location.kind === "text-file") delete location.documentId;
    return [location];
  });
  useMoleculeStore.setState(state => ({ tabs: state.tabs.map(tab => tab.id === tabId
    ? { ...tab, ...(placement.title ? { title: placement.title } : {}), pinned: placement.pinned, back: decode(placement.back), forward: decode(placement.forward) }
    : tab) }));
  if (!point) return;
  const target = resolvedTarget ?? resolveTabTransferTarget(point, viewportWidth);
  if (!target) return;
  const { strip, x, pane } = target;
  useWorkspacePanesStore.getState().setFullView(null);
  const store = useMoleculeStore.getState();
  store.placeTab(tabId, pane);
  const next = [...strip.querySelectorAll<HTMLElement>(".tab-shell[data-tab-id]")].find(element => {
    const bounds = element.getBoundingClientRect();
    return element.dataset.tabId !== tabId && x < bounds.left + bounds.width / 2;
  });
  const tabs = useMoleculeStore.getState().tabs.filter(tab => tab.id !== tabId);
  const index = next ? tabs.findIndex(tab => tab.id === next.dataset.tabId) : tabs.length;
  store.moveTab(tabId, index < 0 ? tabs.length : index);
}
