import { useEffect, useMemo, useRef, useState } from "react";
import { readStructureTextDocument } from "../lib/structure-text";
import { parseSpectrumFile, spectrumSummary, type SpectrumDocument, type SpectrumFile } from "../lib/spectrum";
import type { ViewerDocument } from "../types";
import { formatBytes } from "./format";

type PlotlyModule = {
  newPlot: (element: HTMLElement, traces: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
  react: (element: HTMLElement, traces: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
  purge: (element: HTMLElement) => void;
  Plots?: {
    resize?: (element: HTMLElement) => Promise<unknown> | unknown;
  };
};

type SpectrumViewerProps = {
  document: ViewerDocument;
  embedded?: boolean;
};

export function SpectrumViewer({ document, embedded = false }: SpectrumViewerProps) {
  const [file, setFile] = useState<SpectrumFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [normalize, setNormalize] = useState(true);
  const [labelTopPeaks, setLabelTopPeaks] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    setSelectedIndex(0);
    void readStructureTextDocument(document.path, {
      id: document.id,
      path: document.path,
      title: document.title,
      extension: document.extension,
      byteCount: document.byteCount,
    }, { maxBytes: 12 * 1024 * 1024 })
      .then((textDocument) => {
        if (cancelled) return;
        setFile(parseSpectrumFile({
          title: textDocument.title,
          extension: textDocument.extension || document.extension,
          content: textDocument.content,
        }));
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [document.byteCount, document.extension, document.id, document.path, document.title]);

  const selectedSpectrum = file?.spectra[selectedIndex] ?? file?.spectra[0] ?? null;
  const summary = useMemo(() => (file ? spectrumSummary(file) : null), [file]);

  if (error) {
    return (
      <div className={embedded ? "spectrum-embedded" : "spectrum-stage"}>
        <div className="spectrum-empty" role="alert">{error}</div>
      </div>
    );
  }
  if (!file || !summary) {
    return (
      <div className={embedded ? "spectrum-embedded" : "spectrum-stage"}>
        <div className="spectrum-empty">Loading spectrum...</div>
      </div>
    );
  }
  if (!selectedSpectrum) {
    return (
      <div className={embedded ? "spectrum-embedded" : "spectrum-stage"}>
        <div className="spectrum-empty">No drawable spectra found in {document.title}</div>
      </div>
    );
  }

  return (
    <div className={embedded ? "spectrum-embedded" : "spectrum-stage"}>
      <header className="spectrum-toolbar">
        <div className="spectrum-title">
          <span>{document.title}</span>
          <span className="text-file-badge">{file.format.toUpperCase()}</span>
        </div>
        <div className="spectrum-controls">
          {file.spectra.length > 1 && (
            <select
              className="spectrum-select"
              value={selectedIndex}
              onChange={(event) => setSelectedIndex(Number(event.currentTarget.value))}
              aria-label="Spectrum"
            >
              {file.spectra.map((spectrum, index) => (
                <option key={`${spectrum.id}:${index}`} value={index}>{spectrum.title}</option>
              ))}
            </select>
          )}
          <label className="spectrum-toggle">
            <input type="checkbox" checked={normalize} onChange={(event) => setNormalize(event.currentTarget.checked)} />
            <span>Normalize</span>
          </label>
          <label className="spectrum-toggle">
            <input type="checkbox" checked={labelTopPeaks} onChange={(event) => setLabelTopPeaks(event.currentTarget.checked)} />
            <span>Top labels</span>
          </label>
        </div>
      </header>
      <main className="spectrum-layout">
        <section className="spectrum-plot-panel">
          <SpectrumPlot spectrum={selectedSpectrum} normalize={normalize} labelTopPeaks={labelTopPeaks} />
        </section>
        {!embedded && (
          <aside className="spectrum-side-panel">
            <SpectrumMetadata document={document} file={file} spectrum={selectedSpectrum} summary={summary} />
          </aside>
        )}
        <section className="spectrum-table-panel">
          <PeakTable spectrum={selectedSpectrum} normalize={normalize} />
        </section>
      </main>
    </div>
  );
}

export function SpectrumInfoPanel({ document }: { document: ViewerDocument }) {
  const [file, setFile] = useState<SpectrumFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    void readStructureTextDocument(document.path, {
      id: document.id,
      path: document.path,
      title: document.title,
      extension: document.extension,
      byteCount: document.byteCount,
    }, { maxBytes: 12 * 1024 * 1024 })
      .then((textDocument) => {
        if (!cancelled) setFile(parseSpectrumFile({ title: textDocument.title, extension: textDocument.extension, content: textDocument.content }));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [document.byteCount, document.extension, document.id, document.path, document.title]);

  const summary = file ? spectrumSummary(file) : null;
  return (
    <div className="dock-content structure-brief">
      <section className="structure-brief-card">
        <div className="structure-brief-card-header">
          <div>
            <small>SPECTRUM</small>
            <h3>{document.title}</h3>
          </div>
          <span className="structure-brief-pill">{document.extension.toUpperCase()}</span>
        </div>
        {error ? (
          <p>{error}</p>
        ) : summary ? (
          <div className="structure-brief-rows">
            <StructureBriefTextRow label="Format" value={file?.format.toUpperCase() ?? "Spectrum"} />
            <StructureBriefTextRow label="Spectra" value={String(summary.spectraCount)} />
            <StructureBriefTextRow label="Peaks" value={String(summary.peakCount)} />
            <StructureBriefTextRow label="m/z range" value={summary.minX === null ? "None" : `${formatNumber(summary.minX)} - ${formatNumber(summary.maxX ?? summary.minX)}`} />
            <StructureBriefTextRow label="Size" value={formatBytes(document.byteCount)} />
          </div>
        ) : (
          <p>Loading spectrum metadata...</p>
        )}
      </section>
      {file?.warnings.length ? (
        <section className="structure-brief-card">
          <h4>Warnings</h4>
          <div className="structure-brief-notes">
            {file.warnings.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SpectrumPlot({
  spectrum,
  normalize,
  labelTopPeaks,
}: {
  spectrum: SpectrumDocument;
  normalize: boolean;
  labelTopPeaks: boolean;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotlyRef = useRef<PlotlyModule | null>(null);
  const peaks = useMemo(() => scaledPeaks(spectrum, normalize), [normalize, spectrum]);
  const labels = useMemo(() => topPeakLabels(peaks, labelTopPeaks), [labelTopPeaks, peaks]);

  useEffect(() => {
    let disposed = false;
    void import("plotly.js-basic-dist-min").then((module) => {
      if (disposed || !plotRef.current) return;
      plotlyRef.current = module.default as PlotlyModule;
      return renderPlot(plotlyRef.current, plotRef.current, spectrum, peaks, labels, normalize);
    });
    return () => {
      disposed = true;
    };
  }, [labels, normalize, peaks, spectrum]);

  useEffect(() => {
    const element = plotRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (plotRef.current && plotlyRef.current?.Plots?.resize) {
          void plotlyRef.current.Plots.resize(plotRef.current);
        }
      });
    });
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => () => {
    if (plotRef.current && plotlyRef.current) plotlyRef.current.purge(plotRef.current);
  }, []);

  return <div ref={plotRef} className="spectrum-plot" />;
}

function renderPlot(
  plotly: PlotlyModule,
  element: HTMLElement,
  spectrum: SpectrumDocument,
  peaks: SpectrumPeak[],
  labels: string[],
  normalize: boolean,
) {
  const trace = {
    type: "bar",
    x: peaks.map((peak) => peak.x),
    y: peaks.map((peak) => peak.y),
    width: peakBarWidths(peaks),
    marker: {
      color: peaks.map((peak) => peak.annotations?.frag_base_form ? "#4f8cff" : "#7c8798"),
      line: { width: 0 },
    },
    text: labels,
    textposition: "outside",
    customdata: peaks.map((peak) => peakHoverData(peak)),
    hovertemplate: "%{customdata}<extra></extra>",
  };
  const layout = {
    autosize: true,
    margin: { l: 58, r: 20, t: 18, b: 48 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "var(--text-secondary)", family: "var(--ui-font)", size: 12 },
    bargap: 0.98,
    xaxis: {
      title: spectrum.xLabel,
      zeroline: false,
      gridcolor: "rgba(130,140,160,0.16)",
      linecolor: "rgba(130,140,160,0.28)",
      tickcolor: "rgba(130,140,160,0.28)",
    },
    yaxis: {
      title: normalize ? "Relative intensity" : spectrum.yLabel,
      rangemode: "tozero",
      gridcolor: "rgba(130,140,160,0.16)",
      linecolor: "rgba(130,140,160,0.28)",
      tickcolor: "rgba(130,140,160,0.28)",
    },
  };
  const config = {
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };
  return plotly.react(element, [trace], layout, config);
}

function SpectrumMetadata({
  document,
  file,
  spectrum,
  summary,
}: {
  document: ViewerDocument;
  file: SpectrumFile;
  spectrum: SpectrumDocument;
  summary: ReturnType<typeof spectrumSummary>;
}) {
  const metadataRows = Object.entries(spectrum.metadata).filter(([, value]) => value !== "").slice(0, 16);
  return (
    <div className="spectrum-metadata">
      <section>
        <h3>{spectrum.title}</h3>
        <div className="spectrum-stat-grid">
          <Metric label="Format" value={file.format.toUpperCase()} />
          <Metric label="Spectra" value={String(summary.spectraCount)} />
          <Metric label="Peaks" value={String(spectrum.peaks.length)} />
          <Metric label="File" value={formatBytes(document.byteCount)} />
        </div>
      </section>
      {file.warnings.length > 0 && (
        <section>
          <h4>Warnings</h4>
          <ul className="spectrum-warning-list">
            {file.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      )}
      {metadataRows.length > 0 && (
        <section>
          <h4>Metadata</h4>
          <div className="spectrum-metadata-list">
            {metadataRows.map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PeakTable({ spectrum, normalize }: { spectrum: SpectrumDocument; normalize: boolean }) {
  const peaks = scaledPeaks(spectrum, normalize).slice(0, 500);
  return (
    <div className="spectrum-peak-table">
      <table>
        <thead>
          <tr>
            <th>m/z</th>
            <th>{normalize ? "Relative intensity" : "Intensity"}</th>
            <th>Annotation</th>
          </tr>
        </thead>
        <tbody>
          {peaks.map((peak, index) => (
            <tr key={`${peak.x}:${peak.y}:${index}`}>
              <td>{formatNumber(peak.x)}</td>
              <td>{formatNumber(peak.y)}</td>
              <td>{peak.label || String(peak.annotations?.frag_base_form ?? peak.annotations?.ion ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StructureBriefTextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="structure-brief-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dock-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function scaledPeaks(spectrum: SpectrumDocument, normalize: boolean): SpectrumPeak[] {
  if (!normalize) return spectrum.peaks;
  const max = Math.max(0, ...spectrum.peaks.map((peak) => peak.y));
  if (max <= 0) return spectrum.peaks;
  return spectrum.peaks.map((peak) => ({ ...peak, y: peak.y / max * 100 }));
}

function topPeakLabels(peaks: SpectrumPeak[], enabled: boolean) {
  if (!enabled) return peaks.map(() => "");
  const top = new Set([...peaks]
    .sort((left, right) => right.y - left.y)
    .slice(0, 12)
    .map((peak) => peak.x));
  return peaks.map((peak) => top.has(peak.x) ? formatNumber(peak.x) : "");
}

function peakBarWidths(peaks: SpectrumPeak[]) {
  const sortedX = [...peaks.map((peak) => peak.x)].sort((left, right) => left - right);
  const deltas = sortedX.slice(1).map((x, index) => x - sortedX[index]).filter((value) => value > 0);
  const width = deltas.length ? Math.max(0.01, Math.min(0.18, Math.min(...deltas) * 0.25)) : 0.06;
  return peaks.map(() => width);
}

function peakHoverData(peak: SpectrumPeak) {
  const annotationRows = Object.entries(peak.annotations ?? {})
    .slice(0, 8)
    .map(([key, value]) => `<br>${escapeHtml(key)}: ${escapeHtml(String(value))}`)
    .join("");
  return `m/z ${formatNumber(peak.x)}<br>intensity ${formatNumber(peak.y)}${annotationRows}`;
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
