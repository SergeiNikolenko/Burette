import type { MenuItemSpec } from "../menu-types";
import type { ShellActions, ShellViewState } from "../types";

export function sidebarCreationItems(state: ShellViewState, actions: ShellActions): MenuItemSpec[] {
  return [
    { kind: "item", id: "open-files", text: "Open Files…", action: actions.chooseFiles },
    { kind: "item", id: "add-project", text: "Add Folder…", action: actions.chooseWorkspace },
    { kind: "item", id: "new-molecule", text: "New Molecule", action: actions.openKetcher },
    { kind: "separator" },
    { kind: "item", id: "expand-all-projects", text: "Expand All", action: () => {
      for (const project of state.sidebarProjects) if (!state.expandedProjectIds.includes(project.id)) actions.toggleProjectExpanded(project.id);
      window.dispatchEvent(new CustomEvent("burette-sidebar-expand-all", { detail: true }));
    } },
    { kind: "item", id: "collapse-all-projects", text: "Collapse All", action: () => {
      for (const project of state.sidebarProjects) if (state.expandedProjectIds.includes(project.id)) actions.toggleProjectExpanded(project.id);
      window.dispatchEvent(new CustomEvent("burette-sidebar-expand-all", { detail: false }));
    } },
    ...(state.recentStructures.length ? [{
      kind: "submenu" as const, id: "recent-files", text: "Open Recent",
      items: state.recentStructures.slice(0, 10).map((recent, index) => ({
        kind: "item" as const, id: `recent-file-${index}`, text: recent.title,
        action: () => { void actions.openRecentStructure(recent); },
      })),
    }] : []),
  ];
}
