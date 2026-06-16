import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { showNativeContextMenu } from "./native-context-menu";
import { formatBytes } from "./format";
import type { MenuItemSpec } from "./menu-types";
import type { ShellActions, ShellViewState } from "./types";
import { structureBriefForDocument, type StructureBriefRow as BriefRow } from "../lib/structure-brief";
import { parseStructureComposition, type StructureCompositionSummary, type StructureSummaryRow, type StructureViewerAction } from "../lib/structure-composition";
import { readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { readStructureText } from "../lib/structure-text";
import type { ViewerDocument } from "../types";

type StructureInfoPanelProps = {
  document: ViewerDocument | null;
  dockDrops: ShellViewState["dockDroppedStructures"];
  actions: ShellActions;
};

const SDF_CONTEXT_STYLE_OPTIONS = [
  { value: "line", label: "Line" },
  { value: "ball-and-stick", label: "Ball+Stick" },
  { value: "spacefill", label: "Spacefill" },
  { value: "molecular-surface", label: "Surface" },
  { value: "match", label: "Match" },
] as const;
const STRUCTURE_SCENE_STYLE_OPTIONS = [
  { value: "illustrative", label: "Colorful" },
  { value: "line", label: "Line" },
  { value: "ball-and-stick", label: "Ball+Stick" },
  { value: "molecular-surface", label: "Surface" },
] as const;

type SdfContextStyle =
  | typeof SDF_CONTEXT_STYLE_OPTIONS[number]["value"]
  | typeof STRUCTURE_SCENE_STYLE_OPTIONS[number]["value"];
const SDF_CONTEXT_OPACITY_DEFAULT = 0.4;
const SDF_CONTEXT_OPACITY_MIN = 0.04;
const SDF_CONTEXT_OPACITY_MAX = 1;
const STRUCTURE_SCENE_OPACITY_MAX = 1;

export function StructureInfoPanel({ document, dockDrops, actions }: StructureInfoPanelProps) {
  const composition = useStructureComposition(document);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [sdfContextStyle, setSdfContextStyle] = useState<SdfContextStyle>("line");
  const [sdfContextOpacity, setSdfContextOpacity] = useState(SDF_CONTEXT_OPACITY_DEFAULT);

  useEffect(() => {
    setActiveActionKey(null);
  }, [document?.id]);

  useEffect(() => {
    if (!document) return;
    const sceneControls = document.renderer === "molstar" && Boolean(document.dockingRequest?.sceneMode || isStructureFrameStyleDocument(document));
    const style = readSdfContextStylePreference(document, sceneControls ? STRUCTURE_SCENE_STYLE_OPTIONS : SDF_CONTEXT_STYLE_OPTIONS);
    setSdfContextStyle(style);
    setSdfContextOpacity(readSdfContextOpacityPreference(document));
  }, [document]);

  if (!document) {
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
  const compositionError = composition.documentId === document.id ? composition.error : null;
  const selectedEntity = selectedStructureRow(document, compositionSummary, activeActionKey);
  const isMolstarDocument = document.renderer === "molstar";
  const hasStructureScene = isMolstarDocument && Boolean(document.dockingRequest?.sceneMode);
  const hasStructureSceneAllMode = isMolstarDocument && document.dockingRequest?.poseMode === "all";
  const hasStructureFrameAllMode = isMolstarDocument && shouldShowStructureFrameStyleCard(document, compositionSummary);
  const allStructureStyleCard = hasStructureSceneAllMode
    ? {
        title: "All structures",
        ariaLabel: "All structures style",
        opacityLabel: "All structures opacity",
      }
    : hasStructureFrameAllMode
      ? {
          title: "All frames",
          ariaLabel: "All frames style",
          opacityLabel: "All frames opacity",
        }
      : null;
  const clearSelection = () => {
    actions.runStructureViewerAction(document, { type: "clear_selection", label: "Clear selection" });
    setActiveActionKey(null);
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
          <span>{brief.format}</span>
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
        <p>{inspectorSummaryLine(brief.kind, compositionSummary, compositionPending, compositionError)}</p>
      </section>

      {isMolstarDocument && compositionSummary && hasSdfMoleculeCollection(compositionSummary) ? (
        <SdfContextStyleCard
          document={document}
          actions={actions}
          value={sdfContextStyle}
          setValue={setSdfContextStyle}
          opacity={sdfContextOpacity}
          setOpacity={setSdfContextOpacity}
        />
      ) : null}

      {hasStructureScene ? (
        <StructureSceneControlsCard document={document} actions={actions} />
      ) : null}

      {allStructureStyleCard ? (
        <SdfContextStyleCard
          document={document}
          actions={actions}
          setValue={setSdfContextStyle}
          setOpacity={setSdfContextOpacity}
          title={allStructureStyleCard.title}
          detail="All-together view"
          ariaLabel={allStructureStyleCard.ariaLabel}
          opacityLabel={allStructureStyleCard.opacityLabel}
          styleOptions={STRUCTURE_SCENE_STYLE_OPTIONS}
          opacityDisabled={sdfContextStyle === "illustrative"}
          value={normalizeStructureSceneStyle(sdfContextStyle)}
          opacity={clampOpacity(sdfContextOpacity, SDF_CONTEXT_OPACITY_MIN, STRUCTURE_SCENE_OPACITY_MAX)}
          opacityMax={STRUCTURE_SCENE_OPACITY_MAX}
        />
      ) : null}

      {(compositionSummary || compositionPending || compositionError) ? (
        <section className="structure-brief-card">
          <StructureSectionHeader title="Components" detail="Primary groups" />
          {compositionSummary ? (
            <StructureActionList
              rows={visibleComponentRows(compositionSummary.componentRows)}
              document={document}
              actions={actions}
              activeActionKey={activeActionKey}
              setActiveActionKey={setActiveActionKey}
            />
          ) : (
            <div className="dock-empty">{compositionPending ? "Reading structure text..." : `Composition unavailable: ${compositionError}`}</div>
          )}
        </section>
      ) : null}

      {selectedEntity ? (
        <SelectedEntityCard
          selectedEntity={selectedEntity}
          clearSelection={clearSelection}
        />
      ) : null}

      {compositionSummary?.maestroRows?.length ? (
        <section className="structure-brief-card">
          <StructureSectionHeader title="Maestro entries" detail={`${compositionSummary.maestroRows.length} CT ${plural(compositionSummary.maestroRows.length, "block")}`} />
          <StructureActionList
            rows={compositionSummary.maestroRows}
            document={document}
            actions={actions}
            activeActionKey={activeActionKey}
            setActiveActionKey={setActiveActionKey}
            compact
          />
        </section>
      ) : null}

      {compositionSummary?.ligandRows.length ? (
        <section className="structure-brief-card">
          <StructureSectionHeader title="Ligands" detail={`${compositionSummary.ligandRows.length} ${plural(compositionSummary.ligandRows.length, "instance")}`} />
          <StructureActionList
            rows={compositionSummary.ligandRows}
            document={document}
            actions={actions}
            activeActionKey={activeActionKey}
            setActiveActionKey={setActiveActionKey}
            compact
          />
        </section>
      ) : null}

      {compositionSummary?.polymerRows.length ? (
        <section className="structure-brief-card">
          <StructureSectionHeader title="Chains" detail={`${compositionSummary.polymerRows.length} ${plural(compositionSummary.polymerRows.length, "chain")}`} />
          <StructureActionList
            rows={compositionSummary.polymerRows}
            document={document}
            actions={actions}
            activeActionKey={activeActionKey}
            setActiveActionKey={setActiveActionKey}
            compact
          />
        </section>
      ) : null}

      {compositionSummary?.solventRows.length ? (
        <section className="structure-brief-card">
          <StructureSectionHeader title="Water / ions" />
          <StructureActionList
            rows={compositionSummary.solventRows}
            document={document}
            actions={actions}
            activeActionKey={activeActionKey}
            setActiveActionKey={setActiveActionKey}
          />
        </section>
      ) : null}

      <StructureDetailsSection
        brief={brief}
        compositionSummary={compositionSummary}
        compositionPending={compositionPending}
        compositionError={compositionError}
        document={document}
        actions={actions}
      />

      <StructureDropSummary dockDrops={dockDrops} />
    </div>
  );
}

function hasSdfMoleculeCollection(summary: StructureCompositionSummary) {
  return summary.componentRows.filter((row) => row.action?.type === "set_sdf_molecule").length > 1;
}

function isStructureFrameStyleDocument(document: ViewerDocument) {
  const extension = document.extension.toLowerCase();
  return document.renderer === "molstar" && (extension === "xyz" || extension === "extxyz");
}

function shouldShowStructureFrameStyleCard(document: ViewerDocument, summary: StructureCompositionSummary | null) {
  if (!isStructureFrameStyleDocument(document) || document.dockingRequest?.sceneMode) return false;
  return summaryInteger(valueForLabel(summary?.rows ?? [], "Frames")) > 1;
}

function summaryInteger(value: string | null) {
  const match = value?.match(/\d[\d,]*/u);
  return match ? Number(match[0].replace(/,/g, "")) : 0;
}

function StructureSceneControlsCard({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  const request = document.dockingRequest;
  if (!request?.sceneMode) return null;
  const paths = [request.receptorPath, ...request.ligandPaths];
  const runMode = (mode: "all" | "single") => {
    actions.runStructureViewerAction(document, {
      type: "set_sdf_pose_mode",
      label: mode === "all" ? "Showing all structures together" : "Showing structures individually",
      notify: false,
      mode,
    });
  };
  const showStructure = (index: number) => {
    actions.runStructureViewerAction(document, {
      type: "set_sdf_pose_index",
      label: `Show ${fileName(paths[index])}`,
      index,
    });
  };
  return (
    <section className="structure-brief-card structure-inspector-scene-controls">
      <StructureSectionHeader title="Scene structures" detail={`${paths.length} structures`} />
      <div className="structure-inspector-style-options" role="group" aria-label="Structure scene mode">
        <button type="button" className="structure-inspector-style-option" onClick={() => runMode("all")}>
          Show all together
        </button>
        <button type="button" className="structure-inspector-style-option" onClick={() => runMode("single")}>
          Show individually
        </button>
      </div>
      <div className="structure-brief-rows">
        {paths.map((path, index) => (
          <button
            key={`${path}:${index}`}
            type="button"
            className="structure-brief-action-row"
            onClick={() => showStructure(index)}
            title={path}
          >
            <span className="structure-inspector-row-content">
              <span className="structure-inspector-row-label">Structure {index + 1}</span>
              <strong title={path}>{fileName(path)}</strong>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function sdfContextStyleStorageKey(document: ViewerDocument) {
  return `buret.sdf.contextStyle.${document.id}`;
}

function sdfContextOpacityStorageKey(document: ViewerDocument) {
  return `buret.sdf.contextOpacity.${document.id}`;
}

function normalizeSdfContextStyle(value: string | null | undefined): SdfContextStyle {
  return normalizeContextStyleForOptions(value, SDF_CONTEXT_STYLE_OPTIONS);
}

function normalizeStructureSceneStyle(value: SdfContextStyle): SdfContextStyle {
  return normalizeContextStyleForOptions(value, STRUCTURE_SCENE_STYLE_OPTIONS);
}

function normalizeContextStyleForOptions(
  value: string | null | undefined,
  styleOptions: ReadonlyArray<{ value: SdfContextStyle; label: string }>,
): SdfContextStyle {
  return styleOptions.some((option) => option.value === value) ? value as SdfContextStyle : "line";
}

function normalizeSdfContextOpacity(value: string | number | null | undefined) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return SDF_CONTEXT_OPACITY_DEFAULT;
  return clampOpacity(opacity, SDF_CONTEXT_OPACITY_MIN, SDF_CONTEXT_OPACITY_MAX);
}

function clampOpacity(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readSdfContextStylePreference(
  document: ViewerDocument,
  styleOptions: ReadonlyArray<{ value: SdfContextStyle; label: string }> = SDF_CONTEXT_STYLE_OPTIONS,
): SdfContextStyle {
  try {
    return normalizeContextStyleForOptions(window.localStorage?.getItem(sdfContextStyleStorageKey(document)), styleOptions);
  } catch (_) {
    return "line";
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

function SdfContextStyleCard({
  document,
  actions,
  value,
  setValue,
  opacity,
  setOpacity,
  title = "All background",
  detail = "Context molecules",
  ariaLabel = "All background style",
  opacityLabel = "All background opacity",
  styleOptions = SDF_CONTEXT_STYLE_OPTIONS,
  opacityMin = SDF_CONTEXT_OPACITY_MIN,
  opacityMax = SDF_CONTEXT_OPACITY_MAX,
  opacityDisabled = false,
}: {
  document: ViewerDocument;
  actions: ShellActions;
  value: SdfContextStyle;
  setValue: (value: SdfContextStyle) => void;
  opacity: number;
  setOpacity: (value: number) => void;
  title?: string;
  detail?: string;
  ariaLabel?: string;
  opacityLabel?: string;
  styleOptions?: ReadonlyArray<{ value: SdfContextStyle; label: string }>;
  opacityMin?: number;
  opacityMax?: number;
  opacityDisabled?: boolean;
}) {
  const applyStyle = (style: SdfContextStyle) => {
    setValue(style);
    writeSdfContextStylePreference(document, style);
    actions.runStructureViewerAction(document, {
      type: "set_sdf_context_style",
      label: `${title}: ${styleOptions.find((option) => option.value === style)?.label ?? style}`,
      notify: false,
      style,
    });
  };
  const applyOpacity = (nextOpacity: number) => {
    const normalized = clampOpacity(nextOpacity, opacityMin, opacityMax);
    setOpacity(normalized);
    writeSdfContextOpacityPreference(document, normalized);
    actions.runStructureViewerAction(document, {
      type: "set_sdf_context_opacity",
      label: `All background opacity: ${Math.round(normalized * 100)}%`,
      notify: false,
      opacity: normalized,
    });
  };
  return (
    <section className="structure-brief-card structure-inspector-context-style">
      <StructureSectionHeader title={title} detail={detail} />
      <div className="structure-inspector-style-options" role="group" aria-label={ariaLabel}>
        {styleOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className="structure-inspector-style-option"
            data-selected={option.value === value || undefined}
            aria-pressed={option.value === value}
            onClick={() => applyStyle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {opacityDisabled ? null : (
        <label className="structure-inspector-opacity-control">
          <span>Opacity</span>
          <input
            type="range"
            min={opacityMin}
            max={opacityMax}
            step="0.01"
            value={opacity}
            aria-label={opacityLabel}
            onInput={(event) => applyOpacity(Number(event.currentTarget.value))}
          />
          <strong>{Math.round(opacity * 100)}%</strong>
        </label>
      )}
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
    void readInspectorStructureText(document)
      .then((text) => {
        if (cancelled) return;
        setState({
          documentId: document.id,
          loading: false,
          summary: parseStructureComposition(text, inspectorCompositionExtension(document)),
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

function readInspectorStructureText(document: ViewerDocument) {
  const maxBytes = compositionReadLimit(document);
  const virtualText = document.virtual ? readBrowserDevVirtualTextDocument(document.path) : null;
  if (virtualText !== null) {
    return Promise.resolve(maxBytes === undefined ? virtualText : virtualText.slice(0, maxBytes));
  }
  return readStructureText(inspectorCompositionPath(document), { maxBytes });
}

function inspectorCompositionPath(document: ViewerDocument) {
  return document.dockingRequest?.receptorPath ?? document.path;
}

function inspectorCompositionExtension(document: ViewerDocument) {
  if (!document.dockingRequest) return document.extension;
  return extensionFromPath(document.dockingRequest.receptorPath) || document.extension;
}

function extensionFromPath(path: string) {
  const file = fileName(path);
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(dot + 1).toLowerCase() : "";
}

function compositionReadLimit(document: ViewerDocument) {
  const extension = document.extension.toLowerCase();
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

function SelectedEntityCard({
  selectedEntity,
  clearSelection,
}: {
  selectedEntity: SelectedStructureRow;
  clearSelection: () => void;
}) {
  const copyIdentity = () => void navigator.clipboard?.writeText(`${selectedEntity.row.label}: ${selectedEntity.row.value}`);
  return (
    <section className="structure-brief-card structure-inspector-selected-card">
      <StructureSectionHeader title="Selected entity" detail={selectedEntity.group} />
      <div className="structure-inspector-selection-pill">
        <span>Selected</span>
        <strong>{selectedEntity.row.label}</strong>
        <button type="button" className="structure-inspector-inline-action" onClick={clearSelection}>
          Clear
        </button>
      </div>
      <div className="structure-inspector-selected-meta">
        <span>{selectedEntity.row.value}</span>
        <span>{actionTypeLabel(selectedEntity.action)}</span>
        <span>{selectorLabel(selectedEntity.action)}</span>
      </div>
      <div className="structure-brief-actions structure-brief-actions-secondary">
        <button type="button" className="dock-action" onClick={copyIdentity}>
          Copy id
        </button>
      </div>
    </section>
  );
}

function actionTypeLabel(action: StructureViewerAction) {
  if (action.type === "focus_ligand") return "Focus in 3D";
  if (action.type === "set_sdf_molecule") return "Show molecule";
  if (action.type === "select_residues") return "Residues";
  if (action.type === "hide_waters") return "Hide water";
  if (action.type === "show_waters") return "Show water";
  if (action.type === "hide_components") return `Hide ${action.kind}`;
  if (action.type === "show_components") return `Show ${action.kind}`;
  return action.label;
}

function selectorLabel(action: StructureViewerAction) {
  if (action.type === "set_sdf_molecule") return `Molecule ${action.index + 1}`;
  if (!("selector" in action)) return "Scene action";
  const chain = valueFromSelector(action.selector, "auth_asym_id") ?? valueFromSelector(action.selector, "label_asym_id");
  const seq = valueFromSelector(action.selector, "auth_seq_id") ?? valueFromSelector(action.selector, "label_seq_id");
  const comp = valueFromSelector(action.selector, "label_comp_id") ?? valueFromSelector(action.selector, "auth_comp_id");
  const kind = valueFromSelector(action.selector, "kind");
  return [comp, chain, seq, kind && `kind ${kind}`].filter(Boolean).join(" ") || "Selector";
}

function valueFromSelector(selector: Record<string, string | number | Array<string | number>>, key: string) {
  const value = selector[key];
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null) return null;
  return String(value);
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

function fileName(path: string) {
  return path.split(/[\\/]/u).pop() || path;
}

function StructureActionList({
  rows,
  document,
  actions,
  activeActionKey,
  setActiveActionKey,
  compact = false,
}: {
  rows: StructureSummaryRow[];
  document: ViewerDocument;
  actions: ShellActions;
  activeActionKey: string | null;
  setActiveActionKey: (key: string | null) => void;
  compact?: boolean;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
  };

  return (
    <div className={compact ? "structure-brief-chip-list" : "structure-brief-rows"} onKeyDown={handleKeyDown}>
      {rows.map((row, index) => (
        <StructureActionRow
          key={structureActionRowKey(row, index)}
          row={row}
          document={document}
          actions={actions}
          activeActionKey={activeActionKey}
          setActiveActionKey={setActiveActionKey}
          compact={compact}
        />
      ))}
    </div>
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
}: {
  row: StructureSummaryRow;
  document: ViewerDocument;
  actions: ShellActions;
  activeActionKey: string | null;
  setActiveActionKey: (key: string | null) => void;
  compact: boolean;
}) {
  const content = () => (
    <span className="structure-inspector-row-content">
      <span className="structure-inspector-row-label">{row.label}</span>
      <strong title={row.value}>{row.value}</strong>
    </span>
  );
  if (!row.action) {
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
      <div className="structure-brief-action-entry" data-actions="pair" data-selected={selected || undefined} onContextMenu={showContextMenu}>
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
    <div className="structure-brief-action-entry" data-selected={selected || undefined} onContextMenu={showContextMenu}>
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
  actions,
}: {
  brief: ReturnType<typeof structureBriefForDocument>;
  compositionSummary: StructureCompositionSummary | null;
  compositionPending: boolean;
  compositionError: string | null;
  document: ViewerDocument;
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

        <StructureSectionHeader title="Source affordances" detail="Source text stays available in the Text dock tab." />
        <div className="structure-brief-rows">
          {brief.usefulRows.map((row) => (
            <StructureBriefRow key={row.label} label={row.label} value={row.value} />
          ))}
        </div>

        <StructureSectionHeader title="Notes" />
        <div className="structure-brief-notes">
          {[...compositionNotes(compositionSummary, compositionPending, compositionError), ...brief.notes].map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>

        <div className="structure-brief-actions">
          <button type="button" className="dock-action" onClick={() => void actions.showDocumentMetadata(document)}>
            Show metadata
          </button>
          <button type="button" className="dock-action" onClick={() => void actions.revealDocument(document)}>
            Reveal file
          </button>
          <button type="button" className="dock-action" onClick={() => void actions.copyDocumentPath(document)}>
            Copy path
          </button>
        </div>
      </div>
    </details>
  );
}

function selectionActionKey(document: ViewerDocument, action: StructureViewerAction) {
  if (action.type === "set_sdf_molecule") return JSON.stringify([document.id, action.type, action.index]);
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
