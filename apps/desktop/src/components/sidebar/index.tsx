import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  Cancel01Icon,
  File02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { appInstanceLabel } from "../../lib/instance";
import { filterSidebarProjects, type SidebarProject, type SidebarProjectItem } from "../../lib/sidebar-projects";
import { ScrollFade } from "../scroll-fade";
import { rendererLabel } from "../format";
import type { ShellActions, ShellViewState } from "../types";

export const Sidebar = forwardRef<HTMLInputElement, {
  state: ShellViewState;
  actions: ShellActions;
  open: boolean;
}>(({ state, actions, open }, searchRef) => {
  const visibleProjects = filterSidebarProjects(state.sidebarProjects, state.sidebarQuery);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState({
    left: 12,
    top: 528,
    width: 210,
    maxHeight: 260,
  });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);

  const updateWorkspaceMenuPosition = useCallback(() => {
    const button = workspaceButtonRef.current;
    if (!button) return;
    const margin = 8;
    const menuHeight = 68;
    const rect = button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 210), window.innerWidth - margin * 2);
    setWorkspaceMenuPosition({
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
      top: Math.max(margin, rect.top - menuHeight - margin),
      width,
      maxHeight: Math.max(48, rect.top - margin * 2),
    });
  }, []);

  useEffect(() => {
    if (!workspaceMenuOpen) return undefined;
    updateWorkspaceMenuPosition();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceMenuOpen(false);
    };
    const onResize = () => updateWorkspaceMenuPosition();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [updateWorkspaceMenuPosition, workspaceMenuOpen]);

  const runWorkspaceAction = (action: () => void | Promise<void>) => {
    setWorkspaceMenuOpen(false);
    void action();
  };

  const toggleWorkspaceMenu = () => {
    if (!workspaceMenuOpen) updateWorkspaceMenuPosition();
    setWorkspaceMenuOpen((open) => !open);
  };

  const workspaceMenuStyle = {
    "--workspace-menu-left": workspaceMenuPosition.left + "px",
    "--workspace-menu-top": workspaceMenuPosition.top + "px",
    "--workspace-menu-width": workspaceMenuPosition.width + "px",
    "--workspace-menu-max-height": workspaceMenuPosition.maxHeight + "px",
  } as CSSProperties;

  return (
    <aside
      className="sidebar"
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
      inert={!open}
      style={{ width: state.sidebarWidth }}
    >
      <div className="sidebar-spacer" data-tauri-drag-region />
      <ScrollFade className="sidebar-scroll">
        <div className="sidebar-search-row">
          <span className="sidebar-search-icon" aria-hidden="true">
            <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
          </span>
          <input
            ref={searchRef}
            type="text"
            className="sidebar-search-input"
            value={state.sidebarQuery}
            onChange={(event) => actions.setSidebarQuery(event.target.value)}
            placeholder="Search projects and structures"
            aria-label="Search projects and structures"
          />
          <kbd>⌘<span>P</span></kbd>
        </div>
        <SidebarSection title="Projects">
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
                  projectCount={visibleProjects.length}
                  state={state}
                  actions={actions}
                />
              ))}
            </div>
          )}
        </SidebarSection>
      </ScrollFade>
      <div className="sidebar-footer" ref={menuRef}>
        {workspaceMenuOpen && (
          <div className="sidebar-workspace-menu" role="menu" aria-label="Workspace actions" style={workspaceMenuStyle}>
            <button type="button" role="menuitem" onClick={() => runWorkspaceAction(actions.chooseWorkspace)}>
              Add project folder...
            </button>
            <button type="button" role="menuitem" onClick={() => runWorkspaceAction(actions.openWorkspaceFolder)}>
              Open active project folder
            </button>
          </div>
        )}
        <button
          ref={workspaceButtonRef}
          type="button"
          className="sidebar-product"
          onClick={toggleWorkspaceMenu}
          aria-haspopup="menu"
          aria-expanded={workspaceMenuOpen}
          aria-label={"Open workspace menu for " + appInstanceLabel}
          title={appInstanceLabel}
        >
          <span className="sidebar-product-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeLinejoin="round">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M8.7071 2.39644C8.31658 2.00592 7.68341 2.00592 7.29289 2.39644L4.46966 5.21966L3.93933 5.74999L4.99999 6.81065L5.53032 6.28032L7.99999 3.81065L10.4697 6.28032L11 6.81065L12.0607 5.74999L11.5303 5.21966L8.7071 2.39644ZM5.53032 9.71966L4.99999 9.18933L3.93933 10.25L4.46966 10.7803L7.29289 13.6035C7.68341 13.9941 8.31658 13.9941 8.7071 13.6035L11.5303 10.7803L12.0607 10.25L11 9.18933L10.4697 9.71966L7.99999 12.1893L5.53032 9.71966Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="sidebar-product-label">{appInstanceLabel}</span>
        </button>
      </div>
    </aside>
  );
});
Sidebar.displayName = "Sidebar";

