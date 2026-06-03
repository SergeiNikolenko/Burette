import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import { formatBytes, rendererLabel } from "../format";
import type { ShellActions, ShellViewState } from "../types";
import type { ViewerPreferences } from "../../types";

type CommandPaletteProps = {
  state: ShellViewState;
  actions: ShellActions;
  isOpen: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
};

type PaletteItem = {
  id: string;
  group: string;
  label: string;
  description: string;
  run: () => void | Promise<void>;
};

const rendererCommands: Array<{
  id: string;
  label: string;
  value: ViewerPreferences["rendererMode"];
}> = [
  { id: "renderer-auto", label: "Renderer: Auto", value: "auto" },
  { id: "renderer-molstar", label: "Renderer: Mol*", value: "molstar" },
  { id: "renderer-xyzrender", label: "Renderer: xyzrender external", value: "xyzrender-external" },
];

export function CommandPalette({
  state,
  actions,
  isOpen,
  query,
  onQueryChange,
  onClose,
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
      {
        id: "open-structure",
        group: "Suggested",
        label: "Open Structure",
        description: "Choose molecular structure files",
        run: actions.chooseFiles,
      },
      {
        id: "open-clipboard",
        group: "Suggested",
        label: "Open from Clipboard",
        description: "Open molecular text or copied structure paths",
        run: actions.openClipboard,
      },
      {
        id: "open-recent",
        group: "Suggested",
        label: "Open Recent",
        description: "Open the most recent structure",
        run: actions.openMostRecentStructure,
      },
      {
        id: "search-projects",
        group: "Suggested",
        label: "Search Projects and Structures",
        description: "Focus project and structure search",
        run: actions.focusSidebarSearch,
      },
      {
        id: "open-settings",
        group: "Suggested",
        label: "Settings",
        description: "Open Burette settings",
        run: actions.openSettings,
      },
      {
        id: "open-ketcher",
        group: "Suggested",
        label: "Ketcher",
        description: "Open molecule sketch tab",
        run: actions.openKetcher,
      },
      {
        id: "toggle-sidebar",
        group: "Suggested",
        label: state.sidebarOpen ? "Hide Sidebar" : "Show Sidebar",
        description: "Toggle the molecule browser",
        run: actions.toggleSidebar,
      },
      {
        id: "close-active",
        group: "Suggested",
        label: "Close Active Structure",
        description: "Close the selected molecule tab",
        run: actions.closeActiveDocument,
      },
      {
        id: "close-all",
        group: "Suggested",
        label: "Close All Structures",
        description: "Clear all open molecule tabs",
        run: actions.clearAllDocuments,
      },
      {
        id: "clear-recent",
        group: "Suggested",
        label: "Clear Recent Structures",
        description: "Forget the recent structure list",
        run: actions.clearRecentStructures,
      },
      {
        id: "clear-cache",
        group: "Suggested",
        label: "Clear Preview Cache",
        description: "Remove generated preview runtimes",
        run: actions.clearCache,
      },
      {
        id: "reveal-active",
        group: "Active Structure",
        label: "Reveal in Finder",
        description: "Show the active structure in Finder",
        run: actions.revealActiveDocument,
      },
      {
        id: "copy-active-path",
        group: "Active Structure",
        label: "Copy Path",
        description: "Copy the active structure path",
        run: actions.copyActiveDocumentPath,
      },
      {
        id: "show-active-metadata",
        group: "Active Structure",
        label: "Show Metadata",
        description: "Show active structure path, renderer, format, and size",
        run: actions.showActiveDocumentMetadata,
      },
      {
        id: "export-preview-png",
        group: "Active Structure",
        label: "Export Preview as PNG",
        description: "Save the active external SVG preview as PNG",
        run: actions.exportActivePreviewAsPng,
      },
      {
        id: "export-preview-svg",
        group: "Active Structure",
        label: "Export Preview as SVG",
        description: "Save the active external SVG preview",
        run: actions.exportActivePreviewAsSvg,
      },
      {
        id: "reset-quicklook",
        group: "Suggested",
        label: "Reset Quick Look",
        description: "Refresh Finder preview registration",
        run: actions.resetQuickLook,
      },
      {
        id: "open-logs",
        group: "Suggested",
        label: "Open Logs Folder",
        description: "Show Burette runtime logs",
        run: actions.openLogs,
      },
      {
        id: "export-diagnostics",
        group: "Suggested",
        label: "Export Diagnostics",
        description: "Save logs, environment, size report, and performance marks",
        run: actions.exportDiagnostics,
      },
      {
        id: "check-updates",
        group: "Suggested",
        label: "Check for Updates",
        description: "Check Burette releases",
        run: actions.checkForUpdates,
      },
      ...rendererCommands.map((command) => ({
        id: command.id,
        group: "Renderer",
        label: command.label,
        description: state.preferences.rendererMode === command.value ? "Current renderer mode" : "Switch renderer mode",
        run: () => actions.setPreference("rendererMode", command.value),
      })),
      ...projectItems,
    ];
    return commands;
  }, [actions, state.preferences.rendererMode, state.sidebarOpen, state.sidebarProjects]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => (
      item.label.toLowerCase().includes(normalized)
      || item.description.toLowerCase().includes(normalized)
    ));
  }, [items, query]);

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
    void item.run();
  };

  if (!portalContainer) return null;

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      label="Command Palette"
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
      container={portalContainer}
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
    </CommandDialog>
  );
}
