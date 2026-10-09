import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ToolbarButton } from "../components/ui/toolbar-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { Annotate, CameraPhoto, Expand, Lightbulb, PlayCircle, X, type AppIconType } from "../components/ui/app-icons";

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

function ViewportToolbar({ options, state }: { options: RailOptions; state: RailState }) {
  const controls: { action: RailAction; label: string; Icon: AppIconType; popup?: "menu" | "dialog"; selected?: boolean }[] = [
    { action: "camera", label: "Camera", Icon: Expand, popup: "menu" },
    { action: "screenshot", label: "Save a screenshot", Icon: CameraPhoto, popup: "menu" },
    { action: "illumination", label: "Realistic lighting", Icon: Lightbulb, selected: state.illumination },
    { action: "animate", label: "Animate the scene", Icon: PlayCircle, popup: "dialog", selected: state.motion !== "off" },
    { action: "select-mode", label: "Selection mode", Icon: Annotate, selected: state.selectionMode },
  ];
  if (state.hasSelection) controls.push({ action: "clear-selection", label: "Clear selection", Icon: X });
  return <TooltipProvider>{controls.map(control => {
    const popup = control.popup;
    return <Tooltip key={control.action}>
      <TooltipTrigger asChild>
        <ToolbarButton className="buret-rail-button" aria-label={control.label}
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
