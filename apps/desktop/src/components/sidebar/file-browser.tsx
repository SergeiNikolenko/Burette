import { useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Atom01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { filterSidebarProjects } from "../../lib/sidebar-projects";
import { hasStructureDrag, readStructureDragPayload, structureDragRecordsToFragments } from "../../lib/structure-drag";
import { ScrollFade } from "../scroll-fade";
import { showNativeContextMenu } from "../native-context-menu";
import type { ShellActions, ShellViewState } from "../types";
import { ProjectGroup, ProjectItem } from "./file-tree-node";

export function FileBrowser({
  state,
  actions,
}: {
  state: ShellViewState;
  actions: ShellActions;
}) {
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [ketcherDropActive, setKetcherDropActive] = useState(false);
  const sidebarQuery = state.sidebarQuery.trim();
  const hasSidebarQuery = sidebarQuery.length > 0;
  const visibleProjects = filterSidebarProjects(state.sidebarProjects, state.sidebarQuery);
  const pinnedItems = visibleProjects.flatMap((project) => project.items.filter((item) => item.isPinned));
  const pinnedExpanded = pinnedOpen || hasSidebarQuery;
  const projectsExpanded = state.projectsOpen || hasSidebarQuery;
  const visibleProjectIds = visibleProjects.map((project) => project.id);
  const allVisibleProjectsExpanded = visibleProjectIds.length > 0
    && visibleProjectIds.every((projectId) => state.expandedProjectIds.includes(projectId));

  const toggleAllProjectFolders = () => {
    if (!projectsExpanded) actions.toggleProjectsOpen();
    actions.setExpandedProjectIds(allVisibleProjectsExpanded ? [] : state.sidebarProjects.map((project) => project.id));
  };

  const showProjectsMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(
      [
        {
          kind: "item" as const,
          id: "add-project-folder",
          text: "Add Project Folder...",
          action: () => {
            void actions.chooseWorkspace();
          },
        },
        { kind: "separator" as const },
        {
          kind: "item" as const,
          id: "close-all-tabs",
          text: "Close All Tabs",
          action: () => {
            actions.clearAllDocuments();
          },
        },
      ],
      { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) },
    );
  };

  const handleKetcherDragOver = (event: ReactDragEvent<HTMLButtonElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
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
    setKetcherDropActive(false);
    actions.setStructureDragActive(false);
    const fragments = structureDragRecordsToFragments(payload.records);
    if (payload.paths.length === 0 && fragments.length === 0) return;
    actions.openKetcherWithStructures(payload.paths, fragments);
  };

  return (
    <ScrollFade className="sidebar-scroll">
      <button
        type="button"
        className="sidebar-search-row"
        onClick={actions.openCommandPalette}
        aria-label="Search projects and structures"
      >
        <span className="sidebar-search-icon" aria-hidden="true">
          <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
        </span>
        <span className="sidebar-search-label">Search</span>
        <kbd>⌘<span>P</span></kbd>
      </button>
      <button
        type="button"
        className="sidebar-tool-row"
        onClick={actions.openKetcher}
        onDragOver={handleKetcherDragOver}
        onDragLeave={handleKetcherDragLeave}
        onDrop={handleKetcherDrop}
        data-drop-active={ketcherDropActive || undefined}
        aria-label="Open Ketcher"
      >
        <span className="sidebar-tool-icon" aria-hidden="true">
          <HugeiconsIcon icon={Atom01Icon} size={16} color="currentColor" strokeWidth={2} />
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
                <ProjectItem key={`pinned:${item.key}`} item={item} actions={actions} nested={false} />
              ))}
            </div>
          )}
        </section>
      )}
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
          <button
            type="button"
            className="sidebar-section-menu-button"
            aria-label="Project options"
            aria-haspopup="menu"
            onClick={showProjectsMenu}
          >
            <MoreIcon />
          </button>
        </div>
        {projectsExpanded && (
          visibleProjects.length === 0 ? (
            <div className="empty-sidebar">
              {hasSidebarQuery ? "No matching projects or structures" : "No project structures yet"}
            </div>
          ) : (
            <div className="project-tree" role="list" id="sidebar-projects-tree">
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
