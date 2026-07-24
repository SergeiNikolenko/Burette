import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { AnimatedOrbitIcon } from "../ui/animated-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isRemoteStructureUrl } from "../../lib/remote-structure";
import { filterSidebarProjects } from "../../lib/sidebar-projects";
import { buildShellCommands, filterShellCommands } from "../../lib/shell-commands";
import { hasStructureDrag, readStructureDragPayload } from "../../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "../drop-action-executor";
import { RadixDropdownMenu } from "../radix-menu";
import { ScrollFade } from "../scroll-fade";
import type { ShellActions, ShellViewState } from "../types";
import { ProjectGroup, ProjectItem } from "./file-tree-node";
import { useSidebarStructureDrag } from "./use-sidebar-structure-drag";

const SIDEBAR_TREE_ROW_SELECTOR = ".project-group-row, .project-folder-row, [data-sidebar-structure-path]";
const SIDEBAR_COMMAND_LIMIT = 6;

// DOM-based tree keyboard navigation: move focus across visible rows with the
// arrow keys, expand/collapse the focused folder with Right/Left, and jump with
// Home/End. Rows inside a collapsed subtree ([data-expanded="false"]) are skipped.
function handleSidebarTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(SIDEBAR_TREE_ROW_SELECTOR),
  ).filter((row) => !row.closest('[data-expanded="false"]'));
  if (rows.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const currentIndex = active ? rows.indexOf(active) : -1;

  if (active && active.hasAttribute("aria-expanded")) {
    const isExpanded = active.getAttribute("aria-expanded") === "true";
    if (event.key === "ArrowRight" && !isExpanded) {
      event.preventDefault();
      active.click();
      return;
    }
    if (event.key === "ArrowLeft" && isExpanded) {
      event.preventDefault();
      active.click();
      return;
    }
  }

  let nextIndex = currentIndex;
  switch (event.key) {
    case "ArrowDown":
    case "ArrowRight":
      nextIndex = currentIndex < 0 ? 0 : Math.min(rows.length - 1, currentIndex + 1);
      break;
    case "ArrowUp":
    case "ArrowLeft":
      nextIndex = currentIndex < 0 ? 0 : Math.max(0, currentIndex - 1);
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = rows.length - 1;
      break;
  }
  const nextRow = rows[nextIndex];
  if (nextRow && nextRow !== active) {
    event.preventDefault();
    nextRow.focus();
  }
}

