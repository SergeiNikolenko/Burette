import { openWorkbenchDialog } from "../../lib/workbench/dialog-store";
import { polymerSourceFormat } from "../../lib/workbench/polymer-tool";
import { openPlots, usePlotsAvailable, PLOTS_COMMAND } from "../../lib/workbench/plots-tool";
import { assemblySourceFormat } from "../../lib/workbench/assembly-source";
import { sourceExtension, useLogicalSource } from "../../lib/science-session/state";
import { openScientificSpectra, useScientificSpectraAvailable, SCIENTIFIC_SPECTRA_COMMAND } from "../../lib/workbench/scientific-spectra-tool";
import { openOrbitals, useOrbitalsAvailable, ORBITALS_COMMAND } from "../../lib/workbench/orbitals-tool";
import { openPotential, usePotentialAvailable, POTENTIAL_COMMAND } from "../../lib/workbench/potential-tool";
import { FIELDS_COMMAND, openFields, useFieldsAvailable } from "../../lib/workbench/fields-tool";
import { openVibrations, useVibrationsAvailable, VIBRATIONS_COMMAND } from "../../lib/workbench/vibrations-tool";
import { CRYSTAL_COMMAND, openSymmetryTool, SYMMETRY_COMMAND, useSymmetryAvailable } from "../../lib/workbench/symmetry-tools";
import { useCrystalAvailable } from "../../lib/workbench/use-crystal-draft";
import { useEffect, useRef, useState, type RefObject } from "react";
import { commandMenuItems, startAvogadroCommand, useAvogadroCommands } from "../../lib/extensions/avogadro-commands";

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
import { isHostedMcpWidget } from "../../lib/hosted-mcp-widget";

const CALCULATIONS: [XtbOperation, string][] = [["properties", "Energy & charges"], ["optimize", "Optimize with xTB"], ["hessian", "Vibrational modes"], ["md", "Molecular dynamics"]];
const THIS_MAC = "this-mac";
const BUILDERS = [["peptide", "Build peptide…"], ["nucleic", "Build DNA or RNA…"], ["metal", "Build metal complex…"]] as const;
const CONFORMER_JOBS: [ConformerOperation, string][] = [["crest-generate", "Generate conformers"], ["prism-prune", "Prune conformers"]];
const UNAVAILABLE: Record<Exclude<SceneFileState, "available">, string> = {
  removed: "Removed from the scene",
  deleted: "The file no longer exists",
};

