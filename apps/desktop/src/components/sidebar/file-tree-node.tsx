import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  File02Icon,
  Folder01Icon,
  Folder02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarProject, SidebarProjectItem } from "../../lib/sidebar-projects";
import { writeStructureDrag } from "../../lib/structure-drag";
import { rendererLabel } from "../format";
import { showNativeContextMenu } from "../native-context-menu";
import type { ShellActions, ShellViewState } from "../types";

export function ProjectGroup({
  project,
  state,
  actions,
}: {
  project: SidebarProject;
  state: ShellViewState;
  actions: ShellActions;
}) {
  const expanded = state.sidebarQuery.trim().length > 0
    || state.expandedProjectIds.includes(project.id);

  const handleToggle = () => {
    actions.toggleProjectExpanded(project.id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const items = project.rootPath
      ? [
          {
            kind: "item" as const,
            id: "open-project-folder",
            text: "Open Project Folder",
            action: () => {
              void actions.openProjectFolder(project.rootPath);
            },
          },
          { kind: "separator" as const },
          {
            kind: "item" as const,
            id: "add-project-folder",
            text: "Add Project Folder...",
            action: () => {
              void actions.chooseWorkspace();
            },
          },
        ]
      : [
          {
            kind: "item" as const,
            id: "add-project-folder",
            text: "Add Project Folder...",
            action: () => {
              void actions.chooseWorkspace();
            },
          },
        ];
    void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
  };

  return (
    <div className="project-group" role="listitem">
      <div
        role="button"
        tabIndex={0}
        className="project-group-row"
        onClick={handleToggle}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
        aria-label={`${project.title}, ${project.items.length} structure${project.items.length === 1 ? "" : "s"}`}
      >
        <span className="project-folder-icon" aria-hidden="true">
          <HugeiconsIcon icon={expanded ? Folder02Icon : Folder01Icon} size={16} color="currentColor" strokeWidth={2} />
        </span>
        <span className="project-group-copy">
          <span className="project-group-title">{project.title}</span>
        </span>
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

  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    writeStructureDrag(event.dataTransfer, [item.path]);
    actions.setStructureDragActive(true);
  };

  const handleDragEnd = () => {
    actions.setStructureDragActive(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className={item.isActive ? "project active nested-project" : "project nested-project"}
      onClick={openItem}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onKeyDown={handleKeyDown}
      aria-label={`${item.relativePath}, ${rendererLabel(item.renderer)}`}
      title={item.relativePath}
    >
      <span className="project-icon" aria-hidden="true">
        <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={2} />
      </span>
      <span className="project-copy">
        <span className="project-name">{item.title}</span>
      </span>
    </div>
  );
}
