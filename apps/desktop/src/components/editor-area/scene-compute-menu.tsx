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

// SDF/MOL's embedded toolbar already owns the geometry/ensemble menu. Other
// molecular scenes use the same selection-aware jobs as the inspector. A scene
// built from several files lists each file, so any of them can be computed
// without selecting it first, and files that are gone show why they cannot.
export function SceneComputeMenu({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  const [files, setFiles] = useState<Array<{ path: string; state: SceneFileState }> | null>(null);
  const host = useComputeHost();
  const connections = useSshConnections().filter(connection => connection.enabled);
  if (window.BuretteMcpWorkspace || !["molstar", "xyzrender-external"].includes(document.renderer)) return null;
  const combined = document.renderer === "molstar" && new Set(recordedScenePaths(document)).size > 1;
  if (!combined && document.renderer === "molstar" && ["sdf", "sd", "mol"].includes(document.extension.toLowerCase().replace(/^\./, ""))) return null;

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
  const items: MenuItemSpec[] = combined
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
  // Every calculation here, and xTB/CREST started elsewhere, runs where this points.
  if (connections.length > 0) items.push({ kind: "separator" }, {
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
