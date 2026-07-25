import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { hasFoldingResultContent, readFoldingResultBundle } from "../lib/folding-results";
import { readStructureText } from "../lib/structure-text";
import type { FoldingArtifact, FoldingMatrixPreview, FoldingModel, FoldingProfile, FoldingResultBundle, ViewerDocument } from "../types";
import { formatBytes } from "./format";
import type { ShellActions } from "./types";

type FoldingResultState = {
  bundle: FoldingResultBundle | null;
  loading: boolean;
  error: string | null;
};

type PlotlyModule = {
  react: (element: HTMLElement, traces: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
  purge: (element: HTMLElement) => void;
  Plots?: {
    resize?: (element: HTMLElement) => Promise<unknown> | unknown;
  };
};

type SelectedMatrixCell = {
  xLabel: string;
  yLabel: string;
  value: number;
};

const ABCFOLD_PAE_COLORSCALE = [
  [0, "#1b4223"],
  [0.125, "#2c5f36"],
  [0.25, "#3f794b"],
  [0.375, "#559262"],
  [0.5, "#6eaa7a"],
  [0.625, "#89c094"],
  [0.75, "#a7d4b0"],
  [0.875, "#c8e6ce"],
  [1, "#ebf7ed"],
];
const PAE_PLOT_MARGIN = { l: 34, r: 42, t: 8, b: 30 };
const RESIDUE_ONE_LETTER: Record<string, string> = {
  ALA: "A",
  ARG: "R",
  ASN: "N",
  ASP: "D",
  CYS: "C",
  GLN: "Q",
  GLU: "E",
  GLY: "G",
  HIS: "H",
  ILE: "I",
  LEU: "L",
  LYS: "K",
  MET: "M",
  PHE: "F",
  PRO: "P",
  SER: "S",
  THR: "T",
  TRP: "W",
  TYR: "Y",
  VAL: "V",
  SEC: "U",
  PYL: "O",
};

type ChainSequence = {
  chainId: string;
  sequence: string;
  residueNumbers: string[];
};

type SelectedResidue = {
  chainId: string;
  residueNumber: string;
  index: number;
};

type ResidueDragSelection = {
  chainId: string;
  startIndex: number;
  currentIndex: number;
  source: "mouse" | "pointer";
  pointerId?: number;
  moved: boolean;
};

export function useFoldingResult(document: ViewerDocument | null): FoldingResultState {
  const [bundle, setBundle] = useState<FoldingResultBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sourcePath = document?.sourcePath || document?.path || null;
    if (!sourcePath || document?.virtual) {
      setBundle(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void readFoldingResultBundle(sourcePath)
      .then((nextBundle) => {
        if (cancelled) return;
        setBundle(hasFoldingResultContent(nextBundle) ? nextBundle : null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setBundle(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [document?.id, document?.path, document?.sourcePath, document?.virtual]);

  return { bundle, loading, error };
}

export function FoldingResultsPanel({ state, actions }: { state: FoldingResultState; actions: ShellActions }) {
  const bundle = state.bundle;
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setActiveModelId(bundle?.models[0]?.id ?? null);
  }, [bundle?.rootPath]);

  useEffect(() => {
    setCollapsed(false);
  }, [bundle?.rootPath]);

  const activeModel = useMemo(() => {
    if (!bundle?.models.length) return null;
    return bundle.models.find((model) => model.id === activeModelId) ?? bundle.models[0] ?? null;
  }, [activeModelId, bundle]);

  if (!bundle || !activeModel) {
    return null;
  }

  const selectModel = (model: FoldingModel) => {
    setActiveModelId(model.id);
    if (model.structurePath !== activeModel.structurePath) void actions.openStructurePaths([model.structurePath]);
  };

  return (
    <section className="structure-brief-card structure-inspector-section folding-results-card" data-collapsed={collapsed || undefined}>
      <div className="structure-inspector-section-header">
        <button
          type="button"
          className="structure-inspector-section-title-button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          Folding Results
        </button>
        <span>{bundle.source} · {modelCountLabel(bundle.models.length)}</span>
      </div>

      {collapsed ? null : (
        <div className="folding-results-body">
          <FoldingModelSelector models={bundle.models} activeModel={activeModel} onSelect={selectModel} />

          <div className="folding-model-summary">
            <div>
              <strong>{activeModel.title}</strong>
              <span title={activeModel.structureTitle}>{activeModel.structureTitle}</span>
            </div>
            <Button type="button" variant="outline" size="xs" onClick={() => actions.openStructurePaths([activeModel.structurePath])}>
              Open
            </Button>
          </div>
          {activeModel.matrixPreview ? (
            <Button type="button" variant="secondary" size="sm" className="folding-full-pae-button w-full" onClick={() => actions.openDockTab("bottom", "folding")}>
              Full PAE
            </Button>
          ) : null}

          {activeModel.metrics.length ? (
            <div className="structure-inspector-xtb-metrics folding-metric-grid">
              {activeModel.metrics.slice(0, 8).map((metric) => (
                <div key={metric.key} className="structure-inspector-xtb-metric">
                  <span>{metric.label}</span>
                  <strong>{metric.formatted || formatMetric(metric.value)}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {activeModel.plddtProfile ? <FoldingPlddtPlot profile={activeModel.plddtProfile} /> : null}
          {activeModel.matrixPreview ? <FoldingMatrixHeatmap preview={activeModel.matrixPreview} /> : null}

          {activeModel.artifacts.length ? (
            <div className="structure-inspector-xtb-file-groups">
              <div className="structure-inspector-xtb-file-group">
                <strong>Artifacts</strong>
                <div>
                  {activeModel.artifacts.slice(0, 12).map((artifact) => (
                    <button
                      key={artifact.path}
                      type="button"
                      className="dock-action structure-inspector-xtb-file-button"
                      title={`${artifact.title} · ${formatBytes(artifact.byteCount)}`}
                      onClick={() => openFoldingArtifact(artifact, actions)}
                    >
                      <span>{artifactKindLabel(artifact.kind)}</span>
                      <span>{artifact.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {bundle.warnings.length ? (
            <div className="folding-warning-list">
              {bundle.warnings.slice(0, 3).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function FoldingAnalysisPanel({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const state = useFoldingResult(document);
  const bundle = state.bundle;
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [selectedResidues, setSelectedResidues] = useState<SelectedResidue[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectedResidue | null>(null);

  useEffect(() => {
    setActiveModelId(bundle?.models[0]?.id ?? null);
  }, [bundle?.rootPath]);

  const activeModel = useMemo(() => {
    if (!bundle?.models.length) return null;
    return bundle.models.find((model) => model.id === activeModelId) ?? bundle.models[0] ?? null;
  }, [activeModelId, bundle]);
  const sequences = useStructureSequences(activeModel?.structurePath ?? null);

  useEffect(() => {
    setSelectedResidues([]);
    setSelectionAnchor(null);
  }, [activeModel?.id]);

  const applyResidueSelection = (nextSelection: SelectedResidue[]) => {
    setSelectedResidues(nextSelection);
    if (!document) return;
    if (!nextSelection.length) {
      actions.runStructureViewerAction(document, { type: "clear_selection", label: "Clear folding residue selection", notify: false });
      return;
    }
    actions.runStructureViewerAction(document, {
      type: "select_residues",
      label: selectedResiduesLabel(nextSelection),
      notify: false,
      selector: residueSelectionSelector(nextSelection),
      granularity: "residue",
      mode: "replace",
    });
  };

  if (state.loading) {
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">Loading folding results</div>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">Folding results failed to load</div>
      </div>
    );
  }
  if (!bundle || !activeModel) {
    return (
      <div className="dock-content dock-content-empty">
        <div className="dock-empty dock-empty-large">Open a folding result model to inspect PAE</div>
      </div>
    );
  }

  const selectModel = (model: FoldingModel) => {
    setActiveModelId(model.id);
    if (model.structurePath !== activeModel.structurePath) void actions.openStructurePaths([model.structurePath]);
  };

  return (
    <div className="folding-analysis-panel">
      <div className="folding-analysis-header">
        <div>
          <strong>{activeModel.title}</strong>
          <span>{bundle.source} · {modelCountLabel(bundle.models.length)}</span>
        </div>
        <div className="folding-analysis-actions">
          <Button type="button" variant="secondary" size="sm" onClick={() => actions.openStructurePaths([activeModel.structurePath])}>
            Open model
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => actions.revealPath(bundle.rootPath, "Folding result")}>
            Reveal bundle
          </Button>
        </div>
      </div>

      <FoldingModelSelector models={bundle.models} activeModel={activeModel} onSelect={selectModel} />

      {/* This panel is what the "Full PAE" button opens and what its own empty
          state promises, but the matrix was never rendered here - only the
          thumbnail in the side card. The large size was already designed for it. */}
      {activeModel.matrixPreview ? (
        <FoldingMatrixHeatmap preview={activeModel.matrixPreview} size="large" />
      ) : (
        <div className="dock-empty">This model has no PAE matrix.</div>
      )}

      <FoldingSequenceStrip
        sequences={sequences}
        selectedResidues={selectedResidues}
        onClearSelection={() => {
          applyResidueSelection([]);
          setSelectionAnchor(null);
        }}
        onSelectResidue={(chain, residueNumber, _residue, index, options) => {
          const selectedResidue = { chainId: chain.chainId, residueNumber, index };
          const nextSelection = options?.rangeFromAnchor && selectionAnchor?.chainId === chain.chainId
            ? mergeResidueRange(selectedResidues, chain, selectionAnchor.index, index)
            : toggleResidueSelection(selectedResidues, selectedResidue);
          setSelectionAnchor(nextSelection.length ? selectedResidue : null);
          applyResidueSelection(nextSelection);
        }}
        onSelectResidueRange={(chain, startIndex, targetIndex) => {
          const nextSelection = replaceResidueRange(chain, startIndex, targetIndex);
          const anchorResidue = nextSelection.find((residue) => residue.index === startIndex) ?? nextSelection[0] ?? null;
          setSelectionAnchor(anchorResidue);
          applyResidueSelection(nextSelection);
        }}
      />
    </div>
  );
}

function FoldingModelSelector({
  models,
  activeModel,
  onSelect,
}: {
  models: FoldingModel[];
  activeModel: FoldingModel;
  onSelect: (model: FoldingModel) => void;
}) {
  return (
    <div className="folding-model-selector">
      <label>
        <span>Model / seed</span>
        <NativeSelect
          className="settings-select w-full"
          size="sm"
          value={activeModel.id}
          disabled={models.length <= 1}
          aria-label="Folding model or seed"
          onChange={(event) => {
            const model = models.find((candidate) => candidate.id === event.currentTarget.value);
            if (model && model.id !== activeModel.id) onSelect(model);
          }}
        >
          {models.map((model) => (
            <NativeSelectOption key={model.id} value={model.id}>
              {modelOptionLabel(model)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <span className="folding-model-selector-count">{modelAvailabilityLabel(models.length)}</span>
    </div>
  );
}

function FoldingPlddtPlot({ profile }: { profile: FoldingProfile }) {
  const plotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let plotly: PlotlyModule | null = null;
    const element = plotRef.current;
    if (!element) return;
    void import("plotly.js-basic-dist-min")
      .then((module) => {
        if (cancelled || !plotRef.current) return;
        plotly = module.default as PlotlyModule;
        const x = profile.values.map((_, index) => index + 1);
        return plotly.react(
          plotRef.current,
          [{
            type: "scatter",
            mode: "lines",
            x,
            y: profile.values,
            line: { color: "#2f6fed", width: 2 },
            hovertemplate: "Residue %{x}<br>pLDDT %{y:.1f}<extra></extra>",
          }],
          {
            margin: { l: 34, r: 10, t: 8, b: 24 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            xaxis: { title: "", zeroline: false, showgrid: false, tickfont: { size: 10, color: "rgba(128,128,128,0.9)" } },
            yaxis: { range: [0, 100], zeroline: false, gridcolor: "rgba(128,128,128,0.18)", tickfont: { size: 10, color: "rgba(128,128,128,0.9)" } },
            showlegend: false,
          },
          { displayModeBar: false, responsive: true },
        );
      })
      .catch(() => {});
    const observer = new ResizeObserver(() => {
      if (plotRef.current && plotly?.Plots?.resize) void plotly.Plots.resize(plotRef.current);
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (element && plotly) plotly.purge(element);
    };
  }, [profile]);

  return (
    <div className="folding-chart-panel">
      <div className="folding-chart-title">
        <strong>pLDDT</strong>
        <span>mean {profile.mean.toFixed(1)} · range {profile.min.toFixed(1)}-{profile.max.toFixed(1)}</span>
      </div>
      <div ref={plotRef} className="folding-plddt-plot" />
    </div>
  );
}

function FoldingMatrixHeatmap({ preview, size = "compact" }: { preview: FoldingMatrixPreview; size?: "compact" | "large" }) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedMatrixCell | null>(null);

  useEffect(() => {
    let cancelled = false;
    let plotly: PlotlyModule | null = null;
    const element = plotRef.current;
    if (!element || !preview.values.length || !preview.values[0]?.length) return;
    const rows = preview.values.length;
    const cols = preview.values[0].length;
    const x = Array.from({ length: cols }, (_, index) => index + 1);
    const y = Array.from({ length: rows }, (_, index) => index + 1);
    const xLabels = matrixAxisLabels(preview.xLabels, cols);
    const yLabels = matrixAxisLabels(preview.yLabels, rows);
    const customdata = preview.values.map((row, rowIndex) =>
      row.map((_, colIndex) => [xLabels[colIndex], yLabels[rowIndex]]),
    );
    const handleMatrixClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(".modebar")) return;
      const rect = element.getBoundingClientRect();
      const plotWidth = rect.width - PAE_PLOT_MARGIN.l - PAE_PLOT_MARGIN.r;
      const plotHeight = rect.height - PAE_PLOT_MARGIN.t - PAE_PLOT_MARGIN.b;
      if (plotWidth <= 0 || plotHeight <= 0) return;
      const plotX = event.clientX - rect.left - PAE_PLOT_MARGIN.l;
      const plotY = event.clientY - rect.top - PAE_PLOT_MARGIN.t;
      if (plotX < 0 || plotY < 0 || plotX > plotWidth || plotY > plotHeight) return;
      const colIndex = Math.max(0, Math.min(cols - 1, Math.floor(plotX / plotWidth * cols)));
      const rowIndex = Math.max(0, Math.min(rows - 1, Math.floor(plotY / plotHeight * rows)));
      const value = preview.values[rowIndex]?.[colIndex];
      if (typeof value !== "number") {
        setSelectedCell(null);
        return;
      }
      setSelectedCell({ xLabel: xLabels[colIndex], yLabel: yLabels[rowIndex], value });
    };
    element.addEventListener("click", handleMatrixClick);
    void import("plotly.js-basic-dist-min")
      .then((module) => {
        if (cancelled || !plotRef.current) return;
        plotly = module.default as PlotlyModule;
        return plotly.react(
          plotRef.current,
          [{
            type: "heatmap",
            x,
            y,
            z: preview.values,
            customdata,
            zmin: 0,
            zmax: preview.max ?? undefined,
            colorscale: ABCFOLD_PAE_COLORSCALE,
            hoverongaps: false,
            hovertemplate: "Scored %{customdata[0]}<br>Aligned %{customdata[1]}<br>PAE %{z:.2f} A<extra></extra>",
            colorbar: {
              title: { text: "PAE", side: "right" },
              thickness: 8,
              len: 0.82,
              tickfont: { size: 10, color: "rgba(128,128,128,0.9)" },
            },
          }],
          {
            margin: PAE_PLOT_MARGIN,
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            xaxis: {
              range: [0.5, cols + 0.5],
              tickmode: "array",
              ...matrixAxisTicks(xLabels),
              showgrid: false,
              zeroline: false,
              tickfont: { size: 10, color: "rgba(128,128,128,0.9)" },
            },
            yaxis: {
              range: [rows + 0.5, 0.5],
              tickmode: "array",
              ...matrixAxisTicks(yLabels),
              showgrid: false,
              zeroline: false,
              tickfont: { size: 10, color: "rgba(128,128,128,0.9)" },
            },
            shapes: matrixBoundaryShapes(xLabels, yLabels, rows, cols),
            showlegend: false,
          },
          { displayModeBar: true, displaylogo: false, responsive: true },
        );
      })
      .catch(() => {});
    const observer = new ResizeObserver(() => {
      if (plotRef.current && plotly?.Plots?.resize) void plotly.Plots.resize(plotRef.current);
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      element.removeEventListener("click", handleMatrixClick);
      if (element && plotly) plotly.purge(element);
    };
  }, [preview]);

  return (
    <div className="folding-chart-panel">
      <div className="folding-chart-title">
        <strong>{preview.label}</strong>
        <span>{preview.shape.join(" x ")} · mean {preview.mean === null || preview.mean === undefined ? "-" : preview.mean.toFixed(2)}</span>
      </div>
      <div ref={plotRef} className="folding-matrix-heatmap" data-size={size} aria-label={`${preview.label} heatmap`} />
      {selectedCell ? (
        <div className="folding-matrix-status">
          {selectedCell.yLabel} / {selectedCell.xLabel}: {selectedCell.value.toFixed(2)} A
        </div>
      ) : null}
    </div>
  );
}

function useStructureSequences(path: string | null): ChainSequence[] {
  const [sequences, setSequences] = useState<ChainSequence[]>([]);
  useEffect(() => {
    if (!path) {
      setSequences([]);
      return;
    }
    let cancelled = false;
    void readStructureText(path, { maxBytes: 8_000_000 })
      .then((text) => {
        if (!cancelled) setSequences(parseStructureSequences(text));
      })
      .catch(() => {
        if (!cancelled) setSequences([]);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return sequences;
}

function FoldingSequenceStrip({
  sequences,
  selectedResidues,
  onClearSelection,
  onSelectResidue,
  onSelectResidueRange,
}: {
  sequences: ChainSequence[];
  selectedResidues?: SelectedResidue[];
  onClearSelection?: () => void;
  onSelectResidue?: (chain: ChainSequence, residueNumber: string, residue: string, index: number, options?: { rangeFromAnchor?: boolean }) => void;
  onSelectResidueRange?: (chain: ChainSequence, startIndex: number, targetIndex: number) => void;
}) {
  const dragSelectionRef = useRef<ResidueDragSelection | null>(null);
  const [dragSelection, setDragSelection] = useState<ResidueDragSelection | null>(null);
  const selectedResidueKeys = useMemo(
    () => new Set((selectedResidues ?? []).map(residueSelectionKey)),
    [selectedResidues],
  );
  const setActiveDragSelection = (selection: ResidueDragSelection | null) => {
    dragSelectionRef.current = selection;
    setDragSelection(selection);
  };
  const residueIndexFromPoint = (clientX: number, clientY: number, chain: ChainSequence) => {
    const element = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLButtonElement>(".folding-sequence-residue");
    if (!element || element.dataset.chainId !== chain.chainId) return null;
    const index = Number(element.dataset.residueIndex);
    return Number.isInteger(index) && index >= 0 && index < chain.sequence.length ? index : null;
  };
  const residueIndexFromPointer = (event: ReactPointerEvent<HTMLElement>, chain: ChainSequence) => (
    residueIndexFromPoint(event.clientX, event.clientY, chain)
  );
  const residueIndexFromMouse = (event: ReactMouseEvent<HTMLElement>, chain: ChainSequence) => (
    residueIndexFromPoint(event.clientX, event.clientY, chain)
  );
  const updateDragRange = (chain: ChainSequence, index: number) => {
    const current = dragSelectionRef.current;
    if (!current || current.chainId !== chain.chainId) return;
    const moved = current.moved || index !== current.startIndex;
    if (current.currentIndex === index && current.moved === moved) return;
    setActiveDragSelection({ ...current, currentIndex: index, moved });
    if (moved) onSelectResidueRange?.(chain, current.startIndex, index);
  };
  useEffect(() => {
    if (!dragSelection) return;
    const clearDragSelection = () => setActiveDragSelection(null);
    window.addEventListener("pointerup", clearDragSelection);
    window.addEventListener("pointercancel", clearDragSelection);
    window.addEventListener("mouseup", clearDragSelection);
    return () => {
      window.removeEventListener("pointerup", clearDragSelection);
      window.removeEventListener("pointercancel", clearDragSelection);
      window.removeEventListener("mouseup", clearDragSelection);
    };
  }, [dragSelection]);
  if (!sequences.length) return null;
  return (
    <div className="folding-sequence-strip">
      {sequences.slice(0, 4).map((chain) => (
        <div key={chain.chainId} className="folding-sequence-chain">
          <div className="folding-sequence-chain-title">Chain-{chain.chainId} ({chain.sequence.length} aa)</div>
          <div className="folding-sequence-ruler">
            {sequenceTicks(chain.residueNumbers).map((tick) => (
              <span key={`${chain.chainId}-${tick.index}`} style={{ left: `${tick.percent}%` }}>{tick.label}</span>
            ))}
          </div>
          <div
            className="folding-sequence-text"
            role="list"
            aria-label={`Chain-${chain.chainId} residues`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              if (dragSelectionRef.current) return;
              const index = residueIndexFromPointer(event, chain);
              if (index === null) return;
              event.preventDefault();
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Pointer capture is best-effort; drag selection still works without it inside the strip.
              }
              setActiveDragSelection({
                chainId: chain.chainId,
                startIndex: index,
                currentIndex: index,
                source: "pointer",
                pointerId: event.pointerId,
                moved: false,
              });
            }}
            onPointerMove={(event) => {
              const current = dragSelectionRef.current;
              if (!current || current.source !== "pointer" || current.pointerId !== event.pointerId || current.chainId !== chain.chainId) return;
              const index = residueIndexFromPointer(event, chain);
              if (index === null) return;
              event.preventDefault();
              updateDragRange(chain, index);
            }}
            onPointerUp={(event) => {
              const current = dragSelectionRef.current;
              if (!current || current.source !== "pointer" || current.pointerId !== event.pointerId || current.chainId !== chain.chainId) return;
              event.preventDefault();
              try {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              } catch {
                // Ignore stale pointer capture state from cancelled synthetic events.
              }
              const targetIndex = residueIndexFromPointer(event, chain) ?? current.currentIndex;
              if (current.moved || targetIndex !== current.startIndex) {
                onSelectResidueRange?.(chain, current.startIndex, targetIndex);
              } else {
                const residueNumber = chain.residueNumbers[targetIndex] ?? String(targetIndex + 1);
                const residue = chain.sequence[targetIndex] ?? "";
                onSelectResidue?.(chain, residueNumber, residue, targetIndex, { rangeFromAnchor: event.shiftKey });
              }
              setActiveDragSelection(null);
            }}
            onPointerCancel={(event) => {
              const current = dragSelectionRef.current;
              if (!current || current.source !== "pointer" || current.pointerId !== event.pointerId) return;
              setActiveDragSelection(null);
            }}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              if (dragSelectionRef.current) return;
              const index = residueIndexFromMouse(event, chain);
              if (index === null) return;
              event.preventDefault();
              setActiveDragSelection({
                chainId: chain.chainId,
                startIndex: index,
                currentIndex: index,
                source: "mouse",
                moved: false,
              });
            }}
            onMouseMove={(event) => {
              const current = dragSelectionRef.current;
              if (!current || current.chainId !== chain.chainId) return;
              if ((event.buttons & 1) !== 1) {
                setActiveDragSelection(null);
                return;
              }
              const index = residueIndexFromMouse(event, chain);
              if (index === null) return;
              event.preventDefault();
              updateDragRange(chain, index);
            }}
            onMouseUp={(event) => {
              const current = dragSelectionRef.current;
              if (!current || current.chainId !== chain.chainId) return;
              event.preventDefault();
              const targetIndex = residueIndexFromMouse(event, chain) ?? current.currentIndex;
              if (current.moved || targetIndex !== current.startIndex) {
                onSelectResidueRange?.(chain, current.startIndex, targetIndex);
              } else {
                const residueNumber = chain.residueNumbers[targetIndex] ?? String(targetIndex + 1);
                const residue = chain.sequence[targetIndex] ?? "";
                onSelectResidue?.(chain, residueNumber, residue, targetIndex, { rangeFromAnchor: event.shiftKey });
              }
              setActiveDragSelection(null);
            }}
          >
            {Array.from(chain.sequence).map((residue, index) => {
              const residueNumber = chain.residueNumbers[index] ?? String(index + 1);
              const dragSelected = dragSelection?.chainId === chain.chainId
                && index >= Math.min(dragSelection.startIndex, dragSelection.currentIndex)
                && index <= Math.max(dragSelection.startIndex, dragSelection.currentIndex);
              const selected = dragSelected || selectedResidueKeys.has(residueSelectionKey({ chainId: chain.chainId, residueNumber, index }));
              return (
                <button
                  key={`${chain.chainId}-${residueNumber}-${index}`}
                  type="button"
                  className="folding-sequence-residue"
                  data-selected={selected || undefined}
                  data-chain-id={chain.chainId}
                  data-residue-index={index}
                  aria-label={`Select Chain-${chain.chainId} residue ${residueNumber} ${residue}`}
                  aria-pressed={selected}
                  // Selection was driven entirely by elementFromPoint inside the
                  // container's pointer handlers, so these buttons looked focusable
                  // and did nothing on Enter or Space. A keyboard-generated click
                  // reports detail 0, which is what keeps this from firing a second
                  // selection after the pointer handlers have already made one.
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    onSelectResidue?.(chain, residueNumber, residue, index, { rangeFromAnchor: event.shiftKey });
                  }}
                >
                  {residue}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {selectedResidues?.length ? (
        <div className="folding-sequence-selection">
          <span>{selectedResidues.length} {selectedResidues.length === 1 ? "residue" : "residues"} selected</span>
          <Button type="button" variant="outline" size="xs" onClick={onClearSelection}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function sequenceTicks(residueNumbers: string[]) {
  if (!residueNumbers.length) return [];
  const step = Math.max(1, Math.ceil(residueNumbers.length / 5));
  const ticks = [];
  for (let index = 0; index < residueNumbers.length; index += step) {
    ticks.push({
      index,
      label: residueNumbers[index],
      percent: residueNumbers.length === 1 ? 0 : index / (residueNumbers.length - 1) * 100,
    });
  }
  const lastIndex = residueNumbers.length - 1;
  if (ticks[ticks.length - 1]?.index !== lastIndex) {
    ticks.push({ index: lastIndex, label: residueNumbers[lastIndex], percent: 100 });
  }
  return ticks;
}

function parseStructureSequences(text: string): ChainSequence[] {
  if (/^data_/imu.test(text) || text.includes("_atom_site.")) {
    const cifSequences = parseCifSequences(text);
    if (cifSequences.length) return cifSequences;
  }
  const pdbSequences = parsePdbSequences(text);
  if (pdbSequences.length) return pdbSequences;
  return parseCifSequences(text);
}

function parsePdbSequences(text: string): ChainSequence[] {
  const chains = new Map<string, { residues: string[]; residueNumbers: string[]; seen: Set<string> }>();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith("ATOM")) continue;
    const residueName = line.slice(17, 20).trim().toUpperCase();
    const residue = RESIDUE_ONE_LETTER[residueName];
    if (!residue) continue;
    const chainId = line.slice(21, 22).trim() || "A";
    const residueNumber = line.slice(22, 27).trim();
    const key = `${chainId}:${residueNumber}`;
    const chain = chains.get(chainId) ?? { residues: [], residueNumbers: [], seen: new Set<string>() };
    if (!chain.seen.has(key)) {
      chain.seen.add(key);
      chain.residues.push(residue);
      chain.residueNumbers.push(residueNumber || String(chain.residues.length));
      chains.set(chainId, chain);
    }
  }
  return chainSequencesFromMap(chains);
}

function parseCifSequences(text: string): ChainSequence[] {
  const lines = text.split(/\r?\n/u);
  const chains = new Map<string, { residues: string[]; residueNumbers: string[]; seen: Set<string> }>();
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "loop_") continue;
    const headers: string[] = [];
    let rowIndex = index + 1;
    while (rowIndex < lines.length && lines[rowIndex].trim().startsWith("_")) {
      headers.push(lines[rowIndex].trim());
      rowIndex += 1;
    }
    const groupIndex = headers.indexOf("_atom_site.group_PDB");
    const residueIndex = headers.indexOf("_atom_site.label_comp_id");
    const chainIndex = firstHeaderIndex(headers, ["_atom_site.label_asym_id", "_atom_site.auth_asym_id"]);
    const sequenceIndex = firstHeaderIndex(headers, ["_atom_site.label_seq_id", "_atom_site.auth_seq_id"]);
    if (groupIndex < 0 || residueIndex < 0 || chainIndex < 0 || sequenceIndex < 0) continue;
    while (rowIndex < lines.length) {
      const line = lines[rowIndex].trim();
      if (!line || line === "#" || line === "loop_" || line.startsWith("_")) break;
      const fields = tokenizeCifRow(line);
      const group = fields[groupIndex];
      if (group === "ATOM") {
        const residueName = fields[residueIndex]?.toUpperCase();
        const residue = RESIDUE_ONE_LETTER[residueName];
        if (residue) {
          const chainId = fields[chainIndex] && fields[chainIndex] !== "." ? fields[chainIndex] : "A";
          const residueNumber = fields[sequenceIndex] && fields[sequenceIndex] !== "." ? fields[sequenceIndex] : "";
          const key = `${chainId}:${residueNumber}`;
          const chain = chains.get(chainId) ?? { residues: [], residueNumbers: [], seen: new Set<string>() };
          if (!chain.seen.has(key)) {
            chain.seen.add(key);
            chain.residues.push(residue);
            chain.residueNumbers.push(residueNumber || String(chain.residues.length));
            chains.set(chainId, chain);
          }
        }
      }
      rowIndex += 1;
    }
  }
  return chainSequencesFromMap(chains);
}

function firstHeaderIndex(headers: string[], candidates: string[]) {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

function tokenizeCifRow(line: string) {
  const values: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current) {
        values.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current) values.push(current);
  return values;
}

function chainSequencesFromMap(chains: Map<string, { residues: string[]; residueNumbers: string[] }>) {
  return [...chains.entries()]
    .map(([chainId, chain]) => ({
      chainId,
      sequence: chain.residues.join(""),
      residueNumbers: chain.residueNumbers,
    }))
    .filter((chain) => chain.sequence.length > 0);
}

type ResidueSelectionSelectorValue =
  | string
  | number
  | Array<string | number>
  | Array<Record<string, string | number | Array<string | number>>>;

function residueSelectionSelector(residues: SelectedResidue[]): Record<string, ResidueSelectionSelectorValue> {
  const uniqueResidues = uniqueSelectedResidues(residues);
  if (uniqueResidues.length === 1) return singleResidueSelectionSelector(uniqueResidues[0]);
  const chains = new Set(uniqueResidues.map((residue) => residue.chainId));
  if (chains.size === 1) {
    const chainId = uniqueResidues[0]?.chainId ?? "A";
    const selector: Record<string, ResidueSelectionSelectorValue> = { kind: "polymer" };
    if (chainId && chainId !== "-") {
      selector.auth_asym_id = chainId;
      selector.label_asym_id = chainId;
    }
    const residueValues = uniqueResidueSelectorValues(uniqueResidues);
    selector.auth_seq_id = residueValues;
    selector.label_seq_id = residueValues;
    return selector;
  }
  return {
    kind: "polymer",
    residues: uniqueResidues.map(singleResidueSelectionSelector),
  };
}

function singleResidueSelectionSelector(residue: SelectedResidue): Record<string, string | number | Array<string | number>> {
  const selector: Record<string, string | number | Array<string | number>> = { kind: "polymer" };
  if (residue.chainId && residue.chainId !== "-") {
    selector.auth_asym_id = residue.chainId;
    selector.label_asym_id = residue.chainId;
  }
  const residueValues = residueSelectorValues(residue.residueNumber);
  selector.auth_seq_id = residueValues;
  selector.label_seq_id = residueValues;
  return selector;
}

function residueSelectorValues(residueNumber: string): Array<string | number> {
  const values: Array<string | number> = [];
  const trimmed = residueNumber.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) values.push(numeric);
  if (trimmed && !values.some((value) => String(value) === trimmed)) values.push(trimmed);
  return values.length ? values : [residueNumber];
}

function uniqueResidueSelectorValues(residues: SelectedResidue[]) {
  const values: Array<string | number> = [];
  const seen = new Set<string>();
  for (const residue of residues) {
    for (const value of residueSelectorValues(residue.residueNumber)) {
      const key = String(value);
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(value);
    }
  }
  return values;
}

function toggleResidueSelection(selectedResidues: SelectedResidue[], residue: SelectedResidue) {
  const key = residueSelectionKey(residue);
  const selected = selectedResidues.some((candidate) => residueSelectionKey(candidate) === key);
  if (selected) return selectedResidues.filter((candidate) => residueSelectionKey(candidate) !== key);
  return sortSelectedResidues([...selectedResidues, residue]);
}

function mergeResidueRange(selectedResidues: SelectedResidue[], chain: ChainSequence, anchorIndex: number, targetIndex: number) {
  const start = Math.max(0, Math.min(anchorIndex, targetIndex));
  const end = Math.min(chain.residueNumbers.length - 1, Math.max(anchorIndex, targetIndex));
  const byKey = new Map(selectedResidues.map((residue) => [residueSelectionKey(residue), residue]));
  for (let index = start; index <= end; index += 1) {
    const residue = { chainId: chain.chainId, residueNumber: chain.residueNumbers[index] ?? String(index + 1), index };
    byKey.set(residueSelectionKey(residue), residue);
  }
  return sortSelectedResidues([...byKey.values()]);
}

function replaceResidueRange(chain: ChainSequence, anchorIndex: number, targetIndex: number) {
  const start = Math.max(0, Math.min(anchorIndex, targetIndex));
  const end = Math.min(chain.residueNumbers.length - 1, Math.max(anchorIndex, targetIndex));
  const residues: SelectedResidue[] = [];
  for (let index = start; index <= end; index += 1) {
    residues.push({ chainId: chain.chainId, residueNumber: chain.residueNumbers[index] ?? String(index + 1), index });
  }
  return residues;
}

function sortSelectedResidues(residues: SelectedResidue[]) {
  return uniqueSelectedResidues(residues).sort((left, right) => (
    left.chainId.localeCompare(right.chainId, undefined, { numeric: true }) || left.index - right.index
  ));
}

function uniqueSelectedResidues(residues: SelectedResidue[]) {
  const byKey = new Map<string, SelectedResidue>();
  for (const residue of residues) byKey.set(residueSelectionKey(residue), residue);
  return [...byKey.values()];
}

function residueSelectionKey(residue: SelectedResidue) {
  return `${residue.chainId}\u0000${residue.residueNumber}\u0000${residue.index}`;
}

function selectedResiduesLabel(residues: SelectedResidue[]) {
  if (residues.length === 1) {
    const residue = residues[0];
    return `Select Chain-${residue.chainId} ${residue.residueNumber}`;
  }
  return `Select ${residues.length} folding residues`;
}

function openFoldingArtifact(artifact: FoldingArtifact, actions: ShellActions) {
  if (["pdb", "cif", "mmcif", "mcif", "bcif"].includes(artifact.extension)) {
    void actions.openStructurePaths([artifact.path]);
    return;
  }
  if (["json", "npz", "npy", "txt", "log", "pml", "html", "htm"].includes(artifact.extension)) {
    void actions.openTextPaths([artifact.path]);
    return;
  }
  void actions.openPaths([artifact.path]);
}

function modelOptionLabel(model: FoldingModel) {
  const parts = [model.backend];
  if (model.modelIndex !== null && model.modelIndex !== undefined) parts.push(`model ${model.modelIndex}`);
  if (model.seed !== null && model.seed !== undefined) parts.push(`seed ${model.seed}`);
  return parts.filter(Boolean).join(" / ") || model.title || model.structureTitle;
}

function modelCountLabel(count: number) {
  return `${count} ${count === 1 ? "model" : "models"}`;
}

function modelAvailabilityLabel(count: number) {
  return `${count} available`;
}

function artifactKindLabel(kind: string) {
  if (kind === "plddt") return "pLDDT";
  if (kind === "pae") return "PAE";
  if (kind === "pde") return "PDE";
  return kind;
}

function formatMetric(value: number) {
  if (Math.abs(value) >= 1000 || (value !== 0 && Math.abs(value) < 0.001)) return value.toExponential(3);
  return value.toFixed(3);
}

function matrixAxisLabels(labels: string[] | undefined, count: number) {
  if (labels?.length === count) return labels;
  return Array.from({ length: count }, (_, index) => String(index + 1));
}

function matrixAxisTicks(labels: string[]) {
  const step = Math.max(1, Math.ceil(labels.length / 6));
  const tickvals: number[] = [];
  const ticktext: string[] = [];
  for (let index = 0; index < labels.length; index += step) {
    tickvals.push(index + 1);
    ticktext.push(labels[index]);
  }
  if (tickvals[tickvals.length - 1] !== labels.length) {
    tickvals.push(labels.length);
    ticktext.push(labels[labels.length - 1]);
  }
  return { tickvals, ticktext };
}

function matrixBoundaryShapes(xLabels: string[], yLabels: string[], rows: number, cols: number) {
  const shapes: unknown[] = [];
  for (const boundary of chainBoundaries(xLabels)) {
    shapes.push({
      type: "line",
      x0: boundary,
      x1: boundary,
      y0: 0.5,
      y1: rows + 0.5,
      line: { color: "rgba(255,255,255,0.48)", width: 1 },
    });
  }
  for (const boundary of chainBoundaries(yLabels)) {
    shapes.push({
      type: "line",
      x0: 0.5,
      x1: cols + 0.5,
      y0: boundary,
      y1: boundary,
      line: { color: "rgba(255,255,255,0.48)", width: 1 },
    });
  }
  return shapes;
}

function chainBoundaries(labels: string[]) {
  const boundaries: number[] = [];
  for (let index = 1; index < labels.length; index += 1) {
    const previous = chainPrefix(labels[index - 1]);
    const current = chainPrefix(labels[index]);
    if (previous && current && previous !== current) boundaries.push(index + 0.5);
  }
  return boundaries;
}

function chainPrefix(label: string) {
  const separator = label.indexOf(":");
  return separator > 0 ? label.slice(0, separator) : "";
}
