import { useEffect, useMemo, useRef, useState } from "react";
import { readStructureTextDocument } from "../lib/structure-text";
import { parseSpectrumFile, peakAnnotationValue, spectrumAnalytics, spectrumSummary, type SpectrumDocument, type SpectrumFile, type SpectrumPeak } from "../lib/spectrum";
import { useSpectrumPeakSelection } from "../lib/spectrum-selection";
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

type PlotlyClickEvent = {
  points?: Array<{
    pointIndex?: number;
    pointNumber?: number;
  }>;
};

type PlotlyElement = HTMLElement & {
  on?: (event: "plotly_click", handler: (event: PlotlyClickEvent) => void) => void;
  removeAllListeners?: (event: "plotly_click") => void;
};

type SpectrumSubformulaAnnotation = {
  candidateFormula: string;
  candidateIon: string;
  fragmentCount: number;
  fragmentIons: string[];
  fragmentFormulas: string[];
};

export function SpectrumViewer({ document, embedded = false }: SpectrumViewerProps) {
  const [file, setFile] = useState<SpectrumFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { activePeakIndex, selectedPeakIndices, selectPeak, clearPeakSelection } = useSpectrumPeakSelection(document.id);
  const [normalize, setNormalize] = useState(true);
  const [labelTopPeaks, setLabelTopPeaks] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    setSelectedIndex(0);
    clearPeakSelection();
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
  }, [clearPeakSelection, document.byteCount, document.extension, document.id, document.path, document.title]);

  const selectedSpectrum = file?.spectra[selectedIndex] ?? file?.spectra[0] ?? null;
  const summary = useMemo(() => (file ? spectrumSummary(file) : null), [file]);

  useEffect(() => {
    clearPeakSelection();
  }, [clearPeakSelection, selectedIndex]);

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
          <SpectrumPlot
            spectrum={selectedSpectrum}
            normalize={normalize}
            labelTopPeaks={labelTopPeaks}
            activePeakIndex={activePeakIndex}
            selectedPeakIndices={selectedPeakIndices}
            onPeakSelect={selectPeak}
          />
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
  const spectrum = file?.spectra[0] ?? null;
  return (
    <div className="dock-content spectrum-info-dock">
      {error && <div className="spectrum-empty" role="alert">{error}</div>}
      {!error && (!file || !summary || !spectrum) && <div className="spectrum-empty">Loading spectrum metadata...</div>}
      {!error && file && summary && spectrum && (
        <SpectrumMetadata document={document} file={file} spectrum={spectrum} summary={summary} />
      )}
    </div>
  );
}

export function SpectrumPeakTablePanel({ document }: { document: ViewerDocument }) {
  const [file, setFile] = useState<SpectrumFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const {
    activePeakIndex,
    selectedPeakIndices,
    previewPeak,
    selectPeakRange,
    clearPeakSelection,
  } = useSpectrumPeakSelection(document.id);
  const [normalize, setNormalize] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    setSelectedIndex(0);
    clearPeakSelection();
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
  }, [clearPeakSelection, document.byteCount, document.extension, document.id, document.path, document.title]);

  const selectedSpectrum = file?.spectra[selectedIndex] ?? file?.spectra[0] ?? null;

  useEffect(() => {
    clearPeakSelection();
  }, [clearPeakSelection, selectedIndex]);

  return (
    <section className="spectrum-table-panel">
      {error && <div className="spectrum-empty" role="alert">{error}</div>}
      {!error && !selectedSpectrum && <div className="spectrum-empty">Loading spectrum peaks...</div>}
      {!error && selectedSpectrum && (
        <>
          {file && file.spectra.length > 1 && (
            <div className="spectrum-table-toolbar">
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
              <label className="spectrum-toggle">
                <input type="checkbox" checked={normalize} onChange={(event) => setNormalize(event.currentTarget.checked)} />
                <span>Normalize</span>
              </label>
            </div>
          )}
          <PeakTable
            spectrum={selectedSpectrum}
            normalize={normalize}
            activePeakIndex={activePeakIndex}
            selectedPeakIndices={selectedPeakIndices}
            onPeakHover={previewPeak}
            onPeakRangeSelect={selectPeakRange}
          />
        </>
      )}
    </section>
  );
}