export function FileBrowser({
  state,
  actions,
}: {
  state: ShellViewState;
  actions: ShellActions;
}) {
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(() => state.sidebarQuery.trim().length > 0);
  const [ketcherDropActive, setKetcherDropActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const hideProjectPreviews = state.buildInfo.isAgentShell && !state.workspacePath;
  const sidebarQuery = state.sidebarQuery.trim();
  const hasSidebarQuery = sidebarQuery.length > 0;
  const canFetchRemoteStructure = isRemoteStructureUrl(sidebarQuery);
  const matchingCommands = hasSidebarQuery
    ? filterShellCommands(buildShellCommands(state, actions, sidebarQuery), sidebarQuery).slice(0, SIDEBAR_COMMAND_LIMIT)
    : [];
  const visibleProjects = hideProjectPreviews ? [] : filterSidebarProjects(state.sidebarProjects, state.sidebarQuery);
  const pinnedItems = visibleProjects.flatMap((project) => project.items.filter((item) => item.isPinned));
  const pinnedExpanded = pinnedOpen || hasSidebarQuery;
  const projectsExpanded = state.projectsOpen || hasSidebarQuery;
  const visibleProjectIds = visibleProjects.map((project) => project.id);
  const allVisibleProjectsExpanded = visibleProjectIds.length > 0
    && visibleProjectIds.every((projectId) => state.expandedProjectIds.includes(projectId));
  const ketcherDrag = useSidebarStructureDrag({
    actions,
    getPayload: () => ({
      paths: [],
      records: [],
      items: [{
        kind: "ketcher",
        title: "Ketcher",
        detail: "Molecule sketch editor",
      }],
    }),
    state,
  });

  useEffect(() => {
    if (hasSidebarQuery) setSearchOpen(true);
  }, [hasSidebarQuery]);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  const toggleSearch = () => {
    if (searchOpen) {
      actions.setSidebarQuery("");
      setSearchOpen(false);
      return;
    }
    setSearchOpen(true);
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    actions.setSidebarQuery("");
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchToggleRef.current?.focus());
  };

  const toggleAllProjectFolders = () => {
    if (!projectsExpanded) actions.toggleProjectsOpen();
    actions.setExpandedProjectIds(allVisibleProjectsExpanded ? [] : state.sidebarProjects.map((project) => project.id));
  };

  const handleKetcherDragOver = (event: ReactDragEvent<HTMLButtonElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    const payload = readStructureDragPayload(event.dataTransfer);
    if (shellDropActionChoices(payload, { kind: "ketcher" }, { kind: "unknown" }).length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setKetcherDropActive(true);
  };

  const handleKetcherDragLeave = (event: ReactDragEvent<HTMLButtonElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setKetcherDropActive(false);
  };

  const handleKetcherDrop = (event: ReactDragEvent<HTMLButtonElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = readStructureDragPayload(event.dataTransfer);
    const choices = shellDropActionChoices(payload, { kind: "ketcher" }, { kind: "unknown" });
    if (choices.length === 0) return;
    setKetcherDropActive(false);
    actions.setStructureDragActive(false);
    runShellDropActionChoices(actions, payload, choices, { x: event.clientX, y: event.clientY });
  };

  return (
    <ScrollFade className="sidebar-scroll">
      <div className="sidebar-browser-header">
        <strong className="sidebar-browser-title">Burette</strong>
        <button
          ref={searchToggleRef}
          type="button"
          className="sidebar-search-toggle"
          data-sidebar-search-toggle
          onClick={toggleSearch}
          aria-label={searchOpen ? "Close project search" : "Search projects and structures"}
          aria-expanded={searchOpen}
          aria-controls="sidebar-project-search"
        >
          <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
        </button>
      </div>
      {searchOpen ? (
        <label
          id="sidebar-project-search"
          className="sidebar-search-row"
          aria-label="Search projects and structures"
        >
          <span className="sidebar-search-icon" aria-hidden="true">
            <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
          </span>
          <input
            ref={searchInputRef}
            type="search"
            data-sidebar-search
            value={state.sidebarQuery}
            onChange={(event) => actions.setSidebarQuery(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search"
            aria-label="Search projects and structures"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>⌘<span>P</span></kbd>
        </label>
      ) : null}
      {matchingCommands.length > 0 && (
        <section className="sidebar-section sidebar-command-section" aria-label="Matching commands">
          <div className="sidebar-section-header">
            <span className="sidebar-section-title">Commands</span>
          </div>
          {matchingCommands.map((command) => (
            <button
              key={command.id}
              type="button"
              className="sidebar-command-row"
              title={command.description}
              onClick={() => {
                actions.setSidebarQuery("");
                void command.run();
              }}
            >
              <span className="sidebar-command-label">{command.label}</span>
              <span className="sidebar-command-description">{command.description}</span>
            </button>
          ))}
        </section>
      )}
      {canFetchRemoteStructure && (
        <button
          type="button"
          className="sidebar-search-action-row"
          onClick={() => actions.openStructureUrlInMolstar(sidebarQuery)}
        >
          Fetch URL in Mol*
        </button>
      )}
      <button
        type="button"
        className="sidebar-tool-row"
        draggable
        onMouseDown={ketcherDrag.onMouseDown}
        onClickCapture={ketcherDrag.onClickCapture}
        onClick={actions.openKetcher}
        onDragStart={ketcherDrag.onDragStart}
        onDragEnd={ketcherDrag.onDragEnd}
        onDragOver={handleKetcherDragOver}
        onDragLeave={handleKetcherDragLeave}
        onDrop={handleKetcherDrop}
        data-drop-active={ketcherDropActive || undefined}
        aria-label="Open Ketcher"
      >
        <span className="sidebar-tool-icon" aria-hidden="true">
          <AnimatedOrbitIcon size={16} />
        </span>
        <span className="sidebar-tool-label">Ketcher</span>
      </button>
      {pinnedItems.length > 0 && (
        <section className="sidebar-section pinned-section" aria-label="Pinned structures">
          <div className="sidebar-section-header">
            <button
              type="button"
              className="sidebar-section-title-button"
              onClick={() => setPinnedOpen((value) => !value)}
              aria-expanded={pinnedExpanded}
              aria-controls="sidebar-pinned-tree"
            >
              <span>Pinned</span>
              <span className={pinnedExpanded ? "sidebar-section-chevron expanded" : "sidebar-section-chevron"} aria-hidden="true">
                <ChevronIcon />
              </span>
            </button>
          </div>
          {pinnedExpanded && (
            <div className="pinned-structures" role="list" id="sidebar-pinned-tree">
              {pinnedItems.map((item) => (
                <ProjectItem key={`pinned:${item.key}`} item={item} state={state} actions={actions} nested={false} />
              ))}
            </div>
          )}
        </section>
      )}
      {!hideProjectPreviews && (
      <section className="sidebar-section" aria-label="Projects">
        <div className="sidebar-section-header">
          <button
            type="button"
            className="sidebar-section-title-button"
            onClick={actions.toggleProjectsOpen}
            aria-expanded={projectsExpanded}
            aria-controls="sidebar-projects-tree"
          >
            <span>Projects</span>
            <span className={projectsExpanded ? "sidebar-section-chevron expanded" : "sidebar-section-chevron"} aria-hidden="true">
              <ChevronIcon />
            </span>
          </button>
          <button
            type="button"
            className="sidebar-section-menu-button"
            aria-label={allVisibleProjectsExpanded ? "Collapse all project folders" : "Expand all project folders"}
            title={allVisibleProjectsExpanded ? "Collapse all project folders" : "Expand all project folders"}
            onClick={toggleAllProjectFolders}
          >
            <ExpandCollapseIcon collapsed={allVisibleProjectsExpanded} />
          </button>
          <RadixDropdownMenu
            items={[
              {
                kind: "item",
                id: "add-project-folder",
                text: "Add Project Folder...",
                action: () => {
                  void actions.chooseWorkspace();
                },
              },
              { kind: "separator" },
              {
                kind: "item",
                id: "close-all-tabs",
                text: "Close All Tabs",
                action: actions.clearAllDocuments,
              },
            ]}
            trigger={(
              <button
                type="button"
                className="sidebar-section-menu-button"
                aria-label="Project options"
              >
                <MoreIcon />
              </button>
            )}
          />
        </div>
        {projectsExpanded && (
          visibleProjects.length === 0 ? (
            <div className="empty-sidebar">
              {hasSidebarQuery ? "No matching projects or structures" : "No project structures yet"}
            </div>
          ) : (
            <div className="project-tree" role="tree" id="sidebar-projects-tree" onKeyDown={handleSidebarTreeKeyDown}>
              {visibleProjects.map((project) => (
                <ProjectGroup
                  key={project.id}
                  project={project}
                  state={state}
                  actions={actions}
                />
              ))}
            </div>
          )
        )}
      </section>
      )}
    </ScrollFade>
  );
}

function ExpandCollapseIcon({ collapsed }: { collapsed: boolean }) {
  return collapsed ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 3.5L6.9 6.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6.9 4.7V6.9H4.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 12.5L9.1 9.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9.1 11.3V9.1H11.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.9 6.9L3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3.5 5.7V3.5H5.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.1 9.1L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12.5 10.3V12.5H10.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}