// SDF/MOL geometry/ensemble actions run in the viewer; it reports them with its
// anchor and hides its own trigger, so this is the only Compute button. Other
// molecular scenes use the same selection-aware jobs as the inspector. A scene
// built from several files lists each file, so any of them can be computed
// without selecting it first, and files that are gone show why they cannot.
export function SceneComputeMenu({ document, actions, iframeRef }: {
  document: ViewerDocument;
  actions: ShellActions;
  iframeRef?: RefObject<HTMLIFrameElement | null>;
}) {
  const [files, setFiles] = useState<Array<{ path: string; state: SceneFileState }> | null>(null);
  const [viewerOperations, setViewerOperations] = useState<ViewerComputeOperation[]>([]);
  const [pendingLabel, setPendingLabel] = useState("");
  const hasOrbitals = useOrbitalsAvailable(document);
  const hasPotential = usePotentialAvailable(document);
  const hasFields = useFieldsAvailable(document);
  const logical = useLogicalSource(document.id);
  const hasPolymer = polymerSourceFormat(document, logical?.extension ?? document.extension) !== null;
  const hasPlots = usePlotsAvailable(document);
  const hasScientificSpectra = useScientificSpectraAvailable(document);
  const hasVibrations = useVibrationsAvailable(document);
  const hasCrystal = useCrystalAvailable(document);
  const hasSymmetry = useSymmetryAvailable(document);
  const pluginCommands = useAvogadroCommands(document);
  const anchor = useRef<HTMLDivElement>(null);
  const host = useComputeHost();
  const connections = useSshConnections().filter(connection => connection.enabled);
  const combined = document.renderer === "molstar" && new Set(recordedScenePaths(document)).size > 1;
  const embeddedGraph = !combined && document.renderer === "molstar" && ["sdf", "sd", "mol"].includes(sourceExtension(document));
  const available = !window.BuretteMcpWorkspace && !isHostedMcpWidget() && ["molstar", "xyzrender-external"].includes(document.renderer);
  useEffect(() => {
    if (!available || !iframeRef) return;
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      const body = event.data?.body;
      if (!frame || event.source !== frame.contentWindow || event.data?.source !== "burette-viewer"
        || body?.type !== "sceneComputeAnchor" || body.documentId !== document.id
        || !Number.isFinite(body.top) || !Number.isFinite(body.right)
        || body.top < 0 || body.top >= frame.clientHeight || body.right < 0 || body.right >= frame.clientWidth) return;
      setViewerOperations(viewerComputeOperations(body.operations));
      setPendingLabel(typeof body.pendingLabel === "string" ? body.pendingLabel.slice(0, 40) : "");
      const element = anchor.current;
      if (element) {
        element.style.top = `${body.top}px`;
        element.style.right = `${body.right}px`;
        element.style.visibility = body.covered === true ? "hidden" : "visible";
      }
    };
    window.addEventListener("message", onMessage);
    iframeRef.current?.contentWindow?.postMessage({
      source: "burette-host",
      body: { type: "sceneComputeAnchorRequest", documentId: document.id },
    }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [available, document.id, iframeRef]);
  if (!available) return null;

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
  // A MOL or SDF scene gets the potential of its Gasteiger charges, so its menu lists it too.
  if (!combined && hasPotential) items.push(...(embeddedGraph || hasOrbitals ? [] : [{ kind: "separator" as const }]), { kind: "item", id: "workbench-tool-potential", text: POTENTIAL_COMMAND.label, action: () => openPotential(actions, document.id) });
  // A Cube is a calculation, so the item joins the Orbitals and Potential group.
  if (!combined && hasFields) items.push({ kind: "item", id: "workbench-tool-fields", text: FIELDS_COMMAND.label, action: () => openFields(actions, document.id) });
  if (!embeddedGraph && !combined && hasVibrations) items.push(...(hasOrbitals || hasPotential ? [] : [{ kind: "separator" as const }]), { kind: "item", id: "workbench-tool-vibrations", text: VIBRATIONS_COMMAND.label, action: () => openVibrations(actions, document.id) });
  if (!embeddedGraph && !combined && hasCrystal) items.push(...(hasOrbitals || hasPotential || hasVibrations ? [] : [{ kind: "separator" as const }]), { kind: "item", id: "workbench-tool-crystal", text: CRYSTAL_COMMAND.label, action: () => openSymmetryTool(actions, document.id, "crystal") });
  if (!embeddedGraph && !combined && hasSymmetry) items.push(...(hasOrbitals || hasPotential || hasVibrations || hasCrystal ? [] : [{ kind: "separator" as const }]), { kind: "item", id: "workbench-tool-symmetry", text: SYMMETRY_COMMAND.label, action: () => openSymmetryTool(actions, document.id, "symmetry") });
  if (!combined && hasScientificSpectra) items.push(...(embeddedGraph || hasOrbitals || hasPotential || hasVibrations || hasCrystal || hasSymmetry ? [] : [{ kind: "separator" as const }]), { kind: "item", id: "workbench-tool-scientific-spectra", text: SCIENTIFIC_SPECTRA_COMMAND.label, action: () => openScientificSpectra(actions, document.id) });
  if (!combined && hasPlots) items.push(...(embeddedGraph || hasOrbitals || hasPotential || hasVibrations || hasCrystal || hasSymmetry || hasScientificSpectra ? [] : [{ kind: "separator" as const }]), { kind: "item", id: "workbench-tool-plots", text: PLOTS_COMMAND.label, action: () => openPlots(actions, document.id) });
  // Builders open a new document; peptide, DNA/RNA and metal complex also insert into an editable MOL/SDF.
  if (!combined) {
    if (items.length) items.push({ kind: "separator" });
    if (assemblySourceFormat(document)) items.push({ kind: "item", id: "workbench-assembly", text: "Build biological assembly…", action: () => openWorkbenchDialog({ kind: "assembly", document }) });
    if (hasPolymer) items.push({ kind: "item", id: "workbench-polymer", text: "Build polymer…", action: () => openWorkbenchDialog({ kind: "builder", builder: "polymer", document }) });
    for (const [builder, text] of BUILDERS) items.push({ kind: "item", id: `workbench-${builder}`, text, action: () => openWorkbenchDialog({ kind: "builder", builder, document }) });
  }
  if (viewerOperations.length) items.unshift(...viewerOperations.map(({ operation, label, disabled }) => ({
    kind: "item" as const,
    id: `viewer-${operation}`,
    text: label,
    disabled,
    action: () => iframeRef?.current?.contentWindow?.postMessage({
      source: "burette-host",
      body: { type: "runComputeOperation", documentId: document.id, operation },
    }, "*"),
  })), ...(items.length ? [{ kind: "separator" as const }] : []));
  if (!combined && pluginCommands.length) items.push(...(items.length ? [{ kind: "separator" as const }] : []), ...commandMenuItems(pluginCommands, entry => startAvogadroCommand(entry, document)));
  // Every calculation here, and xTB/CREST started elsewhere, runs where this points.
  if (!embeddedGraph && connections.length > 0) items.push({ kind: "separator" }, {
    kind: "select", id: "scene-run-on", label: "Run on", value: host ?? THIS_MAC,
    options: [THIS_MAC, ...connections.map(connection => connection.host)],
    optionLabels: Object.fromEntries([[THIS_MAC, "This Mac"], ...connections.map(connection => [connection.host, connection.name])]),
    action: value => setComputeHost(value === THIS_MAC ? null : value),
  });
  // The same opaque capsule as the viewer's toolbar and rail, so the scene never
  // shows through and the button reads as one of them.
  return <div ref={anchor} className={`absolute right-12 top-14 z-20 rounded-full p-0.5 bg-(--color-surface-elevated) shadow-(--shadow-viewer-surface) backdrop-blur-(--blur-xl) dark:bg-(--color-surface-elevated-secondary) dark:shadow-[0_0_0_var(--border-width-hairline)_var(--color-border),var(--shadow-xl-spread)]${iframeRef ? " invisible" : ""}`}>
    <RadixDropdownMenu
      align="end"
      items={items}
      onOpenChange={(open) => { if (open && combined) void sceneFileStates(document).then(setFiles).catch(() => {}); }}
      trigger={<Button variant="ghost" size="toolbar" className="rounded-full text-(--color-text)" aria-label="Open molecular compute menu">{pendingLabel || "Compute"}<ChevronDown data-icon="inline-end" aria-hidden="true" /></Button>}
    />
  </div>;
}

type ViewerComputeOperation = { operation: string; label: string; disabled: boolean };

// The viewer's own operations arrive over postMessage; keep only well-formed, short entries.
function viewerComputeOperations(value: unknown): ViewerComputeOperation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap(item => (
    item && typeof item.operation === "string" && /^[A-Za-z0-9]{1,40}$/u.test(item.operation) && typeof item.label === "string"
      ? [{ operation: item.operation, label: item.label.slice(0, 60), disabled: item.disabled === true }]
      : []
  ));
}
