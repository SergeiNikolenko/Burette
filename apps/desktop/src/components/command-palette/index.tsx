import { openOrbitals, useOrbitalsAvailable, ORBITALS_COMMAND } from "../../lib/workbench/orbitals-tool";
import { focusToolDock, type WorkbenchToolDockKind } from "../../lib/workbench/focus-tool-dock";
import { openVibrations, useVibrationsAvailable, VIBRATIONS_COMMAND } from "../../lib/workbench/vibrations-tool";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ArrowRight, Clipboard, FileDocument, FolderOpen, History, Link, Plus, Search, SettingsCog, type AppIconType } from "../ui/app-icons";
import { Kbd } from "../ui/kbd";
import { formatBytes, rendererLabel } from "../format";
import type { ShellActions, ShellViewState } from "../types";
import { isRemoteStructureUrl } from "../../lib/remote-structure";
import { buildShellCommands, filterShellCommands, type ShellCommand } from "../../lib/shell-commands";

type CommandPaletteProps = {
  state: ShellViewState;
  actions: ShellActions;
  isOpen: boolean;
  query: string;
  onQueryChange: (query: string) => void;
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
  query,
  onQueryChange,
  onClose,
  onRunError,
}: CommandPaletteProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const workbenchFocus = useRef<{ kind: WorkbenchToolDockKind; documentId: string; workspaceId: string } | null>(null);
  const hasOrbitals = useOrbitalsAvailable(state.activeDocument ?? null);
  const hasVibrations = useVibrationsAvailable(state.activeDocument ?? null);

  const items = useMemo<PaletteItem[]>(() => {
    const projectItems = state.sidebarProjects.flatMap((project) => project.items.map((item) => ({
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
    })));

    const commands: PaletteItem[] = [
      ...projectItems,
      ...(hasOrbitals && state.activeDocument ? [{ id: "workbench-tool-orbitals", group: "Suggested", ...ORBITALS_COMMAND, run: () => openOrbitals(actions, state.activeDocument!.id) }] : []),
      ...(hasVibrations && state.activeDocument ? [{ id: "workbench-tool-vibrations", group: "Suggested", ...VIBRATIONS_COMMAND, run: () => openVibrations(actions, state.activeDocument!.id) }] : []),
      ...buildShellCommands(state, actions, query).map((command) => ({
        ...command,
        group: command.group === "Suggested" ? "Quick actions" : command.group,
        icon: commandIcons[command.id] ?? ArrowRight,
        shortcut: commandShortcuts[command.id],
      })),
    ];
    return commands;
  }, [actions, query, state, hasVibrations, hasOrbitals]);

  const visibleItems = useMemo(() => {
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
  const [selectedValue, setSelectedValue] = useState(firstValue);

  useEffect(() => {
    setSelectedValue(firstValue);
    listRef.current?.scrollTo({ top: 0 });
  }, [firstValue, isOpen, query]);

  const runItem = (item: PaletteItem) => {
    const kind = item.id === "workbench-tool-vibrations" ? "vibrations" : item.id === "workbench-tool-orbitals" ? "orbitals" : item.id === "workbench-tool-scientific-spectra" ? "scientific-spectra" : null;
    workbenchFocus.current = kind && state.activeDocument && state.activeTab ? { kind, documentId: state.activeDocument.id, workspaceId: state.activeTab.id } : null;
    onClose();
    void Promise.resolve(item.run()).catch((error) => {
      onRunError(error, `${item.label} failed`);
    });
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
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
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
          if (!commandId) return;
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
          value={query}
          variant="plain"
          onValueChange={onQueryChange}
          placeholder="Search structures or run a command"
          aria-label="Search commands and open structures"
        />
        <CommandList ref={listRef}>
          {visibleItems.length === 0 ? (
            <CommandEmpty>No results found.</CommandEmpty>
          ) : (
            visibleGroups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((item) => {
                  const Icon = item.icon ?? ArrowRight;
                  return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => runItem(item)}
                    title={item.description}
                  >
                    <Icon aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <CommandShortcut className="flex min-w-0 items-center gap-2 tracking-normal">
                      {item.detail ? <span className="max-w-32 truncate">{item.detail}</span> : null}
                      {item.shortcut ? <Kbd className="h-auto py-0.5 leading-none text-current opacity-80">{item.shortcut}</Kbd> : null}
                    </CommandShortcut>
                  </CommandItem>
                  );
                })}
              </CommandGroup>
            ))
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
