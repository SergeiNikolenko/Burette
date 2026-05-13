import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import {
  useCommandPaletteSearch,
  useSetCommandPaletteSearch,
} from "../../hooks/use-command-palette";
import type { WorkspaceSearchResult } from "../../types";
import type { ShellActions, ShellViewState } from "../types";
import { useFuzzySearch } from "./use-fuzzy-search";

type Command = {
  id: string;
  label: string;
  description: string;
  run: () => void | Promise<void>;
};

function basename(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
}

function toCreatePath(root: string, rawName: string) {
  const trimmed = rawName.trim().replace(/^\/+/, "");
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  const fileName = segments.join("/");
  if (!fileName) return null;
  return `${root}/${fileName.includes(".") ? fileName : `${fileName}.pdb`}`;
}

function renderMatchedPath(result: WorkspaceSearchResult) {
  const matches = new Set(result.matchIndices);
  return Array.from(result.relativePath).map((character, index) =>
    matches.has(index) ? (
      <mark key={index} className="command-path-highlight">
        {character}
      </mark>
    ) : (
      <span key={index}>{character}</span>
    ),
  );
}

function recentFileResult(path: string): WorkspaceSearchResult {
  return {
    path,
    filename: basename(path),
    relativePath: path,
    score: 0,
    matchIndices: [],
  };
}

