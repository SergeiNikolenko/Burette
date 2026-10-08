import { useState } from "react";
import { DockPanel } from "@/components/dock-panel";
import type { ShellActions, ShellViewState } from "@/components/types";
import type { ViewerDocument } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const molecule = { id: "rendering-example", title: "Caffeine", path: "/example/caffeine.xyz", extension: "xyz", renderer: "xyzrender-external", xyzrenderPreset: "default" } as ViewerDocument;
const state = {
  documents: [molecule], textDocuments: [], activeDocument: molecule, visibleDocuments: [molecule],
  activeTab: { location: { kind: "file", path: molecule.path, documentId: molecule.id } },
  rightDockTabs: [{ id: "style", kind: "xyzrender" }], rightDockActiveTab: "xyzrender", rightDockOpen: true,
  rightDockDocumentId: null, rightDockTool: null, dockDroppedStructures: [], hoveredGridRows: {},
} as unknown as ShellViewState;

export function RenderingStyleExample() {
  const [applied, setApplied] = useState("");
  const actions = { openDockTab: () => {}, setStructureDragActive: () => {}, reloadXyzrenderDocument: async (_document, options) => {
    setApplied(options?.xyzrenderSelectionAction === "vdw" ? "Select atoms" : "Style applied");
  } } as ShellActions;
  return <Dialog>
    <DialogTrigger asChild><Button variant="secondary">Rendering style</Button></DialogTrigger>
    <DialogContent variant="form" className="flex max-h-[85vh] flex-col overflow-hidden" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Rendering style</DialogTitle></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain"><DockPanel area="right" state={state} actions={actions} /></div>
      {applied ? <output className="text-sm" aria-live="polite">{applied}</output> : null}
    </DialogContent>
  </Dialog>;
}
