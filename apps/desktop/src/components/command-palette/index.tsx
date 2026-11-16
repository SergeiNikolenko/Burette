import { openPlots, usePlotsAvailable, PLOTS_COMMAND } from "../../lib/workbench/plots-tool";
import { openSmartsSelect, runSelectCommand, SELECT_COMMANDS } from "../../lib/workbench/select-commands";
import { exportSceneSvg, openMovieDialog } from "../../lib/workbench/scene-media";
import { openEnumerateLibrary } from "../../lib/library-enumeration-task";
import { startAvogadroCommand, useAvogadroCommands } from "../../lib/extensions/avogadro-commands";
import { openScientificSpectra, useScientificSpectraAvailable, SCIENTIFIC_SPECTRA_COMMAND } from "../../lib/workbench/scientific-spectra-tool";
import { openOrbitals, useOrbitalsAvailable, ORBITALS_COMMAND } from "../../lib/workbench/orbitals-tool";
import { openPotential, usePotentialAvailable, POTENTIAL_COMMAND } from "../../lib/workbench/potential-tool";
import { FIELDS_COMMAND, openFields, useFieldsAvailable } from "../../lib/workbench/fields-tool";
import { focusToolDock, type WorkbenchToolDockKind } from "../../lib/workbench/focus-tool-dock";
import { openVibrations, useVibrationsAvailable, VIBRATIONS_COMMAND } from "../../lib/workbench/vibrations-tool";
import { CRYSTAL_COMMAND, openSymmetryTool, SYMMETRY_COMMAND, useSymmetryAvailable } from "../../lib/workbench/symmetry-tools";
import { useCrystalAvailable } from "../../lib/workbench/use-crystal-draft";
import { structureEditAvailable } from "../../lib/workbench/graph-draft";
import { geometryPanelAvailable } from "../../lib/geometry-editing";
import { OPTIMIZATION_COMMANDS, requestOptimizationCommand } from "../../lib/workbench/optimization-commands";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ArrowRight, Clipboard, FileDocument, FolderOpen, History, Link, Plus, Search, SettingsCog, type AppIconType } from "../ui/app-icons";
import { Kbd } from "../ui/kbd";
import { formatBytes, rendererLabel } from "../format";
import type { ShellActions, ShellViewState } from "../types";
import { isRemoteStructureUrl } from "../../lib/remote-structure";
import { buildShellCommands, filterShellCommands, type ShellCommand } from "../../lib/shell-commands";
import { useCommandPaletteSearch, useSetCommandPaletteSearch } from "../../hooks/use-command-palette";
import { useVirtualResults, PaletteResultItem, VirtualResults } from "./virtual-results";

type CommandPaletteProps = {
  state: ShellViewState;
  actions: ShellActions;
  isOpen: boolean;
  onClose: () => void;
  onRunError: (error: unknown, prefix?: string) => void;
};

type PaletteItem = ShellCommand & { icon?: AppIconType; detail?: string; shortcut?: string };

const commandIcons: Record<string, AppIconType> = {
  "open-structure": FolderOpen,
  "open-clipboard": Clipboard,
  "fetch-structure-url": Link,
  "new-window": Plus,
  "open-recent": History,
  "search-projects": Search,
  "open-settings": SettingsCog,
};
const commandShortcuts: Record<string, string> = {
  "open-structure": "⌘O",
  "open-recent": "⇧⌘O",
  "search-projects": "⌘P",
  "open-settings": "⌘,",
};

