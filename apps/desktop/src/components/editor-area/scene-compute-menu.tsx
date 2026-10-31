import { openScientificSpectra, useScientificSpectraAvailable, SCIENTIFIC_SPECTRA_COMMAND } from "../../lib/workbench/scientific-spectra-tool";
import { openOrbitals, useOrbitalsAvailable, ORBITALS_COMMAND } from "../../lib/workbench/orbitals-tool";
import { openVibrations, useVibrationsAvailable, VIBRATIONS_COMMAND } from "../../lib/workbench/vibrations-tool";
import { useState } from "react";

import type { ConformerOperation, ViewerDocument, XtbOperation } from "../../types";
import type { ShellActions } from "../types";
import type { MenuItemSpec } from "../menu-types";
import { RadixDropdownMenu } from "../radix-menu";
import { Button } from "../ui/button";
import { ChevronDown } from "../ui/app-icons";
import { recordedScenePaths, sceneFileStates, type SceneFileState } from "../../hooks/workspace-scene-import";
import { xtbOperationLabel } from "../../lib/chemistry-settings";
import { setComputeHost, useComputeHost } from "../../lib/remote-jobs";
import { useSshConnections } from "../../lib/ssh-projects";
import { basename } from "../../lib/sidebar-projects";

const CALCULATIONS: [XtbOperation, string][] = [["properties", "Energy & charges"], ["optimize", "Optimize geometry"], ["hessian", "Vibrational modes"], ["md", "Molecular dynamics"]];
const THIS_MAC = "this-mac";
const CONFORMER_JOBS: [ConformerOperation, string][] = [["crest-generate", "Generate conformers"], ["prism-prune", "Prune conformers"]];
const UNAVAILABLE: Record<Exclude<SceneFileState, "available">, string> = {
  removed: "Removed from the scene",
  deleted: "The file no longer exists",
};

// SDF/MOL's embedded toolbar owns geometry/ensemble actions; registered source
// spectra use this host menu without exposing another generic compute route. Other
// molecular scenes use the same selection-aware jobs as the inspector. A scene
// built from several files lists each file, so any of them can be computed
// without selecting it first, and files that are gone show why they cannot.
export function SceneComputeMenu({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  const [files, setFiles] = useState<Array<{ path: string; state: SceneFileState }> | null>(null);
  const hasOrbitals = useOrbitalsAvailable(document);
  const hasScientificSpectra = useScientificSpectraAvailable(document);
  const hasVibrations = useVibrationsAvailable(document);
  const host = useComputeHost();
  const connections = useSshConnections().filter(connection => connection.enabled);
  if (window.BuretteMcpWorkspace || !["molstar", "xyzrender-external"].includes(document.renderer)) return null;
  const combined = document.renderer === "molstar" && new Set(recordedScenePaths(document)).size > 1;
  const embeddedGraph = !combined && document.renderer === "molstar" && ["sdf", "sd", "mol"].includes(document.extension.toLowerCase().replace(/^\./, ""));
  if (embeddedGraph && !hasScientificSpectra) return null;

  const fileItems = (path: string): MenuItemSpec[] => [
    ...CALCULATIONS.map(([operation, text]) => ({
      kind: "item" as const,
      id: `scene-file-${operation}-${path}`,
      text,
      action: () => void actions.runXtbJob(
        { operation, inputPath: path, sourcePath: path, label: basename(path) },
        { title: xtbOperationLabel(operation), inputLabel: basename(path), openPrimary: operation !== "properties" },
      ),
    })),
    { kind: "separator" },
    ...CONFORMER_JOBS.map(([operation, text]) => ({
      kind: "item" as const,
      id: `scene-file-${operation}-${path}`,
      text,
      action: () => void actions.runConformerOperation(operation, document, null, { scenePath: path }),
    })),
  ];
  const items: MenuItemSpec[] = embeddedGraph ? [] : combined
    ? (files ?? recordedScenePaths(document).map(path => ({ path, state: "available" as const }))).map(({ path, state }) => (
      state === "available"
        ? { kind: "submenu", id: `scene-file-${path}`, text: basename(path), items: fileItems(path) }
        : { kind: "item", id: `scene-file-${path}`, text: basename(path), disabled: true, tooltip: UNAVAILABLE[state] }
    ))
    : [
      ...CALCULATIONS.map(([operation, text]) => ({ kind: "item" as const, id: `scene-${operation}`, text, action: () => void actions.runXtbActiveOperation(operation, document) })),
      { kind: "separator" },
      ...CONFORMER_JOBS.map(([operation, text]) => ({ kind: "item" as const, id: `scene-${operation === "crest-generate" ? "conformers" : "prune"}`, text, action: () => void actions.runConformerOperation(operation, document) })),
    ];
  if (!embeddedGraph && !combined && hasOrbitals) items.push({ kind: "separator" }, { kind: "item", id: "workbench-tool-orbitals", text: ORBITALS_COMMAND.label, action: () => openOrbitals(actions, document.id) });
  if (!embeddedGraph && !combined && hasVibrations) items.push(...(hasOrbitals ? [] : [{ kind: "separator" as const }]), { kind: "item", id: "workbench-tool-vibrations", text: VIBRATIONS_COMMAND.label, action: () => openVibrations(actions, document.id) });
  if (!combined && hasScientificSpectra) items.push(...(embeddedGraph || hasOrbitals || hasVibrations ? [] : [{ kind: "separator" as const }]), { kind: "item", id: "workbench-tool-scientific-spectra", text: SCIENTIFIC_SPECTRA_COMMAND.label, action: () => openScientificSpectra(actions, document.id) });
  // Every calculation here, and xTB/CREST started elsewhere, runs where this points.
  if (!embeddedGraph && connections.length > 0) items.push({ kind: "separator" }, {
    kind: "select", id: "scene-run-on", label: "Run on", value: host ?? THIS_MAC,
    options: [THIS_MAC, ...connections.map(connection => connection.host)],
    optionLabels: Object.fromEntries([[THIS_MAC, "This Mac"], ...connections.map(connection => [connection.host, connection.name])]),
    action: value => setComputeHost(value === THIS_MAC ? null : value),
  });
  // Opaque base under the soft secondary pill so the scene never shows through it.
  return <div className="absolute bottom-3 right-3 z-20 rounded-(--radius-button-toolbar) bg-(--app-shell-sidebar-popover-background)">
    <RadixDropdownMenu
      align="end"
      items={items}
      onOpenChange={(open) => { if (open && combined) void sceneFileStates(document).then(setFiles).catch(() => {}); }}
      trigger={<Button variant="secondary" size="toolbar" aria-label="Open molecular compute menu">Compute<ChevronDown data-icon="inline-end" aria-hidden="true" /></Button>}
    />
  </div>;
}
