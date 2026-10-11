import type { MenuItemSpec } from "../menu-types";
import type { ShellActions, ShellViewState } from "../types";

export function sidebarCreationItems(state: ShellViewState, actions: ShellActions): MenuItemSpec[] {
  return [
    { kind: "item", id: "open-files", text: "Open files…", action: actions.chooseFiles },
    { kind: "item", id: "add-project", text: "Add folder…", action: actions.chooseWorkspace },
    { kind: "item", id: "new-molecule", text: "New molecule", action: actions.openKetcher },
    { kind: "separator" },
    { kind: "item", id: "expand-all-projects", text: "Expand all", action: () => {
      for (const project of state.sidebarProjects) if (!state.expandedProjectIds.includes(project.id)) actions.toggleProjectExpanded(project.id);
      window.dispatchEvent(new CustomEvent("burette-sidebar-expand-all", { detail: true }));
    } },
    { kind: "item", id: "collapse-all-projects", text: "Collapse all", action: () => {
      for (const project of state.sidebarProjects) if (state.expandedProjectIds.includes(project.id)) actions.toggleProjectExpanded(project.id);
      window.dispatchEvent(new CustomEvent("burette-sidebar-expand-all", { detail: false }));
    } },
    ...(state.recentStructures.length ? [{
      kind: "submenu" as const, id: "recent-files", text: "Open recent",
      items: state.recentStructures.slice(0, 10).map((recent, index) => ({
        kind: "item" as const, id: `recent-file-${index}`, text: recent.title,
        action: () => { void actions.openRecentStructure(recent); },
      })),
    }] : []),
  ];
}