export function CommandPalette({
  state,
  actions,
  isOpen,
  onClose,
  onRunError,
}: CommandPaletteProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const query = useCommandPaletteSearch();
  const onQueryChange = useSetCommandPaletteSearch();
  const workbenchFocus = useRef<{ kind: WorkbenchToolDockKind; documentId: string; workspaceId: string } | null>(null);
  const hasOrbitals = useOrbitalsAvailable(state.activeDocument ?? null);
  const hasPotential = usePotentialAvailable(state.activeDocument ?? null);
  const hasFields = useFieldsAvailable(state.activeDocument ?? null);
  const hasPlots = usePlotsAvailable(state.activeDocument);
  const hasScientificSpectra = useScientificSpectraAvailable(state.activeDocument ?? null);
  const hasVibrations = useVibrationsAvailable(state.activeDocument ?? null);
  const hasCrystal = useCrystalAvailable(state.activeDocument ?? null);
  const hasSymmetry = useSymmetryAvailable(state.activeDocument ?? null);
  const pluginCommands = useAvogadroCommands(state.activeDocument ?? null);

  const projectItems = useMemo<PaletteItem[]>(() => (
    state.sidebarProjects.flatMap((project) => project.items.map((item) => ({
      id: `${item.source}-${item.path}`,
      group: "Structures",
      label: item.title,
      detail: project.title,
      icon: FileDocument,
      description: `${project.title} · ${item.relativePath} · ${rendererLabel(item.renderer)} · ${formatBytes(item.byteCount)}${item.isOpen ? "" : " · Recent"}`,
      run: () => {
        if (item.documentId) {
          actions.selectDocument(item.documentId);
          return;
        }
        return actions.openRecentStructure({
          path: item.path,
          title: item.title,
          extension: item.extension,
          renderer: item.renderer,
          byteCount: item.byteCount,
          openedAt: item.openedAt ?? Date.now(),
        });
      },
    })))
  ), [actions, state.sidebarProjects]);

  const items = useMemo<PaletteItem[]>(() => {
    const commands: PaletteItem[] = [
      ...projectItems,
      ...(hasOrbitals && state.activeDocument ? [{ id: "workbench-tool-orbitals", group: "Suggested", ...ORBITALS_COMMAND, run: () => openOrbitals(actions, state.activeDocument!.id) }] : []),
      ...(hasPotential && state.activeDocument ? [{ id: "workbench-tool-potential", group: "Suggested", ...POTENTIAL_COMMAND, run: () => openPotential(actions, state.activeDocument!.id) }] : []),
      ...(hasFields && state.activeDocument ? [{ id: "workbench-tool-fields", group: "Suggested", ...FIELDS_COMMAND, run: () => openFields(actions, state.activeDocument!.id) }] : []),
      ...(hasVibrations && state.activeDocument ? [{ id: "workbench-tool-vibrations", group: "Suggested", ...VIBRATIONS_COMMAND, run: () => openVibrations(actions, state.activeDocument!.id) }] : []),
      ...(hasCrystal && state.activeDocument ? [{ id: "workbench-tool-crystal", group: "Suggested", ...CRYSTAL_COMMAND, run: () => openSymmetryTool(actions, state.activeDocument!.id, "crystal") }] : []),
      ...(hasSymmetry && state.activeDocument ? [{ id: "workbench-tool-symmetry", group: "Suggested", ...SYMMETRY_COMMAND, run: () => openSymmetryTool(actions, state.activeDocument!.id, "symmetry") }] : []),
      ...(hasPlots && state.activeDocument ? [{ id: "workbench-tool-plots", group: "Suggested", ...PLOTS_COMMAND, run: () => openPlots(actions, state.activeDocument!.id) }] : []),
      ...(hasScientificSpectra && state.activeDocument ? [{ id: "workbench-tool-scientific-spectra", group: "Suggested", ...SCIENTIFIC_SPECTRA_COMMAND, run: () => openScientificSpectra(actions, state.activeDocument!.id) }] : []),
      // The editing docks otherwise open only from the dock's add-tab menu.
      ...([["structure-edit", "Edit atoms and bonds", "Elements, charges and bond orders", structureEditAvailable], ["geometry", "Edit geometry", "Bond lengths, angles and dihedrals", geometryPanelAvailable]] as const)
        .flatMap(([kind, label, description, available]) => state.activeDocument && available(state.activeDocument) ? [{ id: `workbench-tool-${kind}`, group: "Suggested", label, description,
          run: () => { actions.setDockDocument("right", state.activeDocument!.id); actions.openDockTab("right", kind); } }] : []),
      ...(() => {
        const document = state.activeDocument ?? null;
        const panel = structureEditAvailable(document) ? "structure-edit" : geometryPanelAvailable(document) ? "geometry" : null;
        return document && panel ? OPTIMIZATION_COMMANDS.map(({ command, label }) => ({ id: `optimization-${command}`, group: "Calculate", label, description: "",
          shortcut: command === "optimize" ? "⌥⌘O" : undefined, run: () => requestOptimizationCommand(actions, document, panel, command) })) : [];
      })(),
      ...(state.activeDocument?.renderer === "molstar" ? [
        ...SELECT_COMMANDS.map(({ command, label }) => ({ id: `select-${command}`, group: "Select", label, description: "",
          run: () => runSelectCommand(actions, state.activeDocument!, command) })),
        ...(structureEditAvailable(state.activeDocument) ? [{ id: "select-smarts", group: "Select", label: "Select by SMARTS…", description: "",
          run: () => openSmartsSelect(state.activeDocument!) }] : []),
        { id: "export-svg", group: "Export", label: "Export image as SVG", description: "", run: () => exportSceneSvg(actions, state.activeDocument!) },
        { id: "record-movie", group: "Export", label: "Record movie…", description: "", run: () => openMovieDialog(state.activeDocument!) },
      ] : []),
      // Building blocks can be pasted, so the library does not need an open collection.
      { id: "enumerate-library", group: "Collection", label: "Enumerate library…", description: "", run: () => openEnumerateLibrary(state.activeDocument ?? null) },
      ...(state.activeDocument ? pluginCommands.map(entry => ({ id: `avogadro-command-${entry.id}`, group: "Extensions", label: entry.path.join(" › "),
        description: entry.plugin.name, run: () => startAvogadroCommand(entry, state.activeDocument!) })) : []),
      ...buildShellCommands(state, actions, query).map((command) => ({
        ...command,
        group: command.group === "Suggested" ? "Quick actions" : command.group,
        icon: commandIcons[command.id] ?? ArrowRight,
        shortcut: commandShortcuts[command.id],
      })),
    ];
    return commands;
  }, [actions, projectItems, query, state, hasVibrations, hasOrbitals, hasPotential, hasFields, hasScientificSpectra, hasPlots, hasCrystal, hasSymmetry, pluginCommands]);

  const visibleItems = useMemo<PaletteItem[]>(() => {
    const queryUrl = query.trim();
    const allItems: PaletteItem[] = isRemoteStructureUrl(queryUrl)
      ? [{
          id: `fetch-structure-url:${queryUrl}`,
          group: "Suggested",
          label: "Open structure from URL",
          description: queryUrl,
          run: () => actions.openStructureUrlInMolstar(queryUrl),
        }, ...items]
      : items;
    const matches = filterShellCommands(allItems, query);
    let structures = 0;
    return matches.filter((item) => query.trim() || item.group !== "Structures" || ++structures <= 9)
      .map((item, index) => ({ ...item, shortcut: item.group === "Structures" && index < 9 ? `⌘${index + 1}` : item.shortcut }));
  }, [actions, items, query]);

  const visibleGroups = useMemo(() => {
    const groups: Array<{ heading: string; items: PaletteItem[] }> = [];
    for (const item of visibleItems) {
      const heading = query.trim() ? "Results" : item.group;
      let group = groups.find((candidate) => candidate.heading === heading);
      if (!group) {
        group = { heading, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }, [query, visibleItems]);

  const firstValue = visibleItems[0]?.id ?? "";
  const [selection, setSelectedValue] = useState(firstValue);
  const selectedValue = visibleItems.some(item => item.id === selection) ? selection : firstValue;
  useEffect(() => {
    if (selection !== selectedValue) setSelectedValue(selectedValue);
  }, [selection, selectedValue]);

  useEffect(() => {
    setSelectedValue(firstValue);
    listRef.current?.scrollTo({ top: 0 });
  }, [firstValue, isOpen, query]);

  const runItem = (item: PaletteItem) => {
    const kind = item.id.startsWith("workbench-tool-") ? item.id.slice("workbench-tool-".length) as WorkbenchToolDockKind : null;
    workbenchFocus.current = kind && state.activeDocument && state.activeTab ? { kind, documentId: state.activeDocument.id, workspaceId: state.activeTab.id } : null;
    onClose();
    void Promise.resolve(item.run()).catch((error) => {
      onRunError(error, `${item.label} failed`);
    });
  };
  const virtual = useVirtualResults({ items: visibleItems, query, selectedValue, select: setSelectedValue, run: runItem, listRef });
  const renderItem = (item: PaletteItem, index: number) => {
    const Icon = item.icon ?? ArrowRight;
    const content = <>
      <Icon aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <CommandShortcut className="flex min-w-0 items-center gap-2 tracking-normal">
        {item.detail ? <span className="max-w-32 truncate">{item.detail}</span> : null}
        {item.shortcut ? <Kbd className="h-auto py-0.5 leading-none text-current opacity-80">{item.shortcut}</Kbd> : null}
      </CommandShortcut>
    </>;
    return <PaletteResultItem key={item.id} value={item.id} onSelect={() => runItem(item)} title={item.description}
      virtual={virtual.enabled} id={virtual.itemId(index)} index={index} count={visibleItems.length}>{content}</PaletteResultItem>;
  };

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onCloseAutoFocus={event => {
        const intent = workbenchFocus.current;
        workbenchFocus.current = null;
        if (intent && focusToolDock(intent.kind, intent.documentId, intent.workspaceId)) event.preventDefault();
      }}
      title="Command Palette"
      description="Search commands and structures."
    >
      <Command
        label="Command Palette"
        shouldFilter={false}
        value={selectedValue}
        onValueChange={setSelectedValue}
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) { virtual.onKeyDown(event); return; }
          const key = event.key.toLowerCase();
          if (!event.shiftKey && /^[1-9]$/.test(key)) {
            // Keep palette shortcuts from also switching workspace tabs.
            event.preventDefault();
            event.stopPropagation();
            const item = visibleItems[Number(key) - 1];
            if (item?.group === "Structures") runItem(item);
            return;
          }
          const commandId = key === "o" ? event.shiftKey ? "open-recent" : "open-structure"
            : !event.shiftKey && key === "," ? "open-settings"
            : !event.shiftKey && key === "p" ? "search-projects" : null;
          if (!commandId) { virtual.onKeyDown(event); return; }
          event.preventDefault();
          event.stopPropagation();
          if (commandId === "search-projects") onQueryChange("");
          else {
            const command = items.find((item) => item.id === commandId);
            if (command) runItem(command);
          }
        }}
      >
        <CommandInput
          asChild
          value={query}
          variant="plain"
          onValueChange={onQueryChange}
          placeholder="Search structures or run a command"
          aria-label="Search commands and open structures"
        ><input aria-activedescendant={visibleItems.length ? virtual.activeId : undefined} /></CommandInput>
        <CommandList ref={listRef}>
          {visibleItems.length === 0 ? (
            <CommandEmpty>No results found.</CommandEmpty>
          ) : virtual.enabled ? (
            <CommandGroup heading="Results" forceMount>
              <VirtualResults count={visibleItems.length} rowHeight={virtual.rowHeight} indices={virtual.indices}
                renderItem={index => renderItem(visibleItems[index], index)} />
            </CommandGroup>
          ) : (
            visibleGroups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map(item => renderItem(item, visibleItems.indexOf(item)))}
              </CommandGroup>
            ))
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
