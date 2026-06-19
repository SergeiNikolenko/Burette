import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { annotateSpectrumWithMsbuddy, msbuddyPeakInput, type MsbuddyAnnotationResult, type MsbuddyCandidate } from "../lib/msbuddy";
import { readStructureTextDocument } from "../lib/structure-text";
import { parseSpectrumFile, peakAnnotationValue, spectrumAnalytics, spectrumSummary, type SpectrumDocument, type SpectrumFile, type SpectrumPeak } from "../lib/spectrum";
import { useSpectrumPeakSelection } from "../lib/spectrum-selection";
import type { ViewerDocument } from "../types";
import { formatBytes } from "./format";
import type { ShellActions } from "./types";

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

type RDKitModule = {
  get_mol: (input: string) => RDKitMol;
};

type RDKitModuleOptions = {
  locateFile?: (file: string) => string;
  wasmBinary?: Uint8Array;
};

type RDKitMol = {
  delete?: () => void;
  get_svg: (width?: number, height?: number) => string;
  is_valid?: () => boolean;
  set_new_coords?: () => void;
};

type PlotlyClickEvent = {
  points?: Array<{
    pointIndex?: number;
    pointNumber?: number;
    customdata?: number;
  }>;
};

type PlotlyElement = HTMLElement & {
  on?: (event: "plotly_click", handler: (event: PlotlyClickEvent) => void) => void;
  removeAllListeners?: (event: "plotly_click") => void;
  __buretteSpectrumClickCleanup?: () => void;
};

type SpectrumSubformulaAnnotation = {
  candidateFormula: string;
  candidateIon: string;
  fragmentCount: number;
  fragmentIons: string[];
  fragmentFormulas: string[];
};

const rdkitScriptUrl = new URL("../../../../PreviewExtension/Web/rdkit/RDKit_minimal.js", import.meta.url).href;
const rdkitWasmUrl = new URL("../../../../PreviewExtension/Web/rdkit/RDKit_minimal.wasm", import.meta.url).href;
let rdkitPromise: Promise<RDKitModule> | null = null;

