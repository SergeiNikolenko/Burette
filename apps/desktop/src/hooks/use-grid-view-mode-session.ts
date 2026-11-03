import { useCallback, useEffect, type RefObject } from "react";
import { useMoleculeStore } from "../stores/molecule-store";

// Native viewer frames have opaque origins: their localStorage is unavailable.
// Keep presentation checkpoints on the owning tab, including navigation history.
// The viewer validates the versioned contents; the host bounds the opaque JSON
// string to 32K UTF-16 code units (at most 64 KiB) before persisting it.
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
      ...(location.gridViewState !== undefined ? { snapshot: location.gridViewState } : {}),
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
        if (body.snapshot !== undefined && (typeof body.snapshot !== "string" || body.snapshot.length > 32768)) return;
        const store = useMoleculeStore.getState();
        const location = store.tabs.find(tab => tab.id === tabId)?.location;
        if (location?.kind !== "file" || location.path !== path) return;
        const snapshot = body.snapshot ?? location.gridViewState;
        if (location.gridViewMode === body.value && location.gridViewState === snapshot) return;
        store.navigateTabLocation(tabId, { ...location, gridViewMode: body.value,
          ...(snapshot !== undefined ? { gridViewState: snapshot } : {}),
        }, "replace");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [enabled, frameRef, path, restore, tabId]);

  return restore;
}
