import { useWorkspaceMenus } from "../workspace-menus";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { SidebarProject, SidebarProjectItem } from "../../lib/sidebar-projects";
import { hasStructureDrag, readStructureDragPayload, type StructureDragPayload } from "../../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "../drop-action-executor";

import { MarqueeName } from "../marquee-name";
import { rendererLabel } from "../format";
import { showNativeContextMenu } from "../native-context-menu";
import type { ShellActions, ShellViewState } from "../types";
import { FileKindIcon, fileKindForPath } from "./file-kind-icon";
import { useSidebarStructureDrag } from "./use-sidebar-structure-drag";

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
  expandFoldersByDefault = false,
}: {
  project: SidebarProject;
  state: ShellViewState;
  actions: ShellActions;
  expandFoldersByDefault?: boolean;
}) {

  const menus = useWorkspaceMenus();
  const emptyFolders = project.rootPath ? menus.folders[project.rootPath] : undefined;
  const projectTree = useMemo(() => buildProjectTree(project.items, emptyFolders), [project.items, emptyFolders]);
  const defaultExpandedFolderPaths = useMemo(
    () => expandFoldersByDefault ? collectProjectFolderPaths(projectTree) : [],
    [expandFoldersByDefault, projectTree],
  );
  const [showAllItems, setShowAllItems] = useState(false);
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(() => new Set(defaultExpandedFolderPaths));
  const [showAllFolderPaths, setShowAllFolderPaths] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(project.title);
  const folderExpansionChangedRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameCommitRef = useRef(false);
  const sidebarQuery = state.sidebarQuery.trim();
  const hasSidebarQuery = sidebarQuery.length > 0;
  const expanded = hasSidebarQuery || state.expandedProjectIds.includes(project.id);
  const canRenameProject = Boolean(project.rootPath);
  const shouldLimitItems = !hasSidebarQuery
    && projectTree.length > COLLAPSED_PROJECT_ITEM_LIMIT
    && !showAllItems;
  const visibleTree = shouldLimitItems
    ? projectTree.slice(0, COLLAPSED_PROJECT_ITEM_LIMIT)
    : projectTree;
  const hiddenItemCount = projectTree.length - COLLAPSED_PROJECT_ITEM_LIMIT;
  const sidebarDrag = useSidebarStructureDrag({
    actions,
    disabled: renaming,
    getPayload: () => sidebarProjectItemsDragPayload(project.items),
    state,
  });

  useEffect(() => {
    if (!renaming) setRenameDraft(project.title);
  }, [project.title, renaming]);

  useEffect(() => {
    if (!expandFoldersByDefault || folderExpansionChangedRef.current) return;
    setExpandedFolderPaths(new Set(defaultExpandedFolderPaths));
  }, [defaultExpandedFolderPaths, expandFoldersByDefault]);

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  useEffect(() => {
    const expandAll = (event: Event) => {
      const expanded = (event as CustomEvent<boolean>).detail;
      setExpandedFolderPaths(new Set(expanded ? collectProjectFolderPaths(projectTree) : []));
      setShowAllItems(expanded);
      setShowAllFolderPaths(new Set(expanded ? collectProjectFolderPaths(projectTree) : []));
    };
    window.addEventListener("burette-sidebar-expand-all", expandAll);
    return () => window.removeEventListener("burette-sidebar-expand-all", expandAll);
  }, [projectTree]);

  const handleToggle = () => {
    if (renaming) return;
    actions.toggleProjectExpanded(project.id);
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail > 1) {
      event.preventDefault();
      return;
    }
    handleToggle();
  };

  const handleRowMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail < 2) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const startRename = () => {
    if (!canRenameProject) return;
    skipRenameCommitRef.current = false;
    setRenameDraft(project.title);
    setRenaming(true);
  };

  const cancelRename = () => {
    skipRenameCommitRef.current = true;
    setRenameDraft(project.title);
    setRenaming(false);
  };

  const commitRename = () => {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false;
      return;
    }
    if (!project.rootPath) {
      cancelRename();
      return;
    }
    actions.renameProjectRoot(project.rootPath, renameDraft);
    setRenaming(false);
  };

  const handleRecursiveToggle = () => {
    const folderPaths = collectProjectFolderPaths(projectTree);
    folderExpansionChangedRef.current = true;
    setExpandedFolderPaths((current) => {
      const next = new Set(current);
      for (const folderPath of folderPaths) {
        if (expanded) next.delete(folderPath);
        else next.add(folderPath);
      }
      return next;
    });
    actions.toggleProjectExpanded(project.id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      startRename();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu(menus.folder(project, project.rootPath ?? "", true, startRename), { x: event.clientX, y: event.clientY });
  };
  const toggleFolderPath = (path: string) => {
    const descendantPaths = collectProjectFolderPathsFor(projectTree, path).slice(1);
    folderExpansionChangedRef.current = true;
    setExpandedFolderPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        for (const descendantPath of descendantPaths) next.delete(descendantPath);
      }
      return next;
    });
  };
  const toggleFolderPathRecursive = (path: string) => {
    const folderPaths = collectProjectFolderPathsFor(projectTree, path);
    folderExpansionChangedRef.current = true;
    setExpandedFolderPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        for (const folderPath of folderPaths) next.delete(folderPath);
      } else {
        for (const folderPath of folderPaths) next.add(folderPath);
      }
      return next;
    });
  };
  const toggleShowAllFolderPath = (path: string) => {
    setShowAllFolderPaths((current) => {
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
        role="treeitem"
        tabIndex={0}
        className="project-group-row"
        draggable={!renaming && project.items.length > 0}
        onMouseDown={(event) => {
          handleRowMouseDown(event);
          sidebarDrag.onMouseDown(event);
        }}
        onClickCapture={sidebarDrag.onClickCapture}
        onClick={handleRowClick}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={handleContextMenu}
        onDragStart={sidebarDrag.onDragStart}
        onDragEnd={sidebarDrag.onDragEnd}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
        aria-label={`${project.title}, ${project.items.length} file${project.items.length === 1 ? "" : "s"}`}
      >
        <span className="project-group-copy">
          {renaming ? (
            <input
              ref={renameInputRef}
              className="project-group-title-input"
              value={renameDraft}
              aria-label={`Rename ${project.title}`}
              onChange={(event) => setRenameDraft(event.currentTarget.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRename();
                }
              }}
              onBlur={commitRename}
            />
          ) : (
            <MarqueeName className="project-group-title">{project.title}</MarqueeName>
          )}
        </span>
        <button
          type="button"
          className="project-folder-toggle-button"
          aria-label={expanded ? `Collapse ${project.title}` : `Expand ${project.title}`}
          title={expanded ? "Collapse all nested folders" : "Expand all nested folders"}
          onClick={(event) => {
            event.stopPropagation();
            handleRecursiveToggle();
          }}
        >
          <FolderExpandCollapseIcon collapse={expanded} />
        </button>
        <span className="project-group-actions">
          <button
            type="button"
            className="project-group-menu-button"
            aria-label={`${project.title} options`}
            aria-haspopup="menu"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              void showNativeContextMenu(menus.folder(project, project.rootPath ?? "", true, startRename), { x: rect.left, y: rect.bottom });
            }}
          >
            <MoreIcon />
          </button>
        </span>
      </div>
      <div
        className="project-group-children-shell"
        data-expanded={expanded ? "true" : "false"}
        aria-hidden={!expanded}
      >
        <div className="project-children" role="list">
          {visibleTree.map((node) => (
            <ProjectTreeNodeView
              key={node.key}
              node={node}
              project={project}
              state={state}
              actions={actions}
              depth={1}
              expandedFolderPaths={expandedFolderPaths}
              showAllFolderPaths={showAllFolderPaths}
              forceExpanded={hasSidebarQuery}
              toggleFolderPath={toggleFolderPath}
              toggleFolderPathRecursive={toggleFolderPathRecursive}
              toggleShowAllFolderPath={toggleShowAllFolderPath}
            />
          ))}
          {projectTree.length > COLLAPSED_PROJECT_ITEM_LIMIT && !hasSidebarQuery && (
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
      </div>
    </div>
  );
}

