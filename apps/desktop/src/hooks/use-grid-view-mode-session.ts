import { useCallback, useEffect, type RefObject } from "react";
import { useMoleculeStore } from "../stores/molecule-store";

// Native viewer frames have opaque origins: their localStorage is unavailable.
// Keep this view choice on the owning tab, including its navigation history.
export function useGridViewModeSession(
  tabId: string,
  path: string,
  enabled: boolean,
  frameRef: RefObject<HTMLIFrameElement | null>,
) {
  const restore = useCallback((frame: HTMLIFrameElement, active: boolean) => {
    if (!enabled || !active) return;
    const location = useMoleculeStore.getState().tabs.find(tab => tab.id === tabId)?.location;
    if (location?.kind !== "file" || location.path !== path) return;
    frame.contentWindow?.postMessage({ source: "burette-grid-host", body: {
      type: "gridRestoreViewMode", value: location.gridViewMode,
    } }, "*");
  }, [enabled, path, tabId]);

  useEffect(() => {
    if (!enabled) return;
    const receive = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame?.contentWindow || event.source !== frame.contentWindow || event.data?.source !== "burette-grid") return;
      const body = event.data.body;
      if (body?.type === "gridViewModeReady") {
        restore(frame, true);
      } else if (body?.type === "gridViewModeChanged" && (body.value === "cards" || body.value === "table")) {
        const store = useMoleculeStore.getState();
        const location = store.tabs.find(tab => tab.id === tabId)?.location;
        if (location?.kind !== "file" || location.path !== path || location.gridViewMode === body.value) return;
        store.navigateTabLocation(tabId, { ...location, gridViewMode: body.value }, "replace");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [enabled, frameRef, path, restore, tabId]);

  return restore;
}
