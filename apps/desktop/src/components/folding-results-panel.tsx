import { useEffect, useMemo, useRef, useState } from "react";
import { hasFoldingResultContent, readFoldingResultBundle } from "../lib/folding-results";
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

  useEffect(() => {
    setActiveModelId(bundle?.models[0]?.id ?? null);
  }, [bundle?.rootPath]);

  const activeModel = useMemo(() => {
    if (!bundle?.models.length) return null;
    return bundle.models.find((model) => model.id === activeModelId) ?? bundle.models[0] ?? null;
  }, [activeModelId, bundle]);

  if (!bundle || !activeModel) {
    return null;
  }

  return (
    <section className="structure-brief-card folding-results-card">
      <div className="structure-inspector-section-header">
        <button
          type="button"
          className="structure-inspector-section-title-button"
          onClick={() => actions.revealPath(bundle.rootPath, "Folding result")}
        >
          Folding Results
        </button>
        <span>{bundle.source}</span>
      </div>

      {bundle.models.length > 1 ? (
        <div className="folding-model-tabs" role="tablist" aria-label="Folding models">
          {bundle.models.map((model) => (
            <button
              key={model.id}
              type="button"
              role="tab"
              aria-selected={model.id === activeModel.id}
              data-active={model.id === activeModel.id || undefined}
              onClick={() => setActiveModelId(model.id)}
            >
              {modelLabel(model)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="folding-model-summary">
        <div>
          <strong>{activeModel.title}</strong>
          <span title={activeModel.structureTitle}>{activeModel.structureTitle}</span>
        </div>
        <button type="button" className="structure-inspector-xtb-table-action" onClick={() => actions.openStructurePaths([activeModel.structurePath])}>
          Open
        </button>
      </div>

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
    </section>
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

function FoldingMatrixHeatmap({ preview }: { preview: FoldingMatrixPreview }) {
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
      <div ref={plotRef} className="folding-matrix-heatmap" aria-label={`${preview.label} heatmap`} />
      {selectedCell ? (
        <div className="folding-matrix-status">
          {selectedCell.yLabel} / {selectedCell.xLabel}: {selectedCell.value.toFixed(2)} A
        </div>
      ) : null}
    </div>
  );
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

function modelLabel(model: FoldingModel) {
  if (model.modelIndex !== null && model.modelIndex !== undefined) return `Model ${model.modelIndex}`;
  if (model.seed !== null && model.seed !== undefined) return `Seed ${model.seed}`;
  return model.backend;
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
