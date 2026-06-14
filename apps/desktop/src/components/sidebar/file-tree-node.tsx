import { useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  File02Icon,
  Folder01Icon,
  Folder02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isMoleculeCollectionPath } from "../../lib/collection-documents";
import type { SidebarProject, SidebarProjectItem } from "../../lib/sidebar-projects";
import { hasStructureDrag, readStructureDragPayload, writeStructureDragPayload } from "../../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "../drop-action-executor";
import { rendererLabel } from "../format";
import { showNativeContextMenu } from "../native-context-menu";
import { RadixDropdownMenu } from "../radix-menu";
import type { ShellActions, ShellViewState } from "../types";

const COLLAPSED_PROJECT_ITEM_LIMIT = 5;

type ProjectTreeNode =
  | {
    kind: "folder";
    key: string;
    name: string;
    path: string;
    children: ProjectTreeNode[];
  }
  | {
    kind: "item";
    key: string;
    item: SidebarProjectItem;
  };

export function ProjectGroup({
  project,
  state,
  actions,
}: {
  project: SidebarProject;
  state: ShellViewState;
  actions: ShellActions;
}) {
  const [showAllItems, setShowAllItems] = useState(false);
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<Set<string>>(() => new Set());
  const sidebarQuery = state.sidebarQuery.trim();
  const hasSidebarQuery = sidebarQuery.length > 0;
  const expanded = hasSidebarQuery || state.expandedProjectIds.includes(project.id);
  const shouldLimitItems = !hasSidebarQuery
    && project.items.length > COLLAPSED_PROJECT_ITEM_LIMIT
    && !showAllItems;
  const visibleItems = shouldLimitItems
    ? project.items.slice(0, COLLAPSED_PROJECT_ITEM_LIMIT)
    : project.items;
  const visibleTree = buildProjectTree(visibleItems);
  const hiddenItemCount = project.items.length - COLLAPSED_PROJECT_ITEM_LIMIT;

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
    void showNativeContextMenu(projectMenuItems(project, actions), { x: event.clientX, y: event.clientY });
  };

  const toggleFolderPath = (path: string) => {
    setCollapsedFolderPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
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
        <span className="project-group-actions">
          <RadixDropdownMenu
            items={projectMenuItems(project, actions)}
            trigger={(
              <button
                type="button"
                className="project-group-menu-button"
                aria-label={`${project.title} options`}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <MoreIcon />
              </button>
            )}
          />
        </span>
      </div>
      {expanded && (
        <div className="project-children" role="list">
          {visibleTree.map((node) => (
            <ProjectTreeNodeView
              key={node.key}
              node={node}
              state={state}
              actions={actions}
              depth={1}
              collapsedFolderPaths={collapsedFolderPaths}
              forceExpanded={hasSidebarQuery}
              toggleFolderPath={toggleFolderPath}
            />
          ))}
          {project.items.length > COLLAPSED_PROJECT_ITEM_LIMIT && !hasSidebarQuery && (
            <button
              type="button"
              className="project-show-more"
              onClick={() => setShowAllItems((value) => !value)}
              aria-label={showAllItems ? `Show fewer files in ${project.title}` : `Show ${hiddenItemCount} more files in ${project.title}`}
            >
              {showAllItems ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function projectMenuItems(project: SidebarProject, actions: ShellActions) {
  return [
    {
      kind: "item" as const,
      id: project.isPinned ? "unpin-project" : "pin-project",
      text: project.isPinned ? "Unpin project" : "Pin project",
      disabled: !project.rootPath,
      action: () => {
        if (!project.rootPath) return;
        actions.togglePinnedProjectRoot(project.rootPath);
      },
    },
    {
      kind: "item" as const,
      id: "open-project-folder",
      text: "Open in Finder",
      disabled: !project.rootPath,
      action: () => {
        void actions.openProjectFolder(project.rootPath);
      },
    },
    { kind: "separator" as const },
    {
      kind: "item" as const,
      id: "rename-project",
      text: "Rename project",
      disabled: !project.rootPath,
      action: () => {
        if (!project.rootPath) return;
        const nextName = window.prompt("Rename project", project.title);
        if (nextName === null) return;
        actions.renameProjectRoot(project.rootPath, nextName);
      },
    },
    { kind: "separator" as const },
    {
      kind: "item" as const,
      id: "remove-project",
      text: "Remove",
      disabled: !project.rootPath,
      action: () => {
        if (!project.rootPath) return;
        actions.removeProjectRoot(project.rootPath);
      },
    },
  ];
}

function ProjectTreeNodeView({
  node,
  state,
  actions,
  depth,
  collapsedFolderPaths,
  forceExpanded,
  toggleFolderPath,
}: {
  node: ProjectTreeNode;
  state: ShellViewState;
  actions: ShellActions;
  depth: number;
  collapsedFolderPaths: Set<string>;
  forceExpanded: boolean;
  toggleFolderPath: (path: string) => void;
}) {
  if (node.kind === "item") {
    return <ProjectItem item={node.item} state={state} actions={actions} depth={depth} />;
  }

  const expanded = forceExpanded || !collapsedFolderPaths.has(node.path);
  const handleToggle = () => {
    if (!forceExpanded) toggleFolderPath(node.path);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  };

  return (
    <div className="project-folder-node" role="listitem">
      <div
        role="button"
        tabIndex={0}
        className="project-folder-row"
        style={projectDepthStyle(depth)}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
        aria-label={node.path}
        title={node.path}
      >
        <span className="project-folder-icon" aria-hidden="true">
          <HugeiconsIcon icon={Folder02Icon} size={16} color="currentColor" strokeWidth={2} />
        </span>
        <span className="project-folder-name">{node.name}</span>
      </div>
      {expanded && (
        <div className="project-folder-children" role="list">
          {node.children.map((child) => (
            <ProjectTreeNodeView
              key={child.key}
              node={child}
              state={state}
              actions={actions}
              depth={depth + 1}
              collapsedFolderPaths={collapsedFolderPaths}
              forceExpanded={forceExpanded}
              toggleFolderPath={toggleFolderPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectItem({
  item,
  state,
  actions,
  nested = true,
  depth,
}: {
  item: SidebarProjectItem;
  state: ShellViewState;
  actions: ShellActions;
  nested?: boolean;
  depth?: number;
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
    writeStructureDragPayload(event.dataTransfer, {
      paths: [item.path],
      records: [],
      items: [{
        kind: "file",
        title: item.title,
        detail: item.relativePath,
        path: item.path,
      }],
    });
    actions.setStructureDragActive(true);
  };

  const handleDragEnd = () => {
    actions.setStructureDragActive(false);
  };
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    const payload = readStructureDragPayload(event.dataTransfer);
    if (shellDropActionChoices(payload, sidebarDropTarget(item, state), { kind: "sidebar" }).length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    const payload = readStructureDragPayload(event.dataTransfer);
    const choices = shellDropActionChoices(payload, sidebarDropTarget(item, state), { kind: "sidebar" });
    if (choices.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    actions.setStructureDragActive(false);
    runShellDropActionChoices(actions, payload, choices, { x: event.clientX, y: event.clientY });
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
      {
        kind: "item" as const,
        id: "copy-structure-path",
        text: "Copy Path",
        action: () => {
          void actions.copyPath(item.path, "structure");
        },
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
      style={projectDepthStyle(depth ?? (nested ? 1 : 0))}
      data-sidebar-structure-path={item.path}
      data-sidebar-structure-renderer={item.renderer}
      data-sidebar-structure-document-id={item.documentId ?? undefined}
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

function buildProjectTree(items: SidebarProjectItem[]) {
  const roots: ProjectTreeNode[] = [];
  const folders = new Map<string, Extract<ProjectTreeNode, { kind: "folder" }>>();

  const childrenFor = (folderPath: string | null) => {
    if (!folderPath) return roots;
    let folder = folders.get(folderPath);
    if (!folder) {
      const segments = folderPath.split("/");
      folder = {
        kind: "folder",
        key: `folder:${folderPath}`,
        name: segments.at(-1) ?? folderPath,
        path: folderPath,
        children: [],
      };
      folders.set(folderPath, folder);
      const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
      childrenFor(parentPath).push(folder);
    }
    return folder.children;
  };

  for (const item of items) {
    const segments = item.relativePath.split("/").filter(Boolean);
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
    childrenFor(parentPath).push({
      kind: "item",
      key: item.key,
      item,
    });
  }

  return roots;
}

function projectDepthStyle(depth: number): CSSProperties {
  return { "--project-depth": depth } as CSSProperties;
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

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

function sidebarDropTarget(item: SidebarProjectItem, state: ShellViewState) {
  const document = item.documentId
    ? state.documents.find((candidate) => candidate.id === item.documentId)
    : state.documents.find((candidate) => candidate.path === item.path);
  return {
    kind: "active-viewer" as const,
    documentId: item.documentId,
    documentPath: item.path,
    renderer: item.renderer,
    dockingRequest: document?.dockingRequest ?? null,
  };
}
