import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  File02Icon,
  Folder01Icon,
  Folder02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isMoleculeCollectionPath } from "../../lib/collection-documents";
import { dockingRequestForDrop } from "../../lib/docking-documents";
import type { SidebarProject, SidebarProjectItem } from "../../lib/sidebar-projects";
import { hasStructureDrag, readStructureDragPayload, writeStructureDrag } from "../../lib/structure-drag";
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

export function ProjectItem({
  item,
  actions,
  nested = true,
}: {
  item: SidebarProjectItem;
  actions: ShellActions;
  nested?: boolean;
}) {
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
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    const payload = readStructureDragPayload(event.dataTransfer);
    const paths = payload.paths;
    const canMergeCollection = isMoleculeCollectionPath(item.path) && paths.some(isMoleculeCollectionPath);
    const canOpenDocking = Boolean(dockingRequestForDrop(item.path, paths)) || item.path.startsWith("burrete-docking://");
    const canAddToXyzrenderSheet = item.renderer === "xyzrender-external" && Boolean(item.documentId) && (paths.length > 0 || payload.records.length > 0);
    if (!canMergeCollection && !canOpenDocking && !canAddToXyzrenderSheet) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    const payload = readStructureDragPayload(event.dataTransfer);
    const paths = payload.paths;
    const canMergeCollection = isMoleculeCollectionPath(item.path) && paths.some(isMoleculeCollectionPath);
    const dockingRequest = dockingRequestForDrop(item.path, paths);
    const canAddToXyzrenderSheet = item.renderer === "xyzrender-external" && Boolean(item.documentId) && (paths.length > 0 || payload.records.length > 0);
    if (!canMergeCollection && !dockingRequest && !item.path.startsWith("burrete-docking://") && !canAddToXyzrenderSheet) return;
    event.preventDefault();
    event.stopPropagation();
    actions.setStructureDragActive(false);
    if (canAddToXyzrenderSheet && item.documentId) {
      actions.addXyzrenderSheetItems(item.documentId, payload);
      return;
    }
    if (canMergeCollection) {
      void actions.mergeMoleculeCollections(item.documentId ?? item.path, paths);
      return;
    }
    if (dockingRequest) {
      void actions.openDockingDocument(dockingRequest.receptorPath, dockingRequest.ligandPaths);
      return;
    }
    void actions.openDockingDocument(item.documentId ?? item.path, paths);
  };
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const items = [
      {
        kind: "item" as const,
        id: "open-structure",
        text: "Open",
        action: openItem,
      },
      ...(isMoleculeCollectionPath(item.path)
        ? [
            { kind: "separator" as const },
            {
              kind: "item" as const,
              id: "save-collection-as",
              text: "Save Collection As...",
              action: () => {
                void actions.saveMoleculeCollectionAs(item.documentId ?? item.path);
              },
            },
          ]
        : []),
      { kind: "separator" as const },
      {
        kind: "item" as const,
        id: item.isPinned ? "unpin-structure" : "pin-structure",
        text: item.isPinned ? "Unpin" : "Pin",
        action: () => actions.togglePinnedStructure(item.path),
      },
    ];
    void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
  };
  const className = [
    "project",
    item.isActive ? "active" : "",
    item.isPinned ? "pinned" : "",
    nested ? "nested-project" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className={className}
      onClick={openItem}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      aria-label={`${item.relativePath}, ${rendererLabel(item.renderer)}${item.isPinned ? ", pinned" : ""}`}
      title={item.relativePath}
    >
      <span className="project-icon" aria-hidden="true">
        <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={2} />
      </span>
      <span className="project-copy">
        <span className="project-name">{item.title}</span>
      </span>
      <span className="project-actions">
        <button
          type="button"
          className={item.isPinned ? "pin-hit pinned" : "pin-hit"}
          aria-label={(item.isPinned ? "Unpin " : "Pin ") + item.title}
          title={item.isPinned ? "Unpin structure" : "Pin structure"}
          onClick={(event) => {
            event.stopPropagation();
            actions.togglePinnedStructure(item.path);
          }}
        >
          <PinIcon />
        </button>
      </span>
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M8.25 1.75L12.25 5.75L10.4 7.6L9.25 6.45L6.8 8.9L7.15 11.2L6.35 12L4 9.65L1.9 11.75L1.25 11.1L3.35 9L1 6.65L1.8 5.85L4.1 6.2L6.55 3.75L5.4 2.6L8.25 1.75Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
