import { SceneNameDialog } from "./scene-name-dialog";
import type { ViewerDocument } from "../types";
import { isTauriRuntime } from "../lib/tauri";
import { useBatchFileOperations } from "./batch-file-operations";
import { useGridWorkspaceMenu } from "../hooks/use-grid-workspace-menu";
import { createContext, useContext, useEffect, useState, type ReactNode, type MouseEvent } from "react";
import type { MenuItemSpec } from "./menu-types";
import type { ShellActions, ShellViewState } from "./types";
import type { SidebarProject } from "../lib/sidebar-projects";
import { useWorkspaceFileActions } from "../hooks/use-workspace-file-actions";
import { useSidebarFileMenus } from "./sidebar/file-operations";
import { workspaceFileMenu } from "./workspace-file-menu";
import { menuItem, menuSections, submenu, fileCapabilities } from "./workspace-menu-items";
import { FolderOpenDialog, readFolderContents } from "./folder-open-dialog";
import { toast } from "./ui/toast";

type Menus = {
  scene: (document: ViewerDocument) => MenuItemSpec[];
  files: (paths: string[]) => Promise<MenuItemSpec[]>;
  folder: (project: SidebarProject, path: string, root: boolean, rename: () => void) => MenuItemSpec[];
  selected: Set<string>;
  select: (path: string, event: MouseEvent) => boolean;
  folders: Record<string, string[]>;
};
const Context = createContext<Menus>({ scene: () => [], files: async () => [], folder: () => [], selected: new Set(), select: () => false, folders: {} });
export const useWorkspaceMenus = () => useContext(Context);