type RDKitWindow = Window & {
  initRDKitModule?: (options?: RDKitModuleOptions) => Promise<RDKitModule>;
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

export function SpectrumInfoPanel({ document, actions }: { document: ViewerDocument; actions?: ShellActions }) {
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
        <SpectrumMetadata document={document} file={file} spectrum={spectrum} summary={summary} actions={actions} />
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
  const selectedPeakPoints = peaks
    .map((peak, index) => ({ peak, index, active: index === activePeakIndex }))
    .filter(({ index }) => index === activePeakIndex || selectedPeakSet.has(index));
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
  const selectedTrace = {
    type: "scatter",
    mode: "markers",
    x: selectedPeakPoints.map(({ peak }) => peak.x),
    y: selectedPeakPoints.map(({ peak }) => peak.y),
    marker: {
      size: selectedPeakPoints.map(({ active }) => active ? 22 : 18),
      color: selectedPeakPoints.map(({ active }) => active ? "rgba(180,86,232,0.32)" : "rgba(180,86,232,0.2)"),
      line: {
        width: 3,
        color: "#b456e8",
      },
      symbol: "circle-open",
    },
    customdata: selectedPeakPoints.map(({ index }) => index),
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
  return plotly.react(element, [stickTrace, selectedTrace, hoverTrace], layout, config).then((value) => {
    const plotElement = element as PlotlyElement;
    let lastPeakClickAt = 0;
    plotElement.removeAllListeners?.("plotly_click");
    plotElement.__buretteSpectrumClickCleanup?.();
    plotElement.on?.("plotly_click", (event) => {
      lastPeakClickAt = window.performance.now();
      const point = event.points?.[0];
      const index = typeof point?.customdata === "number" ? point.customdata : point?.pointIndex ?? point?.pointNumber;
      onPeakSelect(typeof index === "number" ? index : null);
      window.getSelection()?.removeAllRanges();
    });
    const handleBlankClick = () => {
      window.setTimeout(() => {
        if (window.performance.now() - lastPeakClickAt < 100) return;
        onPeakSelect(null);
        window.getSelection()?.removeAllRanges();
      }, 0);
    };
    element.addEventListener("click", handleBlankClick);
    plotElement.__buretteSpectrumClickCleanup = () => {
      element.removeEventListener("click", handleBlankClick);
    };
    return value;
  });
}

function SpectrumMetadata({
  document,
  file,
  spectrum,
  summary,
  actions,
}: {
  document: ViewerDocument;
  file: SpectrumFile;
  spectrum: SpectrumDocument;
  summary: ReturnType<typeof spectrumSummary>;
  actions?: ShellActions;
}) {
  const { selectPeaks } = useSpectrumPeakSelection(document.id);
  const [subformula, setSubformula] = useState<SpectrumSubformulaAnnotation | null>(null);
  const [msbuddyStatus, setMsbuddyStatus] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [msbuddyResult, setMsbuddyResult] = useState<MsbuddyAnnotationResult | null>(null);
  const [msbuddyError, setMsbuddyError] = useState<string | null>(null);
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
  useEffect(() => {
    setMsbuddyStatus("idle");
    setMsbuddyResult(null);
    setMsbuddyError(null);
  }, [document.path, spectrum.id]);
  const analytics = useMemo(() => spectrumAnalytics(spectrum), [spectrum]);
  const metadataEntries = Object.entries(spectrum.metadata).filter(([, value]) => value !== "");
  const baseMetadataRows = metadataEntries.slice(0, 16);
  const smilesMetadataRow = metadataEntries.find(([key]) => isSmilesMetadataKey(key));
  const metadataRows = smilesMetadataRow && !baseMetadataRows.some(([key]) => key === smilesMetadataRow[0])
    ? [smilesMetadataRow, ...baseMetadataRows.slice(0, 15)]
    : baseMetadataRows;
  const collisionEnergy = metadataValue(spectrum.metadata, ["collision energy", "collision_energy", "CE", "COLLISIONENERGY"]);
  const precursor = metadataValue(spectrum.metadata, ["precursor", "precursor_mz", "PEPMASS", "PRECURSORMZ", "parentmass"]);
  const charge = metadataValue(spectrum.metadata, ["charge", "CHARGE"]);
  const runMsbuddy = useCallback(() => {
    setMsbuddyStatus("running");
    setMsbuddyError(null);
    void annotateSpectrumWithMsbuddy({
      title: spectrum.title,
      format: file.format,
      precursorMz: parseNumericMetadata(precursor),
      candidateFormula: subformula?.candidateFormula ?? null,
      candidateIon: subformula?.candidateIon ?? null,
      fragmentFormulas: subformula?.fragmentFormulas ?? [],
      metadata: spectrum.metadata,
      peaks: spectrum.peaks.map(msbuddyPeakInput),
    }).then((result) => {
      setMsbuddyResult(result);
      setMsbuddyStatus("ready");
    }).catch((annotationError) => {
      setMsbuddyError(annotationError instanceof Error ? annotationError.message : String(annotationError));
      setMsbuddyStatus("error");
    });
  }, [file.format, precursor, spectrum, subformula]);
  const selectMsbuddyCandidate = useCallback((candidate: MsbuddyCandidate) => {
    if (candidate.explainedPeakIndexes.length > 0) {
      selectPeaks(candidate.explainedPeakIndexes);
    } else {
      selectPeaks(findPeakIndexesForFormula(spectrum, candidate.formula));
    }
  }, [selectPeaks, spectrum]);
  const selectFragmentFormula = useCallback((formula: string) => {
    selectPeaks(findPeakIndexesForFormula(spectrum, formula));
  }, [selectPeaks, spectrum]);
  return (
    <div className="spectrum-metadata">
      <section className="spectrum-metadata-hero">
        <h3>{spectrum.title}</h3>
        <div className="spectrum-summary-line">
          <span>{file.format.toUpperCase()}</span>
          <span>{spectrum.peaks.length} peaks</span>
          {analytics.minMz !== null && analytics.maxMz !== null && <span>m/z {formatMzRangeValue(analytics.minMz)}-{formatMzRangeValue(analytics.maxMz)}</span>}
          <span>{analytics.annotatedPeaks}/{spectrum.peaks.length} annotated</span>
        </div>
      </section>
      {subformula && (
        <section>
          <h4>Candidate</h4>
          <div className="spectrum-stat-grid spectrum-stat-grid-compact">
            <Metric label="Formula" value={subformula.candidateFormula} />
            <Metric label="Ion" value={subformula.candidateIon} />
            {precursor && <Metric label="Precursor" value={precursor} />}
            {charge && <Metric label="Charge" value={charge} />}
            {collisionEnergy && <Metric label="Collision energy" value={collisionEnergy} />}
            <Metric label="Fragments" value={String(subformula.fragmentCount)} />
          </div>
        </section>
      )}
      <section className="spectrum-msbuddy">
        <div className="spectrum-section-header">
          <h4>msbuddy</h4>
          <button type="button" onClick={runMsbuddy} disabled={msbuddyStatus === "running"}>
            {msbuddyStatus === "running" ? "Annotating..." : "Annotate"}
          </button>
        </div>
        <p>{msbuddyResult?.message ?? "Annotate molecular formulas from the current spectrum and map results back to peaks."}</p>
        {msbuddyError && <div className="spectrum-inline-error">{msbuddyError}</div>}
        {msbuddyResult && msbuddyResult.candidates.length > 0 && (
          <div className="spectrum-msbuddy-candidates">
            {msbuddyResult.candidates.map((candidate) => (
              <button
                key={`${candidate.rank}:${candidate.formula}:${candidate.evidence}`}
                type="button"
                onClick={() => selectMsbuddyCandidate(candidate)}
              >
                <span>#{candidate.rank} {candidate.formula}</span>
                <strong>{candidate.score === null ? "score -" : `score ${formatNumber(candidate.score)}`}</strong>
                <small>{candidate.evidence}{candidate.explainedPeakIndexes.length ? ` · ${candidate.explainedPeakIndexes.length} peaks` : ""}</small>
              </button>
            ))}
          </div>
        )}
        {msbuddyResult && msbuddyResult.candidates.length === 0 && (
          <div className="spectrum-empty spectrum-empty-compact">No formula candidates found in this spectrum.</div>
        )}
      </section>
      <section>
        <h4>Spectrum summary</h4>
        <div className="spectrum-stat-grid spectrum-stat-grid-compact">
          <Metric label="Base peak" value={analytics.basePeak ? `m/z ${formatNumber(analytics.basePeak.x)} · ${formatNumber(analytics.basePeak.y)}` : "-"} />
          <Metric label="m/z range" value={analytics.minMz !== null && analytics.maxMz !== null ? `${formatMzRangeValue(analytics.minMz)}-${formatMzRangeValue(analytics.maxMz)}` : "-"} />
          <Metric label="TIC" value={formatNumber(analytics.totalIntensity)} />
          <Metric label="Annotated" value={`${analytics.annotatedPeaks}/${spectrum.peaks.length} (${formatPercent(analytics.annotationCoverage)})`} />
          <Metric label="Spectra" value={String(summary.spectraCount)} />
          <Metric label="File" value={formatBytes(document.byteCount)} />
        </div>
      </section>
      {subformula && subformula.fragmentFormulas.length > 0 && (
        <section>
          <h4>Fragment formulas</h4>
          <div className="spectrum-chip-list">
            {subformula.fragmentFormulas.slice(0, 10).map((formula) => (
              <FragmentFormulaChip
                key={formula}
                formula={formula}
                peakCount={findPeakIndexesForFormula(spectrum, formula).length}
                onSelect={selectFragmentFormula}
              />
            ))}
          </div>
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
        <section className="spectrum-source-metadata">
          <h4>Source metadata</h4>
          <div className="spectrum-metadata-list">
            {metadataRows.map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                {isSmilesMetadataKey(key) ? (
                  <SmilesMetadataValue title={spectrum.title} smiles={value} actions={actions} />
                ) : (
                  <strong>{value}</strong>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SmilesMetadataValue({
  title,
  smiles,
  actions,
}: {
  title: string;
  smiles: string;
  actions?: ShellActions;
}) {
  const [hovered, setHovered] = useState(false);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const openMolstar = useCallback(() => {
    const cleanSmiles = smiles.trim();
    if (!cleanSmiles || !actions) return;
    void actions.openKetcherSketch({
      title: `${title || "SMILES"}.smi`,
      extension: "smi",
      text: `${cleanSmiles}\n`,
      target: "molstar",
    });
  }, [actions, smiles, title]);

  useEffect(() => {
    if (!hovered || svg || error) return;
    let cancelled = false;
    void drawSmilesSvg(smiles)
      .then((nextSvg) => {
        if (cancelled) return;
        setSvg(nextSvg);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [error, hovered, smiles, svg]);

  return (
    <span
      className="spectrum-smiles-value-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <button
        type="button"
        className="spectrum-smiles-value"
        disabled={!actions}
        onClick={openMolstar}
        title={actions ? "Open SMILES in Molstar" : "Molstar open unavailable here"}
      >
        {smiles}
      </button>
      {hovered && (
        <span className="spectrum-smiles-popover" role="tooltip">
          {svg ? <span className="spectrum-smiles-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <span>{error || "Rendering molecule..."}</span>}
        </span>
      )}
    </span>
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
  const tableRef = useRef<HTMLDivElement>(null);
  const peaks = scaledPeaks(spectrum, normalize);
  const selectedPeakSet = useMemo(() => new Set(selectedPeakIndices), [selectedPeakIndices]);

  useEffect(() => {
    if (activePeakIndex === null || !selectedPeakSet.has(activePeakIndex)) return;
    const row = tableRef.current?.querySelector<HTMLTableRowElement>(`tr[data-peak-index="${activePeakIndex}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [activePeakIndex, selectedPeakSet]);

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
    <div ref={tableRef} className="spectrum-peak-table" onMouseLeave={() => {
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

function FragmentFormulaChip({
  formula,
  peakCount,
  onSelect,
}: {
  formula: string;
  peakCount: number;
  onSelect: (formula: string) => void;
}) {
  const disabled = peakCount === 0;
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "No matching visible peak" : `${peakCount} matching peak${peakCount === 1 ? "" : "s"}`}
      onClick={() => onSelect(formula)}
    >
      {formula}
    </button>
  );
}

function findPeakIndexesForFormula(spectrum: SpectrumDocument, formula: string) {
  const normalizedFormula = formula.trim();
  if (!normalizedFormula) return [];
  return spectrum.peaks
    .map((peak, index) => peakHasFormula(peak, normalizedFormula) ? index : null)
    .filter((index): index is number => index !== null);
}

function peakHasFormula(peak: SpectrumPeak, formula: string) {
  if (formulaTokenMatches(peak.label, formula)) return true;
  for (const value of Object.values(peak.annotations ?? {})) {
    if (formulaTokenMatches(value, formula)) return true;
  }
  return false;
}

function formulaTokenMatches(value: unknown, formula: string) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return false;
  const text = String(value).trim();
  if (text === formula) return true;
  const escapedFormula = formula.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escapedFormula}($|[^A-Za-z0-9])`, "u").test(text);
}

function isSmilesMetadataKey(key: string) {
  return key.trim().toLowerCase() === "smiles";
}

async function drawSmilesSvg(smiles: string) {
  const cleanSmiles = smiles.trim();
  if (!cleanSmiles) throw new Error("No SMILES");
  const rdkit = await loadRDKit();
  let mol: RDKitMol | null = null;
  try {
    mol = rdkit.get_mol(cleanSmiles);
    if (!mol || (typeof mol.is_valid === "function" && !mol.is_valid())) throw new Error("Invalid SMILES");
    try { mol.set_new_coords?.(); } catch (_) {}
    return sanitizeSvg(mol.get_svg(260, 190));
  } finally {
    try { mol?.delete?.(); } catch (_) {}
  }
}

async function loadRDKit() {
  const rdkitWindow = window as RDKitWindow;
  if (!rdkitWindow.initRDKitModule) await loadScript(rdkitScriptUrl);
  if (!rdkitWindow.initRDKitModule) throw new Error("RDKit loader is unavailable");
  rdkitPromise ??= loadRDKitWasmBinary().then((wasm) => {
    const loader = (window as RDKitWindow).initRDKitModule;
    if (!loader) throw new Error("RDKit loader is unavailable");
    return loader({ locateFile: () => wasm.path, wasmBinary: wasm.bytes });
  });
  return rdkitPromise;
}

async function loadRDKitWasmBinary() {
  const candidates = [rdkitWasmUrl, "/__burette/rdkit-wasm"];
  let lastError: Error | null = null;
  for (const path of candidates) {
    try {
      const response = await fetch(path, { cache: "force-cache" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
      return { path, bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(`Could not load RDKit wasm: ${lastError?.message ?? "unknown error"}`);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${cssEscape(src)}"]`);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
    if (!existing) document.head.append(script);
  });
}

function cssEscape(value: string) {
  return value.replace(/["\\]/gu, "\\$&");
}

function sanitizeSvg(svg: string) {
  return String(svg || "")
    .replace(/<script[\s\S]*?<\/script>/giu, "")
    .replace(/\s(?:on\w+)=(?:"[^"]*"|'[^']*')/giu, "");
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

function formatMzRangeValue(value: number) {
  return Number.isFinite(value) ? value.toFixed(1) : "";
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

function parseNumericMetadata(value: string | null) {
  if (!value) return null;
  const match = value.match(/-?\d+(?:\.\d+)?/u);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
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
