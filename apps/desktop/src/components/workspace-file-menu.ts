import { copyChemicalFiles } from "../hooks/workspace-chemical-copy";
import type { MenuItemSpec } from "./menu-types";
import type { ShellActions, ShellViewState } from "./types";
import type { useWorkspaceFileActions } from "../hooks/use-workspace-file-actions";
import { isTauriRuntime } from "../lib/tauri";
import { menuItem as item, submenu, menuSections, fileCapabilities } from "./workspace-menu-items";

type Workflows = ReturnType<typeof useWorkspaceFileActions>;
export function workspaceFileMenu(paths: string[], state: ShellViewState, actions: ShellActions, workflows: Workflows,
  diskItems: MenuItemSpec[], run: (action: () => unknown | Promise<unknown>) => () => void): MenuItemSpec[] {
  if (!paths.length || paths.length > 200) return [];
  const command = (id: string, text: string, action: () => unknown | Promise<unknown>) => item(id, text, run(action));
  const single = paths.length === 1;
  const path = paths[0];
  const caps = paths.map(fileCapabilities);
  const local = paths.every(path => path.startsWith("/"));
  const document = single ? state.documents.find(document => document.path === path) : null;
  const opening = [
    command("open-tabs", single ? "New Tab" : "In Tabs", () => actions.openPaths(paths)),
    command("open-right", "Right Panel", () => actions.openDockPayload({ area: "right", tabKind: "files", payload: {
      paths, records: [], items: paths.map(path => ({ kind: "file", path, title: path.split('/').pop() || path })),
    } })),
    ...(isTauriRuntime() && local ? [command("open-window", "New Window", () => actions.openNewWindow(paths))] : []),
    ...(!single && caps.every(cap => cap.scene) ? [
      command("open-together", "Together", () => actions.openDockingDocument(path, paths.slice(1), { sceneMode: "structureAll" })),
      ...(caps.every(cap => cap.protein) ? [command("open-aligned", "Aligned", () => workflows.openAligned(paths))] : []),
      ...(caps.every(cap => cap.poses) ? [command("open-poses", "As Poses", () => workflows.openPoses(paths))] : []),
    ] : []),
    ...submenu("open-as", "As", [
      ...(single && caps[0].scene ? [command("open-3d", "3D", () => actions.openStructurePaths(paths, { rendererMode: "molstar" }))] : []),
      ...(single && caps[0].collection ? [
        command("open-table", "Table", () => workflows.gridView(path, "table")),
        command("open-cards", "Cards", () => workflows.gridView(path, "cards")),
      ] : []),
      ...(caps.every(cap => cap.text) ? [command("open-text", "Text", () => actions.openTextPaths(paths))] : []),
    ]),
    ...submenu("add-scene", "Add to Scene", workflows.sceneTargets(paths).map((target, index) =>
      command(`add-scene-${index}`, target.title, () => workflows.addToScene(paths, target)))),
    ...(single && local ? [command("open-finder", "Finder", () => actions.revealPath(path))] : []),
    ...(single && local && isTauriRuntime() ? submenu("open-external", "External App", [
      command("open-default-app", "Default Application", () => actions.openPathWithDefaultApp(path)),
    ]) : []),
  ];
  const pinned = paths.every(path => state.pinnedStructurePaths.includes(path));
  const take = (id: string) => (local ? diskItems : []).filter(entry => "id" in entry && entry.id === id).map(entry => entry.kind === "item" && entry.action ? { ...entry, action: run(entry.action) } : entry);
  return menuSections(
    submenu("file-open", "Open", opening, "arrow.up.forward"),
    [ ...take("rename-file"), command("pin-files", pinned ? "Unpin" : "Pin", () => {
      paths.forEach(path => { if (state.pinnedStructurePaths.includes(path) === pinned) actions.togglePinnedStructure(path); });
    }), ...take("duplicate-file") ],
    submenu("file-edit", "Edit", caps.every(cap => cap.molecule) ? [command("edit-ketcher", "Ketcher", () => actions.openKetcherWithStructures(paths))] : []),
    submenu("file-copy", "Copy", [
      command("copy-names", single ? "Name" : "Names", () => workflows.copyNames(paths)),
      command("copy-paths", single ? "Path" : "Paths", () => actions.copyPath(paths.join('\n'))),
      ...(caps.every(cap => ['mol', 'sdf', 'sd', 'smi', 'smiles'].includes(cap.extension)) ? [
        command("copy-smiles", "SMILES", () => copyChemicalFiles(paths, "smiles")),
        command("copy-inchi", "InChI", () => copyChemicalFiles(paths, "inchi")),
      ] : []),
      ...(document?.renderer === "molstar" && caps[0].protein ? [command("copy-sequence", "Sequence", () => workflows.copySequence(document))] : []),
    ], "plus.square.on.square"),
    submenu("file-export", "Export", [
      ...take("save-file-copy").map(entry => ({ ...entry, text: single ? "File Copy…" : "Selected Files…" })),
      ...(document?.renderer === "grid2d" ? [command("export-table", "Collection…", () => actions.saveMoleculeCollectionAs(document.id))] : []),
      ...(document?.renderer === "molstar" ? [
        command("save-scene", "Scene…", () => workflows.saveScene(document)),
        ...submenu("export-structure", "Structure", [
          command("export-cif", "mmCIF…", () => workflows.exportStructure(document, "mmcif")),
          ...(caps[0].protein ? [command("export-pdb", "PDB…", () => workflows.exportStructure(document, "pdb"))] : []),
        ]),
        command("export-image", "Image…", () => workflows.exportImage(document)),
      ] : []),
    ], "square.and.arrow.up"),
    take("trash-file"),
  );
}
