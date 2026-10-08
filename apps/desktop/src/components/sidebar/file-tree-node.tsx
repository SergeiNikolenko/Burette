import { FolderExpandCollapseIcon } from "./folder-expand-collapse-icon";
import { TreeCollapse } from "./tree-collapse";
import { useWorkspaceMenus } from "../workspace-menus";
import { SidebarTooltip } from "./sidebar-tooltip";
import { Pin, PinFilled, DotsHorizontal } from "../ui/app-icons";
import { SidebarFolderIcon } from "./sidebar-folder-icon";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { documentFallbackExtensions } from "../../lib/file-routing";
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
// Collapse only when at least two rows would hide behind "Show more".
const COLLAPSE_PROJECT_ITEMS_FROM = 7;

type ProjectTreeNode =
  | {
    kind: "folder";
    key: string;
    name: string;
    path: string;
    children: ProjectTreeNode[];
    hasItems: boolean;
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
  // A search shows every match inline. Closed folders and overflow tails are
  // mounted on demand; TreeCollapse retains them only through the closing slide.
  const limitItems = !hasSidebarQuery && projectTree.length >= COLLAPSE_PROJECT_ITEMS_FROM;
  const leadingTree = limitItems ? projectTree.slice(0, COLLAPSED_PROJECT_ITEM_LIMIT) : projectTree;
  const trailingTree = limitItems ? projectTree.slice(COLLAPSED_PROJECT_ITEM_LIMIT) : [];
  const hiddenItemCount = trailingTree.length;
  const sidebarDrag = useSidebarStructureDrag({
    actions,
    disabled: renaming,
    getPayload: () => sidebarProjectItemsDragPayload(project.items, project.rootPath),
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
  const renderNode = (node: ProjectTreeNode) => (
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
  );

  return (
    <div className="project-group" role="listitem">
      <div
        role="treeitem"
        tabIndex={0}
        className="project-group-row"
        data-drop-directory={project.rootPath ?? undefined}
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
        <SidebarFolderIcon expanded={expanded} />
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
          onClick={(event) => {
            event.stopPropagation();
            handleRecursiveToggle();
          }}
        >
          <FolderExpandCollapseIcon collapse={expanded} />
        </button>
        <span className="project-group-actions">
          {project.rootPath && (
            <FolderPinButton
              pinned={project.isPinned}
              title={project.title}
              onToggle={() => actions.togglePinnedProjectRoot(project.rootPath!)}
            />
          )}
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
              void showNativeContextMenu(menus.folder(project, project.rootPath ?? "", true, startRename), { x: rect.left, y: rect.bottom }, { presentation: "dropdown" });
            }}
          >
            <MoreIcon />
          </button>
        </span>
      </div>
      <TreeCollapse
        className="project-group-children-shell"
        open={expanded}
      >
        {() => <div className="project-children" role="list">
          {leadingTree.map(renderNode)}
          {limitItems && (
            <>
              <TreeCollapse
                className="project-tail-shell"
                open={showAllItems}
              >
                {() => <div className="project-tail">
                  {trailingTree.map(renderNode)}
                </div>}
              </TreeCollapse>
              <button
                type="button"
                className="project-show-more"
                onClick={() => setShowAllItems((value) => !value)}
                aria-expanded={showAllItems}
                aria-label={showAllItems ? `Show fewer files in ${project.title}` : `Show ${hiddenItemCount} more files in ${project.title}`}
              >
                {showAllItems ? "Show less" : "Show more"}
              </button>
            </>
          )}
        </div>}
      </TreeCollapse>
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
    getPayload: () => sidebarProjectItemsDragPayload(projectTreeNodeItems(node), folderPath),
    state,
  });
  const showAllChildren = showAllFolderPaths.has(node.path);
  const limitChildren = !forceExpanded && node.children.length >= COLLAPSE_PROJECT_ITEMS_FROM;
  const leadingChildren = limitChildren ? node.children.slice(0, COLLAPSED_PROJECT_ITEM_LIMIT) : node.children;
  const trailingChildren = limitChildren ? node.children.slice(COLLAPSED_PROJECT_ITEM_LIMIT) : [];
  const hiddenChildCount = trailingChildren.length;
  const renderChild = (child: ProjectTreeNode) => (
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
  );

  return (
    <div className="project-folder-node" role="listitem">
      <div
        role="treeitem"
        tabIndex={0}
        className="project-folder-row"
        data-drop-directory={project.rootPath ? `${project.rootPath}/${node.path}` : undefined}
        style={projectDepthStyle(depth)}
        draggable={node.hasItems}
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
      >
        <SidebarFolderIcon expanded={expanded} />
        <MarqueeName className="project-folder-name">{displayName}</MarqueeName>
        <button
          type="button"
          className="project-folder-toggle-button"
          aria-label={expanded ? `Collapse ${node.path}` : `Expand ${node.path}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!forceExpanded) toggleFolderPathRecursive(node.path);
          }}
        >
          <FolderExpandCollapseIcon collapse={expanded} />
        </button>
        {folderPath && (
          <FolderPinButton
            className="project-row-pin"
            pinned={false}
            title={displayName}
            onToggle={() => actions.togglePinnedProjectRoot(folderPath)}
          />
        )}
      </div>
      <TreeCollapse
        className="project-folder-children-shell"
        open={expanded}
      >
        {() => <div className="project-folder-children" role="list">
          {leadingChildren.map(renderChild)}
          {limitChildren && (
            <>
              <TreeCollapse
                className="project-tail-shell"
                open={showAllChildren}
              >
                {() => <div className="project-tail">
                  {trailingChildren.map(renderChild)}
                </div>}
              </TreeCollapse>
              <button
                type="button"
                className="project-show-more"
                style={projectDepthStyle(depth + 1)}
                onClick={() => toggleShowAllFolderPath(node.path)}
                aria-expanded={showAllChildren}
                aria-label={showAllChildren ? `Show fewer files in ${node.path}` : `Show ${hiddenChildCount} more files in ${node.path}`}
              >
                {showAllChildren ? "Show less" : "Show more"}
              </button>
            </>
          )}
        </div>}
      </TreeCollapse>
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
    // A CSV/TSV row can be bound to the hidden text copy that the grid and dock
    // keep for source editing; reopen it instead so it lands in the molecule
    // grid or the table viewer. Raw text stays an explicit Open As choice.
    const textCopyOfTable = item.renderer === "text" && documentFallbackExtensions.has(item.extension.toLowerCase());
    if (item.documentId && !textCopyOfTable) {
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
        <SidebarTooltip label={item.isPinned ? "Unpin structure" : "Pin structure"}>
          <button
            type="button"
            className={item.isPinned ? "pin-hit pinned" : "pin-hit"}
            aria-label={(item.isPinned ? "Unpin " : "Pin ") + item.title}
            onClick={(event) => {
              event.stopPropagation();
              actions.togglePinnedStructure(item.path);
            }}
          >
            <PinIcon pinned={item.isPinned} />
          </button>
        </SidebarTooltip>
      </span>
    </div>
  );
}

function buildProjectTree(items: SidebarProjectItem[], emptyFolders: string[] = []) {
  const roots: ProjectTreeNode[] = [];
  const folders = new Map<string, Extract<ProjectTreeNode, { kind: "folder" }>>();

  const childrenFor = (folderPath: string | null, hasItems = false) => {
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
        hasItems,
      };
      folders.set(folderPath, folder);
      const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
      childrenFor(parentPath, hasItems).push(folder);
    } else if (hasItems && !folder.hasItems) {
      folder.hasItems = true;
      const separator = folderPath.lastIndexOf("/");
      childrenFor(separator < 0 ? null : folderPath.slice(0, separator), true);
    }
    return folder.children;
  };

  for (const path of emptyFolders) childrenFor(path);
  for (const item of items) {
    const segments = item.relativePath.split("/").filter(Boolean);
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
    childrenFor(parentPath, true).push({
      kind: "item",
      key: item.key,
      item,
    });
  }

  return roots;
}

function collectProjectFolderPaths(nodes: ProjectTreeNode[]) {
  const paths: string[] = [];
  const pending = [...nodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind !== "folder") continue;
    paths.push(node.path);
    for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
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
  folderPath?: string | null,
): StructureDragPayload | null {
  const draggableItems = items.filter((item) => item.path.trim().length > 0);
  if (draggableItems.length === 0) return null;
  return {
    ...(folderPath ? { entries: [folderPath] } : {}),
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

// Pinning a folder promotes it to a pinned project, same as the folder menu's Pin.
function FolderPinButton({ pinned, title, onToggle, className }: {
  pinned: boolean;
  title: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <SidebarTooltip label={pinned ? "Unpin folder" : "Pin folder"}>
      <button
        type="button"
        className={["pin-hit", pinned ? "pinned" : "", className ?? ""].filter(Boolean).join(" ")}
        aria-label={(pinned ? "Unpin " : "Pin ") + title}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <PinIcon pinned={pinned} />
      </button>
    </SidebarTooltip>
  );
}

function PinIcon({ pinned }: { pinned: boolean }) {
  const Icon = pinned ? PinFilled : Pin;
  return <Icon size={14} aria-hidden="true" />;
}

function MoreIcon() {
  return <DotsHorizontal size={16} aria-hidden="true" />;
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
