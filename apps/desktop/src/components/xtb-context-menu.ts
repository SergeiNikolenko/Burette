import type { ViewerDocument } from "../types";
import type { MenuItemSpec } from "./menu-types";
import type { ShellActions } from "./types";

type XtbMenuActions = Pick<
  ShellActions,
  "openDockTab" | "openSettingsSection" | "runXtbJob" | "setDockActiveTab" | "setDockOpen"
>;

type XtbMenuTarget = {
  path: string;
  title: string;
  renderer: ViewerDocument["renderer"];
  idPrefix: string;
};

export function xtbStructureMenuItems(actions: XtbMenuActions, target: XtbMenuTarget): MenuItemSpec[] {
  const jobsItem: MenuItemSpec = {
    kind: "item",
    id: `${target.idPrefix}-xtb-jobs`,
    text: "Open xTB Jobs",
    action: () => {
      actions.openDockTab("bottom", "jobs");
      actions.setDockActiveTab("bottom", "jobs");
      actions.setDockOpen("bottom", true);
    },
  };
  const settingsItem: MenuItemSpec = {
    kind: "item",
    id: `${target.idPrefix}-xtb-settings`,
    text: "xTB Settings",
    action: () => actions.openSettingsSection("xtb"),
  };

  if (target.renderer === "grid2d") {
    return [jobsItem, settingsItem];
  }

  return [
    {
      kind: "item",
      id: `${target.idPrefix}-xtb-properties`,
      text: "xTB Properties",
      detail: target.title,
      action: () => void actions.runXtbJob({
        operation: "properties",
        inputPath: target.path,
        label: target.title,
      }, {
        title: "xTB Properties",
        inputLabel: target.title,
        openPrimary: false,
      }),
    },
    { kind: "separator" },
    jobsItem,
    settingsItem,
  ];
}
