import { useEffect, useMemo, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = useMemo<PaletteItem[]>(() => {
    const commands: PaletteItem[] = [
      {
        id: "open-structure",
        group: "Suggested",
        label: "Open Structure",
        description: "Choose molecular structure files",
        run: actions.chooseFiles,
      },
      {
        id: "search-structures",
        group: "Suggested",
        label: "Search Open Structures",
        description: "Focus the sidebar structure filter",
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
      ...state.recentStructures.map((structure) => ({
        id: "recent-" + structure.path,
        group: "Recent",
        label: "Open Recent: " + structure.title,
        description: `${rendererLabel(structure.renderer)} · ${formatBytes(structure.byteCount)}`,
        run: () => actions.openRecentStructure(structure),
      })),
      ...state.documents.map((document) => ({
        id: "structure-" + document.id,
        group: "Open",
        label: "Open Structure: " + document.title,
        description: `${rendererLabel(document.renderer)} · ${formatBytes(document.byteCount)}`,
        run: () => actions.selectDocument(document.id),
      })),
    ];
    return commands;
  }, [actions, state.documents, state.preferences.rendererMode, state.recentStructures, state.sidebarOpen]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => (
      item.label.toLowerCase().includes(normalized)
      || item.description.toLowerCase().includes(normalized)
    ));
  }, [items, query]);

  const visibleGroups = useMemo(() => {
    let itemIndex = 0;
    const groups: Array<{ heading: string; items: Array<{ item: PaletteItem; index: number }> }> = [];
    for (const item of visibleItems) {
      const heading = query.trim() ? "Results" : item.group;
      let group = groups.find((candidate) => candidate.heading === heading);
      if (!group) {
        group = { heading, items: [] };
        groups.push(group);
      }
      group.items.push({ item, index: itemIndex });
      itemIndex += 1;
    }
    return groups;
  }, [query, visibleItems]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, isOpen]);

  useEffect(() => {
    if (selectedIndex >= visibleItems.length) {
      setSelectedIndex(Math.max(0, visibleItems.length - 1));
    }
  }, [selectedIndex, visibleItems.length]);

  if (!isOpen) return null;

  const runItem = (item: PaletteItem) => {
    onClose();
    void item.run();
  };

  const runSelectedItem = () => {
    const item = visibleItems[selectedIndex];
    if (item) runItem(item);
  };

  const moveSelection = (direction: 1 | -1) => {
    if (!visibleItems.length) return;
    setSelectedIndex((index) => (index + direction + visibleItems.length) % visibleItems.length);
  };

  return (
    <div className="command-palette-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              runSelectedItem();
            }
          }}
          autoFocus
          placeholder="Search commands and structures..."
          aria-label="Search commands and open structures"
        />
        <div className="command-palette-list" role="listbox">
          {visibleItems.length === 0 ? (
            <div className="command-palette-empty">No results found.</div>
          ) : (
            visibleGroups.map((group) => (
              <div className="command-palette-group" key={group.heading} role="group" aria-label={group.heading}>
                <div className="command-palette-group-heading">{group.heading}</div>
                {group.items.map(({ item, index }) => (
                  <button
                    key={item.id}
                    className="command-palette-item"
                    data-selected={index === selectedIndex || undefined}
                    onClick={() => runItem(item)}
                    onMouseMove={() => setSelectedIndex(index)}
                    role="option"
                    aria-selected={index === selectedIndex}
                  >
                    <span>{item.label}</span>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
