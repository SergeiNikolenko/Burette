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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !preview.values.length || !preview.values[0]?.length) return;
    const width = canvas.clientWidth || 240;
    const height = canvas.clientHeight || 180;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    const rows = preview.values.length;
    const cols = preview.values[0].length;
    const min = preview.min ?? 0;
    const max = preview.max ?? 1;
    const span = Math.max(0.000001, max - min);
    const cellWidth = width / cols;
    const cellHeight = height / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const value = preview.values[row]?.[col];
        context.fillStyle = value === null ? "rgba(128,128,128,0.18)" : heatmapColor((value - min) / span);
        context.fillRect(col * cellWidth, row * cellHeight, Math.ceil(cellWidth), Math.ceil(cellHeight));
      }
    }
  }, [preview]);

  return (
    <div className="folding-chart-panel">
      <div className="folding-chart-title">
        <strong>{preview.label}</strong>
        <span>{preview.shape.join(" x ")} · mean {preview.mean === null || preview.mean === undefined ? "-" : preview.mean.toFixed(2)}</span>
      </div>
      <canvas ref={canvasRef} className="folding-matrix-heatmap" aria-label={`${preview.label} heatmap`} />
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

function heatmapColor(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped < 0.5) {
    return interpolateColor([47, 111, 237], [245, 247, 250], clamped * 2);
  }
  return interpolateColor([245, 247, 250], [217, 79, 69], (clamped - 0.5) * 2);
}

function interpolateColor(from: [number, number, number], to: [number, number, number], t: number) {
  const r = Math.round(from[0] + (to[0] - from[0]) * t);
  const g = Math.round(from[1] + (to[1] - from[1]) * t);
  const b = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgb(${r} ${g} ${b})`;
}
