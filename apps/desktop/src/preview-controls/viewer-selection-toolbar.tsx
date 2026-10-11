import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Button } from "../components/ui/button";
import { NativeSelectControl } from "../components/ui/native-select-control";
import { ChevronDown, X } from "../components/ui/app-icons";

type ToolbarOptions = {
  read: () => { level: string; label: string };
  levels: [string, string][];
  onLevel: (level: string) => void;
  onAction: (action: "query" | "apply" | "exit", button: HTMLButtonElement) => void;
};

export function mountViewerSelectionToolbar(container: HTMLElement, options: ToolbarOptions) {
  const root = createRoot(container);
  const refresh = () => root.render(<SelectionToolbar options={options} state={options.read()} />);
  flushSync(refresh);
  return { refresh, dispose: () => root.unmount() };
}

function SelectionToolbar({ options, state }: { options: ToolbarOptions; state: ReturnType<ToolbarOptions["read"]> }) {
  return <>
    <NativeSelectControl size="sm" className="buret-selection-level" name="picking-level" aria-label="Picking level"
      title="What one click picks" value={state.level} onChange={event => options.onLevel(event.currentTarget.value)}>
      {options.levels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </NativeSelectControl>
    <Button size="sm" variant="ghost" data-pill={undefined} data-buret-selection-action="query"
      aria-haspopup="dialog" aria-expanded={false} onClick={event => options.onAction("query", event.currentTarget)}>
      Select<ChevronDown size={12} aria-hidden />
    </Button>
    <span className="buret-selection-count" aria-live="polite" title={state.label}>{state.label}</span>
    <Button size="sm" variant="ghost" data-pill={undefined} data-buret-selection-action="apply"
      aria-haspopup="dialog" aria-expanded={false} onClick={event => options.onAction("apply", event.currentTarget)}>
      Apply<ChevronDown size={12} aria-hidden />
    </Button>
    <Button size="icon-sm" variant="ghost" aria-label="Leave selection mode"
      onClick={event => options.onAction("exit", event.currentTarget)}><X size={16} aria-hidden /></Button>
  </>;
}