function ProjectTreeNodeView({
  node,
  project,
  state,
  actions,
  depth,
  expandedFolderPaths,
  showAllFolderPaths,
  forceExpanded,
  toggleFolderPath,
  toggleFolderPathRecursive,
  toggleShowAllFolderPath,
}: {
  node: ProjectTreeNode;
  project: SidebarProject;
  state: ShellViewState;
  actions: ShellActions;
  depth: number;
  expandedFolderPaths: Set<string>;
  showAllFolderPaths: Set<string>;
  forceExpanded: boolean;
  toggleFolderPath: (path: string) => void;
  toggleFolderPathRecursive: (path: string) => void;
  toggleShowAllFolderPath: (path: string) => void;
}) {

  const menus = useWorkspaceMenus();
  if (node.kind === "item") {
    return <ProjectItem item={node.item} state={state} actions={actions} depth={depth} />;
  }

  const nodeItems = projectTreeNodeItems(node);
  const expanded = forceExpanded || expandedFolderPaths.has(node.path);
  const folderPath = project.rootPath ? `${project.rootPath}/${node.path}` : null;
  const displayName = folderPath ? state.projectNameOverrides?.[folderPath]?.trim() || node.name : node.name;
  const handleToggle = () => {
    if (!forceExpanded) toggleFolderPath(node.path);
  };
  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail > 1) {
      event.preventDefault();
      return;
    }
    handleToggle();
  };
  const startRename = () => {
    if (!folderPath) return;
    const command = menus.folder(project, folderPath, false, () => {}).find(entry => entry.kind === "item" && entry.id === "rename-folder");
    if (command?.kind === "item") command.action?.();
  };

  const handleRowMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail < 2) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      startRename();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  };
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu(menus.folder(project, folderPath ?? "", false, startRename), { x: event.clientX, y: event.clientY });
  };
  const sidebarDrag = useSidebarStructureDrag({
    actions,
    getPayload: () => sidebarProjectItemsDragPayload(nodeItems),
    state,
  });
  const showAllChildren = showAllFolderPaths.has(node.path);
  const shouldLimitChildren = !forceExpanded
    && node.children.length > COLLAPSED_PROJECT_ITEM_LIMIT
    && !showAllChildren;
  const visibleChildren = shouldLimitChildren
    ? node.children.slice(0, COLLAPSED_PROJECT_ITEM_LIMIT)
    : node.children;
  const hiddenChildCount = node.children.length - COLLAPSED_PROJECT_ITEM_LIMIT;

  return (
    <div className="project-folder-node" role="listitem">
      <div
        role="treeitem"
        tabIndex={0}
        className="project-folder-row"
        style={projectDepthStyle(depth)}
        draggable={nodeItems.length > 0}
        onMouseDown={(event) => {
          handleRowMouseDown(event);
          sidebarDrag.onMouseDown(event);
        }}
        onClickCapture={sidebarDrag.onClickCapture}
        onClick={handleRowClick}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={handleContextMenu}
        onDragStart={sidebarDrag.onDragStart}
        onDragEnd={sidebarDrag.onDragEnd}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
        aria-label={node.path}
        title={node.path}
      >
        <MarqueeName className="project-folder-name">{displayName}</MarqueeName>
        <button
          type="button"
          className="project-folder-toggle-button"
          aria-label={expanded ? `Collapse ${node.path}` : `Expand ${node.path}`}
          title={expanded ? "Collapse nested folders" : "Expand nested folders"}
          onClick={(event) => {
            event.stopPropagation();
            if (!forceExpanded) toggleFolderPathRecursive(node.path);
          }}
        >
          <FolderExpandCollapseIcon collapse={expanded} />
        </button>
      </div>
      <div
        className="project-folder-children-shell"
        data-expanded={expanded ? "true" : "false"}
        aria-hidden={!expanded}
      >
        <div className="project-folder-children" role="list">
          {visibleChildren.map((child) => (
            <ProjectTreeNodeView
              key={child.key}
              node={child}
              project={project}
              state={state}
              actions={actions}
              depth={depth + 1}
              expandedFolderPaths={expandedFolderPaths}
              showAllFolderPaths={showAllFolderPaths}
              forceExpanded={forceExpanded}
              toggleFolderPath={toggleFolderPath}
              toggleFolderPathRecursive={toggleFolderPathRecursive}
              toggleShowAllFolderPath={toggleShowAllFolderPath}
            />
          ))}
          {node.children.length > COLLAPSED_PROJECT_ITEM_LIMIT && !forceExpanded && (
            <button
              type="button"
              className="project-show-more"
              style={projectDepthStyle(depth + 1)}
              onClick={() => toggleShowAllFolderPath(node.path)}
              aria-label={showAllChildren ? `Show fewer files in ${node.path}` : `Show ${hiddenChildCount} more files in ${node.path}`}
            >
              {showAllChildren ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      </div>
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
  const menus = useWorkspaceMenus();
  const sidebarDrag = useSidebarStructureDrag({
    actions,
    getPayload: () => sidebarProjectItemsDragPayload([item]),
    state,
  });
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
  const handleContextMenu = async (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const paths = menus.selected.has(item.path) ? Array.from(menus.selected) : [item.path];
    void showNativeContextMenu(await menus.files(paths), { x: event.clientX, y: event.clientY });
  };
  const className = [
    "project",
    item.isActive ? "active" : "",
    menus.selected.has(item.path) ? "selected" : "",
    item.isPinned ? "pinned" : "",
    nested ? "nested-project" : "",
  ].filter(Boolean).join(" ");
  const fileKind = fileKindForPath(item.path, item.extension);

  return (
    <div
      role="treeitem"
      tabIndex={0}
      draggable
      className={className}
      style={projectDepthStyle(depth ?? (nested ? 1 : 0))}
      data-sidebar-structure-path={item.path}
      data-sidebar-structure-renderer={item.renderer}
      data-sidebar-structure-document-id={item.documentId ?? undefined}
      data-drop-document-path={item.path}
      data-drop-document-renderer={item.renderer}
      data-drop-document-id={item.documentId ?? undefined}
      onMouseDown={sidebarDrag.onMouseDown}
      onClickCapture={sidebarDrag.onClickCapture}
      onClick={event => { if (!menus.select(item.path, event)) openItem(); }}
      aria-selected={menus.selected.has(item.path)}
      onDragStart={sidebarDrag.onDragStart}
      onDragEnd={sidebarDrag.onDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      aria-label={`${item.relativePath}, ${rendererLabel(item.renderer)}${item.isPinned ? ", pinned" : ""}`}
    >
      <span className="project-icon" data-file-kind={fileKind} aria-hidden="true">
        <FileKindIcon kind={fileKind} />
      </span>
      <span className="project-copy">
        <MarqueeName className="project-name">{item.title}</MarqueeName>
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

function buildProjectTree(items: SidebarProjectItem[], emptyFolders: string[] = []) {
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

  for (const path of emptyFolders) childrenFor(path);
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

function collectProjectFolderPaths(nodes: ProjectTreeNode[]) {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    paths.push(node.path, ...collectProjectFolderPaths(node.children));
  }
  return paths;
}

function collectProjectFolderPathsFor(nodes: ProjectTreeNode[], path: string): string[] {
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    if (node.path === path) return [node.path, ...collectProjectFolderPaths(node.children)];
    const childPaths = collectProjectFolderPathsFor(node.children, path);
    if (childPaths.length > 0) return childPaths;
  }
  return [];
}

function projectTreeNodeItems(node: ProjectTreeNode): SidebarProjectItem[] {
  if (node.kind === "item") {
    return [node.item];
  }
  return node.children.flatMap(projectTreeNodeItems);
}

function sidebarProjectItemsDragPayload(
  items: SidebarProjectItem[],
): StructureDragPayload | null {
  const draggableItems = items.filter((item) => item.path.trim().length > 0);
  if (draggableItems.length === 0) return null;
  return {
    paths: draggableItems.map((item) => item.path),
    records: [],
    items: draggableItems.map((item) => ({
      kind: "file",
      title: item.title,
      detail: item.relativePath,
      path: item.path,
    })),
  };
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

function FolderExpandCollapseIcon({ collapse }: { collapse: boolean }) {
  return collapse ? (
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