export function WorkspaceMenus({ state, actions, children }: { state: ShellViewState; actions: ShellActions; children: ReactNode }) {
  const diskMenu = useSidebarFileMenus();
  const batchFiles = useBatchFileOperations(actions, state);
  const workflows = useWorkspaceFileActions(state, actions);
  useGridWorkspaceMenu(state, actions, workflows);
  const [batch, setBatch] = useState<{ path: string; mode: string } | null>(null);
  const [renamingScene, setRenamingScene] = useState<ViewerDocument | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<Record<string, string[]>>({});
  const [revision, setRevision] = useState(0);
  const refresh = () => { setRevision(value => value + 1); window.dispatchEvent(new Event("burette-project-refresh")); };
  useEffect(() => {
    window.addEventListener("burette-folder-contents-changed", refresh);
    return () => window.removeEventListener("burette-folder-contents-changed", refresh);
  }, []);
  const roots = state.sidebarProjects.flatMap(project => project.rootPath ? [project.rootPath] : []).join('\n');
  useEffect(() => {
    let current = true;
    const paths = roots.split('\n').filter(Boolean);
    void Promise.all(paths.map(async path => {
      try { return [path, (await readFolderContents(path, true, state)).folders.map(folder => folder.slice(path.length + 1))] as const; }
      catch { return [path, []] as const; }
    })).then(entries => { if (current) setFolders(Object.fromEntries(entries)); });
    return () => { current = false; };
  }, [roots, revision]);
  const run = (action: () => unknown | Promise<unknown>) => () => {
    void Promise.resolve().then(action).catch(error => toast.add({ title: String(error), type: "error", timeout: 0 }));
  };
  const files = async (paths: string[]) => {
    const menu = workspaceFileMenu(paths, state, actions, workflows,
      paths.length === 1 ? diskMenu(paths[0]) : batchFiles.items(paths), run);
    if (isTauriRuntime() && paths.length === 1) {
      try {
        const targets = await actions.listChemicalEditorTargets(paths[0]);
        const opening = menu.find(entry => entry.kind === "submenu" && entry.id === "file-open");
        const external = opening?.kind === "submenu" ? opening.items.find(entry => entry.kind === "submenu" && entry.id === "open-external") : null;
        if (external?.kind === "submenu") external.items.push(...targets.slice(0, 12).map((target, index) =>
          menuItem(`open-editor-${index}`, target.name, run(() => actions.openPathInChemicalEditor(paths[0], target.id, target.name)))));
      } catch { /* The default application remains available if discovery fails. */ }
    }
    return menu;
  };
  const folder: Menus["folder"] = (project, path, root, rename) => {
    const disk = diskMenu(path, root ? "project" : "folder");
    const item = (id: string, text: string, action: () => unknown | Promise<unknown>) => menuItem(id, text, run(action));
    const paths = project.items.filter(file => root || file.path.startsWith(path + '/')).map(file => file.path);
    const compatible = paths.length > 1 && paths.every(path => fileCapabilities(path).scene);
    const openFolder = (mode: string) => () => setBatch({ path, mode });
    const pinned = state.sidebarProjects.some(project => project.rootPath === path && project.isPinned);
    return menuSections(
      submenu("folder-open", "Open", [
        item("open-folder", "In Tabs…", openFolder("tabs")),
        ...(isTauriRuntime() ? [item("open-window", "In New Window…", openFolder("window"))] : []),
        ...(compatible ? [item("open-together", "Together…", openFolder("together")),
          ...(paths.every(path => fileCapabilities(path).protein) ? [item("open-aligned", "Aligned…", openFolder("aligned"))] : []),
          ...(paths.every(path => fileCapabilities(path).poses) ? [item("open-poses", "As Poses…", openFolder("poses"))] : [])] : []),
        ...submenu("add-scene", "Add to Scene", workflows.sceneTargets(paths).map((target, index) => item(`add-scene-${index}`, target.title, openFolder(`scene:${target.id}`)))),
        item("folder-finder", "Finder", () => actions.revealPath(path, "folder"))
      ], "arrow.up.forward"),
      [root ? item("rename-project", "Rename Label…", rename) : disk.find(entry => "id" in entry && entry.id === "rename-folder")].filter((entry): entry is MenuItemSpec => Boolean(entry)),
      [item("pin-folder", pinned ? "Unpin" : "Pin", () => actions.togglePinnedProjectRoot(path))],
      submenu("folder-new", "New", [...disk.filter(entry => "id" in entry && entry.id === "new-folder"), item("new-molecule", "Molecule", actions.openKetcher)]),
      submenu("folder-copy", "Copy", [item("copy-folder-name", "Name", () => workflows.copyNames([path])), item("copy-folder-path", "Path", () => actions.copyPath(path, "folder"))]),
      [item("refresh-folder", "Refresh", refresh)],
      root ? [item("remove-project", "Remove from Sidebar", () => actions.removeProjectRoot(path))]
        : disk.filter(entry => "id" in entry && entry.id === "trash-folder"),
    );
  };
  const scene: Menus["scene"] = document => workflows.isCombinedScene(document) ? [
    menuItem("rename-scene", "Rename…", () => setRenamingScene(document)),
    menuItem("save-scene", "Save Scene…", run(() => workflows.saveScene(document))),
  ] : [];
  const select: Menus["select"] = (path, event) => {
    if (event.metaKey || event.ctrlKey) { setSelected(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; }); return true; }
    if (event.shiftKey && selected.size) {
      const visible = Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar-structure-path]')).filter(element => element.getClientRects().length > 0).map(element => element.dataset.sidebarStructurePath!);
      const anchor = visible.indexOf(Array.from(selected).at(-1)!); const end = visible.indexOf(path);
      if (anchor >= 0 && end >= 0) setSelected(new Set(visible.slice(Math.min(anchor, end), Math.max(anchor, end) + 1)));
      return true;
    }
    setSelected(new Set([path])); return false;
  };
  return <Context.Provider value={{ scene, files, folder, selected, select, folders }}>{children}{batchFiles.dialog}<SceneNameDialog document={renamingScene} onClose={() => setRenamingScene(null)} />
    <FolderOpenDialog path={batch?.path ?? null} initialMode={batch?.mode ?? "tabs"} workflows={workflows} state={state} actions={actions} onClose={() => setBatch(null)} />
  </Context.Provider>;
}