function ProjectGroup({
  project,
  projectCount,
  state,
  actions,
}: {
  project: SidebarProject;
  projectCount: number;
  state: ShellViewState;
  actions: ShellActions;
}) {
  const expanded = state.sidebarQuery.trim().length > 0
    || state.expandedProjectIds.includes(project.id)
    || project.isActive
    || projectCount === 1;

  const handleToggle = () => {
    actions.toggleProjectExpanded(project.id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  };

  return (
    <div className="project-group" role="listitem">
      <div
        role="button"
        tabIndex={0}
        className={project.isActive ? "project-group-row active" : "project-group-row"}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
        aria-label={`${project.title}, ${project.items.length} structure${project.items.length === 1 ? "" : "s"}`}
      >
        <span className={expanded ? "project-chevron expanded" : "project-chevron"} aria-hidden="true">
          <ChevronIcon />
        </span>
        <span className="project-folder-icon" aria-hidden="true">
          <FolderIcon />
        </span>
        <span className="project-group-copy">
          <span className="project-group-title">{project.title}</span>
          {project.subtitle && <span className="project-group-subtitle">{project.subtitle}</span>}
        </span>
        <span className="project-group-count" aria-hidden="true">{project.items.length}</span>
        {project.rootPath && (
          <button
            type="button"
            className="project-open-folder"
            aria-label={`Open folder ${project.title}`}
            onClick={(event) => {
              event.stopPropagation();
              void actions.openProjectFolder(project.rootPath);
            }}
          >
            <OpenFolderIcon />
          </button>
        )}
      </div>
      {expanded && (
        <div className="project-children" role="list">
          {project.items.map((item) => (
            <ProjectItem key={item.key} item={item} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectItem({ item, actions }: { item: SidebarProjectItem; actions: ShellActions }) {
  const openItem = () => {
    if (item.documentId) {
      actions.selectDocument(item.documentId);
      return;
    }
    void actions.openRecentStructure({
      path: item.path,
      title: item.title,
      extension: item.extension,
      renderer: item.renderer,
      byteCount: item.byteCount,
      openedAt: item.openedAt ?? Date.now(),
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openItem();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={item.isActive ? "project active nested-project" : "project nested-project"}
      onClick={openItem}
      onKeyDown={handleKeyDown}
      aria-label={`${item.relativePath}, ${rendererLabel(item.renderer)}${item.isOpen ? "" : ", recent"}`}
      title={item.relativePath}
    >
      <span className="project-icon" aria-hidden="true">
        <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={2} />
      </span>
      <span className="project-copy">
        <span className="project-name">{item.title}</span>
        {item.relativePath !== item.title && (
          <span className="project-subpath">{item.relativePath}</span>
        )}
      </span>
      {!item.isOpen && <span className="project-source-badge">Recent</span>}
      {item.documentId && (
        <button
          type="button"
          className="close-hit"
          aria-label={"Close " + item.title}
          onClick={(event) => {
            event.stopPropagation();
            actions.closeDocument(item.documentId!);
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} color="currentColor" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sidebar-section" aria-label={title}>
      <div className="sidebar-section-title">{title}</div>
      {children}
    </section>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M1.75 5.25C1.75 4.42157 2.42157 3.75 3.25 3.75H6.11861C6.4931 3.75 6.85339 3.89022 7.12964 4.14291L7.87036 4.85709C8.14661 5.10978 8.5069 5.25 8.88139 5.25H12.75C13.5784 5.25 14.25 5.92157 14.25 6.75V11.25C14.25 12.0784 13.5784 12.75 12.75 12.75H3.25C2.42157 12.75 1.75 12.0784 1.75 11.25V5.25Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function OpenFolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 3.5H3.75C3.05964 3.5 2.5 4.05964 2.5 4.75V10.25C2.5 10.9404 3.05964 11.5 3.75 11.5H9.25C9.94036 11.5 10.5 10.9404 10.5 10.25V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 3H11V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.75 3.25L6 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
