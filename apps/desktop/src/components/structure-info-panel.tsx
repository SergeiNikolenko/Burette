import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { showNativeContextMenu } from "./native-context-menu";
import { formatBytes } from "./format";
import { RangeControl, SelectControl, ToggleControl } from "./settings-panel/setting-control";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { FoldingResultsPanel, useFoldingResult } from "./folding-results-panel";
import type { MenuItemSpec } from "./menu-types";
import type { ShellActions, ShellViewState, StructureOverlayMode, StructureViewerAction } from "./types";
import { structureBriefForDocument, type StructureBriefRow as BriefRow } from "../lib/structure-brief";
import { parseStructureComposition, type StructureCompositionSummary, type StructureSummaryRow } from "../lib/structure-composition";
import { canInspectConformerEnsemble, canShowConformerWorkflow, canUseConformerWorkflow } from "../lib/conformer-ensemble";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DIRECT_CHEMISTRY_JOB_ATOM_LIMIT, structureAtomCountFromSummary } from "../lib/direct-chemistry-guard";
import { extensionForDocking } from "../lib/docking-documents";
import { readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { readStructureText } from "../lib/structure-text";
import { isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { getMdsmoothCapabilities, installDeepTica, runMdsmooth, type MdsmoothMode, type MdsmoothResult, type MdsmoothSignal } from "../lib/mdsmooth";
import { isTauriRuntime } from "../lib/tauri";
import type { ConformerSettings, TextFileDocument, ViewerDocument, XtbArtifact, XtbRunResult, XtbSettings } from "../types";

type StructureInfoPanelProps = {
  document: ViewerDocument | null;
  textDocument?: TextFileDocument | null;
  dockDrops: ShellViewState["dockDroppedStructures"];
  conformerStatus: ShellViewState["conformerStatus"];
  conformerSettings: ShellViewState["conformerSettings"];
  viewerLigandSelection: ShellViewState["viewerLigandSelection"];
  structureOverlayMode: StructureOverlayMode;
  xtbStatus: ShellViewState["xtbStatus"];
  xtbSettings: ShellViewState["xtbSettings"];
  xtbJobs: ShellViewState["xtbJobs"];
  preferences: ShellViewState["preferences"];
  isBrowserDev: boolean;
  actions: ShellActions;
};

type XtbSettingsScope = "general" | "optimize" | "properties" | "optimized-hessian" | "vipea" | "vfukui" | "md" | "metadyn";
type XtbSettingsCategory = "core" | "solvation" | "properties" | "dynamics" | "output";
type InspectorStructureTextSource = {
  path: string;
  extension: string;
  virtual: boolean;
};
type TrajectorySmoothingResult = {
  frameCount: number;
  keyframeCount: number;
  keyframes: number[];
  rawSignal: number[];
  filteredSignal: number[];
  interpolation: string;
  outputPath?: string;
  signal?: MdsmoothSignal;
  cutoffFrequency?: number | null;
  spectrum?: MdsmoothResult["spectrum"];
  diagnostics?: MdsmoothResult["diagnostics"];
  mode?: MdsmoothMode;
  preset?: "light" | "balanced" | "strong";
  settingsSignature?: string;
};
type TrajectoryPlaybackState = {
  frameIndex: number;
  frameCount: number;
  playing: boolean;
};

const SDF_CONTEXT_STYLE_OPTIONS = [
  { value: "line", label: "Line" },
  { value: "ball-and-stick", label: "Ball+Stick" },
  { value: "cartoon", label: "Cartoon" },
  { value: "spacefill", label: "Spacefill" },
  { value: "molecular-surface", label: "Surface" },
  { value: "match", label: "Match" },
] as const;

type SdfContextStyleOption = typeof SDF_CONTEXT_STYLE_OPTIONS[number];
type SdfContextStyle = SdfContextStyleOption["value"];
type SdfContextColor = "gray" | "colored";
const XYZ_FRAME_CONTEXT_STYLE_OPTIONS = [
  { value: "line", label: "Line" },
  { value: "ball-and-stick", label: "Ball+Stick" },
  { value: "spacefill", label: "Spacefill" },
  { value: "molecular-surface", label: "Surface" },
  { value: "match", label: "Match" },
] as const satisfies readonly SdfContextStyleOption[];
const SDF_CONTEXT_OPACITY_DEFAULT = 0.4;
const SDF_CONTEXT_OPACITY_MIN = 0.04;
const SDF_CONTEXT_OPACITY_MAX = 1;
const SDF_CONTEXT_STYLE_DEFAULT: SdfContextStyle = "match";
const SDF_CONTEXT_COLOR_DEFAULT: SdfContextColor = "colored";
const INFO_TRAJECTORY_CONTROL_LIMIT = 200;
const TRAJECTORY_SMOOTHING_PRESET_TARGET_RATIO = {
  light: 0.55,
  balanced: 0.32,
  strong: 0.18,
} as const;
const TRAJECTORY_SMOOTHING_EXTENSIONS = new Set([
  "xyz", "pdb", "ent", "gro", "xtc", "trr", "dcd", "nctraj", "nc", "ncdf", "netcdf", "ncrst", "lammpstrj",
]);

export function StructureInfoPanel({ document, textDocument, dockDrops, conformerStatus, conformerSettings, viewerLigandSelection, structureOverlayMode, xtbStatus, xtbSettings, xtbJobs, preferences, isBrowserDev, actions }: StructureInfoPanelProps) {
  const hostedMcpWidget = isHostedMcpWidget();
  const composition = useStructureComposition(document);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [sdfContextStyle, setSdfContextStyle] = useState<SdfContextStyle>(SDF_CONTEXT_STYLE_DEFAULT);
  const [sdfContextColor, setSdfContextColor] = useState<SdfContextColor>(SDF_CONTEXT_COLOR_DEFAULT);
  const [sdfContextOpacity, setSdfContextOpacity] = useState(SDF_CONTEXT_OPACITY_DEFAULT);
  const [xtbOpen, setXtbOpen] = useState(true);
  const [xtbSettingsOpen, setXtbSettingsOpen] = useState(false);
  const [xtbSettingsScope, setXtbSettingsScope] = useState<XtbSettingsScope>("general");
  const [conformerOpen, setConformerOpen] = useState(true);
  const [trajectorySmoothingOpen, setTrajectorySmoothingOpen] = useState(true);
  const [trajectorySmoothingAdvanced, setTrajectorySmoothingAdvanced] = useState(false);
  const [trajectorySmoothingPreset, setTrajectorySmoothingPreset] = useState<"light" | "balanced" | "strong">("balanced");
  const [trajectorySmoothingTargetFrames, setTrajectorySmoothingTargetFrames] = useState(50);
  const [trajectorySmoothingReferenceFrame, setTrajectorySmoothingReferenceFrame] = useState(1);
  const [trajectorySmoothingAlign, setTrajectorySmoothingAlign] = useState(true);
  const [trajectorySmoothingBuilt, setTrajectorySmoothingBuilt] = useState(false);
  const [trajectorySmoothingView, setTrajectorySmoothingView] = useState<"original" | "smoothed">("original");
  const [trajectorySmoothingResult, setTrajectorySmoothingResult] = useState<TrajectorySmoothingResult | null>(null);
  const [trajectorySmoothingSignal, setTrajectorySmoothingSignal] = useState<MdsmoothSignal>("rmsd");
  const [trajectorySmoothingMode, setTrajectorySmoothingMode] = useState<MdsmoothMode>("extrema");
  const [trajectoryPlayback, setTrajectoryPlayback] = useState<TrajectoryPlaybackState | null>(null);
  const foldingResult = useFoldingResult(document);

  useEffect(() => {
    setActiveActionKey(null);
    setTrajectorySmoothingBuilt(false);
    setTrajectorySmoothingView("original");
    setTrajectorySmoothingResult(null);
    setTrajectoryPlayback(null);
  }, [document?.id]);

  // Closing the molecule card clears the selection inside the viewer, so a row
  // highlighted from a ligand click here has to let go of it too - otherwise the
  // panel keeps claiming a scope the viewer no longer has.
  useEffect(() => {
    if (viewerLigandSelection) return;
    setActiveActionKey((current) => current && current.includes("focus_ligand") ? null : current);
  }, [viewerLigandSelection]);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (String(detail?.documentId || "") !== document?.id) return;
      const frameCount = Math.max(1, Math.trunc(Number(detail.frameCount) || 1));
      setTrajectoryPlayback({
        frameIndex: Math.max(0, Math.min(frameCount - 1, Math.trunc(Number(detail.frameIndex) || 0))),
        frameCount,
        playing: detail.playing === true,
      });
    };
    window.addEventListener("burrete:trajectory-frame-changed", handle);
    return () => window.removeEventListener("burrete:trajectory-frame-changed", handle);
  }, [document?.id]);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (String(detail?.documentId || "") !== document?.id) return;
      if (detail.view === "original" || detail.view === "smoothed") setTrajectorySmoothingView(detail.view);
      if (!Array.isArray(detail.rawSignal) || !Array.isArray(detail.filteredSignal)) return;
      setTrajectorySmoothingBuilt(true);
      setTrajectorySmoothingResult({
        frameCount: Number(detail.frameCount) || detail.rawSignal.length,
        keyframeCount: Number(detail.keyframeCount) || 0,
        keyframes: Array.isArray(detail.keyframes) ? detail.keyframes.map(Number) : [],
        rawSignal: detail.rawSignal.map(Number),
        filteredSignal: detail.filteredSignal.map(Number),
        interpolation: String(detail.interpolation || "linear"),
      });
    };
    window.addEventListener("burrete:trajectory-smoothing-changed", handle);
    return () => window.removeEventListener("burrete:trajectory-smoothing-changed", handle);
  }, [document?.id]);

  useEffect(() => {
    if (!document) return;
    setSdfContextStyle(readSdfContextStylePreference(document));
    setSdfContextColor(readSdfContextColorPreference(document));
    setSdfContextOpacity(readSdfContextOpacityPreference(document));
  }, [document]);

  if (!document) {
    if (textDocument) {
      return <TextFileInfoPanel document={textDocument} dockDrops={dockDrops} actions={actions} />;
    }
    return (
      <div className="dock-content structure-brief">
        <section className="structure-brief-card">
          <div className="structure-brief-kicker">Molecular Inspector</div>
          <h3>No active structure</h3>
          <p>Open a molecular file to see a compact summary here.</p>
        </section>
        <StructureDropSummary dockDrops={dockDrops} />
      </div>
    );
  }

  const brief = structureBriefForDocument(document, formatBytes(document.byteCount));
  const compositionSummary = composition.documentId === document.id ? composition.summary : null;
  const compositionPending = composition.documentId === document.id && composition.loading;
  const rawCompositionError = composition.documentId === document.id ? composition.error : null;
  const virtualScene = isVirtualMolstarScene(document);
  const compositionError = virtualScene ? null : rawCompositionError;
  const selectedEntity = selectedStructureRow(document, compositionSummary, activeActionKey);
  const poseControls = structurePoseControlsFor(document, compositionSummary) ?? trajectoryPlaybackControlsFor(document, trajectoryPlayback);
  const trajectoryDocument = isTrajectorySmoothingDocument(document, poseControls);
  const contextStyleCard = structureContextStyleCardFor(document, compositionSummary, structureOverlayMode);
  const latestXtbJob = latestXtbJobForDocument(document, xtbJobs);
  const runningXtbJob = latestXtbJob?.status === "running" ? latestXtbJob : null;
  const structureXtbArtifact = xtbArtifactInfoForPath(document.path, document.extension);
  // Only a checked-and-missing binary disables the run buttons; an unchecked one
  // is not yet known to be missing.
  const xtbMissing = xtbStatus?.installed === false;
  // A direct job on a whole protein is refused once it starts, with a message
  // telling you to select something first. The atom count is already parsed, so
  // the card can say that before the click instead of after it.
  const structureAtoms = compositionSummary ? structureAtomCountFromSummary(compositionSummary) : null;
  const jobScopedToSelection = Boolean(selectedEntity || viewerLigandSelection);
  const oversizedForDirectJob = !jobScopedToSelection
    && structureAtoms !== null
    && structureAtoms > DIRECT_CHEMISTRY_JOB_ATOM_LIMIT;
  const oversizedNotice: EngineTool[] = oversizedForDirectJob ? [{
    name: "Scope",
    installed: false,
    hint: `This structure has ${structureAtoms.toLocaleString()} atoms. Select a ligand or chain first — direct runs are capped at ${DIRECT_CHEMISTRY_JOB_ATOM_LIMIT}.`,
  }] : [];
  const xtbBlocked = xtbMissing || oversizedForDirectJob;
  const openXtbSettingsFor = (scope: XtbSettingsScope) => {
    setXtbSettingsScope(scope);
    setXtbSettingsOpen(true);
  };
  const showXtbMoreMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(XTB_MORE_OPERATIONS.map(([operation, text]) => ({
      kind: "item" as const,
      id: operation,
      text,
      detail: XTB_ACTION_TOOLTIPS[operation],
      action: () => void actions.runXtbActiveOperation(operation),
    })), { x: rect.left, y: rect.bottom + 6 }, { forceWeb: true });
  };
  const showXtbSettingsFor = (scope: XtbSettingsScope) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openXtbSettingsFor(scope);
  };
  const toggleGeneralXtbSettings = () => {
    setXtbSettingsScope("general");
    setXtbSettingsOpen((open) => xtbSettingsScope === "general" ? !open : true);
  };
  const showFileActionsMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu([
      {
        kind: "item",
        id: "show-metadata",
        text: "Show metadata",
        detail: document.title,
        action: () => void actions.showDocumentMetadata(document),
      },
      {
        kind: "item",
        id: "copy-path",
        text: "Copy path",
        detail: document.path,
        action: () => void actions.copyDocumentPath(document),
      },
      {
        kind: "item",
        id: "reveal-file",
        text: "Reveal file",
        detail: document.title,
        action: () => void actions.revealDocument(document),
      },
    ], { x: rect.left, y: rect.bottom + 6 }, { forceWeb: true });
  };

  return (
    <div className="dock-content structure-brief">
      <section className="structure-brief-card structure-inspector-header">
        <div className="structure-brief-kicker">Molecular Inspector</div>
        <div className="structure-brief-title-row">
          <h3 title={document.title}>{document.title}</h3>
          <Badge variant="secondary">{brief.format}</Badge>
          {!hostedMcpWidget && !document.virtual ? (
            <button
              type="button"
              className="structure-inspector-more-button"
              aria-label="File actions"
              title="File actions"
              onClick={showFileActionsMenu}
            >
              ...
            </button>
          ) : null}
        </div>
        <p>{inspectorSummaryLine(brief.kind, compositionSummary, compositionPending, compositionError)}</p>
      </section>

      {contextStyleCard ? (
        <SdfContextStyleCard
          document={document}
          actions={actions}
          value={sdfContextStyle}
          setValue={setSdfContextStyle}
          color={sdfContextColor}
          setColor={setSdfContextColor}
          opacity={sdfContextOpacity}
          setOpacity={setSdfContextOpacity}
          copy={contextStyleCard}
        />
      ) : null}

      {(compositionSummary || compositionPending || compositionError) ? (
        <StructureCompositionCard
          summary={compositionSummary}
          pending={compositionPending}
          error={compositionError}
          document={document}
          actions={actions}
          activeActionKey={activeActionKey}
          setActiveActionKey={setActiveActionKey}
        />
      ) : null}

      <FoldingResultsPanel state={foldingResult} actions={actions} />

      {!hostedMcpWidget && !trajectoryDocument && !virtualScene ? <>
        <ConformerWorkflowCard
          document={document}
          selectedEntity={selectedEntity}
          viewerLigandSelection={viewerLigandSelection}
          status={conformerStatus}
          settings={conformerSettings}
          open={conformerOpen}
          setOpen={setConformerOpen}
          oversizedNotice={oversizedNotice}
          actions={actions}
        />

        <InspectorEngineCard
          className="structure-inspector-xtb-card"
          title="xTB"
          tooltip="Semiempirical quantum calculations for the current molecular scope."
          status={runningXtbJob ? `Running ${operationTitle(runningXtbJob.operation).toLowerCase()}` : xtbStatusLine(xtbStatus, isBrowserDev)}
          open={xtbOpen}
          onToggle={() => setXtbOpen((open) => !open)}
          summary={xtbSettingsSummary(xtbSettings)}
          summaryTooltip="Hamiltonian, convergence, charge, spin, solvation, and parallelism for xTB calculations."
          summaryModified={xtbSettingsModified(xtbSettings)}
          onReset={xtbSettingsModified(xtbSettings) ? () => actions.setXtbSettings(defaultXtbSettings) : undefined}
          // xTB takes the viewer's selection as its scope the same way CREST does,
          // and that changes what the run costs - worth saying out loud.
          scope={runningXtbJob ? (
            <>
              {runningXtbJob.inputLabel} is running.
              {" "}
              <Button type="button" variant="outline" size="xs" onClick={() => void actions.cancelXtbJob(runningXtbJob.id)}>
                Cancel
              </Button>
            </>
          ) : jobScopedToSelection ? "Scope: selected object" : undefined}
          notice={(
            <EngineToolNotice
              tools={[...oversizedNotice, {
                name: "xTB",
                installed: xtbStatus?.installed !== false,
                hint: xtbStatus?.installHint ?? "",
                install: () => void actions.installXtb(),
              }]}
              onCheck={() => void actions.checkXtbStatus()}
            />
          )}
        >
          <div className="structure-brief-actions structure-brief-actions-grid">
            <XtbActionButton label="Optimize" tooltip={XTB_ACTION_TOOLTIPS.optimize} disabled={xtbBlocked} onClick={() => void actions.runXtbActiveOperation("optimize")} onContextMenu={showXtbSettingsFor("optimize")} />
            <XtbActionButton label="Properties" tooltip={XTB_ACTION_TOOLTIPS.properties} disabled={xtbBlocked} onClick={() => void actions.runXtbActiveOperation("properties")} onContextMenu={showXtbSettingsFor("properties")} />
            <XtbActionButton label="Frequencies" tooltip={XTB_ACTION_TOOLTIPS["optimized-hessian"]} disabled={xtbBlocked} onClick={() => void actions.runXtbActiveOperation("optimized-hessian")} onContextMenu={showXtbSettingsFor("optimized-hessian")} />
            {/* Four of the seven operations are specialist runs, and giving them the
                same weight as Optimize made the card read as a wall of buttons. */}
            <Button type="button" variant="secondary" size="sm" className="structure-inspector-xtb-action w-full" disabled={xtbBlocked} onClick={showXtbMoreMenu}>
              More
              <ShortcutTooltip label="IP/EA, Fukui, molecular dynamics, and metadynamics runs." />
            </Button>
            <Button type="button" variant="outline" size="sm" className="structure-inspector-xtb-action w-full" aria-expanded={xtbSettingsOpen} onClick={toggleGeneralXtbSettings}>
              Settings
              <ShortcutTooltip label="Hamiltonian, charge, spin, solvation, accuracy, property, and dynamics parameters." />
            </Button>
            <Button type="button" variant="outline" size="sm" className="structure-inspector-xtb-action w-full" onClick={() => actions.toggleDockTab("bottom", "jobs")}>
              Jobs
              <ShortcutTooltip label="xTB calculation history, energies, properties, trajectories, and output artifacts." />
            </Button>
          </div>
          {xtbSettingsOpen ? (
            <XtbInlineSettings
              settings={xtbSettings}
              scope={xtbSettingsScope}
              xtbStatus={xtbStatus}
              isBrowserDev={isBrowserDev}
              actions={actions}
              onClose={() => setXtbSettingsOpen(false)}
            />
          ) : null}
        </InspectorEngineCard>

        {latestXtbJob?.result ? (
          <XtbResultsPanel document={document} job={latestXtbJob} actions={actions} />
        ) : null}

        {structureXtbArtifact ? <XtbArtifactInfoCard artifact={structureXtbArtifact} byteCount={document.byteCount} /> : null}
      </> : null}

      {poseControls ? (
        <>
          {trajectoryDocument && !virtualScene ? (
            <TrajectorySmoothingCard
              document={document}
              controls={poseControls}
              actions={actions}
              open={trajectorySmoothingOpen}
              setOpen={setTrajectorySmoothingOpen}
              advanced={trajectorySmoothingAdvanced}
              setAdvanced={setTrajectorySmoothingAdvanced}
              preset={trajectorySmoothingPreset}
              setPreset={setTrajectorySmoothingPreset}
              targetFrames={trajectorySmoothingTargetFrames}
              setTargetFrames={setTrajectorySmoothingTargetFrames}
              referenceFrame={trajectorySmoothingReferenceFrame}
              setReferenceFrame={setTrajectorySmoothingReferenceFrame}
              align={trajectorySmoothingAlign}
              setAlign={setTrajectorySmoothingAlign}
              built={trajectorySmoothingBuilt}
              view={trajectorySmoothingView}
              setView={setTrajectorySmoothingView}
              result={trajectorySmoothingResult}
              setResult={setTrajectorySmoothingResult}
              setBuilt={setTrajectorySmoothingBuilt}
              signal={trajectorySmoothingSignal}
              setSignal={setTrajectorySmoothingSignal}
              mode={trajectorySmoothingMode}
              setMode={setTrajectorySmoothingMode}
              playback={trajectoryPlayback}
            />
          ) : null}
          {!trajectoryDocument ? (
            <StructurePoseControlsCard
              document={document}
              controls={poseControls}
              actions={actions}
              activeActionKey={activeActionKey}
              setActiveActionKey={setActiveActionKey}
            />
          ) : null}
        </>
      ) : null}

      <StructureDetailsSection
        brief={brief}
        compositionSummary={compositionSummary}
        compositionPending={compositionPending}
        compositionError={compositionError}
        document={document}
        hostedMcpWidget={hostedMcpWidget}
        actions={actions}
      />

      <StructureDropSummary dockDrops={dockDrops} />
    </div>
  );
}

