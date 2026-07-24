import { useEffect, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  File02Icon,
  Folder01Icon,
  Folder02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isMoleculeCollectionPath } from "../../lib/collection-documents";
import type { SidebarProject, SidebarProjectItem } from "../../lib/sidebar-projects";
import { hasStructureDrag, readStructureDragPayload, type StructureDragPayload } from "../../lib/structure-drag";
import type { DockingSceneMode } from "../../types";
import { runShellDropActionChoices, shellDropActionChoices } from "../drop-action-executor";
import { rendererLabel } from "../format";
import { showNativeContextMenu } from "../native-context-menu";
import { RadixDropdownMenu } from "../radix-menu";
import type { ShellActions, ShellViewState } from "../types";
import { useSidebarStructureDrag } from "./use-sidebar-structure-drag";

const COLLAPSED_PROJECT_ITEM_LIMIT = 5;
const MAX_MOLSTAR_SCENE_STRUCTURES = 200;

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
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(() => new Set());
  const [showAllFolderPaths, setShowAllFolderPaths] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(project.title);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameCommitRef = useRef(false);
  const sidebarQuery = state.sidebarQuery.trim();
  const hasSidebarQuery = sidebarQuery.length > 0;
  const expanded = hasSidebarQuery || state.expandedProjectIds.includes(project.id);
  const canRenameProject = Boolean(project.rootPath);
  const projectTree = buildProjectTree(project.items);
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
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

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
    void showNativeContextMenu(projectMenuItems(project, actions, startRename), { x: event.clientX, y: event.clientY });
  };
  const toggleFolderPath = (path: string) => {
    const descendantPaths = collectProjectFolderPathsFor(projectTree, path).slice(1);
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
        aria-label={`${project.title}, ${project.items.length} structure${project.items.length === 1 ? "" : "s"}`}
      >
        <span className="project-folder-icon" aria-hidden="true">
          <HugeiconsIcon icon={expanded ? Folder02Icon : Folder01Icon} size={16} color="currentColor" strokeWidth={2} />
        </span>
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
            <span className="project-group-title">{project.title}</span>
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
          <RadixDropdownMenu
            items={projectMenuItems(project, actions, startRename)}
            trigger={(
              <button
                type="button"
                className="project-group-menu-button"
                aria-label={`${project.title} options`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
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

function projectMenuItems(project: SidebarProject, actions: ShellActions, startRename: () => void) {
  const scenePaths = molstarScenePathsForProjectFolder(project, null);
  return [
    {
      kind: "item" as const,
      id: "open-project-molstar-scene",
      text: "Open all in Mol* scene",
      disabled: scenePaths.length < 2 || scenePaths.length > MAX_MOLSTAR_SCENE_STRUCTURES,
      action: () => openProjectFolderMolstarScene(project, null, actions, "structureAll"),
    },
    { kind: "separator" as const },
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
        startRename();
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

function projectFolderMenuItems(project: SidebarProject, folderPath: string, actions: ShellActions, startRename: () => void) {
  const scenePaths = molstarScenePathsForProjectFolder(project, folderPath);
  return [
    {
      kind: "item" as const,
      id: "open-folder-molstar-scene",
      text: "Open all in Mol* scene",
      disabled: scenePaths.length < 2 || scenePaths.length > MAX_MOLSTAR_SCENE_STRUCTURES,
      action: () => openProjectFolderMolstarScene(project, folderPath, actions, "structureAll"),
    },
    { kind: "separator" as const },
    {
      kind: "item" as const,
      id: "open-folder-documents",
      text: "Open as document tabs",
      disabled: scenePaths.length === 0,
      action: () => {
        if (scenePaths.length > 0) void actions.openStructurePaths(scenePaths);
      },
    },
    {
      kind: "item" as const,
      id: "copy-folder-path",
      text: "Copy Path",
      disabled: !project.rootPath,
      action: () => {
        if (!project.rootPath) return;
        void actions.copyPath(`${project.rootPath}/${folderPath}`, "folder");
      },
    },
    { kind: "separator" as const },
    {
      kind: "item" as const,
      id: "rename-folder",
      text: "Rename folder",
      disabled: !project.rootPath,
      action: startRename,
    },
  ];
}

function openProjectFolderMolstarScene(
  project: SidebarProject,
  folderPath: string | null,
  actions: ShellActions,
  sceneMode: DockingSceneMode,
) {
  const paths = molstarScenePathsForProjectFolder(project, folderPath);
  if (paths.length < 2) return;
  if (paths.length > MAX_MOLSTAR_SCENE_STRUCTURES) return;
  void actions.openDockingDocument(paths[0], paths.slice(1), { sceneMode });
}

function molstarScenePathsForProjectFolder(project: SidebarProject, folderPath: string | null) {
  const prefix = folderPath ? `${folderPath}/` : "";
  return project.items
    .filter((item) => (folderPath ? item.relativePath.startsWith(prefix) : true))
    .filter((item) => item.renderer === "molstar")
    .map((item) => item.path);
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
  if (node.kind === "item") {
    return <ProjectItem item={node.item} state={state} actions={actions} depth={depth} />;
  }

  const nodeItems = projectTreeNodeItems(node);
  const expanded = forceExpanded || expandedFolderPaths.has(node.path);
  const folderPath = project.rootPath ? `${project.rootPath}/${node.path}` : null;
  const displayName = folderPath ? state.projectNameOverrides?.[folderPath]?.trim() || node.name : node.name;
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(displayName);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameCommitRef = useRef(false);

  useEffect(() => {
    if (!renaming) setRenameDraft(displayName);
  }, [displayName, renaming]);

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  const handleToggle = () => {
    if (renaming) return;
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
    skipRenameCommitRef.current = false;
    setRenameDraft(displayName);
    setRenaming(true);
  };
  const cancelRename = () => {
    skipRenameCommitRef.current = true;
    setRenameDraft(displayName);
    setRenaming(false);
  };
  const commitRename = () => {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false;
      return;
    }
    if (!folderPath) {
      cancelRename();
      return;
    }
    actions.renameProjectFolder(folderPath, renameDraft);
    setRenaming(false);
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
    void showNativeContextMenu(projectFolderMenuItems(project, node.path, actions, startRename), { x: event.clientX, y: event.clientY });
  };
  const sidebarDrag = useSidebarStructureDrag({
    actions,
    disabled: renaming,
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
        draggable={!renaming && nodeItems.length > 0}
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
        <span className="project-folder-icon" aria-hidden="true">
          <HugeiconsIcon icon={expanded ? Folder02Icon : Folder01Icon} size={16} color="currentColor" strokeWidth={2} />
        </span>
        {renaming ? (
          <input
            ref={renameInputRef}
            className="project-folder-name-input"
            value={renameDraft}
            aria-label={`Rename ${displayName}`}
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
          <span className="project-folder-name">{displayName}</span>
        )}
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
        id: "open-structure-as-text",
        text: "Open as Text",
        action: () => {
          void actions.openTextPaths([item.path]);
        },
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
      onClick={openItem}
      onDragStart={sidebarDrag.onDragStart}
      onDragEnd={sidebarDrag.onDragEnd}
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
