import type { ViewerDocument, XtbOperation } from "../../types";
import type { ShellActions } from "../types";
import { RadixDropdownMenu } from "../radix-menu";
import { Button } from "../ui/button";
import { ChevronDown } from "../ui/app-icons";

// SDF/MOL's embedded toolbar already owns the geometry/ensemble menu. Other
// molecular scenes use the same selection-aware jobs as the inspector.
export function SceneComputeMenu({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  if (window.BuretteMcpWorkspace || !["molstar", "xyzrender-external"].includes(document.renderer)) return null;
  if (document.renderer === "molstar" && ["sdf", "sd", "mol"].includes(document.extension.toLowerCase().replace(/^\./, ""))) return null;
  const calculations: [XtbOperation, string][] = [["properties", "Energy & charges"], ["optimize", "Optimize geometry"], ["hessian", "Vibrational modes"]];
  return <div className="absolute bottom-3 right-3 z-20">
    <RadixDropdownMenu align="end" items={[
      ...calculations.map(([operation, text]) => ({ kind: "item" as const, id: `scene-${operation}`, text, action: () => void actions.runXtbActiveOperation(operation, document) })),
      { kind: "separator" },
      { kind: "item", id: "scene-conformers", text: "Generate conformers", action: () => void actions.runConformerOperation("crest-generate", document) },
      { kind: "item", id: "scene-prune", text: "Prune conformers", action: () => void actions.runConformerOperation("prism-prune", document) },
    ]} trigger={<Button variant="secondary" size="toolbar" aria-label="Open molecular compute menu">Compute<ChevronDown data-icon="inline-end" aria-hidden="true" /></Button>} />
  </div>;
}
