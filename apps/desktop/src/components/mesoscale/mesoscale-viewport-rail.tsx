import { X } from "../ui/app-icons";
import type { ComponentType, MouseEvent } from "react";
import type { ViewerDocument } from "../../types";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";
import { showNativeContextMenu } from "../native-context-menu";
import type { MenuItemSpec } from "../menu-types";
import { ToolbarButton } from "../ui/toolbar-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Aim, Lighting, Motion, Pick, Snapshot } from "../../preview-controls/viewer-viewport-toolbar";

function menuPoint(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left - 8, y: rect.bottom + 6 };
}

type RailControl = {
  label: string;
  Icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  selected?: boolean;
  menu?: boolean;
  motion?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

// The glyphs, button recipe and left-hand floating hints are the standard
// viewer rail's.
export function MesoscaleViewportRail({ document, hidden }: { document: ViewerDocument; hidden: boolean }) {
  const summary = useMesoscaleStore((state) => state.sessions[document.id]?.summary);
  const disabled = !summary;
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(document.id, action).catch(() => undefined);
  const openMenu = (event: MouseEvent<HTMLButtonElement>, entries: MenuItemSpec[]) => {
    event.stopPropagation();
    void showNativeContextMenu(entries, menuPoint(event));
  };
  const controls: RailControl[] = [
    { label: "Camera", Icon: Aim, menu: true, onClick: (event) => openMenu(event, [
      { kind: "label", id: "mesoscale-camera-label", text: "Camera" },
      { kind: "item", id: "mesoscale-camera-reset", text: "Reset zoom", action: () => run({ type: "resetCamera" }) },
      { kind: "item", id: "mesoscale-camera-orient", text: "Lay flat", action: () => run({ type: "orientAxes" }) },
      { kind: "item", id: "mesoscale-camera-axes", text: "Reset axes", action: () => run({ type: "resetAxes" }) },
    ]) },
    { label: "Save a screenshot", Icon: Snapshot, onClick: () => run({ type: "exportPng" }) },
    { label: "Realistic lighting", Icon: Lighting, selected: summary?.illumination ?? false, onClick: () => run({ type: "setIllumination", enabled: !(summary?.illumination ?? false) }) },
    { label: "Animate the scene", Icon: Motion, menu: true, selected: (summary?.motion ?? "off") !== "off", motion: summary?.motion ?? "off", onClick: (event) => openMenu(event, [
      { kind: "label", id: "mesoscale-motion-label", text: "Motion" },
      { kind: "select", id: "mesoscale-motion", label: "Scene motion", value: summary?.motion ?? "off", options: ["off", "spin", "rock"], optionLabels: { off: "Off", spin: "Spin", rock: "Rock" }, action: (motion) => run({ type: "setMotion", motion: motion as "off" | "spin" | "rock" }) },
    ]) },
    { label: "Selection mode", Icon: Pick, selected: summary?.selectionMode ?? false, onClick: () => run({ type: "setSelectionMode", enabled: !(summary?.selectionMode ?? false) }) },
  ];
  if (summary?.selectedCount) controls.push({ label: "Clear selection", Icon: X, onClick: () => run({ type: "setSelection", mode: "clear" }) });

  return (
    <TooltipProvider>
    <div className={`mesoscale-viewport-rail${hidden ? " hidden" : ""}`} role="toolbar" aria-label="Burette viewport controls">
      {controls.map((control) => (
        <Tooltip key={control.label}>
          <TooltipTrigger asChild>
            <ToolbarButton
              disabled={disabled}
              selected={control.selected}
              aria-pressed={control.menu ? undefined : control.selected}
              aria-haspopup={control.menu ? "menu" : undefined}
              aria-label={control.label}
              data-motion={control.motion}
              onClick={control.onClick}
            >
              <control.Icon size={16} aria-hidden />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent variant="floating" side="left">{control.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
    </TooltipProvider>
  );
}
