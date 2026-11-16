import type { MenuItemSpec } from "./menu-types";
import type { ViewerDocument } from "../types";
import type { DockTabKind } from "../lib/dock";
import { geometryPanelAvailable } from "../lib/geometry-editing";
import { structureEditAvailable } from "../lib/workbench/graph-draft";
import { workbenchSupportsDocument } from "../lib/workbench/structure";
import { requestGeometryFocus } from "../lib/workbench/geometry-focus";
import { openWorkbenchDialog } from "../lib/workbench/dialog-store";

/**
 * The editing tools of the right-clicked document, as Avogadro offers them from the
 * 3D view. Only the host knows which tools a document has; the viewer names the
 * picked atom (model order, which is source order for the formats Geometry edits).
 * Icons are the dock tabs' own.
 */
export function molstarToolMenuItems(document: ViewerDocument, atomIndex: unknown, openDockTab: (area: "right", kind: DockTabKind) => void): MenuItemSpec[] {
  const atom = Number.isInteger(atomIndex) && (atomIndex as number) >= 0 ? atomIndex as number : null;
  const items: MenuItemSpec[] = [
    ...(structureEditAvailable(document) ? [{ kind: "item" as const, id: "molstar-tool:structure-edit", text: "Edit atoms and bonds", icon: "Edit" as const, action: () => openDockTab("right", "structure-edit") }] : []),
    ...(geometryPanelAvailable(document) ? [{ kind: "item" as const, id: "molstar-tool:geometry", text: "Edit geometry", icon: "SettingsSlider" as const, action: () => {
      if (atom !== null) requestGeometryFocus(document.id, [atom]);
      openDockTab("right", "geometry");
    } }] : []),
    ...(workbenchSupportsDocument(document) ? [{ kind: "item" as const, id: "molstar-tool:properties", text: "Properties…", icon: "InfoCircle" as const, action: () => openWorkbenchDialog({ kind: "properties", document }) }] : []),
  ];
  return items.length ? [...items, { kind: "separator" }] : [];
}
