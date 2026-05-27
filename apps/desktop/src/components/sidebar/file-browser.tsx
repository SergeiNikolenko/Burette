import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { filterSidebarProjects } from "../../lib/sidebar-projects";
import { ScrollFade } from "../scroll-fade";
import type { ShellActions, ShellViewState } from "../types";
import { ProjectGroup } from "./file-tree-node";

export function FileBrowser({
  state,
  actions,
}: {
  state: ShellViewState;
  actions: ShellActions;
}) {
  const visibleProjects = filterSidebarProjects(state.sidebarProjects, state.sidebarQuery);

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
      <section className="sidebar-section" aria-label="File browser">
        {visibleProjects.length === 0 ? (
          <div className="empty-sidebar">
            {state.sidebarQuery.trim() ? "No matching projects or structures" : "No project structures yet"}
          </div>
        ) : (
          <div className="project-tree" role="list">
            {visibleProjects.map((project) => (
              <ProjectGroup
                key={project.id}
                project={project}
                state={state}
                actions={actions}
              />
            ))}
          </div>
        )}
      </section>
    </ScrollFade>
  );
}
