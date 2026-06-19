import { useState, type DragEvent as ReactDragEvent } from "react";
import { filterSidebarProjects } from "../../lib/sidebar-projects";
import { hasStructureDrag, readStructureDragPayload, writeStructureDragItems } from "../../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "../drop-action-executor";
import { RadixDropdownMenu } from "../radix-menu";
import { ScrollFade } from "../scroll-fade";
import { SystemIcon } from "../system-icon";
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
  const hideProjectPreviews = state.buildInfo.isAgentShell;
  const sidebarQuery = state.sidebarQuery.trim();
  const hasSidebarQuery = sidebarQuery.length > 0;
  const visibleProjects = hideProjectPreviews ? [] : filterSidebarProjects(state.sidebarProjects, state.sidebarQuery);
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

  const handleKetcherDragStart = (event: ReactDragEvent<HTMLButtonElement>) => {
    writeStructureDragItems(event.dataTransfer, [{
      kind: "ketcher",
      title: "Ketcher",
      detail: "Molecule sketch editor",
    }]);
    actions.setStructureDragActive(true);
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
          <SystemIcon name="magnifyingglass" size={16} />
        </span>
        <span className="sidebar-search-label">Search</span>
        <kbd>⌘<span>P</span></kbd>
      </button>
      <button
        type="button"
        className="sidebar-tool-row"
        draggable
        onClick={actions.openKetcher}
        onDragStart={handleKetcherDragStart}
        onDragEnd={() => actions.setStructureDragActive(false)}
        onDragOver={handleKetcherDragOver}
        onDragLeave={handleKetcherDragLeave}
        onDrop={handleKetcherDrop}
        data-drop-active={ketcherDropActive || undefined}
        aria-label="Open Ketcher"
      >
        <span className="sidebar-tool-icon" aria-hidden="true">
          <SystemIcon name="atom" size={16} />
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
      )}
    </ScrollFade>
  );
}

function ExpandCollapseIcon({ collapsed }: { collapsed: boolean }) {
  return <SystemIcon name={collapsed ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"} size={16} />;
}

function ChevronIcon() {
  return <SystemIcon name="chevron.forward" size={10} />;
}

function MoreIcon() {
  return <SystemIcon name="ellipsis" size={16} />;
}
