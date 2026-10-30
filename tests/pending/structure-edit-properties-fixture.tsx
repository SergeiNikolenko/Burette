import React from "react";
import type { DockTabKind } from "../../apps/desktop/src/lib/dock";
import { doc, viewerActions, resetSource, shellActions, useFixtureRender, createHost, StructureEditPanel } from "../structure-edit-fixture";

export const opened: DockTabKind[] = [];
export let done = 0;
export async function propertiesFixture() {
  const { Dialog, DialogContent } = await import("../../apps/desktop/src/components/ui/dialog");
  const { PropertiesDialogBody } = await import("../../apps/desktop/src/components/workbench/properties-dialog");
  const other = { ...doc, id: "ethanol-in-place", path: "/ethanol-in-place.sdf" };
  resetSource(true);
  opened.length = 0;
  done = 0;
  const actions = shellActions({
    runStructureViewerAction: async (_document, action) => { viewerActions.push(action); },
    openDockTab: (_area, kind) => { opened.push(kind); },
    saveKetcherExportFile: async () => ({ status: "cancelled" }),
    openStructureRecords: async () => { throw new Error("No new document expected"); },
  });
  function Host({ panel }: { panel: boolean }) {
    useFixtureRender();
    return panel
      ? <StructureEditPanel document={other} actions={actions} />
      : <Dialog open><DialogContent><PropertiesDialogBody document={other} actions={actions} onDone={() => { done++; }} /></DialogContent></Dialog>;
  }
  const { host, root } = createHost();
  return { Host, host, root };
}