function SpectrumPlot({
  spectrum,
  normalize,
  labelTopPeaks,
  activePeakIndex,
  selectedPeakIndices,
  onPeakSelect,
}: {
  spectrum: SpectrumDocument;
  normalize: boolean;
  labelTopPeaks: boolean;
  activePeakIndex: number | null;
  selectedPeakIndices: number[];
  onPeakSelect: (index: number | null) => void;
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
      return renderPlot(plotlyRef.current, plotRef.current, spectrum, peaks, labels, normalize, activePeakIndex, selectedPeakIndices, onPeakSelect);
    });
    return () => {
      disposed = true;
    };
  }, [activePeakIndex, labels, normalize, onPeakSelect, peaks, selectedPeakIndices, spectrum]);

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
  activePeakIndex: number | null,
  selectedPeakIndices: number[],
  onPeakSelect: (index: number | null) => void,
) {
  const selectedPeakSet = new Set(selectedPeakIndices);
  const stickTrace = {
    type: "bar",
    x: peaks.map((peak) => peak.x),
    y: peaks.map((peak) => peak.y),
    width: peakBarWidths(peaks),
    marker: {
      color: peaks.map((peak, index) => (
        index === activePeakIndex
          ? "#b456e8"
          : selectedPeakSet.has(index)
          ? "rgba(180,86,232,0.7)"
          : peak.annotations?.frag_base_form ? "#4f8cff" : "#7c8798"
      )),
      line: {
        width: peaks.map((_peak, index) => index === activePeakIndex || selectedPeakSet.has(index) ? 1.5 : 0),
        color: peaks.map((_peak, index) => index === activePeakIndex || selectedPeakSet.has(index) ? "#6f2dbd" : "transparent"),
      },
    },
    text: labels,
    textposition: "outside",
    customdata: peaks.map((peak) => peakHoverData(peak)),
    hoverinfo: "skip",
    showlegend: false,
  };
  const hoverTrace = {
    type: "scatter",
    mode: "markers",
    x: peaks.map((peak) => peak.x),
    y: peaks.map((peak) => peak.y),
    marker: {
      size: peaks.map((_peak, index) => index === activePeakIndex ? 18 : selectedPeakSet.has(index) ? 16 : 14),
      color: peaks.map((_peak, index) => index === activePeakIndex ? "rgba(180,86,232,0.24)" : selectedPeakSet.has(index) ? "rgba(180,86,232,0.14)" : "rgba(79,140,255,0.01)"),
      line: {
        width: peaks.map((_peak, index) => index === activePeakIndex || selectedPeakSet.has(index) ? 2 : 0),
        color: peaks.map((_peak, index) => index === activePeakIndex || selectedPeakSet.has(index) ? "#6f2dbd" : "transparent"),
      },
    },
    customdata: peaks.map((peak) => peakHoverData(peak)),
    hovertemplate: "%{customdata}<extra></extra>",
    showlegend: false,
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
  return plotly.react(element, [stickTrace, hoverTrace], layout, config).then((value) => {
    const plotElement = element as PlotlyElement;
    plotElement.removeAllListeners?.("plotly_click");
    plotElement.on?.("plotly_click", (event) => {
      const point = event.points?.[0];
      const index = point?.pointIndex ?? point?.pointNumber;
      onPeakSelect(typeof index === "number" ? index : null);
    });
    return value;
  });
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
  const [subformula, setSubformula] = useState<SpectrumSubformulaAnnotation | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSubformula(null);
    void readSpectrumSubformulaAnnotation(document.path)
      .then((annotation) => {
        if (!cancelled) setSubformula(annotation);
      })
      .catch(() => {
        if (!cancelled) setSubformula(null);
      });
    return () => {
      cancelled = true;
    };
  }, [document.path]);
  const analytics = useMemo(() => spectrumAnalytics(spectrum), [spectrum]);
  const metadataRows = Object.entries(spectrum.metadata).filter(([, value]) => value !== "").slice(0, 16);
  const collisionEnergy = metadataValue(spectrum.metadata, ["collision energy", "collision_energy", "CE", "COLLISIONENERGY"]);
  const precursor = metadataValue(spectrum.metadata, ["precursor", "precursor_mz", "PEPMASS", "PRECURSORMZ", "parentmass"]);
  const charge = metadataValue(spectrum.metadata, ["charge", "CHARGE"]);
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
      <section>
        <h4>Spectrum summary</h4>
        <div className="spectrum-stat-grid">
          <Metric label="Base peak" value={analytics.basePeak ? `${formatNumber(analytics.basePeak.x)} / ${formatNumber(analytics.basePeak.y)}` : "-"} />
          <Metric label="m/z range" value={analytics.minMz !== null && analytics.maxMz !== null ? `${formatNumber(analytics.minMz)}-${formatNumber(analytics.maxMz)}` : "-"} />
          <Metric label="TIC" value={formatNumber(analytics.totalIntensity)} />
          <Metric label="Annotated" value={`${analytics.annotatedPeaks}/${spectrum.peaks.length} (${formatPercent(analytics.annotationCoverage)})`} />
          {collisionEnergy && <Metric label="Collision energy" value={collisionEnergy} />}
          {precursor && <Metric label="Precursor" value={precursor} />}
          {charge && <Metric label="Charge" value={charge} />}
        </div>
        {analytics.topPeaks.length > 0 && (
          <div className="spectrum-metadata-list spectrum-top-peaks">
            {analytics.topPeaks.slice(0, 8).map((peak, index) => (
              <div key={`${peak.x}:${peak.y}:${index}`}>
                <span>{formatNumber(peak.x)}</span>
                <strong>{formatNumber(peak.y)}{peakAnnotationLabel(peak) ? ` · ${peakAnnotationLabel(peak)}` : ""}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
      {subformula && (
        <section>
          <h4>Candidate ion</h4>
          <div className="spectrum-stat-grid">
            <Metric label="Formula" value={subformula.candidateFormula} />
            <Metric label="Ion" value={subformula.candidateIon} />
            <Metric label="Fragments" value={String(subformula.fragmentCount)} />
            <Metric label="Fragment ions" value={subformula.fragmentIons.join(", ") || "-"} />
          </div>
          {subformula.fragmentFormulas.length > 0 && (
            <div className="spectrum-metadata-list">
              <div>
                <span>top formulas</span>
                <strong>{subformula.fragmentFormulas.slice(0, 8).join(", ")}</strong>
              </div>
            </div>
          )}
        </section>
      )}
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

function PeakTable({
  spectrum,
  normalize,
  activePeakIndex,
  selectedPeakIndices,
  onPeakHover,
  onPeakRangeSelect,
}: {
  spectrum: SpectrumDocument;
  normalize: boolean;
  activePeakIndex: number | null;
  selectedPeakIndices: number[];
  onPeakHover: (index: number | null) => void;
  onPeakRangeSelect: (startIndex: number, endIndex: number) => void;
}) {
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const peaks = scaledPeaks(spectrum, normalize).slice(0, 500);
  const selectedPeakSet = useMemo(() => new Set(selectedPeakIndices), [selectedPeakIndices]);

  useEffect(() => {
    if (dragStartIndex === null) return undefined;
    const finishDrag = () => setDragStartIndex(null);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragStartIndex]);

  return (
    <div className="spectrum-peak-table" onMouseLeave={() => {
      if (dragStartIndex === null) onPeakHover(null);
    }} onPointerMove={(event) => {
      const row = event.target instanceof HTMLElement ? event.target.closest<HTMLTableRowElement>("tr[data-peak-index]") : null;
      if (!row) return;
      const index = Number(row.dataset.peakIndex);
      if (!Number.isInteger(index)) return;
      onPeakHover(index);
      if (dragStartIndex !== null && event.buttons === 1) onPeakRangeSelect(dragStartIndex, index);
    }}>
      <table>
        <thead>
          <tr>
            <th>m/z</th>
            <th>{normalize ? "Relative intensity" : "Intensity"}</th>
            <th>Annotation</th>
            <th>ppm diff</th>
            <th>frag mass</th>
          </tr>
        </thead>
        <tbody>
          {peaks.map((peak, index) => (
            <tr
              key={`${peak.x}:${peak.y}:${index}`}
              data-peak-index={index}
              data-active={index === activePeakIndex || undefined}
              data-selected={selectedPeakSet.has(index) || undefined}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                setDragStartIndex(index);
                onPeakRangeSelect(index, index);
              }}
              onPointerEnter={() => {
                onPeakHover(index);
                if (dragStartIndex !== null) onPeakRangeSelect(dragStartIndex, index);
              }}
            >
              <td>{formatNumber(peak.x)}</td>
              <td>{formatNumber(peak.y)}</td>
              <td>{peakAnnotationLabel(peak)}</td>
              <td>{annotationNumber(peak, "ppm_diff")}</td>
              <td>{annotationNumber(peak, "frag_mass")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function peakAnnotationLabel(peak: SpectrumPeak) {
  return String(peakAnnotationValue(peak));
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
  const rows = [
    `m/z: ${formatNumber(peak.x)}`,
    `intensity: ${formatNumber(peak.y)}`,
  ];
  const annotation = peakAnnotationLabel(peak);
  if (annotation) rows.push(`annotation: ${annotation}`);
  const row = peak.annotations?.row;
  if (row !== undefined && row !== null && row !== "") rows.push(`row: ${String(row)}`);
  return rows.map(escapeHtml).join("<br>");
}

async function readSpectrumSubformulaAnnotation(path: string): Promise<SpectrumSubformulaAnnotation | null> {
  const annotationPath = spectrumSubformulaAnnotationPath(path);
  if (!annotationPath) return null;
  const document = await readStructureTextDocument(annotationPath, undefined, { maxBytes: 2 * 1024 * 1024 });
  return parseSpectrumSubformulaAnnotation(document.content);
}

function spectrumSubformulaAnnotationPath(path: string) {
  const inputsIndex = path.indexOf("/inputs/");
  if (inputsIndex < 0) return null;
  const root = path.slice(0, inputsIndex + "/inputs".length);
  const title = pathBaseName(path).replace(/\.[^.]+$/u, "");
  if (!title) return null;
  return `${root}/subformulae/default_subformulae/${title}.json`;
}

function parseSpectrumSubformulaAnnotation(content: string): SpectrumSubformulaAnnotation | null {
  const data = JSON.parse(content) as unknown;
  if (!isRecord(data)) return null;
  const outputTable = isRecord(data.output_tbl) ? data.output_tbl : {};
  const fragmentFormulas = uniqueStrings(outputTable.formula);
  const fragmentIons = uniqueStrings(outputTable.ions);
  return {
    candidateFormula: stringValue(data.cand_form),
    candidateIon: stringValue(data.cand_ion),
    fragmentCount: tableRowCount(outputTable),
    fragmentIons,
    fragmentFormulas,
  };
}

function tableRowCount(table: Record<string, unknown>) {
  return Math.max(0, ...Object.values(table).map((value) => Array.isArray(value) ? value.length : 0));
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => stringValue(item)).filter(Boolean)));
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathBaseName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? "";
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : "";
}

function formatPercent(value: number) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "-";
}

function metadataValue(metadata: Record<string, string>, keys: string[]) {
  const lowered = new Map(Object.entries(metadata).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = lowered.get(key.toLowerCase());
    if (value) return value;
  }
  return "";
}

function annotationNumber(peak: SpectrumPeak, key: string) {
  const value = peak.annotations?.[key];
  if (typeof value === "number") return formatNumber(value);
  return typeof value === "string" ? value : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