function hasSdfMoleculeCollection(summary: StructureCompositionSummary) {
  return summary.componentRows.filter((row) => row.action?.type === "set_sdf_molecule").length > 1;
}

type StructurePoseControls = {
  kind: "frames";
  title: string;
  detail: string;
  controlLabel: string;
  actions: Array<StructureViewerAction & { type: "set_structure_pose" }>;
};

function structurePoseControlsFor(document: ViewerDocument, summary: StructureCompositionSummary | null): StructurePoseControls | null {
  if (document.renderer !== "molstar") return null;
  // molstarSceneStructureCount already returns 0 for anything that is not a
  // virtual scene, so the count alone identifies one. Requiring !summary as well
  // used the parser failing as the signal, and for a scene built from real files
  // the receptor almost always parses - so the stepper went missing exactly when
  // there were several structures to step through.
  const sceneStructureCount = molstarSceneStructureCount(document);
  if (sceneStructureCount > 1 && sceneStructureCount <= INFO_TRAJECTORY_CONTROL_LIMIT) {
    return {
      kind: "frames",
      title: "Structures",
      detail: `${sceneStructureCount} structures`,
      controlLabel: "Structure",
      actions: Array.from({ length: sceneStructureCount }, (_, index) => ({
        type: "set_structure_pose",
        label: `Show structure ${index + 1}`,
        index,
      })),
    };
  }
  if (!summary) return null;
  const maestroEntryCount = maestroPreviewEntryCount(summary);
  if (maestroEntryCount !== null && maestroEntryCount > 1 && maestroEntryCount <= INFO_TRAJECTORY_CONTROL_LIMIT) {
    return {
      kind: "frames",
      title: "Structures",
      detail: `${maestroEntryCount} structures`,
      controlLabel: "Structure",
      actions: Array.from({ length: maestroEntryCount }, (_, index) => ({
        type: "set_structure_pose",
        label: `Show structure ${index + 1}`,
        index,
      })),
    };
  }
  const frameCount = numberFromSummaryRows(summary.rows, "Frames") ?? numberFromSummaryRows(summary.rows, "Models");
  if (frameCount && frameCount > 1 && frameCount <= INFO_TRAJECTORY_CONTROL_LIMIT) {
    const controlLabel = numberFromSummaryRows(summary.rows, "Models") === frameCount ? "Model" : "Frame";
    return {
      kind: "frames",
      title: `${controlLabel}s`,
      detail: `${frameCount} ${controlLabel.toLowerCase()}s`,
      controlLabel,
      actions: Array.from({ length: frameCount }, (_, index) => ({
        type: "set_structure_pose",
        label: `Show ${controlLabel.toLowerCase()} ${index + 1}`,
        index,
      })),
    };
  }
  return null;
}

function isTrajectorySmoothingDocument(document: ViewerDocument, controls: StructurePoseControls | null) {
  return Boolean(controls && controls.actions.length > 1 && (
    TRAJECTORY_SMOOTHING_EXTENSIONS.has(document.extension) || document.dockingRequest?.ligandPaths.length
  ));
}

function trajectoryPlaybackControlsFor(document: ViewerDocument, playback: TrajectoryPlaybackState | null): StructurePoseControls | null {
  if (!document.dockingRequest || !playback || playback.frameCount <= 1 || playback.frameCount > INFO_TRAJECTORY_CONTROL_LIMIT) return null;
  return {
    kind: "frames",
    title: "Frames",
    detail: `${playback.frameCount} frames`,
    controlLabel: "Frame",
    actions: Array.from({ length: playback.frameCount }, (_, index) => ({
      type: "set_structure_pose",
      label: `Show frame ${index + 1}`,
      index,
    })),
  };
}

