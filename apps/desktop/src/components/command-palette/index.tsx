import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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

type PaletteItem = ShellCommand;

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

  const items = useMemo<PaletteItem[]>(() => {
    const projectItems = state.sidebarProjects.flatMap((project) => project.items.map((item) => ({
      id: `${item.source}-${item.path}`,
      group: "Projects",
      label: `${project.title}: ${item.title}`,
      description: `${item.relativePath} · ${rendererLabel(item.renderer)} · ${formatBytes(item.byteCount)}${item.isOpen ? "" : " · Recent"}`,
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
      ...buildShellCommands(state, actions, query),
      ...projectItems,
    ];
    return commands;
  }, [actions, query, state]);

  const visibleItems = useMemo(() => {
    const queryUrl = query.trim();
    const allItems = isRemoteStructureUrl(queryUrl)
      ? [{
          id: `fetch-structure-url:${queryUrl}`,
          group: "Suggested",
          label: "Fetch URL in Mol*",
          description: queryUrl,
          run: () => actions.openStructureUrlInMolstar(queryUrl),
        }, ...items]
      : items;
    return filterShellCommands(allItems, query);
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
      title="Command Palette"
      description="Search commands and structures."
      className="top-[16%] w-[min(560px,90vw)] sm:max-w-[min(560px,90vw)]"
    >
      <Command
        label="Command Palette"
        shouldFilter={false}
        value={selectedValue}
        onValueChange={setSelectedValue}
        className="bg-transparent p-0"
      >
        <CommandInput
          value={query}
          onValueChange={onQueryChange}
          placeholder="Search commands and structures..."
          aria-label="Search commands and open structures"
          className="pl-1.5"
        />
        <CommandList ref={listRef} className="max-h-80 p-1">
          {visibleItems.length === 0 ? (
            <CommandEmpty>No results found.</CommandEmpty>
          ) : (
            visibleGroups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading} className="p-0">
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => runItem(item)}
                    className="flex-col items-start gap-0.5 px-3 py-2.5"
                  >
                    <span className="w-full truncate">{item.label}</span>
                    <small className="w-full truncate text-xs text-muted-foreground">
                      {item.description}
                    </small>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
