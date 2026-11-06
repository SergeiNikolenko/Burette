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
      ...buildShellCommands(state, actions, query).map((command) => ({
        ...command,
        group: command.group === "Suggested" ? "Quick actions" : command.group,
        icon: commandIcons[command.id] ?? ArrowRight,
        shortcut: commandShortcuts[command.id],
      })),
    ];
    return commands;
  }, [actions, projectItems, query, state]);

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