function TrajectorySmoothingCard({
  document,
  controls,
  actions,
  open,
  setOpen,
  advanced,
  setAdvanced,
  preset,
  setPreset,
  targetFrames,
  setTargetFrames,
  referenceFrame,
  setReferenceFrame,
  align,
  setAlign,
  built,
  view,
  setView,
  result,
  setResult,
  setBuilt,
  signal,
  setSignal,
  mode,
  setMode,
  playback,
}: {
  document: ViewerDocument;
  controls: StructurePoseControls;
  actions: ShellActions;
  open: boolean;
  setOpen: (value: boolean) => void;
  advanced: boolean;
  setAdvanced: (value: boolean) => void;
  preset: "light" | "balanced" | "strong";
  setPreset: (value: "light" | "balanced" | "strong") => void;
  targetFrames: number;
  setTargetFrames: (value: number) => void;
  referenceFrame: number;
  setReferenceFrame: (value: number) => void;
  align: boolean;
  setAlign: (value: boolean) => void;
  built: boolean;
  view: "original" | "smoothed";
  setView: (value: "original" | "smoothed") => void;
  result: TrajectorySmoothingResult | null;
  setResult: (value: TrajectorySmoothingResult | null) => void;
  setBuilt: (value: boolean) => void;
  signal: MdsmoothSignal;
  setSignal: (value: MdsmoothSignal) => void;
  mode: MdsmoothMode;
  setMode: (value: MdsmoothMode) => void;
  playback: TrajectoryPlaybackState | null;
}) {
  const frameCount = controls.actions.length;
  const [running, setRunning] = useState(false);
  const [installingDeepTica, setInstallingDeepTica] = useState(false);
  const [deepTicaInstalled, setDeepTicaInstalled] = useState<boolean | null>(null);
  const [showUpdated, setShowUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rmsdFilter, setRmsdFilter] = useState<"frames" | "cutoff" | "power">("frames");
  const [cutoffFrequency, setCutoffFrequency] = useState(0.1);
  const [powerRetained, setPowerRetained] = useState(0.95);
  const [filterOrder, setFilterOrder] = useState(5);
  const [includeEnds, setIncludeEnds] = useState(true);
  const [kineticStates, setKineticStates] = useState(5);
  const [lagFrames, setLagFrames] = useState(Math.max(1, Math.min(50, Math.round(frameCount / 20))));
  const failedAutoUpdate = useRef<string | null>(null);
  const requestSerial = useRef(0);
  const updatedTimer = useRef<number | null>(null);
  const settingsSignature = JSON.stringify([signal, mode, preset, targetFrames, referenceFrame, align, rmsdFilter, cutoffFrequency, powerRetained, filterOrder, includeEnds, kineticStates, lagFrames]);
  const latestSettingsSignature = useRef(settingsSignature);
  latestSettingsSignature.current = settingsSignature;
  const build = async () => {
    const requestedSignature = settingsSignature;
    const updatingExisting = built;
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    setRunning(true);
    setError(null);
    try {
      const pair = trajectoryPathsFor(document);
      const response = await runMdsmooth({
        trajectoryPath: pair.trajectoryPath,
        topologyPath: pair.topologyPath,
        signal,
        mode,
        targetFrames: Math.max(2, Math.min(frameCount, targetFrames)),
        cutoffFrequency: signal === "rmsd" && rmsdFilter === "cutoff" ? cutoffFrequency : undefined,
        powerCutoff: signal === "rmsd" && rmsdFilter === "power" ? powerRetained : undefined,
        order: filterOrder,
        includeEnds,
        referenceFrame: Math.max(1, Math.min(frameCount, referenceFrame)),
        align,
        lag: lagFrames,
        states: kineticStates,
        microstates: Math.min(100, frameCount),
        ticaDimensions: 3,
      });
      if (serial !== requestSerial.current || requestedSignature !== latestSettingsSignature.current) return;
      failedAutoUpdate.current = null;
      if (updatedTimer.current) window.clearTimeout(updatedTimer.current);
      if (updatingExisting) {
        setShowUpdated(true);
        updatedTimer.current = window.setTimeout(() => setShowUpdated(false), 1400);
      }
      setResult({
        frameCount: response.frameCount,
        keyframeCount: response.keyframes.length,
        keyframes: response.keyframes,
        rawSignal: response.rawSignal,
        filteredSignal: response.filteredSignal,
        interpolation: response.interpolation,
        outputPath: response.outputPath,
        signal: response.signal,
        cutoffFrequency: response.cutoffFrequency,
        spectrum: response.spectrum,
        diagnostics: response.diagnostics,
        mode,
        preset,
        settingsSignature: requestedSignature,
      });
      setBuilt(true);
      setView("smoothed");
      actions.runStructureViewerAction(document, {
        type: "apply_external_trajectory_smoothing",
        label: "Show smoothed motion",
        notify: false,
        sourceUrl: trajectoryOutputUrl(response.outputPath),
        frameCount: response.frameCount,
        interpolation: response.interpolation,
        frameIndex: playback?.frameIndex ?? 0,
        playing: Boolean(playback?.playing),
      });
    } catch (reason) {
      if (serial !== requestSerial.current || requestedSignature !== latestSettingsSignature.current) return;
      failedAutoUpdate.current = requestedSignature;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (serial === requestSerial.current) setRunning(false);
    }
  };
  const selectPreset = (nextPreset: "light" | "balanced" | "strong") => {
    const nextTargetFrames = Math.max(2, Math.round(frameCount * TRAJECTORY_SMOOTHING_PRESET_TARGET_RATIO[nextPreset]));
    setPreset(nextPreset);
    setTargetFrames(nextTargetFrames);
  };
  const resultDirty = Boolean(result && result.settingsSignature !== settingsSignature);
  useEffect(() => {
    if (signal !== "deeptica") return;
    let cancelled = false;
    void getMdsmoothCapabilities()
      .then((capabilities) => { if (!cancelled) setDeepTicaInstalled(capabilities.deepTicaInstalled); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [signal]);
  useEffect(() => {
    if (!built || !resultDirty || running || failedAutoUpdate.current === settingsSignature) return;
    const timer = window.setTimeout(() => void build(), 450);
    return () => window.clearTimeout(timer);
  }, [built, resultDirty, running, settingsSignature]);
  useEffect(() => () => {
    if (updatedTimer.current) window.clearTimeout(updatedTimer.current);
  }, []);
  const changeView = (nextView: "original" | "smoothed") => {
    setView(nextView);
    actions.runStructureViewerAction(document, {
      type: "set_trajectory_smoothing_view",
      label: `Show ${nextView} trajectory`,
      notify: false,
      view: nextView,
    });
  };
  const setFrame = (index: number) => {
    actions.runStructureViewerAction(document, {
      type: "set_structure_pose",
      label: `Show frame ${index + 1}`,
      index,
    });
  };
  useEffect(() => {
    const toggle = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (String(detail?.documentId || "") !== document.id) return;
      setOpen(true);
      if (!built) void build();
      else changeView(view === "smoothed" ? "original" : "smoothed");
    };
    window.addEventListener("burrete:trajectory-smoothing-toggle-requested", toggle);
    return () => window.removeEventListener("burrete:trajectory-smoothing-toggle-requested", toggle);
  });
  return (
    <section className="structure-brief-card trajectory-smoothing-card" data-collapsed={!open || undefined}>
      <div className="trajectory-smoothing-header">
        <strong>Smooth motion</strong>
        <div className="trajectory-smoothing-power" role="group" aria-label="Smooth motion">
          <button type="button" data-selected={view === "original" || !built || undefined} aria-pressed={view === "original" || !built} onClick={() => { if (built) changeView("original"); }}>Off</button>
          <button type="button" data-selected={built && view === "smoothed" || undefined} aria-pressed={built && view === "smoothed"} onClick={() => { if (built) changeView("smoothed"); else void build(); }}>On</button>
        </div>
      </div>
      {open ? (
        <>
          <p className="trajectory-smoothing-intro">Smooths playback without changing the original trajectory or analysis data.</p>
          <div className="trajectory-smoothing-presets" role="group" aria-label="Smoothing strength">
            {(["light", "balanced", "strong"] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-smoothing-tooltip={value === "light" ? "Keeps more source frames and removes only the fastest jitter." : value === "strong" ? "Keeps fewer source frames for the calmest, most simplified playback." : "Balances retained molecular detail with smoother playback."}
                data-selected={preset === value || undefined}
                aria-pressed={preset === value}
                disabled={mode === "kinetic"}
                onClick={() => selectPreset(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <div className="trajectory-smoothing-strength-copy">
            {mode === "kinetic" ? `${kineticStates} MSM/PCCA+ macrostates` : <><strong>{preset[0].toUpperCase() + preset.slice(1)}</strong> · {targetFrames} of {frameCount} source frames</>}
          </div>
          <button type="button" className="trajectory-smoothing-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            <span>Scientific settings</span><span aria-hidden="true">{advanced ? "⌃" : "⌄"}</span>
          </button>
          {advanced ? (
            <div className="trajectory-smoothing-settings trajectory-smoothing-science">
              <div className="trajectory-smoothing-group-label">Method</div>
              <label data-smoothing-tooltip="Smooth one measured motion over time, or build a short tour through distinct long-lived shapes.">
                <span>Analysis method</span>
                <select aria-label="Trajectory key-frame model" value={mode} onChange={(event) => setMode(event.target.value as MdsmoothMode)}>
                  <option value="extrema">Smooth one motion · recommended</option>
                  <option value="kinetic">Tour long-lived shapes · MSM</option>
                </select>
              </label>
              {mode === "extrema" ? (
                <>
                  <label data-smoothing-tooltip={trajectorySignalDescription(signal)}>
                    <span>Signal</span>
                    <select aria-label="Trajectory smoothing signal" value={signal} onChange={(event) => { setSignal(event.target.value as MdsmoothSignal); setError(null); }}>
                      <option value="rmsd">RMSD · safe default</option>
                      <option value="pc1">PCA · largest motion</option>
                      <option value="ic1">tICA · slowest motion</option>
                      <option value="dpca">Backbone angles · loop motion</option>
                      <option value="deeptica">DeepTICA · nonlinear slow motion</option>
                    </select>
                  </label>
                  <div className="trajectory-smoothing-method-note">{trajectorySignalDescription(signal)}</div>
                </>
              ) : (
                <>
                  <div className="trajectory-smoothing-method-note">Use this to tour distinct long-lived shapes, not to smooth the original timeline. It needs a longer trajectory with repeated transitions between shapes.</div>
                  <div className="trajectory-smoothing-group-label">Kinetic model</div>
                  <label data-smoothing-tooltip="How many distinct long-lived shapes to show. Start with 5; reduce it if the trajectory does not revisit enough states."><span>States to show</span><input type="number" min={2} max={12} value={kineticStates} onChange={(event) => setKineticStates(Number(event.target.value) || 5)} /></label>
                  <label data-smoothing-tooltip="How far apart frames must be before a transition is counted. Start near 10 frames; a longer lag ignores brief back-and-forth jitter."><span>Lag, frames</span><input type="number" min={1} max={Math.max(1, Math.floor(frameCount / 3))} value={lagFrames} onChange={(event) => setLagFrames(Number(event.target.value) || 1)} /></label>
                </>
              )}
              <div className="trajectory-smoothing-group-label">Sampling</div>
              {mode === "extrema" ? <label data-smoothing-tooltip="Start with 50. More source frames preserve detail; fewer frames make a shorter, calmer movie.">
                <span>Target frames</span>
                <input type="number" min={2} max={frameCount} value={targetFrames} onChange={(event) => setTargetFrames(Number(event.target.value) || 2)} />
              </label> : null}
              {signal === "rmsd" && mode === "extrema" ? (
                <>
                  <label data-smoothing-tooltip="Choose the easy frame-count control, or set the low-pass filter directly if you know the signal spectrum.">
                    <span>RMSD filter</span>
                    <select aria-label="RMSD filter control" value={rmsdFilter} onChange={(event) => setRmsdFilter(event.target.value as "frames" | "cutoff" | "power")}>
                      <option value="frames">Number of frames · recommended</option>
                      <option value="cutoff">Frequency cutoff · expert</option>
                      <option value="power">Signal power · expert</option>
                    </select>
                  </label>
                  {rmsdFilter === "cutoff" ? <label data-smoothing-tooltip="Normalized low-pass cutoff. Lower values remove more rapid motion."><span>Cutoff frequency</span><input type="number" min={0.0001} max={0.5} step={0.001} value={cutoffFrequency} onChange={(event) => setCutoffFrequency(Number(event.target.value) || 0.1)} /></label> : null}
                  {rmsdFilter === "power" ? <label data-smoothing-tooltip="Fraction of signal power preserved by the low-pass filter."><span>Power retained</span><input type="number" min={0.5} max={0.999} step={0.01} value={powerRetained} onChange={(event) => setPowerRetained(Number(event.target.value) || 0.95)} /></label> : null}
                  <label data-smoothing-tooltip="How sharply the filter separates slow motion from fast jitter. Leave this at 5 unless you are tuning the spectrum manually."><span>Filter order</span><input type="number" min={1} max={12} value={filterOrder} onChange={(event) => setFilterOrder(Number(event.target.value) || 5)} /></label>
                  <label className="trajectory-smoothing-check" data-smoothing-tooltip="Keeps the trajectory endpoints even when they are not signal turning points."><input type="checkbox" checked={includeEnds} onChange={(event) => setIncludeEnds(event.target.checked)} /><span>Always include first and last frames</span></label>
                </>
              ) : null}
              <label data-smoothing-tooltip="The frame RMSD compares against. Frame 1 is the safe default; choose another only when it is a better known reference conformation.">
                <span>Reference frame</span>
                <input type="number" min={1} max={frameCount} value={referenceFrame} onChange={(event) => setReferenceFrame(Number(event.target.value) || 1)} />
              </label>
              <label className="trajectory-smoothing-check" data-smoothing-tooltip="Removes whole-structure tumbling before measuring motion, so the signal follows internal conformational change instead of camera-like movement.">
                <input type="checkbox" checked={align} onChange={(event) => setAlign(event.target.checked)} />
                <span>Align structures before analysis</span>
              </label>
              {mode === "extrema" && signal === "deeptica" ? (
                <div className="trajectory-smoothing-runtime-row">
                  <span>DeepTICA runtime</span>
                  {deepTicaInstalled ? <strong>Ready ✓</strong> : deepTicaInstalled === null ? <small>Checking…</small> : <><small>Not installed</small><button type="button" disabled={installingDeepTica} onClick={async () => {
                  setInstallingDeepTica(true);
                  setError(null);
                  try {
                    await installDeepTica();
                    setDeepTicaInstalled(true);
                    failedAutoUpdate.current = null;
                    if (built) void build();
                  }
                  catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
                  finally { setInstallingDeepTica(false); }
                }}>
                  {installingDeepTica ? "Installing…" : "Install"}
                </button></>}
                </div>
              ) : null}
            </div>
          ) : null}
          {resultDirty || (running && built) ? <div className="trajectory-smoothing-update-status">Updating…</div> : showUpdated ? <div className="trajectory-smoothing-update-status" data-complete>Updated</div> : null}
          {result ? <TrajectorySmoothingChart result={result} playback={playback} preset={result.preset ?? preset} setFrame={setFrame} /> : null}
          {result?.spectrum ? <TrajectorySpectrum spectrum={result.spectrum} cutoffFrequency={result.cutoffFrequency ?? null} /> : null}
          {error ? <div className="trajectory-smoothing-error" role="alert">{error}</div> : null}
          {!built || error ? <button type="button" className="dock-action trajectory-smoothing-build" disabled={running} onClick={() => void build()}>
            {running ? "Enabling smoothing…" : error ? "Try again" : "Enable smoothing"}
          </button> : null}
        </>
      ) : null}
    </section>
  );
}

function TrajectorySmoothingChart({
  result,
  playback,
  preset,
  setFrame,
}: {
  result: TrajectorySmoothingResult;
  playback: TrajectoryPlaybackState | null;
  preset: "light" | "balanced" | "strong";
  setFrame: (index: number) => void;
}) {
  const lastRequestedFrame = useRef<number | null>(null);
  const width = 300;
  const height = 112;
  const padding = 10;
  const values = [...result.rawSignal, ...result.filteredSignal].filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(1e-9, max - min);
  const points = (series: number[]) => series.map((value, index) => {
    const x = padding + index * (width - padding * 2) / Math.max(1, series.length - 1);
    const y = height - padding - (value - min) * (height - padding * 2) / span;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const activeIndex = playback
    ? Math.max(0, Math.min(result.filteredSignal.length - 1, playback.frameIndex))
    : 0;
  const activeX = padding + activeIndex * (width - padding * 2) / Math.max(1, result.filteredSignal.length - 1);
  const frameFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewBoxX = (event.clientX - rect.left) * width / Math.max(1, rect.width);
    const ratio = Math.max(0, Math.min(1, (viewBoxX - padding) / (width - padding * 2)));
    return Math.round(ratio * Math.max(0, result.frameCount - 1));
  };
  const requestFrame = (index: number) => {
    const next = Math.max(0, Math.min(result.frameCount - 1, index));
    if (lastRequestedFrame.current === next) return;
    lastRequestedFrame.current = next;
    setFrame(next);
  };
  const scrub = (event: ReactPointerEvent<SVGSVGElement>) => {
    requestFrame(frameFromPointer(event));
  };
  return (
    <div className="trajectory-smoothing-chart">
      <div className="trajectory-smoothing-chart-header">
        <strong>{result.mode === "kinetic" ? "MSM / PCCA+ states" : `${trajectorySignalLabel(result.signal)} · ${preset[0].toUpperCase() + preset.slice(1)}`}</strong>
        <span className="trajectory-smoothing-playback" data-playing={playback?.playing || undefined}>
          {playback?.playing ? "Playing · " : ""}Frame {(playback?.frameIndex ?? 0) + 1} / {playback?.frameCount ?? result.frameCount}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="slider"
        tabIndex={0}
        aria-label="Trajectory frame on raw and filtered RMSD signal"
        aria-valuemin={1}
        aria-valuemax={result.frameCount}
        aria-valuenow={activeIndex + 1}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrub(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event);
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") requestFrame(activeIndex - 1);
          else if (event.key === "ArrowRight") requestFrame(activeIndex + 1);
          else if (event.key === "Home") requestFrame(0);
          else if (event.key === "End") requestFrame(result.frameCount - 1);
          else return;
          event.preventDefault();
        }}
      >
        <polyline className="trajectory-smoothing-chart-raw" points={points(result.rawSignal)} />
        <polyline className="trajectory-smoothing-chart-filtered" points={points(result.filteredSignal)} />
        <line className="trajectory-smoothing-chart-playhead" x1={activeX} x2={activeX} y1={padding} y2={height - padding} />
        {result.keyframes.map((frame) => {
          const index = Math.max(0, Math.min(result.filteredSignal.length - 1, frame));
          const x = padding + index * (width - padding * 2) / Math.max(1, result.filteredSignal.length - 1);
          const y = height - padding - (result.filteredSignal[index] - min) * (height - padding * 2) / span;
          return <circle key={frame} cx={x} cy={y} r="2.6" />;
        })}
      </svg>
      <div className="trajectory-smoothing-chart-legend"><span>Raw</span><span>{result.mode === "kinetic" ? "State coordinate" : `${preset[0].toUpperCase() + preset.slice(1)} filtered`}</span><span>{result.keyframeCount} key frames</span></div>
    </div>
  );
}

function trajectoryPathsFor(document: ViewerDocument) {
  const topologyPath = document.dockingRequest?.receptorPath;
  const trajectoryPath = document.dockingRequest?.ligandPaths[0];
  return trajectoryPath
    ? { trajectoryPath, topologyPath: topologyPath || null }
    : { trajectoryPath: document.path, topologyPath: null };
}

function trajectorySignalLabel(signal?: MdsmoothSignal) {
  if (signal === "pc1") return "PCA · PC1";
  if (signal === "ic1") return "tICA · IC1";
  if (signal === "dpca") return "Dihedral PCA";
  if (signal === "deeptica") return "DeepTICA";
  return "RMSD signal";
}

function trajectorySignalDescription(signal: MdsmoothSignal) {
  if (signal === "pc1") return "Use PCA when one large, obvious motion dominates, such as a hinge or domain opening. Large thermal breathing can also dominate it.";
  if (signal === "ic1") return "Use tICA when the important motion is slow but not the largest. It needs enough sampled transitions and a sensible lag time.";
  if (signal === "dpca") return "Use backbone angles for flexible loops or backbone rearrangements. It follows internal protein angles and does not work for ligand-only motion.";
  if (signal === "deeptica") return "Use DeepTICA only when PCA or tICA miss a suspected nonlinear slow motion. Training is slower; trust it only when independent seeds agree.";
  return "Start here. RMSD tracks how far the structure moves from a reference frame, needs almost no tuning, and is the safest choice for quick smoothing.";
}

function trajectoryOutputUrl(path: string) {
  return isTauriRuntime() ? convertFileSrc(path) : `/__burette/read-file?path=${encodeURIComponent(path)}`;
}

function TrajectorySpectrum({ spectrum, cutoffFrequency }: { spectrum: MdsmoothResult["spectrum"]; cutoffFrequency: number | null }) {
  const width = 300;
  const height = 80;
  const padding = 10;
  const frequencies = spectrum.frequencies.slice(1);
  const power = spectrum.power.slice(1);
  const maxPower = Math.max(1e-12, ...power.filter(Number.isFinite));
  const maxFrequency = Math.max(1e-12, ...frequencies.filter(Number.isFinite));
  const points = power.map((value, index) => {
    const x = padding + frequencies[index] / maxFrequency * (width - padding * 2);
    const y = height - padding - value / maxPower * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cutoffX = cutoffFrequency == null ? null : padding + cutoffFrequency / maxFrequency * (width - padding * 2);
  return (
    <div className="trajectory-smoothing-chart trajectory-smoothing-spectrum">
      <div className="trajectory-smoothing-chart-header"><strong>Power spectrum</strong><span>{cutoffFrequency == null ? "MSM states" : `cutoff ${cutoffFrequency.toFixed(4)}`}</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trajectory signal power spectrum">
        <polyline className="trajectory-smoothing-chart-filtered" points={points} />
        {cutoffX == null ? null : <line className="trajectory-smoothing-chart-playhead" x1={cutoffX} x2={cutoffX} y1={padding} y2={height - padding} />}
      </svg>
    </div>
  );
}

type StructureContextStyleCardCopy = {
  title: string;
  detail: string;
  styleAriaLabel: string;
  opacityAriaLabel: string;
  styleOptions?: readonly SdfContextStyleOption[];
};

function structureContextStyleCardFor(
  document: ViewerDocument,
  summary: StructureCompositionSummary | null,
  structureOverlayMode: StructureOverlayMode,
): StructureContextStyleCardCopy | null {
  if (document.renderer !== "molstar") return null;
  if (structureOverlayMode !== "all") return null;
  if (isVirtualMolstarScene(document)) {
    return {
      title: "All background",
      detail: "Context structures",
      styleAriaLabel: "All background style",
      opacityAriaLabel: "All background opacity",
    };
  }
  if (!summary) return null;
  if (hasSdfMoleculeCollection(summary)) {
    return {
      title: "All background",
      detail: "Context molecules",
      styleAriaLabel: "All background style",
      opacityAriaLabel: "All background opacity",
    };
  }
  const maestroEntryCount = maestroPreviewEntryCount(summary);
  if (maestroEntryCount !== null && maestroEntryCount > 1 && maestroEntryCount <= INFO_TRAJECTORY_CONTROL_LIMIT) {
    return {
      title: "All background",
      detail: "Context structures",
      styleAriaLabel: "All background style",
      opacityAriaLabel: "All background opacity",
    };
  }
  const frameCount = numberFromSummaryRows(summary.rows, "Frames") ?? numberFromSummaryRows(summary.rows, "Models");
  if (frameCount !== null && frameCount > 1 && frameCount <= INFO_TRAJECTORY_CONTROL_LIMIT) {
    return {
      title: "All background",
      detail: "Background frames",
      styleAriaLabel: "All background frame style",
      opacityAriaLabel: "All background frame opacity",
      styleOptions: isXyzStructureDocument(document) ? XYZ_FRAME_CONTEXT_STYLE_OPTIONS : undefined,
    };
  }
  return null;
}

function isXyzStructureDocument(document: ViewerDocument) {
  return document.extension.trim().toLowerCase() === "xyz" || document.path.trim().toLowerCase().endsWith(".xyz");
}

function isVirtualMolstarScene(document: ViewerDocument) {
  return document.renderer === "molstar" && Boolean(document.dockingRequest?.sceneMode);
}

function molstarSceneStructureCount(document: ViewerDocument) {
  if (!isVirtualMolstarScene(document)) return 0;
  return Math.max(1, 1 + (document.dockingRequest?.ligandPaths?.length ?? 0));
}

function maestroPreviewEntryCount(summary: StructureCompositionSummary) {
  return numberFromSummaryRows(summary.rows, "Preview entries") ?? (summary.maestroRows && summary.maestroRows.length > 1 ? summary.maestroRows.length : null);
}

function numberFromSummaryRows(rows: BriefRow[], label: string) {
  const value = rows.find((row) => row.label === label)?.value;
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function ConformerWorkflowCard({
  document,
  selectedEntity,
  viewerLigandSelection,
  status,
  settings,
  open,
  setOpen,
  oversizedNotice,
  actions,
}: {
  document: ViewerDocument;
  selectedEntity: SelectedStructureRow | null;
  viewerLigandSelection: ShellViewState["viewerLigandSelection"];
  status: ShellViewState["conformerStatus"];
  settings: ShellViewState["conformerSettings"];
  open: boolean;
  setOpen: (updater: (open: boolean) => boolean) => void;
  oversizedNotice: EngineTool[];
  actions: ShellActions;
}) {
  const [settingsPanel, setSettingsPanel] = useState<"all" | "crest" | "prism" | null>(null);
  useEffect(() => {
    setSettingsPanel(null);
  }, [document.id]);
  const selectedConformerAction = conformerSelectionAction(selectedEntity, viewerLigandSelection);
  const canRunCrest = (document.renderer !== "grid2d" && canUseConformerWorkflow(document.extension)) || Boolean(selectedConformerAction);
  const canRunPrism = canInspectConformerEnsemble(document.extension);
  if (!canShowConformerWorkflow(document.extension, document.renderer) && !selectedConformerAction) return null;
  if (!canRunCrest && !canRunPrism) return null;
  // CREST reads the whole structure the same way xTB does, so the atom cap
  // applies to it too. PRISM only prunes an existing ensemble file.
  const oversized = oversizedNotice.length > 0;
  const crestDisabled = !canRunCrest || oversized || status?.crest.installed === false;
  const prismDisabled = !canRunPrism || status?.prism.installed === false;
  const showSettingsFor = (panel: "crest" | "prism") => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSettingsPanel((current) => current === panel ? null : panel);
  };
  return (
    <InspectorEngineCard
      className="conformer-inspector-card"
      title="Conformers"
      tooltip="Conformer search and ensemble pruning for small molecules or selected objects."
      status={conformerStatusSummary(status)}
      open={open}
      onToggle={() => setOpen((current) => !current)}
      summary={conformerSettingsSummary(settings)}
      scope={selectedConformerAction ? "Scope: selected object" : undefined}
      notice={(
        <EngineToolNotice
          tools={[...oversizedNotice, ...conformerTools(status)]}
          onCheck={() => void actions.checkConformerStatus()}
        />
      )}
    >
      <div className="structure-brief-actions structure-brief-actions-grid">
        <Button type="button" variant="secondary" size="sm" className="structure-inspector-xtb-action w-full" disabled={crestDisabled} onClick={() => void actions.runConformerOperation("crest-generate", document, selectedConformerAction)} onContextMenu={showSettingsFor("crest")}>
          CREST
          <ShortcutTooltip label="Sample low-energy conformers with CREST." />
        </Button>
        <Button type="button" variant="secondary" size="sm" className="structure-inspector-xtb-action w-full" disabled={prismDisabled} onClick={() => void actions.runConformerOperation("prism-prune", document)} onContextMenu={showSettingsFor("prism")}>
          PRISM
          <ShortcutTooltip label="Prune duplicate or redundant conformers." />
        </Button>
        <Button type="button" variant="outline" size="sm" className="structure-inspector-xtb-action w-full" aria-expanded={settingsPanel !== null} onClick={() => setSettingsPanel((current) => current === "all" ? null : "all")}>
          Settings
          <ShortcutTooltip label="CREST and PRISM run parameters." />
        </Button>
        <Button type="button" variant="outline" size="sm" className="structure-inspector-xtb-action w-full" onClick={() => actions.toggleDockTab("bottom", "jobs")}>
          Jobs
          <ShortcutTooltip label="Calculation history and output artifacts." />
        </Button>
      </div>
      {settingsPanel ? <ConformerInlineSettings panel={settingsPanel} settings={settings} status={status} actions={actions} /> : null}
    </InspectorEngineCard>
  );
}

// Open Babel only appears once the backend has reported on it; the older status
// payloads leave it out entirely.
function conformerTools(status: ShellViewState["conformerStatus"]): EngineTool[] {
  if (!status) return [];
  const tools: EngineTool[] = [
    { name: "CREST", installed: status.crest.installed, hint: status.crest.installHint },
    { name: "PRISM Pruner", installed: status.prism.installed, hint: status.prism.installHint },
  ];
  if (status.openbabel) {
    tools.push({ name: "Open Babel", installed: status.openbabel.installed, hint: status.openbabel.installHint });
  }
  return tools;
}

function ConformerInlineSettings({
  panel,
  settings,
  status,
  actions,
}: {
  panel: "all" | "crest" | "prism";
  settings: ConformerSettings;
  status: ShellViewState["conformerStatus"];
  actions: ShellActions;
}) {
  const updateSettings = (patch: Partial<ConformerSettings>) => actions.setConformerSettings({ ...settings, ...patch });
  const showCrest = panel === "all" || panel === "crest";
  const showPrism = panel === "all" || panel === "prism";
  return (
    <div className="structure-inspector-xtb-settings conformer-inline-settings">
      <div className="structure-inspector-section-header">
        <h4>{panel === "crest" ? "CREST settings" : panel === "prism" ? "PRISM settings" : "Conformer settings"}</h4>
        <Button type="button" variant="outline" size="xs" onClick={() => void actions.checkConformerStatus()}>
          Check
        </Button>
      </div>
      <div className="structure-inspector-settings-status">{conformerStatusSummary(status)}</div>
      {showCrest ? (
        <InlineSettingsSection title="CREST">
          <InlineXtbSetting label="Method">
            <InlineSegmentedControl
              value={settings.method}
              options={["gfn2", "gfn1", "gfn0", "gfnff"]}
              labels={XTB_METHOD_LABELS}
              ariaLabel="CREST method"
              onChange={(value) => updateSettings({ method: value as ConformerSettings["method"] })}
            />
          </InlineXtbSetting>
          <InlineXtbSetting label="Sampling">
            <SelectControl value={settings.samplingMode} options={["auto", "normal", "quick", "squick", "mquick"]} labels={CONFORMER_SAMPLING_LABELS} onChange={(value) => updateSettings({ samplingMode: value as ConformerSettings["samplingMode"] })} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Solvent">
            <SelectControl value={settings.solvent} options={["none", "water", "methanol", "acetonitrile", "dmso", "chloroform"]} labels={CONFORMER_SOLVENT_LABELS} onChange={(value) => updateSettings({ solvent: value as ConformerSettings["solvent"] })} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Charge">
            <RangeControl value={settings.charge} min={-8} max={8} step={1} onChange={(value) => updateSettings({ charge: value })} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Unpaired electrons">
            <RangeControl value={settings.uhf} min={0} max={12} step={1} onChange={(value) => updateSettings({ uhf: value })} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Threads">
            <RangeControl value={settings.threads} min={1} max={16} step={1} onChange={(value) => updateSettings({ threads: value })} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Energy window">
            <NumberXtbControl value={settings.energyWindowKcalMol} min={1} max={60} step={0.5} suffix="kcal/mol" onChange={(value) => updateSettings({ energyWindowKcalMol: value })} />
          </InlineXtbSetting>
          <InlineXtbSetting label="RMSD threshold">
            <NumberXtbControl value={settings.rmsdThresholdAngstrom} min={0.01} max={2} step={0.005} suffix="Å" onChange={(value) => updateSettings({ rmsdThresholdAngstrom: value })} />
          </InlineXtbSetting>
        </InlineSettingsSection>
      ) : null}
      {showPrism ? (
        <InlineSettingsSection title="PRISM">
          <InlineXtbSetting label="Timeout">
            <RangeControl value={settings.prismTimeoutSeconds} min={5} max={86400} step={5} suffix="s" onChange={(value) => updateSettings({ prismTimeoutSeconds: value })} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Sort by energy">
            <ToggleControl label="Sort by energy" checked={settings.prismEnergySort} onChange={(value) => updateSettings({ prismEnergySort: value })} />
          </InlineXtbSetting>
        </InlineSettingsSection>
      ) : null}
    </div>
  );
}

function conformerSelectionAction(
  selectedEntity: SelectedStructureRow | null,
  viewerLigandSelection: ShellViewState["viewerLigandSelection"],
): StructureViewerAction | null {
  if (selectedEntity && conformerActionCanScopeCrest(selectedEntity.action)) return selectedEntity.action;
  if (!viewerLigandSelection) return null;
  return {
    type: "focus_ligand",
    label: viewerLigandSelection.label,
    selector: viewerLigandSelection.selector,
  };
}

function conformerActionCanScopeCrest(action: StructureViewerAction) {
  return action.type === "focus_ligand" || action.type === "select_residues";
}

function conformerStatusSummary(status: ShellViewState["conformerStatus"]) {
  if (!status) return "CREST / PRISM / Open Babel";
  const crest = status.crest.installed ? "CREST ready" : "CREST missing";
  const prism = status.prism.installed ? "PRISM ready" : "PRISM missing";
  const openbabel = !status.openbabel
    ? "Open Babel status unavailable"
    : status.openbabel.installed ? "Open Babel ready" : "Open Babel missing";
  return `${crest} · ${prism} · ${openbabel}`;
}

function conformerSettingsSummary(settings: ConformerSettings) {
  const solvent = settings.solvent === "none" ? "gas phase" : settings.solvent;
  return `${settings.method.toUpperCase()} · ${settings.samplingMode} · charge ${settings.charge} · UHF ${settings.uhf} · ${solvent}`;
}

function sdfContextStyleStorageKey(document: ViewerDocument) {
  return `buret.sdf.contextStyle.${document.id}`;
}

function sdfContextOpacityStorageKey(document: ViewerDocument) {
  return `buret.sdf.contextOpacity.${document.id}`;
}

function sdfContextColorStorageKey(document: ViewerDocument) {
  return `buret.sdf.contextColor.${document.id}`;
}

function normalizeSdfContextStyle(value: string | null | undefined): SdfContextStyle {
  return SDF_CONTEXT_STYLE_OPTIONS.some((option) => option.value === value) ? value as SdfContextStyle : SDF_CONTEXT_STYLE_DEFAULT;
}

function normalizeSdfContextOpacity(value: string | number | null | undefined) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return SDF_CONTEXT_OPACITY_DEFAULT;
  return Math.max(SDF_CONTEXT_OPACITY_MIN, Math.min(SDF_CONTEXT_OPACITY_MAX, opacity));
}

function normalizeSdfContextColor(value: string | null | undefined): SdfContextColor {
  return value === "gray" ? "gray" : SDF_CONTEXT_COLOR_DEFAULT;
}

function readSdfContextStylePreference(document: ViewerDocument): SdfContextStyle {
  try {
    return normalizeSdfContextStyle(window.localStorage?.getItem(sdfContextStyleStorageKey(document)));
  } catch (_) {
    return SDF_CONTEXT_STYLE_DEFAULT;
  }
}

function writeSdfContextStylePreference(document: ViewerDocument, value: SdfContextStyle) {
  try {
    window.localStorage?.setItem(sdfContextStyleStorageKey(document), value);
  } catch (_) {}
}

function readSdfContextOpacityPreference(document: ViewerDocument) {
  try {
    return normalizeSdfContextOpacity(window.localStorage?.getItem(sdfContextOpacityStorageKey(document)));
  } catch (_) {
    return SDF_CONTEXT_OPACITY_DEFAULT;
  }
}

function writeSdfContextOpacityPreference(document: ViewerDocument, value: number) {
  try {
    window.localStorage?.setItem(sdfContextOpacityStorageKey(document), normalizeSdfContextOpacity(value).toFixed(2));
  } catch (_) {}
}

function readSdfContextColorPreference(document: ViewerDocument): SdfContextColor {
  try {
    return normalizeSdfContextColor(window.localStorage?.getItem(sdfContextColorStorageKey(document)));
  } catch (_) {
    return SDF_CONTEXT_COLOR_DEFAULT;
  }
}

function writeSdfContextColorPreference(document: ViewerDocument, value: SdfContextColor) {
  try {
    window.localStorage?.setItem(sdfContextColorStorageKey(document), normalizeSdfContextColor(value));
  } catch (_) {}
}

function StructurePoseControlsCard({
  document,
  controls,
  actions,
  activeActionKey,
  setActiveActionKey,
}: {
  document: ViewerDocument;
  controls: StructurePoseControls;
  actions: ShellActions;
  activeActionKey: string | null;
  setActiveActionKey: (key: string | null) => void;
}) {
  const runAction = (action: StructureViewerAction) => {
    const key = selectionActionKey(document, action);
    actions.runStructureViewerAction(document, action);
    if (key) setActiveActionKey(key);
  };
  return (
    <section className="structure-brief-card structure-inspector-pose-controls">
      <StructureSectionHeader title={controls.title} detail={controls.detail} />
      <div className="structure-inspector-pose-options" role="group" aria-label={`${controls.controlLabel} controls`}>
        {controls.actions.map((action) => {
          const key = selectionActionKey(document, action);
          const selected = key !== null && key === activeActionKey;
          return (
            <button
              key={`${action.type}:${action.index}`}
              type="button"
              className="structure-inspector-pose-option"
              data-selected={selected || undefined}
              aria-pressed={selected}
              title={action.label}
              onClick={() => runAction(action)}
            >
              {action.index + 1}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SdfContextStyleCard({
  document,
  actions,
  value,
  setValue,
  color,
  setColor,
  opacity,
  setOpacity,
  copy,
}: {
  document: ViewerDocument;
  actions: ShellActions;
  value: SdfContextStyle;
  setValue: (value: SdfContextStyle) => void;
  color: SdfContextColor;
  setColor: (value: SdfContextColor) => void;
  opacity: number;
  setOpacity: (value: number) => void;
  copy: StructureContextStyleCardCopy;
}) {
  const applyStyle = (style: SdfContextStyle) => {
    setValue(style);
    writeSdfContextStylePreference(document, style);
    actions.runStructureViewerAction(document, {
      type: "set_sdf_context_style",
      label: `All background: ${SDF_CONTEXT_STYLE_OPTIONS.find((option) => option.value === style)?.label ?? style}`,
      notify: false,
      style,
    });
  };
  const applyOpacity = (nextOpacity: number) => {
    const normalized = normalizeSdfContextOpacity(nextOpacity);
    setOpacity(normalized);
    writeSdfContextOpacityPreference(document, normalized);
    actions.runStructureViewerAction(document, {
      type: "set_sdf_context_opacity",
      label: `All background opacity: ${Math.round(normalized * 100)}%`,
      notify: false,
      opacity: normalized,
    });
  };
  const applyColor = (nextColor: SdfContextColor) => {
    const normalized = normalizeSdfContextColor(nextColor);
    setColor(normalized);
    writeSdfContextColorPreference(document, normalized);
    actions.runStructureViewerAction(document, {
      type: "set_sdf_context_color",
      label: `All background color: ${normalized === "colored" ? "Colored" : "Gray"}`,
      notify: false,
      color: normalized,
    });
  };
  const styleOptions = copy.styleOptions ?? SDF_CONTEXT_STYLE_OPTIONS;
  const selectedStyle = styleOptions.some((option) => option.value === value)
    ? value
    : styleOptions.some((option) => option.value === "line")
      ? "line"
      : SDF_CONTEXT_STYLE_DEFAULT;
  return (
    <section className="structure-brief-card structure-inspector-context-style">
      <StructureSectionHeader title={copy.title} detail={copy.detail} />
      <div className="structure-inspector-style-options" role="group" aria-label={copy.styleAriaLabel}>
        {styleOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className="structure-inspector-style-option"
            data-selected={option.value === selectedStyle || undefined}
            aria-pressed={option.value === selectedStyle}
            onClick={() => applyStyle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="structure-inspector-color-row">
        <span>Color</span>
        <div className="structure-inspector-style-options" role="group" aria-label="All background color">
          {[
            { value: "gray" as const, label: "Gray" },
            { value: "colored" as const, label: "Colored" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className="structure-inspector-style-option"
              data-selected={option.value === color || undefined}
              aria-pressed={option.value === color}
              onClick={() => applyColor(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <label className="structure-inspector-opacity-control">
        <span>Opacity</span>
        <input
          type="range"
          min={SDF_CONTEXT_OPACITY_MIN}
          max={SDF_CONTEXT_OPACITY_MAX}
          step="0.01"
          value={opacity}
          aria-label={copy.opacityAriaLabel}
          onInput={(event) => applyOpacity(Number(event.currentTarget.value))}
        />
        <strong>{Math.round(opacity * 100)}%</strong>
      </label>
    </section>
  );
}

function TextFileInfoPanel({ document, dockDrops, actions }: { document: TextFileDocument; dockDrops: ShellViewState["dockDroppedStructures"]; actions: ShellActions }) {
  const artifact = xtbArtifactInfoForTextDocument(document);
  const showFileActionsMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu([
      {
        kind: "item",
        id: "show-metadata",
        text: "Show metadata",
        detail: document.title,
        action: () => void actions.showTextFileMetadata(document),
      },
      {
        kind: "item",
        id: "copy-path",
        text: "Copy path",
        detail: document.path,
        action: () => void actions.copyPath(document.path, "file"),
      },
      {
        kind: "item",
        id: "reveal-file",
        text: "Reveal file",
        detail: document.title,
        action: () => void actions.revealPath(document.path, "file"),
      },
    ], { x: rect.left, y: rect.bottom + 6 }, { forceWeb: true });
  };

  return (
    <div className="dock-content structure-brief">
      <section className="structure-brief-card structure-inspector-header">
        <div className="structure-brief-kicker">{artifact ? "xTB Artifact Inspector" : "File Inspector"}</div>
        <div className="structure-brief-title-row">
          <h3 title={document.title}>{document.title}</h3>
          <span>{document.extension ? document.extension.toUpperCase() : "FILE"}</span>
          <button
            type="button"
            className="structure-inspector-more-button"
            aria-label="File actions"
            title="File actions"
            onClick={showFileActionsMenu}
          >
            ...
          </button>
        </div>
        <p>{artifact?.summary ?? "Text artifact opened in the file viewer."}</p>
      </section>

      {artifact ? (
        <XtbArtifactInfoCard artifact={artifact} byteCount={document.byteCount} previewDocument={document} />
      ) : (
        <section className="structure-brief-card">
          <StructureSectionHeader title="Text file" detail={document.language || document.extension || "text"} />
          <div className="structure-brief-rows">
            <StructureBriefRow label="Size" value={formatBytes(document.byteCount)} />
            <StructureBriefRow label="Path" value={document.path} />
          </div>
        </section>
      )}
      <StructureDropSummary dockDrops={dockDrops} />
    </div>
  );
}

function XtbArtifactInfoCard({
  artifact,
  byteCount,
  previewDocument,
}: {
  artifact: XtbTextArtifactInfo;
  byteCount: number;
  previewDocument?: TextFileDocument;
}) {
  return (
    <section className="structure-brief-card structure-inspector-xtb-artifact-card">
      <StructureSectionHeader title={artifact.title} detail={artifact.kind} />
      <div className="structure-brief-rows">
        <StructureBriefRow label="Purpose" value={artifact.purpose} />
        <StructureBriefRow label="Use" value={artifact.use} />
        <StructureBriefRow label="Format" value={artifact.format} />
        <StructureBriefRow label="Run folder" value={artifact.runName ?? "Outside xTB run"} />
        <StructureBriefRow label="Size" value={formatBytes(byteCount)} />
      </div>
      {artifact.notes.length > 0 ? (
        <div className="structure-brief-notes">
          {artifact.notes.map((note) => <span key={note}>{note}</span>)}
        </div>
      ) : null}
      {previewDocument ? <XtbArtifactPreview document={previewDocument} artifact={artifact} /> : null}
    </section>
  );
}

function useStructureComposition(document: ViewerDocument | null) {
  const [state, setState] = useState<{
    documentId: string | null;
    loading: boolean;
    summary: StructureCompositionSummary | null;
    error: string | null;
  }>({ documentId: null, loading: false, summary: null, error: null });

  useEffect(() => {
    if (!document) {
      setState({ documentId: null, loading: false, summary: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ documentId: document.id, loading: true, summary: null, error: null });
    const source = structureCompositionSourceForDocument(document);
    void readInspectorStructureText(source)
      .then((text) => {
        if (cancelled) return;
        setState({
          documentId: document.id,
          loading: false,
          summary: parseStructureComposition(text, source.extension),
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          documentId: document.id,
          loading: false,
          summary: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [document]);

  return state;
}

function structureCompositionSourceForDocument(document: ViewerDocument): InspectorStructureTextSource {
  if (document.dockingRequest?.receptorPath) {
    return {
      path: document.dockingRequest.receptorPath,
      extension: extensionForDocking(document.dockingRequest.receptorPath),
      virtual: false,
    };
  }
  return { path: document.path, extension: document.extension, virtual: document.virtual === true };
}

function readInspectorStructureText(source: InspectorStructureTextSource) {
  const maxBytes = compositionReadLimit(source);
  const virtualText = source.virtual ? readBrowserDevVirtualTextDocument(source.path) : null;
  if (virtualText !== null) {
    return Promise.resolve(maxBytes === undefined ? virtualText : virtualText.slice(0, maxBytes));
  }
  return readStructureText(source.path, { maxBytes });
}

function compositionReadLimit(source: InspectorStructureTextSource) {
  const extension = source.extension.toLowerCase();
  if (["mae", "maegz", "cms"].includes(extension)) return 12 * 1024 * 1024;
  return undefined;
}

function compositionNotes(
  summary: StructureCompositionSummary | null,
  loading: boolean,
  error: string | null,
) {
  if (summary) return summary.notes;
  if (loading) return ["Reading coordinate text for composition summary."];
  if (error) return ["Composition summary could not read the source text."];
  return ["No parser summary is available for this format yet."];
}

function StructureSectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="structure-inspector-section-header">
      <h4>{title}</h4>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function inspectorSummaryLine(
  kind: string,
  summary: StructureCompositionSummary | null,
  loading: boolean,
  error: string | null,
) {
  if (summary) {
    const chains = valueForLabel(summary.rows, "Chains");
    const residues = valueForLabel(summary.rows, "Residues");
    const atoms = valueForLabel(summary.rows, "Preview atoms") ?? valueForLabel(summary.rows, "Atoms") ?? valueForLabel(summary.rows, "Atom sites");
    const ligands = countFromSummaryValue(valueForLabel(summary.componentRows, "Ligands"), "instances");
    const water = countFromSummaryValue(valueForLabel(summary.componentRows, "Water"), "molecules");
    return [chains && `${chains} chains`, residues && `${residues} residues`, ligands && `${ligands} ligands`, water && `${water} water`, atoms && `${atoms} atoms`]
      .filter(Boolean)
      .join(" · ") || kind;
  }
  if (loading) return "Reading coordinate text for molecular components.";
  if (error) return "Composition parser could not read this source.";
  return kind;
}

function xtbStatusLine(xtbStatus: ShellViewState["xtbStatus"], isBrowserDev: boolean) {
  if (!xtbStatus) return "Not checked";
  if (xtbStatus.installed) return shortXtbVersion(xtbStatus.version) ?? "Ready";
  if (isBrowserDev) return "Not found";
  return "Not installed";
}

function shortXtbVersion(version: string | null | undefined) {
  const match = String(version ?? "").match(/xtb version\s+([^\s]+)/iu);
  if (match) return `xTB ${match[1]}`;
  return version || null;
}

const defaultXtbSettings: XtbSettings = {
  method: "gfn2",
  optLevel: "normal",
  solvationModel: "none",
  solvent: "none",
  charge: 0,
  uhf: 0,
  threads: 0,
  accuracy: 1,
  electronicTemperature: 300,
  properties: {
    dipole: true,
    wbo: true,
    population: false,
    molden: false,
    alpha: false,
    fod: false,
    esp: false,
    fukui: false,
  },
  mdTemperature: 298,
  mdTimePs: 2,
  mdStepFs: 1,
  mdSnapshots: 100,
  timeoutSeconds: 180,
  saveRunFiles: true,
};

function xtbSettingsModified(settings: XtbSettings) {
  return settings.method !== defaultXtbSettings.method
    || settings.optLevel !== defaultXtbSettings.optLevel
    || settings.solvationModel !== defaultXtbSettings.solvationModel
    || settings.solvent !== defaultXtbSettings.solvent
    || settings.charge !== defaultXtbSettings.charge
    || settings.uhf !== defaultXtbSettings.uhf
    || settings.threads !== defaultXtbSettings.threads
    || settings.accuracy !== defaultXtbSettings.accuracy
    || settings.electronicTemperature !== defaultXtbSettings.electronicTemperature
    || settings.mdTemperature !== defaultXtbSettings.mdTemperature
    || settings.mdTimePs !== defaultXtbSettings.mdTimePs
    || settings.mdStepFs !== defaultXtbSettings.mdStepFs
    || settings.mdSnapshots !== defaultXtbSettings.mdSnapshots
    || settings.saveRunFiles !== defaultXtbSettings.saveRunFiles
    || Object.keys(settings.properties).some((key) => (
      settings.properties[key as keyof XtbSettings["properties"]] !== defaultXtbSettings.properties[key as keyof XtbSettings["properties"]]
    ))
    || settings.timeoutSeconds !== defaultXtbSettings.timeoutSeconds;
}

function xtbSettingsSummary(settings: XtbSettings) {
  const charge = settings.charge > 0 ? `+${settings.charge}` : String(settings.charge);
  const solvent = settings.solvationModel === "none" || settings.solvent === "none" ? "gas phase" : `${settings.solvationModel.toUpperCase()} ${settings.solvent}`;
  const threads = settings.threads > 0 ? ` · ${settings.threads} threads` : "";
  return `${settings.method.toUpperCase()} · ${settings.optLevel} opt · charge ${charge} · UHF ${settings.uhf} · ${solvent}${threads}`;
}

const XTB_ACTION_TOOLTIPS = {
  optimize: "Relax atomic coordinates toward a local minimum on the selected xTB potential energy surface.",
  properties: "Evaluate single-point electronic properties at the current geometry.",
  "optimized-hessian": "Optimize geometry, then compute Hessian-derived vibrational frequencies.",
  vipea: "Estimate vertical ionization potential and electron affinity.",
  vfukui: "Estimate local electrophilic and nucleophilic Fukui reactivity descriptors.",
  md: "Sample finite-temperature molecular motion with xTB molecular dynamics.",
  metadyn: "Bias the xTB dynamics to explore conformational space beyond local minima.",
} satisfies Record<string, string>;

const XTB_MORE_OPERATIONS = [
  ["vipea", "IP/EA"],
  ["vfukui", "Fukui"],
  ["md", "MD"],
  ["metadyn", "Metadyn"],
] as const satisfies readonly (readonly [keyof typeof XTB_ACTION_TOOLTIPS, string])[];

const XTB_SETTING_TOOLTIPS = {
  method: "Choose the xTB Hamiltonian. GFN2 is the default balanced method; GFNFF is faster for large systems.",
  optLevel: "Controls geometry optimization convergence. Loose is faster; tight and verytight are more conservative.",
  solvation: "Select the implicit solvation model used when a solvent is selected.",
  solvent: "Select the solvent name passed to the chosen implicit solvation model.",
  charge: "Total molecular charge passed with --chrg.",
  uhf: "Number of unpaired electrons passed with --uhf.",
  threads: "CPU threads for xTB parallel execution. Zero lets xTB choose the default.",
  accuracy: "xTB --acc quality/speed setting. Lower values are stricter and usually slower.",
  electronicTemperature: "Electronic temperature in Kelvin for fractional occupation handling.",
  properties: "Choose electronic property outputs such as dipoles, WBO, populations, orbitals, ESP, and Fukui data.",
  mdTemperature: "MD thermostat temperature in Kelvin.",
  mdTime: "Total MD simulation time in picoseconds.",
  mdStep: "MD integration step in femtoseconds.",
  mdSnapshots: "Number of molecular geometries sampled from the trajectory.",
  saveRunFiles: "Persist xTB inputs, logs, structures, properties, and restart files for reproducibility.",
  timeout: "Maximum wall-clock time allowed for the xTB calculation.",
} satisfies Record<string, string>;

const XTB_PROPERTY_TOOLTIPS = {
  dipole: "Write dipole information into the result summary.",
  wbo: "Write Wiberg bond orders for bond inspection.",
  population: "Write Mulliken population/charge output.",
  molden: "Write Molden orbital output for external viewers.",
  alpha: "Calculate molecular polarizability output.",
  fod: "Calculate fractional occupation density artifacts.",
  esp: "Write electrostatic potential related output.",
  fukui: "Write Fukui reactivity output during property jobs.",
} satisfies Record<string, string>;

function xtbSettingsScopeLabel(scope: XtbSettingsScope) {
  switch (scope) {
    case "optimize":
      return "Optimize";
    case "properties":
      return "Properties";
    case "optimized-hessian":
      return "Frequencies";
    case "vipea":
      return "IP/EA";
    case "vfukui":
      return "Fukui";
    case "md":
      return "MD";
    case "metadyn":
      return "Metadyn";
    default:
      return "Advanced xTB";
  }
}

const XTB_SETTINGS_CATEGORIES: Array<{ key: XtbSettingsCategory; label: string; tooltip: string }> = [
  { key: "core", label: "Core", tooltip: "Method, optimization level, charge, spin, threads, accuracy, and electronic temperature." },
  { key: "solvation", label: "Solvation", tooltip: "Implicit solvent model and solvent name." },
  { key: "properties", label: "Properties", tooltip: "Dipole, WBO, population, Molden, alpha, FOD, ESP, and Fukui outputs." },
  { key: "dynamics", label: "Dynamics", tooltip: "MD and metadynamics temperature, time, step, and snapshot settings." },
  { key: "output", label: "Output", tooltip: "Run file persistence and timeout." },
];

function defaultXtbSettingsCategory(scope: XtbSettingsScope): XtbSettingsCategory {
  if (scope === "properties" || scope === "vfukui") return "properties";
  if (scope === "md" || scope === "metadyn") return "dynamics";
  return "core";
}

function XtbSettingsCategoryBar({
  category,
  setCategory,
}: {
  category: XtbSettingsCategory;
  setCategory: (category: XtbSettingsCategory) => void;
}) {
  return (
    <div className="structure-inspector-xtb-category-bar" aria-label="xTB settings categories">
      {XTB_SETTINGS_CATEGORIES.map((item) => (
        <button
          type="button"
          key={item.key}
          className="structure-inspector-xtb-category-button"
          data-active={category === item.key || undefined}
          onClick={() => setCategory(item.key)}
          data-xtb-tooltip={item.tooltip}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function XtbActionButton({
  label,
  tooltip,
  disabled,
  onClick,
  onContextMenu,
}: {
  label: string;
  tooltip: string;
  disabled?: boolean;
  onClick: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Button type="button" variant="secondary" size="sm" className="structure-inspector-xtb-action w-full" disabled={disabled} onClick={onClick} onContextMenu={onContextMenu}>
      {label}
      <ShortcutTooltip label={tooltip} />
    </Button>
  );
}

// The conformer and xTB cards were the same card written twice: a collapsible
// header with a status, a settings summary, a grid of runs and an inline
// settings body. They now share one.
function InspectorEngineCard({
  className,
  title,
  tooltip,
  status,
  open,
  onToggle,
  summary,
  summaryTooltip,
  summaryModified,
  onReset,
  notice,
  scope,
  children,
}: {
  className: string;
  title: string;
  tooltip: string;
  status: ReactNode;
  open: boolean;
  onToggle: () => void;
  summary: string;
  summaryTooltip?: string;
  summaryModified?: boolean;
  onReset?: () => void;
  notice?: ReactNode;
  scope?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      className={`structure-brief-card ${className}`}
      data-collapsed={!open || undefined}
    >
      <div className="structure-inspector-section-header">
        <CollapsibleTrigger className="structure-inspector-section-title-button">
          {title}
          <ShortcutTooltip label={tooltip} />
        </CollapsibleTrigger>
        <span>{status}</span>
      </div>
      <CollapsibleContent className="structure-inspector-engine-body">
        <div
          className="structure-inspector-xtb-summary"
          data-modified={summaryModified || undefined}
          data-xtb-tooltip={summaryTooltip}
        >
          <span>{summary}</span>
          {onReset ? (
            <Button type="button" variant="outline" size="xs" onClick={onReset}>
              Reset
              <ShortcutTooltip label="Restore the default settings." />
            </Button>
          ) : null}
        </div>
        {scope ? (
          <div className="structure-brief-notes">
            <span>{scope}</span>
          </div>
        ) : null}
        {notice}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

type EngineTool = {
  name: string;
  installed: boolean;
  hint: string;
  install?: () => void;
};

// A disabled button with no explanation is a dead end. The backend already says
// how to install each tool, so the card repeats that instead of swallowing it.
function EngineToolNotice({ tools, onCheck }: { tools: EngineTool[]; onCheck: () => void }) {
  const missing = tools.filter((tool) => !tool.installed);
  if (missing.length === 0) return null;
  return (
    <div className="structure-inspector-engine-notices">
      {missing.map((tool) => (
        <Alert key={tool.name} className="structure-inspector-engine-notice">
          {/* Every hint the backend writes already names its own tool, so repeating
              the name here would only read as a stutter. */}
          <AlertDescription>{tool.hint || `${tool.name} is not installed.`}</AlertDescription>
          {tool.install ? (
            <AlertAction>
              <Button type="button" variant="outline" size="xs" onClick={tool.install}>
                Install
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ))}
      <Button type="button" variant="ghost" size="xs" className="justify-self-start" onClick={onCheck}>
        Check again
      </Button>
    </div>
  );
}

function XtbInlineSettings({
  settings,
  scope,
  xtbStatus,
  isBrowserDev,
  actions,
  onClose,
}: {
  settings: XtbSettings;
  scope: XtbSettingsScope;
  xtbStatus: ShellViewState["xtbStatus"];
  isBrowserDev: boolean;
  actions: ShellActions;
  onClose: () => void;
}) {
  const update = <K extends keyof XtbSettings>(key: K, value: XtbSettings[K]) => actions.setXtbSettings({ ...settings, [key]: value });
  const updateProperty = <K extends keyof XtbSettings["properties"]>(key: K, value: boolean) => actions.setXtbSettings({
    ...settings,
    properties: { ...settings.properties, [key]: value },
  });
  const [category, setCategory] = useState<XtbSettingsCategory>(() => defaultXtbSettingsCategory(scope));
  useEffect(() => {
    setCategory(defaultXtbSettingsCategory(scope));
  }, [scope]);
  const showCategories = scope === "general";
  const showCore = !showCategories || category === "core";
  const showSolvation = !showCategories || category === "solvation";
  const showOptLevel = showCategories ? category === "core" : scope === "optimize" || scope === "optimized-hessian";
  const showProperties = showCategories ? category === "properties" : scope === "properties" || scope === "vfukui";
  const showMd = showCategories ? category === "dynamics" : scope === "md" || scope === "metadyn";
  const showOutput = !showCategories || category === "output";
  return (
    <div className="structure-inspector-xtb-settings">
      <div className="structure-inspector-xtb-settings-title">
        <span>{xtbSettingsScopeLabel(scope)} settings</span>
        <Button type="button" variant="ghost" size="xs" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="structure-inspector-xtb-runtime">
        <span>{xtbStatus?.executablePath ?? xtbStatus?.installHint ?? (isBrowserDev ? "Browser dev can run local xTB jobs." : "xTB status has not been checked.")}</span>
        <Button type="button" variant="outline" size="xs" onClick={() => void actions.checkXtbStatus()}>
          Check
        </Button>
      </div>
      {showCategories ? <XtbSettingsCategoryBar category={category} setCategory={setCategory} /> : null}
      {showCore ? (
        <XtbSettingsGroup title="Calculation" labelled={!showCategories}>
          <InlineXtbSetting label="Method" tooltip={XTB_SETTING_TOOLTIPS.method} reset={() => update("method", defaultXtbSettings.method)} modified={settings.method !== defaultXtbSettings.method}>
            <InlineSegmentedControl
              value={settings.method}
              options={["gfn2", "gfn1", "gfn0", "gfnff"]}
              labels={XTB_METHOD_LABELS}
              ariaLabel="xTB method"
              onChange={(method) => update("method", method as XtbSettings["method"])}
            />
          </InlineXtbSetting>
          {showOptLevel ? (
            <InlineXtbSetting label="Convergence" tooltip={XTB_SETTING_TOOLTIPS.optLevel} reset={() => update("optLevel", defaultXtbSettings.optLevel)} modified={settings.optLevel !== defaultXtbSettings.optLevel}>
              <InlineSegmentedControl
                value={settings.optLevel}
                options={["loose", "normal", "tight", "verytight"]}
                labels={XTB_OPT_LEVEL_LABELS}
                ariaLabel="Optimization convergence"
                onChange={(optLevel) => update("optLevel", optLevel as XtbSettings["optLevel"])}
              />
            </InlineXtbSetting>
          ) : null}
          <InlineXtbSetting label="Charge" tooltip={XTB_SETTING_TOOLTIPS.charge} reset={() => update("charge", defaultXtbSettings.charge)} modified={settings.charge !== defaultXtbSettings.charge}>
            <RangeControl value={settings.charge} min={-5} max={5} step={1} onChange={(charge) => update("charge", charge)} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Unpaired electrons" tooltip={XTB_SETTING_TOOLTIPS.uhf} reset={() => update("uhf", defaultXtbSettings.uhf)} modified={settings.uhf !== defaultXtbSettings.uhf}>
            <RangeControl value={settings.uhf} min={0} max={10} step={1} onChange={(uhf) => update("uhf", uhf)} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Threads" tooltip={XTB_SETTING_TOOLTIPS.threads} reset={() => update("threads", defaultXtbSettings.threads)} modified={settings.threads !== defaultXtbSettings.threads}>
            <RangeControl value={settings.threads} min={0} max={32} step={1} onChange={(threads) => update("threads", threads)} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Accuracy" tooltip={XTB_SETTING_TOOLTIPS.accuracy} reset={() => update("accuracy", defaultXtbSettings.accuracy)} modified={settings.accuracy !== defaultXtbSettings.accuracy}>
            <NumberXtbControl value={settings.accuracy} min={0.05} max={10} step={0.05} onChange={(accuracy) => update("accuracy", accuracy)} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Electronic temp" tooltip={XTB_SETTING_TOOLTIPS.electronicTemperature} reset={() => update("electronicTemperature", defaultXtbSettings.electronicTemperature)} modified={settings.electronicTemperature !== defaultXtbSettings.electronicTemperature}>
            <RangeControl value={settings.electronicTemperature} min={50} max={5000} step={50} suffix="K" onChange={(electronicTemperature) => update("electronicTemperature", electronicTemperature)} />
          </InlineXtbSetting>
        </XtbSettingsGroup>
      ) : null}
      {showSolvation ? (
        <XtbSettingsGroup title="Solvation" labelled={!showCategories}>
          <InlineXtbSetting label="Model" tooltip={XTB_SETTING_TOOLTIPS.solvation} reset={() => update("solvationModel", defaultXtbSettings.solvationModel)} modified={settings.solvationModel !== defaultXtbSettings.solvationModel}>
            <InlineSegmentedControl
              value={settings.solvationModel}
              options={["none", "alpb", "gbsa", "cosmo", "cpcmx"]}
              labels={XTB_SOLVATION_LABELS}
              ariaLabel="Solvation model"
              onChange={(solvationModel) => update("solvationModel", solvationModel as XtbSettings["solvationModel"])}
            />
          </InlineXtbSetting>
          <InlineXtbSetting label="Solvent" tooltip={XTB_SETTING_TOOLTIPS.solvent} reset={() => update("solvent", defaultXtbSettings.solvent)} modified={settings.solvent !== defaultXtbSettings.solvent}>
            <SelectControl value={settings.solvent} options={XTB_SOLVENT_OPTIONS} labels={XTB_SOLVENT_LABELS} onChange={(solvent) => update("solvent", solvent)} />
          </InlineXtbSetting>
        </XtbSettingsGroup>
      ) : null}
      {showProperties ? (
        <XtbSettingsGroup title="Properties" labelled={!showCategories}>
        <div className="structure-inspector-xtb-toggle-grid" aria-label="xTB property outputs" data-xtb-tooltip={XTB_SETTING_TOOLTIPS.properties}>
          <XtbToggle label="Dipole" tooltip={XTB_PROPERTY_TOOLTIPS.dipole} checked={settings.properties.dipole} onChange={(value) => updateProperty("dipole", value)} />
          <XtbToggle label="WBO" tooltip={XTB_PROPERTY_TOOLTIPS.wbo} checked={settings.properties.wbo} onChange={(value) => updateProperty("wbo", value)} />
          <XtbToggle label="Mulliken" tooltip={XTB_PROPERTY_TOOLTIPS.population} checked={settings.properties.population} onChange={(value) => updateProperty("population", value)} />
          <XtbToggle label="Molden" tooltip={XTB_PROPERTY_TOOLTIPS.molden} checked={settings.properties.molden} onChange={(value) => updateProperty("molden", value)} />
          <XtbToggle label="Alpha" tooltip={XTB_PROPERTY_TOOLTIPS.alpha} checked={settings.properties.alpha} onChange={(value) => updateProperty("alpha", value)} />
          <XtbToggle label="FOD" tooltip={XTB_PROPERTY_TOOLTIPS.fod} checked={settings.properties.fod} onChange={(value) => updateProperty("fod", value)} />
          <XtbToggle label="ESP" tooltip={XTB_PROPERTY_TOOLTIPS.esp} checked={settings.properties.esp} onChange={(value) => updateProperty("esp", value)} />
          <XtbToggle label="Fukui" tooltip={XTB_PROPERTY_TOOLTIPS.fukui} checked={settings.properties.fukui} onChange={(value) => updateProperty("fukui", value)} />
        </div>
        </XtbSettingsGroup>
      ) : null}
      {showMd ? (
        <XtbSettingsGroup title="Dynamics" labelled={!showCategories}>
          <InlineXtbSetting label="Temperature" tooltip={XTB_SETTING_TOOLTIPS.mdTemperature} reset={() => update("mdTemperature", defaultXtbSettings.mdTemperature)} modified={settings.mdTemperature !== defaultXtbSettings.mdTemperature}>
            <RangeControl value={settings.mdTemperature} min={50} max={2000} step={10} suffix="K" onChange={(mdTemperature) => update("mdTemperature", mdTemperature)} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Duration" tooltip={XTB_SETTING_TOOLTIPS.mdTime} reset={() => update("mdTimePs", defaultXtbSettings.mdTimePs)} modified={settings.mdTimePs !== defaultXtbSettings.mdTimePs}>
            <NumberXtbControl value={settings.mdTimePs} min={0.05} max={100} step={0.05} onChange={(mdTimePs) => update("mdTimePs", mdTimePs)} suffix="ps" />
          </InlineXtbSetting>
          <InlineXtbSetting label="Time step" tooltip={XTB_SETTING_TOOLTIPS.mdStep} reset={() => update("mdStepFs", defaultXtbSettings.mdStepFs)} modified={settings.mdStepFs !== defaultXtbSettings.mdStepFs}>
            <NumberXtbControl value={settings.mdStepFs} min={0.1} max={10} step={0.1} onChange={(mdStepFs) => update("mdStepFs", mdStepFs)} suffix="fs" />
          </InlineXtbSetting>
          <InlineXtbSetting label="Snapshots" tooltip={XTB_SETTING_TOOLTIPS.mdSnapshots} reset={() => update("mdSnapshots", defaultXtbSettings.mdSnapshots)} modified={settings.mdSnapshots !== defaultXtbSettings.mdSnapshots}>
            <RangeControl value={settings.mdSnapshots} min={1} max={1000} step={1} onChange={(mdSnapshots) => update("mdSnapshots", mdSnapshots)} />
          </InlineXtbSetting>
        </XtbSettingsGroup>
      ) : null}
      {showOutput ? (
        <XtbSettingsGroup title="Output" labelled={!showCategories}>
          <InlineXtbSetting label="Keep run files" tooltip={XTB_SETTING_TOOLTIPS.saveRunFiles} reset={() => update("saveRunFiles", defaultXtbSettings.saveRunFiles)} modified={settings.saveRunFiles !== defaultXtbSettings.saveRunFiles}>
            <ToggleControl label="Save xTB run files" checked={settings.saveRunFiles} onChange={(saveRunFiles) => update("saveRunFiles", saveRunFiles)} />
          </InlineXtbSetting>
          <InlineXtbSetting label="Timeout" tooltip={XTB_SETTING_TOOLTIPS.timeout} reset={() => update("timeoutSeconds", defaultXtbSettings.timeoutSeconds)} modified={settings.timeoutSeconds !== defaultXtbSettings.timeoutSeconds}>
            <RangeControl value={settings.timeoutSeconds} min={30} max={1200} step={30} suffix="s" onChange={(timeoutSeconds) => update("timeoutSeconds", timeoutSeconds)} />
          </InlineXtbSetting>
        </XtbSettingsGroup>
      ) : null}
    </div>
  );
}

// In category mode the bar above already says which group you are in, so the
// heading would only repeat it. Scoped mode stacks several groups at once and
// needs them.
function XtbSettingsGroup({ title, labelled, children }: { title: string; labelled: boolean; children: ReactNode }) {
  if (!labelled) return <>{children}</>;
  return <InlineSettingsSection title={title}>{children}</InlineSettingsSection>;
}

const XTB_SOLVENT_OPTIONS = [
  "none",
  "water",
  "acetone",
  "acetonitrile",
  "aniline",
  "benzaldehyde",
  "benzene",
  "ch2cl2",
  "chcl3",
  "cs2",
  "dioxane",
  "dmf",
  "dmso",
  "ether",
  "ethylacetate",
  "furane",
  "hexane",
  "methanol",
  "nitromethane",
  "octanol",
  "phenol",
  "toluene",
  "thf",
];

// Only the tokens whose spelling is not already the chemical name.
const XTB_SOLVENT_LABELS: Record<string, string> = {
  none: "Gas phase",
  ch2cl2: "Dichloromethane",
  chcl3: "Chloroform",
  cs2: "Carbon disulfide",
  dmf: "DMF",
  dmso: "DMSO",
  ether: "Diethyl ether",
  ethylacetate: "Ethyl acetate",
  furane: "Furan",
  nitromethane: "Nitromethane",
  thf: "THF",
  ...Object.fromEntries(["water", "acetone", "acetonitrile", "aniline", "benzaldehyde", "benzene", "dioxane", "hexane", "methanol", "octanol", "phenol", "toluene"]
    .map((solvent) => [solvent, solvent.charAt(0).toUpperCase() + solvent.slice(1)])),
};

function XtbToggle({ label, tooltip, checked, onChange }: { label: string; tooltip: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="structure-inspector-xtb-toggle" data-xtb-tooltip={tooltip}>
      <ToggleControl label={label} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function NumberXtbControl({
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="structure-inspector-number-control">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {suffix ? <span>{suffix}</span> : null}
    </div>
  );
}

type XtbTextArtifactInfo = {
  title: string;
  kind: string;
  summary: string;
  purpose: string;
  use: string;
  format: string;
  notes: string[];
  runName: string | null;
};

function xtbArtifactInfoForTextDocument(document: TextFileDocument): XtbTextArtifactInfo | null {
  return xtbArtifactInfoForPath(document.path, document.extension, document.content);
}

function xtbArtifactInfoForPath(path: string, extension: string, content = ""): XtbTextArtifactInfo | null {
  const runName = xtbRunNameForPath(path);
  const name = fileName(path);
  const lowerName = name.toLowerCase();
  const normalizedExtension = extension.toLowerCase();
  const base = XTB_TEXT_ARTIFACTS[lowerName] ?? xtbArtifactInfoByPattern(lowerName, normalizedExtension);
  if (!base && !runName) return null;
  const notes = [...(base?.notes ?? [])];
  if (lowerName === "xtb.log" && /Fukui functions:/u.test(content)) {
    notes.push("This log contains the Fukui table. xTB prints f(+), f(-), and f(0) here rather than writing a separate Fukui file.");
  }
  return {
    title: base?.title ?? "xTB run artifact",
    kind: base?.kind ?? "xTB artifact",
    summary: base?.summary ?? "File generated inside an xTB run directory.",
    purpose: base?.purpose ?? "Preserves intermediate or output data from the local xTB calculation.",
    use: base?.use ?? "Retains reproducibility data from the local xTB calculation.",
    format: base?.format ?? artifactFormatLabel(normalizedExtension, name),
    notes,
    runName,
  };
}

function xtbArtifactInfoByPattern(name: string, extension: string) {
  if (name.startsWith('input-with-h.')) return XTB_PATTERN_ARTIFACTS.inputWithHydrogens;
  if (name.startsWith('input.')) return XTB_PATTERN_ARTIFACTS.input;
  if (/^secondary-.*-with-h\./u.test(name)) return XTB_PATTERN_ARTIFACTS.secondaryInput;
  if (/^xtbopt\.(pdb|xyz|sdf|mol)$/u.test(name)) return XTB_PATTERN_ARTIFACTS.optimizedStructure;
  if (["cub", "cube"].includes(extension)) return XTB_PATTERN_ARTIFACTS.cube;
  if (name.endsWith(".trj") || name.endsWith(".arc")) return XTB_PATTERN_ARTIFACTS.trajectory;
  if (name === "g98.out" || name.endsWith(".g98.out")) return XTB_PATTERN_ARTIFACTS.frequencyOutput;
  if (name === "molden.input" || name.endsWith(".molden")) return XTB_PATTERN_ARTIFACTS.molden;
  return null;
}

function XtbArtifactPreview({ document, artifact }: { document: TextFileDocument; artifact: XtbTextArtifactInfo }) {
  const rows = xtbArtifactPreviewRows(document, artifact);
  if (rows.length === 0) return null;
  return (
    <div className="structure-inspector-xtb-artifact-preview">
      <strong>Preview</strong>
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`} className="structure-brief-row">
          <span>{row.label}</span>
          <strong title={row.value}>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function xtbArtifactPreviewRows(document: TextFileDocument, artifact: XtbTextArtifactInfo): BriefRow[] {
  const name = fileName(document.path).toLowerCase();
  const content = readBrowserDevVirtualTextDocument(document.path) ?? document.content;
  if (name === "charges") {
    return numericPreviewRows(content, "charge");
  }
  if (name === "wbo") {
    return content.trim().split(/\r?\n/u).slice(0, 4).map((line, index) => {
      const [from, to, order] = line.trim().split(/\s+/u);
      return { label: `Bond ${index + 1}`, value: from && to && order ? `${from}-${to}: ${order}` : line.trim() };
    }).filter((row) => row.value);
  }
  if (name === "xtb.log" && /Fukui functions:/u.test(content)) {
    return fukuiPreviewRows(content);
  }
  if (name === "xtbout.json") {
    return xtboutPreviewRows(content);
  }
  if (artifact.kind === "Log" || artifact.kind === "Report" || artifact.kind === "Input") {
    return content.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 3).map((line, index) => ({
      label: `Line ${index + 1}`,
      value: truncateInline(line, 120),
    }));
  }
  return [];
}

function numericPreviewRows(text: string, label: string): BriefRow[] {
  return text.trim().split(/\r?\n/u).slice(0, 6).map((line, index) => ({
    label: `Atom ${index + 1}`,
    value: `${label} ${line.trim()}`,
  })).filter((row) => row.value.trim() !== label);
}

function fukuiPreviewRows(text: string): BriefRow[] {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes("Fukui functions:"));
  if (start < 0) return [];
  return lines.slice(start + 3, start + 9).map((line) => line.trim()).filter((line) => /^\d+/u.test(line)).map((line) => {
    const match = line.match(/^(\d+)\s*([A-Za-z]{1,3})\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/u);
    return {
      label: match ? `${match[1]}${match[2]}` : "Fukui",
      value: match ? `f+ ${match[3]}, f- ${match[4]}, f0 ${match[5]}` : line,
    };
  });
}

function xtboutPreviewRows(text: string): BriefRow[] {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return [
      { label: "Energy", value: formatMaybeNumber(data["total energy"], " Eh") },
      { label: "HL gap", value: formatMaybeNumber(data["HOMO-LUMO gap / eV"], " eV") },
      { label: "Charges", value: Array.isArray(data["partial charges"]) ? `${data["partial charges"].length} atoms` : "Not present" },
    ];
  } catch (_) {
    return [];
  }
}

function xtbRunNameForPath(path: string) {
  const match = path.replace(/\\/g, "/").match(/\/(xtb_(?:run|optimize|properties|hessian|ip_ea|fukui|md|metadyn)_\d+)(?:\/|$)/u);
  if (match) return match[1];
  if (path.includes("/burrete-xtb-jobs/")) return "temporary xTB run";
  return null;
}

function artifactFormatLabel(extension: string, name: string) {
  if (extension) return extension.toUpperCase();
  if (name.startsWith(".")) return "marker file";
  return "plain text";
}

function fileName(path: string) {
  return path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
}

function truncateInline(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

const XTB_TEXT_ARTIFACTS: Record<string, Omit<XtbTextArtifactInfo, "runName">> = {
  ".xtboptok": {
    title: "Optimization success marker",
    kind: "Marker",
    summary: "xTB marker created when geometry optimization finished successfully.",
    purpose: "Lets xTB and Burrete distinguish a completed optimization from a partial run.",
    use: "Marker for completed geometry relaxation; useful when auditing run completeness.",
    format: "empty marker file",
    notes: ["Presence is the signal; file content is usually empty."],
  },
  charges: {
    title: "Partial charges",
    kind: "Table",
    summary: "Atomic partial charges from the xTB calculation.",
    purpose: "Shows charge distribution atom-by-atom in the same atom order as the xTB input/topology.",
    use: "Use for charge inspection, electrostatics, Fukui/IP/EA context, and result tables.",
    format: "one numeric charge per atom",
    notes: [],
  },
  wbo: {
    title: "Wiberg bond orders",
    kind: "Table",
    summary: "Bond order estimates for atom pairs.",
    purpose: "Helps inspect bonding, connectivity, and bond-strength changes after xTB jobs.",
    use: "Use alongside the structure/topology to explain which bonds xTB considers strong or weak.",
    format: "atom index, atom index, WBO value",
    notes: ["Atom indices follow xTB input order."],
  },
  "xtb-prep.log": {
    title: "Input preparation log",
    kind: "Log",
    summary: "Records how Burrete prepared the input before xTB.",
    purpose: "Explains whether hydrogens were added and which tool/path was used.",
    use: "Check this first when optimized geometry looks odd because missing hydrogens or conversion can change results.",
    format: "plain text log",
    notes: ["Generated by Burrete, not by xTB itself."],
  },
  "xtb-report.md": {
    title: "Burrete xTB report",
    kind: "Report",
    summary: "Human-readable summary of one xTB job.",
    purpose: "Collects operation, status, command, artifacts, JSON summary, and log tail in one place.",
    use: "Use as the compact audit trail for operation, command, outputs, and log tail.",
    format: "Markdown",
    notes: ["Safe to share as a compact run report when paths are acceptable."],
  },
  "xtb.log": {
    title: "xTB run log",
    kind: "Log",
    summary: "Full xTB stdout/stderr log for the calculation.",
    purpose: "Contains convergence, warnings, command details, and text-only property sections.",
    use: "Use to debug failed jobs or inspect values not exported to JSON, including Fukui functions.",
    format: "plain text log",
    notes: ["For Fukui jobs, the f(+), f(-), and f(0) table is printed here."],
  },
  "xtbopt.log": {
    title: "Optimization trajectory",
    kind: "Trajectory",
    summary: "XYZ-like trajectory frames written during xTB geometry optimization.",
    purpose: "Shows how the structure moved from the starting geometry to the optimized pose.",
    use: "Use as trajectory frames to inspect coordinate relaxation step-by-step.",
    format: "XYZ trajectory text",
    notes: ["The .log extension is misleading here; xTB writes repeated XYZ frames into this file."],
  },
  "xtbout.json": {
    title: "Machine-readable xTB summary",
    kind: "JSON",
    summary: "Structured xTB output used by Burrete result cards.",
    purpose: "Stores energy, gap, dipole, partial charges, orbital data, method, version, and command metadata.",
    use: "Use for tables, comparisons, and automated parsing instead of scraping xtb.log.",
    format: "JSON",
    notes: ["Fukui functions are not present in current xTB JSON output; they must be parsed from xtb.log."],
  },
  "xtb.json": {
    title: "Machine-readable xTB summary",
    kind: "JSON",
    summary: "Structured xTB output used by result cards.",
    purpose: "Stores calculation summary values in JSON form.",
    use: "Use for automated parsing and report generation.",
    format: "JSON",
    notes: [],
  },
  xtbrestart: {
    title: "xTB restart data",
    kind: "Restart",
    summary: "Restart/state data written by xTB.",
    purpose: "Allows xTB internals to reuse state or continue related calculations.",
    use: "Keep for reproducibility; usually not useful to inspect manually.",
    format: "xTB restart text/binary-like data",
    notes: ["Do not edit unless you are intentionally debugging xTB restart behavior."],
  },
  "xtbtopo.mol": {
    title: "xTB topology",
    kind: "Structure",
    summary: "MOL topology inferred or written during the xTB run.",
    purpose: "Preserves atom/bond connectivity used for interpreting results.",
    use: "Use as the connectivity reference for charges and WBO.",
    format: "MOL",
    notes: ["Useful companion for charges and WBO tables."],
  },
  "md.inp": {
    title: "xTB dynamics input",
    kind: "Input",
    summary: "Control file for MD or metadynamics parameters.",
    purpose: "Stores temperature, time, step size, and related dynamics settings passed to xTB.",
    use: "Use to verify what dynamics settings were actually run.",
    format: "xTB input/control text",
    notes: ["Generated from the xTB Settings panel."],
  },
  "xcontrol.inp": {
    title: "xTB control input",
    kind: "Input",
    summary: "Extra xTB control file for specialized property jobs.",
    purpose: "Carries options that cannot be represented as simple command-line flags.",
    use: "Use to audit cube/grid or other advanced property setup.",
    format: "xTB input/control text",
    notes: [],
  },
};

const XTB_PATTERN_ARTIFACTS: Record<string, Omit<XtbTextArtifactInfo, "runName">> = {
  input: {
    title: "Copied xTB input",
    kind: "Input",
    summary: "Input structure copied into the run directory.",
    purpose: "Freezes the exact coordinates passed into this xTB run.",
    use: "Use as the coordinate reference for reproducing energy or property calculations with the same xTB setup.",
    format: "structure file",
    notes: ["This can differ from the original file when the run used a selected fragment or inline input."],
  },
  inputWithHydrogens: {
    title: "Prepared input with hydrogens",
    kind: "Input",
    summary: "Structure after Burrete/Open Babel hydrogen preparation.",
    purpose: "xTB generally needs chemically complete hydrogens for stable local calculations.",
    use: "Use to verify chemical completeness if geometry or charge distribution looks unexpected.",
    format: "structure file",
    notes: ["This is the file usually passed to xTB after preparation."],
  },
  secondaryInput: {
    title: "Prepared secondary input",
    kind: "Input",
    summary: "Second structure prepared for workflows that need two inputs.",
    purpose: "Used for paired or docking-like xTB operations.",
    use: "Use to verify the paired structure in two-input workflows.",
    format: "structure file",
    notes: [],
  },
  optimizedStructure: {
    title: "Optimized structure",
    kind: "Structure",
    summary: "Geometry produced by xTB optimization.",
    purpose: "Stores the post-optimization coordinates.",
    use: "Use as the post-relaxation geometry for energy/property interpretation or downstream calculations.",
    format: "structure file",
    notes: ["This is the main output of Optimize workflows."],
  },
  cube: {
    title: "Volumetric grid",
    kind: "Cube",
    summary: "Cube/grid output such as density, ESP, FOD, or orbital fields.",
    purpose: "Stores a scalar field on a 3D grid for surface visualization.",
    use: "Use for isosurfaces or volume maps of density, ESP, FOD, or orbital fields.",
    format: "Cube",
    notes: [],
  },
  trajectory: {
    title: "Trajectory frames",
    kind: "Trajectory",
    summary: "Frames generated by MD or metadynamics.",
    purpose: "Stores time-series coordinates from dynamics.",
    use: "Use to inspect conformational motion and representative frames.",
    format: "trajectory",
    notes: ["Frame count depends on MD/metadyn settings."],
  },
  frequencyOutput: {
    title: "Frequency output",
    kind: "Frequencies",
    summary: "Frequency/Hessian output in Gaussian-style text form.",
    purpose: "Stores vibrational analysis data for frequency inspection.",
    use: "Use for checking normal modes or passing data to tools that understand Gaussian-like output.",
    format: "Gaussian-style output",
    notes: [],
  },
  molden: {
    title: "Molden output",
    kind: "Orbitals",
    summary: "Molden-compatible orbital or vibration data.",
    purpose: "Exports xTB results for external visualization tools.",
    use: "Use with Molden-compatible orbital or vibration analysis.",
    format: "Molden",
    notes: [],
  },
};

function latestXtbJobForDocument(document: ViewerDocument, jobs: ShellViewState["xtbJobs"]) {
  const documentPaths = [document.path, document.sourcePath].filter((path): path is string => Boolean(path));
  return jobs.find((job) => {
    // The label is set when the job is queued; everything else only exists once
    // it finishes. Testing it behind `result &&` meant a running job could never
    // match its own document, so the panel stayed silent until the run ended.
    if (job.inputLabel === document.title) return true;
    const result = job.result;
    return Boolean(result) && (
      documentPaths.includes(result!.primaryOpenPath ?? "")
      || result!.command.some((part) => documentPaths.includes(part))
      || result!.artifacts.some((artifact) => documentPaths.includes(artifact.path))
    );
  }) ?? null;
}

function XtbResultsPanel({ document, job, actions }: { document: ViewerDocument; job: ShellViewState["xtbJobs"][number]; actions: ShellActions }) {
  const result = job.result;
  if (!result) return null;
  const summary = result.summary && typeof result.summary === "object" ? result.summary as Record<string, unknown> : {};
  const allCharges = numericArray(summary["partial charges"] ?? summary.buretteCharges);
  const charges = allCharges.slice(0, 12);
  const wbo = wboRows(summary.buretteWbo).slice(0, 12);
  const fukui = fukuiRows(summary.buretteFukui);
  const fukuiPreview = fukui.slice(0, 12);
  const artifactGroups = groupXtbArtifacts(result.artifacts);
  const chargesArtifact = xtbChargesArtifact(result.artifacts);
  const runName = xtbRunNameForPath(result.workDir) ?? fileName(result.workDir);
  const commandSummary = xtbCommandSummary(result.command);
  const openedInMs = Number.isFinite(result.elapsedMs) ? `${Math.max(0.1, result.elapsedMs / 1000).toFixed(1)} s` : "n/a";
  // Both renderers took the same action with the same payload; only the button
  // label differed.
  const colorCharges = () => {
    actions.runStructureViewerAction(document, {
      type: "color_xtb_charges",
      label: "Color xTB charges",
      charges: allCharges,
      chargeFilePath: chargesArtifact?.path,
    });
  };
  const colorFukuiInMolstar = (mode: "fplus" | "fminus" | "fzero") => {
    actions.runStructureViewerAction(document, {
      type: "color_xtb_fukui",
      label: `Highlight xTB ${fukuiModeLabel(mode)} in Mol*`,
      mode,
      values: fukui.map((row) => row[mode]),
    });
  };
  const showResultsMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu(xtbResultMenuItems(result, actions), { x: event.clientX, y: event.clientY }, { forceWeb: true });
  };
  const showArtifactMenu = (event: MouseEvent<HTMLButtonElement>, artifact: XtbArtifact) => {
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu(xtbArtifactMenuItems(artifact, actions), { x: event.clientX, y: event.clientY }, { forceWeb: true });
  };
  return (
    <section className="structure-brief-card structure-inspector-xtb-results" onContextMenu={showResultsMenu}>
      <div className="structure-inspector-xtb-result-header">
        <div>
          <span className="structure-brief-kicker">{operationTitle(result.operation)}</span>
          <h3>{job.title}</h3>
        </div>
        <span className="structure-inspector-xtb-status" data-status={job.status}>{job.status}</span>
      </div>
      <p className="structure-inspector-xtb-result-context">{commandSummary} · Scope: {job.inputLabel} · Run: {runName}</p>
      <div className="structure-inspector-xtb-metrics" aria-label="xTB run summary">
        <XtbMetric label="Energy" value={formatMaybeNumber(summary["total energy"], " Eh")} />
        <XtbMetric label="HL gap" value={formatMaybeNumber(summary["HOMO-LUMO gap / eV"], " eV")} />
        <XtbMetric label="Dipole" value={formatDipole(summary["dipole / a.u."])} />
        <XtbMetric label="Files" value={String(result.artifacts.length)} />
        <XtbMetric label="Elapsed" value={openedInMs} />
        <XtbMetric label="Exit code" value={result.exitCode === null || result.exitCode === undefined ? "n/a" : String(result.exitCode)} />
      </div>
      {charges.length > 0 ? (
        <XtbResultTable
          title="Charges"
          note="Partial atomic charges from xTB output."
          columns={["Atom", "Charge"]}
          rows={charges.map((charge, index) => [`#${index + 1}`, charge.toFixed(4)])}
          action={document.renderer === "molstar" ? (
            <button type="button" className="structure-inspector-xtb-table-action" onClick={colorCharges}>
              Color in Mol*
            </button>
          ) : document.renderer === "xyzrender-external" && chargesArtifact ? (
            <button type="button" className="structure-inspector-xtb-table-action" onClick={colorCharges}>
              Color in xyzr
            </button>
          ) : null}
        />
      ) : null}
      {wbo.length > 0 ? (
        <XtbResultTable
          title="WBO"
          note="Wiberg bond orders for the strongest reported bonds."
          columns={["Bond", "Order"]}
          rows={wbo.map((row) => [`${row.from}-${row.to}`, row.order.toFixed(3)])}
        />
      ) : null}
      {fukuiPreview.length > 0 ? (
        <XtbResultTable
          title="Fukui"
          note="Condensed Fukui functions from xTB log."
          columns={["Atom", "f+", "f-", "f0"]}
          rows={fukuiPreview.map((row) => [`#${row.atom}${row.element}`, row.fplus.toFixed(3), row.fminus.toFixed(3), row.fzero.toFixed(3)])}
          action={document.renderer === "molstar" ? (
            <div className="structure-inspector-xtb-table-actions">
              <button type="button" className="structure-inspector-xtb-table-action" onClick={() => colorFukuiInMolstar("fplus")}>
                f+ in Mol*
              </button>
              <button type="button" className="structure-inspector-xtb-table-action" onClick={() => colorFukuiInMolstar("fminus")}>
                f- in Mol*
              </button>
              <button type="button" className="structure-inspector-xtb-table-action" onClick={() => colorFukuiInMolstar("fzero")}>
                f0 in Mol*
              </button>
            </div>
          ) : null}
        />
      ) : null}
      <div className="structure-inspector-xtb-file-groups" aria-label="xTB output files">
        {artifactGroups.map((group) => (
          <div className="structure-inspector-xtb-file-group" key={group.title}>
            <strong>{group.title}</strong>
            <div>
              {group.artifacts.map((artifact) => (
                <button
                  type="button"
                  className="dock-action structure-inspector-xtb-file-button"
                  key={artifact.path}
                  onClick={() => void openXtbArtifact(artifact, actions)}
                  onContextMenu={(event) => showArtifactMenu(event, artifact)}
                  title={xtbArtifactButtonTitle(artifact)}
                >
                  {artifact.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="dock-action-row structure-inspector-xtb-result-actions">
        {result.primaryOpenPath ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => void actions.openPaths([result.primaryOpenPath!])}>
            Open result
          </Button>
        ) : null}
        <Button type="button" variant="secondary" size="sm" onClick={() => void actions.revealPath(result.workDir, "xTB run folder")}>
          Open run folder
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => void actions.openTextPaths([result.logPath])}>
          Log
        </Button>
      </div>
    </section>
  );
}

function XtbMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="structure-inspector-xtb-metric">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function XtbResultTable({
  title,
  note,
  columns,
  rows,
  action,
}: {
  title: string;
  note: string;
  columns: string[];
  rows: string[][];
  action?: ReactNode;
}) {
  return (
    <div className="structure-inspector-xtb-table">
      <div className="structure-inspector-xtb-table-title">
        <div>
          <strong>{title}</strong>
          <span>{note}</span>
        </div>
        {action}
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${title}-${index}`}>
              {row.map((cell, cellIndex) => <td key={`${title}-${index}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function groupXtbArtifacts(artifacts: XtbArtifact[]) {
  const groups: Array<{ title: string; artifacts: XtbArtifact[] }> = [
    { title: "Structures", artifacts: [] },
    { title: "Trajectories", artifacts: [] },
    { title: "Properties", artifacts: [] },
    { title: "Logs", artifacts: [] },
    { title: "Restart", artifacts: [] },
    { title: "Other", artifacts: [] },
  ];
  const byTitle = new Map(groups.map((group) => [group.title, group]));
  for (const artifact of artifacts) {
    byTitle.get(xtbArtifactGroupTitle(artifact))!.artifacts.push(artifact);
  }
  return groups.filter((group) => group.artifacts.length > 0);
}

function xtbArtifactGroupTitle(artifact: XtbArtifact) {
  const name = artifact.title.toLowerCase();
  const kind = artifact.kind.toLowerCase();
  if (kind === "structure" || ["input.pdb", "input-with-h.pdb", "xtbopt.pdb", "xtbopt.xyz", "xtbtopo.mol"].includes(name)) return "Structures";
  if (kind === "trajectory" || name.endsWith(".trj") || name.endsWith(".arc") || name === "xtbopt.log") return "Trajectories";
  if (["charges", "wbo", "xtbout.json"].includes(name) || kind === "cube") return "Properties";
  if (name.endsWith(".log") || name.endsWith(".out") || name.endsWith(".md")) return "Logs";
  if (name.includes("restart") || name.startsWith(".xtb")) return "Restart";
  return "Other";
}

function xtbChargesArtifact(artifacts: XtbArtifact[]) {
  return artifacts.find((artifact) => artifact.title.toLowerCase() === "charges" || artifact.path.split("/").pop()?.toLowerCase() === "charges") ?? null;
}

function openXtbArtifact(artifact: XtbArtifact, actions: ShellActions) {
  if (artifact.kind === "structure" || artifact.kind === "cube" || artifact.kind === "trajectory") {
    return actions.openPaths([artifact.path]);
  }
  return actions.openTextPaths([artifact.path]);
}

function xtbArtifactButtonTitle(artifact: XtbArtifact) {
  const info = xtbArtifactInfoForPath(artifact.path, artifact.extension);
  return info ? `${info.title}: ${info.summary}` : artifact.path;
}

// Keyed by the exact flags xtb_solvation_flag emits in the backend. The previous
// list guessed "--cpcm", so a CPCM-X run was reported back as gas phase.
const XTB_SOLVATION_FLAG_LABELS: Record<string, string> = {
  "--alpb": "ALPB",
  "--gbsa": "GBSA",
  "--cosmo": "COSMO",
  "--cpcmx": "CPCM-X",
};

function operationTitle(operation: XtbRunResult["operation"]) {
  switch (operation) {
    case "optimize":
      return "Geometry optimization";
    case "properties":
      return "Single-point properties";
    case "optimized-hessian":
      return "Optimized Hessian";
    case "vipea":
      return "IP/EA workflow";
    case "vfukui":
      return "Fukui workflow";
    case "md":
      return "Molecular dynamics";
    case "metadyn":
      return "Metadynamics";
    default:
      return "xTB run";
  }
}

function xtbCommandSummary(command: string[]) {
  const joined = command.join(" ");
  const method = command.find((part) => /^--?gfn\d$/iu.test(part))?.replace(/^--/u, "").toUpperCase() ?? "xTB";
  const optIndex = command.indexOf("--opt");
  const opt = optIndex >= 0 ? `opt ${command[optIndex + 1] ?? "normal"}` : null;
  const chargeIndex = command.indexOf("--chrg");
  const charge = chargeIndex >= 0 ? `charge ${command[chargeIndex + 1] ?? "0"}` : null;
  const uhfIndex = command.indexOf("--uhf");
  const uhf = uhfIndex >= 0 ? `UHF ${command[uhfIndex + 1] ?? "0"}` : null;
  const solventFlag = command.find((part) => XTB_SOLVATION_FLAG_LABELS[part.toLowerCase()]);
  const solventIndex = solventFlag ? command.indexOf(solventFlag) : -1;
  const solvent = solventFlag
    ? `${XTB_SOLVATION_FLAG_LABELS[solventFlag.toLowerCase()]} ${command[solventIndex + 1] ?? ""}`.trim()
    : "gas phase";
  return [method, opt, charge, uhf, solvent].filter(Boolean).join(" · ") || truncateInline(joined, 80);
}

function xtbArtifactMenuItems(artifact: XtbArtifact, actions: ShellActions): MenuItemSpec[] {
  return [
    {
      kind: "item",
      id: "open-artifact-file",
      text: "Open as file",
      detail: artifact.title,
      action: () => void actions.openPaths([artifact.path]),
    },
    {
      kind: "item",
      id: "open-artifact-text",
      text: "Open as text",
      detail: artifact.title,
      action: () => void actions.openTextPaths([artifact.path]),
    },
    {
      kind: "item",
      id: "copy-artifact-path",
      text: "Copy path",
      detail: artifact.path,
      action: () => void actions.copyPath(artifact.path, "xTB artifact"),
    },
    {
      kind: "item",
      id: "reveal-artifact",
      text: "Reveal file",
      detail: artifact.title,
      action: () => void actions.revealPath(artifact.path, "xTB artifact"),
    },
  ];
}

function xtbResultMenuItems(result: XtbRunResult, actions: ShellActions): MenuItemSpec[] {
  return [
    {
      kind: "item",
      id: "open-primary-result",
      text: "Open result as file",
      detail: result.primaryOpenPath?.split(/[\\/]/u).pop() ?? "No primary result",
      disabled: !result.primaryOpenPath,
      action: result.primaryOpenPath ? () => void actions.openPaths([result.primaryOpenPath!]) : undefined,
    },
    {
      kind: "item",
      id: "open-report",
      text: "Open report",
      detail: result.reportPath.split(/[\\/]/u).pop() ?? "xtb-report.md",
      action: () => void actions.openTextPaths([result.reportPath]),
    },
    {
      kind: "item",
      id: "open-log",
      text: "Open log",
      detail: result.logPath.split(/[\\/]/u).pop() ?? "xtb.log",
      action: () => void actions.openTextPaths([result.logPath]),
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "copy-workdir",
      text: "Copy work dir",
      detail: result.workDir,
      action: () => void actions.copyPath(result.workDir, "xTB work dir"),
    },
  ];
}

function numericArray(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function wboRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const source = row && typeof row === "object" ? row as Record<string, unknown> : {};
    return { from: Number(source.from), to: Number(source.to), order: Number(source.order) };
  }).filter((row) => Number.isFinite(row.from) && Number.isFinite(row.to) && Number.isFinite(row.order));
}

function fukuiRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const source = row && typeof row === "object" ? row as Record<string, unknown> : {};
    return {
      atom: Number(source.atom),
      element: String(source.element ?? ""),
      fplus: Number(source.fplus),
      fminus: Number(source.fminus),
      fzero: Number(source.fzero),
    };
  }).filter((row) => Number.isInteger(row.atom) && row.atom > 0 && Number.isFinite(row.fplus) && Number.isFinite(row.fminus) && Number.isFinite(row.fzero));
}

function fukuiModeLabel(mode: "fplus" | "fminus" | "fzero") {
  if (mode === "fminus") return "f(-)";
  if (mode === "fzero") return "f(0)";
  return "f(+)";
}

function formatMaybeNumber(value: unknown, suffix: string) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(6)}${suffix}` : "n/a";
}

function formatDipole(value: unknown) {
  const rows = numericArray(value);
  return rows.length >= 3 ? rows.slice(0, 3).map((number) => number.toFixed(3)).join(", ") : "n/a";
}

// Engine tokens are what the executable wants; these are what a reader wants.
const XTB_METHOD_LABELS: Record<string, string> = {
  gfn2: "GFN2", gfn1: "GFN1", gfn0: "GFN0", gfnff: "GFN-FF",
};
const XTB_OPT_LEVEL_LABELS: Record<string, string> = {
  loose: "Loose", normal: "Normal", tight: "Tight", verytight: "Very tight",
};
const XTB_SOLVATION_LABELS: Record<string, string> = {
  none: "None", alpb: "ALPB", gbsa: "GBSA", cosmo: "COSMO", cpcmx: "CPCM-X",
};
const CONFORMER_SAMPLING_LABELS: Record<string, string> = {
  auto: "Auto", normal: "Normal", quick: "Quick", squick: "Super quick", mquick: "Micro quick",
};
const CONFORMER_SOLVENT_LABELS: Record<string, string> = {
  none: "Gas phase", water: "Water", methanol: "Methanol",
  acetonitrile: "Acetonitrile", dmso: "DMSO", chloroform: "Chloroform",
};

// Small mutually exclusive sets read far better as one switch than as a dropdown
// you have to open to see the alternatives - the same trade the viewport menus make.
function InlineSegmentedControl({
  value,
  options,
  labels,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label={ariaLabel}
      size="sm"
      spacing={0}
      className="structure-inspector-segment"
      // A radio group is never empty: clicking the active item must not clear it.
      onValueChange={(next) => { if (next) onChange(next); }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option} value={option} className="structure-inspector-segment-button">
          {labels[option] ?? option}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function InlineSettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="structure-inspector-settings-group">
      <h5 className="structure-inspector-settings-group-title">{title}</h5>
      {children}
    </div>
  );
}

function InlineXtbSetting({
  label,
  tooltip,
  reset,
  modified,
  children,
}: {
  label: string;
  tooltip?: string;
  reset?: () => void;
  modified?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="structure-inspector-xtb-setting-row" data-xtb-tooltip={tooltip}>
      <span>{label}</span>
      <div className="structure-inspector-xtb-setting-control">
        {reset ? (
          <button
            type="button"
            className="settings-reset-button"
            aria-hidden={!modified}
            tabIndex={modified ? 0 : -1}
            data-hidden={!modified || undefined}
            onClick={reset}
          >
            Reset
            <ShortcutTooltip label={`Restore the default ${label} parameter.`} />
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function countFromSummaryValue(value: string | null, unit: string) {
  if (!value || value === "None detected") return null;
  const match = value.match(new RegExp(`(\\d[\\d,]*)\\s+${unit}\\b`, "u"));
  return match?.[1] ?? null;
}

function valueForLabel(rows: StructureSummaryRow[], label: string) {
  return rows.find((row) => row.label === label)?.value ?? null;
}

function visibleComponentRows(rows: StructureSummaryRow[]) {
  const visibleRows = rows.filter((row) => row.value !== "None detected" || row.action);
  return visibleRows.length > 0 ? visibleRows : rows;
}

type SelectedStructureRow = {
  row: StructureSummaryRow;
  action: StructureViewerAction;
  key: string;
  group: string;
};

function selectedStructureRow(
  document: ViewerDocument,
  summary: StructureCompositionSummary | null,
  activeActionKey: string | null,
): SelectedStructureRow | null {
  if (!summary || !activeActionKey) return null;
  const groups: Array<[string, StructureSummaryRow[]]> = [
    ["Component", summary.componentRows],
    ["Maestro entry", summary.maestroRows ?? []],
    ["Chain", summary.polymerRows],
    ["Ligand", summary.ligandRows],
    ["Water / ion", summary.solventRows],
  ];
  for (const [group, rows] of groups) {
    for (const row of rows) {
      if (!row.action) continue;
      const key = selectionActionKey(document, row.action);
      if (key && key === activeActionKey) return { row, action: row.action, key, group };
    }
  }
  return null;
}

function StructureBriefRow({ label, value }: BriefRow) {
  return (
    <div className="structure-brief-row">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function plural(count: number, noun: string) {
  return count === 1 ? noun : `${noun}s`;
}

// Arrow keys walk the rows of a list — and of the composition tree, where the
// walk crosses group boundaries because the buttons are collected from the
// container rather than from any one group.
function structureRowsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const button = target?.closest<HTMLButtonElement>("button.structure-brief-action-row, button.structure-brief-chip-button");
  if (!button || !event.currentTarget.contains(button)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button.structure-brief-action-row, button.structure-brief-chip-button"))
    .filter((candidate) => !candidate.disabled);
  const index = buttons.indexOf(button);
  if (index < 0) return;
  const nextIndex = event.key === "ArrowDown"
    ? Math.min(buttons.length - 1, index + 1)
    : Math.max(0, index - 1);
  if (nextIndex === index) return;
  event.preventDefault();
  event.stopPropagation();
  buttons[nextIndex].focus();
  buttons[nextIndex].click();
}

type CompositionGroup = {
  key: string;
  row: StructureSummaryRow;
  children: StructureSummaryRow[];
};

// The parser reports each group twice: once as a summary line and once as the
// members behind it, and the panel used to render those as separate cards. They
// are one hierarchy, so they are shown as one.
function compositionGroups(summary: StructureCompositionSummary): CompositionGroup[] {
  const groups = visibleComponentRows(summary.componentRows).map((row) => ({
    key: `component:${row.label}`,
    row,
    children: row.label === "Polymers" ? summary.polymerRows
      : row.label === "Ligands" ? summary.ligandRows
      : row.label === "Ions" ? summary.solventRows
      : [],
  }));
  const maestroRows = summary.maestroRows ?? [];
  if (maestroRows.length === 0) return groups;
  return [...groups, {
    key: "maestro",
    row: { label: "Maestro entries", value: `${maestroRows.length} CT ${plural(maestroRows.length, "block")}` },
    children: maestroRows,
  }];
}

// A handful of chains or ligands is what people open a structure to look at, so
// those groups start open; a hundred of them would just be the old wall of rows.
const COMPOSITION_AUTO_EXPAND_LIMIT = 8;

function defaultExpandedCompositionGroups(groups: CompositionGroup[]) {
  return new Set(groups
    .filter((group) => group.children.length > 0 && group.children.length <= COMPOSITION_AUTO_EXPAND_LIMIT)
    .map((group) => group.key));
}

function StructureCompositionCard({
  summary,
  pending,
  error,
  document,
  actions,
  activeActionKey,
  setActiveActionKey,
}: {
  summary: StructureCompositionSummary | null;
  pending: boolean;
  error: string | null;
  document: ViewerDocument;
  actions: ShellActions;
  activeActionKey: string | null;
  setActiveActionKey: (key: string | null) => void;
}) {
  const groups = useMemo(() => summary ? compositionGroups(summary) : [], [summary]);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpandedCompositionGroups(groups));
  useEffect(() => {
    setExpanded(defaultExpandedCompositionGroups(groups));
  }, [groups]);
  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  return (
    <section className="structure-brief-card">
      <StructureSectionHeader title="Composition" detail={groups.length ? `${groups.length} ${plural(groups.length, "group")}` : undefined} />
      {summary ? (
        <div className="structure-brief-rows structure-inspector-tree" onKeyDown={structureRowsKeyDown}>
          {groups.map((group) => {
            const open = expanded.has(group.key);
            return (
              <div className="structure-inspector-tree-group" key={group.key}>
                <StructureActionRow
                  row={group.row}
                  document={document}
                  actions={actions}
                  activeActionKey={activeActionKey}
                  setActiveActionKey={setActiveActionKey}
                  compact={false}
                  leading={group.children.length > 0 ? (
                    <button
                      type="button"
                      className="structure-inspector-tree-toggle"
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${group.row.label}`}
                      title={open ? "Collapse" : "Expand"}
                      onClick={() => toggle(group.key)}
                    >
                      <TreeDisclosureIcon />
                    </button>
                  ) : <span className="structure-inspector-tree-spacer" aria-hidden="true" />}
                />
                {open && group.children.length > 0 ? (
                  <div className="structure-inspector-tree-children">
                    {group.children.map((child, index) => (
                      <StructureActionRow
                        key={structureActionRowKey(child, index)}
                        row={child}
                        document={document}
                        actions={actions}
                        activeActionKey={activeActionKey}
                        setActiveActionKey={setActiveActionKey}
                        compact
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dock-empty">{pending ? "Reading structure text..." : `Composition unavailable: ${error}`}</div>
      )}
    </section>
  );
}

function TreeDisclosureIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function structureActionRowKey(row: StructureSummaryRow, index: number) {
  const actionKey = row.action ? `${row.action.type}:${"index" in row.action ? row.action.index : ""}` : "";
  return `${row.label}:${actionKey}:${index}`;
}

function StructureActionRow({
  row,
  document,
  actions,
  activeActionKey,
  setActiveActionKey,
  compact,
  leading,
}: {
  row: StructureSummaryRow;
  document: ViewerDocument;
  actions: ShellActions;
  activeActionKey: string | null;
  setActiveActionKey: (key: string | null) => void;
  compact: boolean;
  leading?: ReactNode;
}) {
  const content = () => (
    <span className="structure-inspector-row-content">
      <span className="structure-inspector-row-label">{row.label}</span>
      <strong title={row.value}>{row.value}</strong>
    </span>
  );
  if (!row.action) {
    // A group heading with no action of its own still has to line up with the
    // rows around it, so it keeps the entry layout instead of falling back to a
    // plain row.
    if (leading) {
      return (
        <div className="structure-brief-action-entry" data-leading="true">
          {leading}
          <div className="structure-brief-action-summary" title={`${row.label}: ${row.value}`}>
            {content()}
          </div>
        </div>
      );
    }
    return compact ? (
      <span title={`${row.label}: ${row.value}`}>
        <strong>{row.label}</strong>
        {row.value}
      </span>
    ) : (
      <StructureBriefRow label={row.label} value={row.value} />
    );
  }

  const primaryAction = row.action;
  const secondaryAction = row.secondaryAction;
  const primaryActionKey = selectionActionKey(document, primaryAction);
  const selected = primaryActionKey !== null && primaryActionKey === activeActionKey;
  const runAction = (action: StructureViewerAction) => {
    const key = selectionActionKey(document, action);
    if (key && key === activeActionKey) {
      actions.runStructureViewerAction(document, { type: "clear_selection", label: "Clear selection" });
      setActiveActionKey(null);
      return;
    }
    actions.runStructureViewerAction(document, action);
    if (key) setActiveActionKey(key);
  };
  const showContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu(contextMenuItems({
      row,
      document,
      primaryAction,
      secondaryAction,
      selected,
      runAction,
      clearSelection: () => {
        actions.runStructureViewerAction(document, { type: "clear_selection", label: "Clear selection" });
        setActiveActionKey(null);
      },
    }), { x: event.clientX, y: event.clientY });
  };

  if (secondaryAction) {
    return (
      <div className="structure-brief-action-entry" data-actions="pair" data-leading={leading ? "true" : undefined} data-selected={selected || undefined} onContextMenu={showContextMenu}>
        {leading}
        <div
          className={compact ? "structure-brief-chip-summary" : "structure-brief-action-summary"}
          title={`${row.label}: ${row.value}`}
        >
          {content()}
        </div>
        <button
          type="button"
          className="structure-brief-mini-action"
          onClick={() => runAction(primaryAction)}
          title={primaryAction.label}
        >
          {miniActionLabel(primaryAction.label)}
        </button>
        <button
          type="button"
          className="structure-brief-mini-action"
          onClick={() => runAction(secondaryAction)}
          title={secondaryAction.label}
        >
          {miniActionLabel(secondaryAction.label)}
        </button>
      </div>
    );
  }

  return (
    <div className="structure-brief-action-entry" data-leading={leading ? "true" : undefined} data-selected={selected || undefined} onContextMenu={showContextMenu}>
      {leading}
      <button
        type="button"
        className={compact ? "structure-brief-chip-button" : "structure-brief-action-row"}
        onClick={() => runAction(primaryAction)}
        title={primaryAction.label}
        aria-pressed={selected}
      >
        {content()}
      </button>
    </div>
  );
}

function StructureDetailsSection({
  brief,
  compositionSummary,
  compositionPending,
  compositionError,
  document,
  hostedMcpWidget,
  actions,
}: {
  brief: ReturnType<typeof structureBriefForDocument>;
  compositionSummary: StructureCompositionSummary | null;
  compositionPending: boolean;
  compositionError: string | null;
  document: ViewerDocument;
  hostedMcpWidget: boolean;
  actions: ShellActions;
}) {
  return (
    <details className="structure-brief-card structure-inspector-details">
      <summary>
        <span>Details</span>
        <small>{brief.summary}</small>
      </summary>
      <div className="structure-inspector-details-body">
        <StructureSectionHeader title="Composition metrics" detail="Parsed from coordinate text." />
        {compositionSummary ? (
          <div className="structure-brief-rows">
            {compositionSummary.rows.map((row) => (
              <StructureBriefRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        ) : (
          <div className="dock-empty">{compositionPending ? "Reading structure text..." : "No parser summary is available."}</div>
        )}

        <StructureSectionHeader title="File metadata" detail={brief.summary} />
        <div className="structure-brief-rows">
          {brief.overviewRows.map((row) => (
            <StructureBriefRow key={row.label} label={row.label} value={row.value} />
          ))}
        </div>

        {!hostedMcpWidget ? <>
          <StructureSectionHeader title="Source affordances" detail="Source text stays available in the Text dock tab." />
          <div className="structure-brief-rows">
            {brief.usefulRows.map((row) => (
              <StructureBriefRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        </> : null}

        <StructureSectionHeader title="Notes" />
        <div className="structure-brief-notes">
          {[...compositionNotes(compositionSummary, compositionPending, compositionError), ...brief.notes].map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>

        {!hostedMcpWidget ? <div className="structure-brief-actions">
          <Button type="button" variant="secondary" size="sm" onClick={() => void actions.showDocumentMetadata(document)}>
            Show metadata
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void actions.revealDocument(document)}>
            Reveal file
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void actions.copyDocumentPath(document)}>
            Copy path
          </Button>
        </div> : null}
      </div>
    </details>
  );
}

function selectionActionKey(document: ViewerDocument, action: StructureViewerAction) {
  if (action.type === "set_sdf_molecule") return JSON.stringify([document.id, action.type, action.index]);
  if (action.type === "set_structure_pose") return JSON.stringify([document.id, action.type, action.index]);
  if (action.type !== "select_residues" && action.type !== "focus_ligand") return null;
  return JSON.stringify([document.id, action.type, action.selector]);
}

function contextMenuItems({
  row,
  document,
  primaryAction,
  secondaryAction,
  selected,
  runAction,
  clearSelection,
}: {
  row: StructureSummaryRow;
  document: ViewerDocument;
  primaryAction: StructureViewerAction;
  secondaryAction?: StructureViewerAction;
  selected: boolean;
  runAction: (action: StructureViewerAction) => void;
  clearSelection: () => void;
}): MenuItemSpec[] {
  const items: MenuItemSpec[] = [
    {
      kind: "item",
      id: "primary-action",
      text: selected ? "Clear selection" : primaryAction.label,
      detail: `${row.label}: ${row.value}`,
      action: selected ? clearSelection : () => runAction(primaryAction),
    },
  ];
  if (secondaryAction) {
    items.push({
      kind: "item",
      id: "secondary-action",
      text: secondaryAction.label,
      detail: `${row.label}: ${row.value}`,
      action: () => runAction(secondaryAction),
    });
  }
  items.push(
    { kind: "separator" },
    {
      kind: "item",
      id: "clear-selection",
      text: "Clear selection",
      disabled: !selected,
      action: clearSelection,
    },
    {
      kind: "item",
      id: "copy-label",
      text: "Copy label",
      detail: document.title,
      action: () => void navigator.clipboard?.writeText(`${row.label}: ${row.value}`),
    },
  );
  return items;
}

function miniActionLabel(label: string) {
  const [first] = label.split(/\s+/u);
  return first || label;
}

function StructureDropSummary({ dockDrops }: { dockDrops: ShellViewState["dockDroppedStructures"] }) {
  if (dockDrops.length === 0) return null;
  return (
    <section className="structure-brief-card">
      <h4>Dropped inputs</h4>
      <div className="structure-brief-rows">
        {dockDrops.map((item) => (
          <StructureBriefRow key={item.id} label={item.title} value={item.detail} />
        ))}
      </div>
    </section>
  );
}
