import type { MouseEvent } from "react";
import type { ViewerDocument } from "../../types";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";
import { showNativeContextMenu } from "../native-context-menu";
import type { MenuItemSpec } from "../menu-types";

function menuPoint(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left - 8, y: rect.bottom + 6 };
}

function RailIcon({ paths, fill = false }: { paths: string[]; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

export function MesoscaleViewportRail({ document, hidden }: { document: ViewerDocument; hidden: boolean }) {
  const summary = useMesoscaleStore((state) => state.sessions[document.id]?.summary);
  const disabled = !summary;
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(document.id, action).catch(() => undefined);
  const openMenu = (event: MouseEvent<HTMLButtonElement>, entries: MenuItemSpec[]) => {
    event.stopPropagation();
    void showNativeContextMenu(entries, menuPoint(event), { forceWeb: true });
  };

  return (
    <div className={`mesoscale-viewport-rail${hidden ? " hidden" : ""}`} role="toolbar" aria-label="Burette viewport controls">
      <button
        type="button"
        className="mesoscale-rail-button"
        disabled={disabled}
        aria-label="Camera"
        title="Camera"
        aria-haspopup="menu"
        onClick={(event) => openMenu(event, [
          { kind: "label", id: "mesoscale-camera-label", text: "Camera" },
          { kind: "item", id: "mesoscale-camera-reset", text: "Reset zoom", action: () => run({ type: "resetCamera" }) },
          { kind: "item", id: "mesoscale-camera-orient", text: "Lay flat", action: () => run({ type: "orientAxes" }) },
          { kind: "item", id: "mesoscale-camera-axes", text: "Reset axes", action: () => run({ type: "resetAxes" }) },
        ])}
      >
        <RailIcon paths={["M18.5 12a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0", "M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5"]} />
      </button>
      <button type="button" className="mesoscale-rail-button" disabled={disabled} aria-label="Save a screenshot" title="Save a screenshot" onClick={() => run({ type: "exportPng" })}>
        <RailIcon paths={["M4.5 8.5h2.2l1.4-2.2h7.8l1.4 2.2h2.2A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-8a1.5 1.5 0 0 1 1.5-1.5Z", "M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"]} />
      </button>
      <button type="button" className="mesoscale-rail-button" disabled={disabled} aria-pressed={summary?.illumination ?? false} aria-label="Realistic lighting" title="Realistic lighting" onClick={() => run({ type: "setIllumination", enabled: !(summary?.illumination ?? false) })}>
        <RailIcon paths={["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M12 1.8V4M12 20v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M1.8 12H4M20 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"]} />
      </button>
      <button
        type="button"
        className="mesoscale-rail-button"
        disabled={disabled}
        data-motion={summary?.motion ?? "off"}
        aria-label="Animate the scene"
        title="Animate the scene"
        aria-haspopup="menu"
        onClick={(event) => openMenu(event, [
          { kind: "label", id: "mesoscale-motion-label", text: "Motion" },
          { kind: "select", id: "mesoscale-motion", label: "Scene motion", value: summary?.motion ?? "off", options: ["off", "spin", "rock"], optionLabels: { off: "Off", spin: "Spin", rock: "Rock" }, action: (motion) => run({ type: "setMotion", motion: motion as "off" | "spin" | "rock" }) },
        ])}
      >
        <RailIcon paths={["M20.5 12a8.5 8.5 0 1 1-2.6-6.1", "M20.8 3.9v4.3h-4.3", "m10.4 9.2 4.8 2.8-4.8 2.8Z"]} />
      </button>
      <button type="button" className="mesoscale-rail-button" disabled={disabled} aria-pressed={summary?.selectionMode ?? false} aria-label="Selection mode" title="Selection mode" onClick={() => run({ type: "setSelectionMode", enabled: !(summary?.selectionMode ?? false) })}>
        <RailIcon paths={["m5 3 14 7.2-6 1.6-1.6 6L5 3Z"]} />
      </button>
      {summary?.selectedCount ? (
        <button type="button" className="mesoscale-rail-button mesoscale-clear-selection" aria-label="Clear selection" title="Clear selection" onClick={() => run({ type: "setSelection", mode: "clear" })}>
          <RailIcon paths={["M18 6 6 18M6 6l12 12"]} />
        </button>
      ) : null}
    </div>
  );
}
