import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ToolbarButton } from "../components/ui/toolbar-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { CameraPhoto as Snapshot, Sun as Lighting, X } from "../components/ui/app-icons";

export { Lighting, Snapshot };

type RailIcon = React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;

type RailState = { illumination: boolean; selectionMode: boolean; hasSelection: boolean; motion: string };
type RailAction = "camera" | "screenshot" | "illumination" | "animate" | "select-mode" | "clear-selection";
type RailOptions = {
  read: () => RailState;
  onAction: (action: RailAction, button: HTMLButtonElement) => void;
  styleSurface: (element: HTMLElement) => void;
};

export function mountViewerViewportToolbar(container: HTMLElement, options: RailOptions) {
  const root = createRoot(container);
  options.styleSurface(container);
  const refresh = () => root.render(<ViewportToolbar options={options} state={options.read()} />);
  flushSync(refresh);
  return { refresh, dispose: () => root.unmount() };
}

// Aim, motion and picking are shared with the scientific mesoscale viewport.
const glyph = (...paths: string[]): RailIcon => ({ size = 16, ...props }) =>
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" {...props}>{paths.map(d => <path key={d} d={d} />)}</svg>;
export const Aim = glyph("M18.5 12a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0", "M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5");
export const Motion = glyph("M20.5 12a8.5 8.5 0 1 1-2.6-6.1", "M20.8 3.9v4.3h-4.3", "m10.4 9.2 4.8 2.8-4.8 2.8Z");
export const Pick = glyph("m5 3 14 7.2-6 1.6-1.6 6L5 3Z");

function ViewportToolbar({ options, state }: { options: RailOptions; state: RailState }) {
  const controls: { action: RailAction; label: string; Icon: RailIcon; popup?: "menu" | "dialog"; selected?: boolean }[] = [
    { action: "camera", label: "Camera", Icon: Aim, popup: "menu" },
    { action: "screenshot", label: "Save a screenshot", Icon: Snapshot, popup: "menu" },
    { action: "illumination", label: "Realistic lighting", Icon: Lighting, selected: state.illumination },
    { action: "animate", label: "Animate the scene", Icon: Motion, popup: "dialog", selected: state.motion !== "off" },
    { action: "select-mode", label: "Selection mode", Icon: Pick, selected: state.selectionMode },
  ];
  if (state.hasSelection) controls.push({ action: "clear-selection", label: "Clear selection", Icon: X });
  return <TooltipProvider>{controls.map(control => {
    const popup = control.popup;
    return <Tooltip key={control.action}>
      <TooltipTrigger asChild>
        <ToolbarButton className="buret-rail-button" aria-label={control.label}
          data-pill="" data-squircle={undefined}
          selected={control.selected}
          aria-pressed={popup ? undefined : control.selected}
          aria-haspopup={popup} aria-expanded={popup ? false : undefined}
          data-buret-viewport-action={control.action}
          data-motion={control.action === "animate" ? state.motion : undefined}
          onClick={event => options.onAction(control.action, event.currentTarget)}>
          <control.Icon size={16} aria-hidden />
        </ToolbarButton>
      </TooltipTrigger>
      <TooltipContent variant="floating" side="left" className="buret-viewport-tooltip"
        ref={element => { if (element) options.styleSurface(element); }}>{control.label}</TooltipContent>
    </Tooltip>;
  })}</TooltipProvider>;
}
