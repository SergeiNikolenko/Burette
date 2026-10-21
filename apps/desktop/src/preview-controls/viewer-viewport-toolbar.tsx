import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ToolbarButton } from "../components/ui/toolbar-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { X } from "../components/ui/app-icons";

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

// The rail keeps its established viewport glyphs (camera aim, lighting, motion,
// picking); the design system reserves these for the scientific canvas. The
// mesoscale rail in the app shell draws the same five.
const glyph = (...paths: string[]): RailIcon => ({ size = 16, ...props }) =>
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" {...props}>{paths.map(d => <path key={d} d={d} />)}</svg>;
export const Aim = glyph("M18.5 12a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0", "M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5");
export const Snapshot = glyph("M4.5 8.5h2.2l1.4-2.2h7.8l1.4 2.2h2.2A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-8a1.5 1.5 0 0 1 1.5-1.5Z", "M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z");
export const Lighting = glyph("M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M12 1.8V4M12 20v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M1.8 12H4M20 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6");
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
