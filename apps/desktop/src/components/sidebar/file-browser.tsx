import type { MouseEvent as ReactMouseEvent } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { filterSidebarProjects } from "../../lib/sidebar-projects";
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
  const visibleProjects = filterSidebarProjects(state.sidebarProjects, state.sidebarQuery);
  const pinnedItems = visibleProjects.flatMap((project) => project.items.filter((item) => item.isPinned));
  const projectsExpanded = state.projectsOpen || state.sidebarQuery.trim().length > 0;

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
          id: "expand-all-project-folders",
          text: "Expand All Project Folders",
          action: () => {
            actions.setExpandedProjectIds(state.sidebarProjects.map((project) => project.id));
          },
        },
        {
          kind: "item" as const,
          id: "collapse-all-project-folders",
          text: "Collapse All Project Folders",
          action: () => {
            actions.setExpandedProjectIds([]);
          },
        },
      ],
      { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) },
    );
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
      {pinnedItems.length > 0 && (
        <section className="sidebar-section pinned-section" aria-label="Pinned structures">
          <div className="sidebar-section-title">Pinned</div>
          <div className="pinned-structures" role="list">
            {pinnedItems.map((item) => (
              <ProjectItem key={`pinned:${item.key}`} item={item} actions={actions} nested={false} />
            ))}
          </div>
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
              {state.sidebarQuery.trim() ? "No matching projects or structures" : "No project structures yet"}
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