export function CommandPalette({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const query = useCommandPaletteSearch();
  const setQuery = useSetCommandPaletteSearch();
  const isSearchIntent = state.commandPaletteIntent === "search";
  const isRecentFilesIntent = state.commandPaletteIntent === "recent-files";
  const isCreateIntent = state.commandPaletteIntent === "create-file";
  const trimmedQuery = query.trim();
  const createPath = state.workspaceRoot && trimmedQuery ? toCreatePath(state.workspaceRoot, trimmedQuery) : null;
  const workspaceSearch = useFuzzySearch(
    state.workspaceRoot,
    query,
    state.commandPaletteOpen && !isCreateIntent && !isRecentFilesIntent,
  );
  const workspaceResults = workspaceSearch.results;
  const recentFileResults = useMemo(() => {
    if (!isRecentFilesIntent) return [];
    const normalized = query.trim().toLowerCase();
    return state.recentFiles
      .filter((entry) => {
        if (!normalized) return true;
        return entry.path.toLowerCase().includes(normalized) || basename(entry.path).toLowerCase().includes(normalized);
      })
      .slice(0, 30);
  }, [isRecentFilesIntent, query, state.recentFiles]);

  const commands = useMemo<Command[]>(
    () => {
      const recentCommands: Command[] = state.recentWorkspaces
        .filter((path) => path !== state.workspaceRoot)
        .slice(0, 5)
        .map((path) => ({
          id: "recent:" + path,
          label: "Open Recent: " + basename(path),
          description: path,
          run: () => actions.openWorkspace(path),
        }));

      return [
        ...(state.workspaceRoot ? [{ id: "toggle-sidebar", label: "Toggle Sidebar", description: "Command", run: actions.toggleSidebar }] : []),
        ...(state.activeDocument ? [{ id: "reload-structure", label: "Reload Current Structure", description: state.activeDocument.title, run: actions.reloadActive }] : []),
        ...(state.activeTabId ? [{ id: "close-tab", label: "Close Current Tab", description: "Command", run: actions.closeActiveDocument }] : []),
        ...(state.tabs.length > 0 ? [{ id: "close-all-tabs", label: "Close All Tabs", description: "Command", run: actions.closeAllTabs }] : []),
        { id: "new-tab", label: "New Tab", description: "Command", run: actions.openLauncher },
        ...(state.workspaceRoot ? [{ id: "new-file", label: "Create New Structure", description: "Command", run: () => actions.openCommandPalette("create-file") }] : []),
        { id: "open-workspace", label: "Open Workspace", description: "Command", run: actions.chooseFolder },
        ...recentCommands,
        { id: "open-file", label: "Open Structure File", description: "Command", run: actions.chooseFiles },
        ...(state.workspaceRoot ? [{ id: "search", label: "Search Structures", description: "Command", run: actions.focusSidebarSearch }] : []),
        { id: "toggle-theme", label: "Toggle Dark Mode", description: "Command", run: actions.toggleTheme },
        { id: "settings", label: "Settings", description: "Application settings", run: actions.openSettings },
        { id: "clear-cache", label: "Clear Preview Cache", description: "Quick Look and app viewer cache", run: actions.clearCache },
        { id: "reset-quick-look", label: "Reset Quick Look", description: "Refresh preview registration and cache", run: actions.resetQuickLook },
        { id: "open-logs", label: "Open Logs Folder", description: "Quick Look and runtime logs", run: actions.openLogs },
        { id: "check-updates", label: "Check for Updates", description: state.update.preferences.channel, run: actions.checkForUpdates },
        ...(state.update.availableRelease ? [{ id: "open-release", label: "Open Available Release", description: state.update.availableRelease.displayName, run: actions.openUpdateRelease }] : []),
        ...(state.workspaceRoot ? [{ id: "clear", label: "Close Workspace", description: "Command", run: actions.closeWorkspace }] : []),
      ];
    },
    [actions, state.activeDocument, state.activeTabId, state.recentWorkspaces, state.tabs.length, state.update.availableRelease, state.update.preferences.channel, state.workspaceRoot],
  );

  const filteredCommands = useMemo(() => {
    if (isSearchIntent || isCreateIntent || isRecentFilesIntent) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(normalized));
  }, [commands, isCreateIntent, isRecentFilesIntent, isSearchIntent, query]);
  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return state.documents.filter((document) => {
      return (
        document.title.toLowerCase().includes(normalized) ||
        document.path.toLowerCase().includes(normalized) ||
        document.renderer.toLowerCase().includes(normalized)
      );
    });
  }, [query, state.documents]);
  const visibleDocuments = (isSearchIntent && state.workspaceRoot) || isCreateIntent || isRecentFilesIntent ? [] : filteredDocuments;
  const hasResults = Boolean(createPath) || filteredCommands.length > 0 || visibleDocuments.length > 0 || workspaceResults.length > 0 || recentFileResults.length > 0;
  const firstValue = createPath ?? filteredCommands[0]?.id ?? workspaceResults[0]?.path ?? recentFileResults[0]?.path ?? visibleDocuments[0]?.id ?? "";
  const [selectedValue, setSelectedValue] = useState(firstValue);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedValue(firstValue);
    listRef.current?.scrollTo({ top: 0 });
  }, [firstValue, query, state.commandPaletteIntent]);

  async function runCommand(command: Command) {
    await command.run();
    if (command.id !== "new-file" && command.id !== "search") actions.closeCommandPalette();
  }

  async function createFile(path: string) {
    actions.closeCommandPalette();
    await actions.createWorkspaceFile(path);
  }

  function selectWorkspaceResult(result: WorkspaceSearchResult) {
    const openDocument = state.documents.find((document) => document.path === result.path);
    actions.closeCommandPalette();
    if (openDocument) {
      actions.selectDocument(openDocument.id);
    } else {
      void actions.openWorkspaceFile(result.path);
    }
  }

  function selectDocumentResult(documentId: string) {
    actions.closeCommandPalette();
    actions.selectDocument(documentId);
  }

  return (
    <CommandDialog
      open={state.commandPaletteOpen}
      onOpenChange={(open) => {
        if (!open) actions.closeCommandPalette();
      }}
      label="Command Palette"
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput
        placeholder={isCreateIntent ? "Create a new structure..." : isRecentFilesIntent ? "Search recent structures..." : isSearchIntent ? "Search structures..." : "Search..."}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList ref={listRef}>
        {isCreateIntent ? (
          <>
            {!state.workspaceRoot && <CommandEmpty>Open a workspace before creating structures.</CommandEmpty>}
            {state.workspaceRoot && !trimmedQuery && <CommandEmpty>Type a structure name to create it.</CommandEmpty>}
            {state.workspaceRoot && trimmedQuery && !createPath && <CommandEmpty>Use a file name inside the workspace.</CommandEmpty>}
            {createPath && (
              <CommandGroup heading="Create structure">
                <CommandItem
                  value={createPath}
                  onSelect={() => void createFile(createPath)}
                >
                  <div className="command-item-content">
                    <span className="command-item-title">
                      <span>Create: {basename(createPath)}</span>
                    </span>
                    <small>{createPath}</small>
                  </div>
                </CommandItem>
              </CommandGroup>
            )}
          </>
        ) : workspaceSearch.isSearching ? (
          <CommandEmpty>Searching workspace...</CommandEmpty>
        ) : !hasResults ? (
          <CommandEmpty>
            {isRecentFilesIntent ? "No recent structures in this workspace." : isSearchIntent && !query.trim() ? "Type to search workspace structures." : "No results found."}
          </CommandEmpty>
        ) : (
          <CommandGroup heading={query.trim() || isSearchIntent ? "Results" : "Suggested"}>
            {filteredCommands.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                onSelect={() => void runCommand(command)}
              >
                <div className="command-item-content">
                  <span className="command-item-title">
                    <span>{command.label}</span>
                  </span>
                  <small>{command.description}</small>
                </div>
              </CommandItem>
            ))}
            {workspaceResults.map((result) => (
              <CommandItem
                key={result.path}
                value={result.path}
                onSelect={() => selectWorkspaceResult(result)}
              >
                <div className="command-item-content">
                  <span className="command-item-title">
                    <span>{result.filename}</span>
                  </span>
                  <small>{renderMatchedPath(result)}</small>
                </div>
              </CommandItem>
            ))}
            {recentFileResults.map((entry) => (
              <CommandItem
                key={entry.path}
                value={entry.path}
                onSelect={() => selectWorkspaceResult(recentFileResult(entry.path))}
              >
                <div className="command-item-content">
                  <span className="command-item-title">
                    <span>{basename(entry.path)}</span>
                  </span>
                  <small>{entry.path}</small>
                </div>
              </CommandItem>
            ))}
            {visibleDocuments.map((document) => (
              <CommandItem
                key={document.id}
                value={document.id}
                onSelect={() => selectDocumentResult(document.id)}
              >
                <div className="command-item-content">
                  <span className="command-item-title">
                    <span>{document.title}</span>
                  </span>
                  <small>{document.path}</small>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
