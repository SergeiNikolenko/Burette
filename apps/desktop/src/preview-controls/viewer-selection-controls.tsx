import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { SegmentedControl, SegmentedControlItem } from "../components/ui/segmented-control";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from "../components/ui/command";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ColorPalette } from "../components/ui/color-palette";
import { ArrowCurvedRight, ChevronDown, ColorTheme, Scissor, Undo, X } from "../components/ui/app-icons";

type QueryOptions = {
  mode: string;
  modes: [string, string][];
  queries: { label: string; category: string; index: number }[];
  onMode: (mode: string) => void;
  onQuery: (index: number) => void;
  resize: () => void;
};

export function mountViewerQueryControls(container: HTMLElement, options: QueryOptions) {
  const root = createRoot(container);
  flushSync(() => root.render(<QueryControls options={options} />));
  return { dispose: () => root.unmount() };
}

function QueryControls({ options }: { options: QueryOptions }) {
  const [mode, setMode] = useState(options.mode);
  const [search, setSearch] = useState("");
  useLayoutEffect(options.resize);
  const groups = new Map<string, typeof options.queries>();
  for (const query of options.queries) {
    if (!groups.has(query.category)) groups.set(query.category, []);
    groups.get(query.category)!.push(query);
  }
  return <>
    <div className="buret-selection-modes">
      <SegmentedControl aria-label="Selection mode" value={mode}
        onValueChange={value => { setMode(value); options.onMode(value); }}>
        {options.modes.map(([value, label]) => <SegmentedControlItem key={value} value={value}>{label}</SegmentedControlItem>)}
      </SegmentedControl>
    </div>
    <Command label="Filter selections" loop>
      <CommandInput variant="plain" name="selection-query" autoComplete="off" spellCheck={false}
        aria-label="Filter selections" placeholder="Filter selections…" value={search} onValueChange={setSearch} />
      <CommandList>
        <CommandEmpty>No matching selections</CommandEmpty>
        {[...groups].map(([category, queries]) => <CommandGroup key={category} heading={<div className="atlas-menu-label">{category}</div>}>
          {queries.map(query => <CommandItem key={query.index} value={String(query.index)} keywords={[query.label]}
            onSelect={() => options.onQuery(query.index)}>{query.label}</CommandItem>)}
        </CommandGroup>)}
      </CommandList>
    </Command>
  </>;
}

type ApplyState = { empty: boolean; canUndo: boolean; canRedo: boolean };
type ApplyOptions = {
  read: () => ApplyState;
  colors: { label: string; value: string }[];
  representations: { name: string; label: string }[];
  onColor: (color: string) => void;
  onRepresentation: (representation: string) => void;
  onAction: (action: string) => void;
  resize: () => void;
};

export function mountViewerSelectionActions(container: HTMLElement, options: ApplyOptions) {
  const root = createRoot(container);
  const refresh = () => root.render(<SelectionActions container={container} options={options} state={options.read()} />);
  flushSync(refresh);
  return { refresh, dispose: () => root.unmount() };
}

function SelectionActions({ container, options, state }: { container: HTMLElement; options: ApplyOptions; state: ApplyState }) {
  const [color, setColor] = useState<string>();
  useLayoutEffect(options.resize);
  const palette = (colors: ApplyOptions["colors"]) => <ColorPalette aria-label="Selection colour" colors={colors} value={color}
    disabled={state.empty} onValueChange={value => { setColor(value); options.onColor(value); }} />;
  const actions = [
    { id: "selection-color-reset", label: "Reset colour", icon: ColorTheme, disabled: state.empty },
    { id: "selection-subtract", label: "Cut out of components", icon: Scissor, disabled: state.empty },
    { id: "undo", label: "Undo", icon: Undo, disabled: !state.canUndo },
    { id: "redo", label: "Redo", icon: ArrowCurvedRight, disabled: !state.canRedo },
    { id: "selection-clear", label: "Clear selection", icon: X, disabled: state.empty },
  ];
  return <div className="buret-selection-actions">
    <fieldset><legend>Colour</legend>{palette(options.colors.slice(0, 8))}
      {options.colors.length > 8 && <details onToggle={options.resize}>
        <summary className="atlas-menu-item">More colours<ChevronDown size={16} aria-hidden /></summary>
        <div className="buret-selection-colors">{palette(options.colors.slice(8))}</div>
      </details>}
    </fieldset>
    {options.representations.length > 0 && <div className="buret-selection-representation">
      <Select disabled={state.empty} value="" onValueChange={options.onRepresentation}>
        <SelectTrigger size="sm" aria-label="Add selection as"><SelectValue placeholder="Add as…" /></SelectTrigger>
        <SelectContent container={container} align="start" onEscapeKeyDown={event => event.stopPropagation()}
          onKeyDown={event => {
            // After Radix commits the item, the viewer restores focus to Apply.
            // Do not let Enter's native button activation reopen that popup.
            if (event.key === "Enter") event.preventDefault();
          }}>
          {options.representations.map(type => <SelectItem key={type.name} value={type.name}>{type.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>}
    <div className="buret-selection-action-list">
      {actions.map(action => <Button key={action.id} size="sm" variant="ghost" data-pill={undefined}
        className="buret-selection-action" disabled={action.disabled} onClick={() => options.onAction(action.id)}>
        <action.icon size={16} aria-hidden />{action.label}
      </Button>)}
    </div>
  </div>;
}
