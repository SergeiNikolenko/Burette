import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Command as CommandRoot,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import {
  Content as DialogContent,
  Description as DialogDescription,
  Overlay as DialogOverlay,
  Portal as DialogPortal,
  Root as DialogRoot,
  Title as DialogTitle,
} from "@radix-ui/react-dialog";
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
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();

  useLayoutEffect(() => {
    setPortalContainer(document.querySelector<HTMLElement>(".app-shell") ?? document.body);
  }, [isOpen]);

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

  if (!portalContainer) return null;

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal container={portalContainer}>
        <DialogOverlay cmdk-overlay="" />
        <DialogContent cmdk-dialog="">
          <DialogTitle className="command-palette-sr-only">Command Palette</DialogTitle>
          <DialogDescription className="command-palette-sr-only">
            Search commands and structures.
          </DialogDescription>
          <CommandRoot
            label="Command Palette"
            shouldFilter={false}
            value={selectedValue}
            onValueChange={setSelectedValue}
          >
            <CommandInput
              value={query}
              onValueChange={onQueryChange}
              placeholder="Search commands and structures..."
              aria-label="Search commands and open structures"
            />
            <CommandList ref={listRef}>
              {visibleItems.length === 0 ? (
                <CommandEmpty>No results found.</CommandEmpty>
              ) : (
                visibleGroups.map((group) => (
                  <CommandGroup key={group.heading} heading={group.heading}>
                    {group.items.map((item) => (
                      <CommandItem key={item.id} value={item.id} onSelect={() => runItem(item)}>
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))
              )}
            </CommandList>
          </CommandRoot>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
