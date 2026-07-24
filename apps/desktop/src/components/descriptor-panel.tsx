import { useCallback, useEffect, useMemo, useState } from "react";
import {
  calculateDescriptors,
  calculateGridDescriptors,
  cancelGridDescriptorJob,
  descriptorDefinition,
  descriptorRuntimeStatus,
  descriptorSourceFromDocument,
  gridDescriptorJobStatus,
  gridDescriptorSummary,
  installDescriptorRuntime,
  type DescriptorCalculationResult,
  type DescriptorDefinition,
  type DescriptorRuntimeStatus,
  type DescriptorSourcePayload,
  type GridDescriptorJobStatus,
  type GridDescriptorControls,
  type GridDescriptorRunSummary,
} from "../lib/descriptors";
import { readStructureText } from "../lib/structure-text";
import type { ShellActions, ShellViewState } from "./types";

type DescriptorPanelProps = {
  state: ShellViewState;
  actions: ShellActions;
};

type SourceState =
  | { status: "loading" }
  | { status: "ready"; source: DescriptorSourcePayload }
  | { status: "collection"; documentId: string; label: string; path: string }
  | { status: "unsupported"; reason: string };

const AUTO_GRID_DESCRIPTOR_LIMIT = 250;
const GRID_DESCRIPTOR_JOB_EVENT = "burette-grid-descriptor-job";

function pendingGridJobStatus(documentId: string, totalRows: number, message: string): GridDescriptorJobStatus {
  return {
    documentId,
    status: "running",
    running: true,
    totalRows,
    processedRows: 0,
    calculatedRows: 0,
    failedRows: 0,
    message,
    startedAtMs: Date.now(),
    finishedAtMs: null,
    summary: null,
  };
}

function failedGridJobStatus(documentId: string, totalRows: number, message: string): GridDescriptorJobStatus {
  const now = Date.now();
  return {
    documentId,
    status: "failed",
    running: false,
    totalRows,
    processedRows: 0,
    calculatedRows: 0,
    failedRows: 0,
    message,
    startedAtMs: now,
    finishedAtMs: now,
    summary: null,
  };
}

export function DescriptorPanel({ state, actions }: DescriptorPanelProps) {
  const [runtime, setRuntime] = useState<DescriptorRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeInstalling, setRuntimeInstalling] = useState(false);
  const [sourceState, setSourceState] = useState<SourceState>({ status: "loading" });
  const [result, setResult] = useState<DescriptorCalculationResult | null>(null);
  const [gridSummary, setGridSummary] = useState<GridDescriptorRunSummary | null>(null);
  const [gridJob, setGridJob] = useState<GridDescriptorJobStatus | null>(null);
  const [filterDescriptorId, setFilterDescriptorId] = useState("");
  const [filterMin, setFilterMin] = useState("");
  const [filterMax, setFilterMax] = useState("");
  const [sortDescriptorId, setSortDescriptorId] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [openDescriptorInfoId, setOpenDescriptorInfoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calculatingGrid, setCalculatingGrid] = useState(false);
  const [autoCalculatedSourceKey, setAutoCalculatedSourceKey] = useState("");
  const [autoCalculatedGridId, setAutoCalculatedGridId] = useState("");
  const activeDocument = state.activeDocument;
  const descriptorSource = state.descriptorSource;

  const refreshRuntime = useCallback(() => {
    setRuntimeLoading(true);
    void descriptorRuntimeStatus()
      .then(setRuntime)
      .catch((statusError) => {
        setRuntime({
          available: false,
          message: statusError instanceof Error ? statusError.message : String(statusError),
          installHint: "Install a uv-managed Python runtime with RDKit and mordredcommunity.",
        });
      })
      .finally(() => setRuntimeLoading(false));
  }, []);

  useEffect(() => {
    refreshRuntime();
  }, [refreshRuntime]);

  useEffect(() => {
    setResult(null);
    setError(null);
    if (descriptorSource) {
      setSourceState({ status: "ready", source: descriptorSource });
      return undefined;
    }
    if (!activeDocument) {
      setSourceState({ status: "unsupported", reason: "Open a small-molecule document or send a Ketcher sketch to descriptors." });
      return undefined;
    }
    if (activeDocument.renderer === "grid2d") {
      setSourceState({ status: "collection", documentId: activeDocument.id, label: activeDocument.title, path: activeDocument.path });
      void gridDescriptorSummary(activeDocument.id, activeDocument.path).then(setGridSummary).catch(() => setGridSummary(null));
      void gridDescriptorJobStatus(activeDocument.id)
        .then((status) => {
          setGridJob(status);
          if (status.summary) setGridSummary(status.summary);
          setCalculatingGrid(status.running);
        })
        .catch(() => setGridJob(null));
      return undefined;
    }
    let cancelled = false;
    setSourceState({ status: "loading" });
    void readStructureText(activeDocument.path)
      .then((text) => {
        if (cancelled) return;
        const source = descriptorSourceFromDocument(activeDocument, text);
        setSourceState("reason" in source ? { status: "unsupported", reason: source.reason } : { status: "ready", source });
      })
      .catch((readError) => {
        if (cancelled) return;
        setSourceState({
          status: "unsupported",
          reason: readError instanceof Error ? readError.message : String(readError),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeDocument, descriptorSource]);

  useEffect(() => {
    const ids = gridSummary?.descriptorIds ?? [];
    if (ids.length === 0) {
      setFilterDescriptorId("");
      setSortDescriptorId("");
      return;
    }
    setFilterDescriptorId((current) => (current && ids.includes(current) ? current : ids[0]));
    setSortDescriptorId((current) => (current && ids.includes(current) ? current : ids[0]));
  }, [gridSummary?.descriptorIds]);

  const source = sourceState.status === "ready" ? sourceState.source : null;
  const collectionDocumentId = sourceState.status === "collection" ? sourceState.documentId : "";
  const shouldShowCollectionSummary = Boolean(
    gridSummary && (runtime?.available || gridSummary.calculatedRows > 0 || gridSummary.descriptorIds.length > 0),
  );
  const sourceKey = useMemo(() => {
    if (!source) return "";
    return [
      source.sourceKind,
      source.sourceLabel,
      source.format,
      source.text.length,
      source.text.slice(0, 128),
    ].join(":");
  }, [source]);
  const runtimeDetails = useMemo(() => {
    if (!runtime) return "Runtime status has not been checked yet.";
    if (!runtime.available) return runtime.message;
    const versions = [
      runtime.mordredVersion ? `Mordred ${runtime.mordredVersion}` : null,
      runtime.rdkitVersion ? `RDKit ${runtime.rdkitVersion}` : null,
    ].filter(Boolean);
    return versions.length > 0 ? versions.join(" / ") : runtime.message;
  }, [runtime]);
  const runtimeSummary = useMemo(() => {
    const runtimeLabel = runtime?.available
      ? (runtime.rdkitVersion ? `RDKit ${runtime.rdkitVersion}` : "RDKit ready")
      : "Runtime unavailable";
    const sourceLabel = sourceState.status === "collection"
      ? `${(gridSummary?.totalRows ?? 0).toLocaleString()} molecules`
      : sourceState.status === "ready"
        ? sourceState.source.sourceKind
        : "no source";
    return [runtimeLabel, sourceLabel].join(" · ");
  }, [gridSummary?.totalRows, runtime?.available, runtime?.rdkitVersion, sourceState]);
  const sourceTitle = sourceState.status === "collection"
    ? sourceState.label
    : sourceState.status === "ready"
      ? sourceState.source.sourceLabel
      : "";
  const sourceMeta = sourceState.status === "collection"
    ? "grid table"
    : sourceState.status === "ready"
      ? `${sourceState.source.sourceKind} / ${sourceState.source.format}`
      : "";
  const isGridRunning = gridJob?.running === true;
  const hasGridDescriptors = Boolean(gridSummary?.descriptorIds.length);
  const showGridProgress = Boolean(gridJob && (gridJob.running || gridJob.status !== "idle" || gridJob.processedRows > 0 || gridJob.failedRows > 0));
  const gridProgress = useMemo(() => {
    const total = gridJob?.totalRows || gridSummary?.totalRows || 0;
    const processed = gridJob?.processedRows || 0;
    if (!total) return { percent: 0, width: 0, label: "0%" };
    const rawPercent = Math.min(100, Math.max(0, (processed / total) * 100));
    const percent = Math.round(rawPercent);
    return {
      percent,
      width: processed > 0 ? Math.max(1, rawPercent) : 0,
      label: processed > 0 && percent === 0 ? "<1%" : `${percent}%`,
    };
  }, [gridJob?.processedRows, gridJob?.totalRows, gridSummary?.totalRows]);
  const descriptorDefinitions = useMemo(
    () => (gridSummary?.descriptorIds ?? []).map((id) => descriptorDefinition(id)),
    [gridSummary?.descriptorIds],
  );
  const visibleDescriptorChips = descriptorDefinitions.slice(0, 4);
  const gridStatusTitle = gridJob?.running
    ? "Calculating descriptors"
    : gridJob?.status === "cancelled"
      ? "Stopped"
      : gridJob?.status === "completed"
        ? "Completed"
        : gridJob?.status === "failed"
          ? "Failed"
          : "";
  const gridProgressTitle = gridJob?.running
    ? `${(gridJob.processedRows ?? 0).toLocaleString()} / ${(gridJob.totalRows ?? 0).toLocaleString()}`
    : gridStatusTitle || gridJob?.message || "";
  const showCollectionSummary = sourceState.status === "collection" && gridSummary && shouldShowCollectionSummary && !isGridRunning && (hasGridDescriptors || showGridProgress);
  const showCollectionControls = Boolean(showCollectionSummary && hasGridDescriptors);

  const runCalculation = useCallback(() => {
    if (!source || calculating) return;
    setCalculating(true);
    setError(null);
    void calculateDescriptors(source)
      .then(setResult)
      .catch((calculateError) => {
        setResult(null);
        setError(calculateError instanceof Error ? calculateError.message : String(calculateError));
      })
      .finally(() => setCalculating(false));
  }, [calculating, source]);

  const installRuntime = useCallback(() => {
    if (runtimeInstalling) return;
    setRuntimeInstalling(true);
    setError(null);
    void installDescriptorRuntime()
      .then((installResult) => {
        setRuntime({
          available: true,
          pythonPath: installResult.pythonPath,
          mordredVersion: null,
          rdkitVersion: null,
          message: installResult.message,
          installHint: "",
        });
        refreshRuntime();
      })
      .catch((installError) => {
        setError(installError instanceof Error ? installError.message : String(installError));
      })
      .finally(() => setRuntimeInstalling(false));
  }, [refreshRuntime, runtimeInstalling]);

  const runGridCalculation = useCallback(() => {
    if (sourceState.status !== "collection" || calculatingGrid) return;
    const totalRows = gridSummary?.totalRows ?? 0;
    setGridJob(pendingGridJobStatus(
      sourceState.documentId,
      totalRows,
      totalRows > 0
        ? `Starting descriptor calculation for ${totalRows.toLocaleString()} molecule${totalRows === 1 ? "" : "s"}...`
        : "Starting descriptor calculation...",
    ));
    setCalculatingGrid(true);
    setError(null);
    void calculateGridDescriptors(sourceState.documentId, sourceState.path)
      .then((status) => {
        setGridJob(status);
        if (status.summary) setGridSummary(status.summary);
        if (status.rows?.length) actions.applyGridDescriptorResults(sourceState.documentId, status.rows);
        setCalculatingGrid(status.running);
      })
      .catch((calculateError) => {
        const message = calculateError instanceof Error ? calculateError.message : String(calculateError);
        setGridJob(failedGridJobStatus(sourceState.documentId, totalRows, message));
        setError(message);
        setCalculatingGrid(false);
      });
  }, [actions, calculatingGrid, gridSummary?.totalRows, sourceState]);

  const cancelGridCalculation = useCallback(() => {
    if (sourceState.status !== "collection" || !gridJob?.running) return;
    setError(null);
    void cancelGridDescriptorJob(sourceState.documentId)
      .then((status) => {
        setGridJob(status);
        if (status.summary) setGridSummary(status.summary);
        setCalculatingGrid(status.running);
      })
      .catch((cancelError) => {
        setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
      })
  }, [gridJob?.running, sourceState]);

  useEffect(() => {
    if (sourceState.status !== "collection") return undefined;
    const onGridJob = (event: Event) => {
      const status = (event as CustomEvent<GridDescriptorJobStatus>).detail;
      if (!status || status.documentId !== sourceState.documentId) return;
      setGridJob(status);
      if (status.summary) setGridSummary(status.summary);
      setCalculatingGrid(status.running);
      if (status.status === "failed" && status.message) setError(status.message);
    };
    window.addEventListener(GRID_DESCRIPTOR_JOB_EVENT, onGridJob);
    return () => window.removeEventListener(GRID_DESCRIPTOR_JOB_EVENT, onGridJob);
  }, [sourceState]);

  useEffect(() => {
    if (sourceState.status !== "collection") return undefined;
    let cancelled = false;
    const wasRunning = gridJob?.running === true;
    const refreshJob = () => {
      void gridDescriptorJobStatus(sourceState.documentId)
        .then((status) => {
          if (cancelled) return;
          setGridJob(status);
          if (status.summary) setGridSummary(status.summary);
          setCalculatingGrid(status.running);
          if (wasRunning && !status.running && status.status !== "idle") {
            if (status.rows?.length) actions.applyGridDescriptorResults(sourceState.documentId, status.rows);
            actions.applyGridDescriptorControls(sourceState.documentId, { filters: [], descriptorSort: null });
          }
        })
        .catch((statusError) => {
          if (cancelled) return;
          setError(statusError instanceof Error ? statusError.message : String(statusError));
          setCalculatingGrid(false);
        });
    };
    refreshJob();
    const timer = window.setInterval(refreshJob, gridJob?.running ? 1200 : 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [actions, gridJob?.running, sourceState]);

  useEffect(() => {
    if (!runtime?.available || !source || !sourceKey || result || calculating || autoCalculatedSourceKey === sourceKey) {
      return;
    }
    setAutoCalculatedSourceKey(sourceKey);
    runCalculation();
  }, [autoCalculatedSourceKey, calculating, result, runCalculation, runtime?.available, source, sourceKey]);

  useEffect(() => {
    if (
      !runtime?.available ||
      !collectionDocumentId ||
      calculatingGrid ||
      autoCalculatedGridId === collectionDocumentId ||
      !gridSummary ||
      gridSummary.totalRows === 0 ||
      gridSummary.totalRows > AUTO_GRID_DESCRIPTOR_LIMIT ||
      gridSummary.calculatedRows > 0 ||
      gridSummary.descriptorIds.length > 0
    ) {
      return;
    }
    setAutoCalculatedGridId(collectionDocumentId);
    runGridCalculation();
  }, [
    autoCalculatedGridId,
    calculatingGrid,
    collectionDocumentId,
    gridSummary,
    runGridCalculation,
    runtime?.available,
  ]);

  const applyCollectionControls = useCallback(() => {
    if (sourceState.status !== "collection") return;
    const controls: GridDescriptorControls = {
      filters: descriptorFilterFromInputs(filterDescriptorId, filterMin, filterMax),
      descriptorSort: sortDescriptorId ? { id: sortDescriptorId, direction: sortDirection } : null,
    };
    actions.applyGridDescriptorControls(sourceState.documentId, controls);
  }, [actions, filterDescriptorId, filterMax, filterMin, sortDescriptorId, sortDirection, sourceState]);

  const clearCollectionControls = useCallback(() => {
    if (sourceState.status !== "collection") return;
    setFilterMin("");
    setFilterMax("");
    actions.applyGridDescriptorControls(sourceState.documentId, { filters: [], descriptorSort: null });
  }, [actions, sourceState]);

  const copyResults = useCallback(() => {
    if (!result?.values.length || !navigator.clipboard?.writeText) return;
    const lines = result.values.map((value) => `${value.label}\t${descriptorValueText(value)}`);
    void navigator.clipboard.writeText(["Descriptor\tValue", ...lines].join("\n"));
  }, [result]);

  const toggleDescriptorInfo = useCallback((id: string) => {
    setOpenDescriptorInfoId((current) => (current === id ? null : id));
  }, []);

  return (
    <div className="dock-content descriptor-panel">
      <section className="descriptor-inspector-header">
        <div className="descriptor-inspector-title">
          <strong>Descriptors</strong>
          <span>{runtimeSummary}</span>
        </div>
        <button
          type="button"
          className="dock-action descriptor-icon-action"
          onClick={refreshRuntime}
          disabled={runtimeLoading}
          aria-label="Refresh descriptor runtime"
          title="Refresh descriptor runtime"
        >
          ↻
        </button>
      </section>

      <section className="descriptor-source-block">
        {sourceState.status === "loading" ? (
          <p className="descriptor-help">Reading active source...</p>
        ) : sourceState.status === "unsupported" ? (
          <p className="descriptor-status-warn">{sourceState.reason}</p>
        ) : (
          <>
            <div className="descriptor-source">
              <strong>{sourceTitle}</strong>
              <span>{sourceMeta}</span>
            </div>
            {descriptorSource ? (
              <button type="button" className="dock-action descriptor-inline-action" onClick={actions.clearDescriptorSource}>
                Clear
              </button>
            ) : null}
          </>
        )}
      </section>

      {!runtime?.available ? (
        <section className="descriptor-runtime-warning">
          <p className="descriptor-status-warn">{runtimeDetails}</p>
          {!runtime?.available && runtime?.installHint ? (
            <p className="descriptor-help">{runtime.installHint}</p>
          ) : null}
          <button
            type="button"
            className="dock-action descriptor-primary-action"
            onClick={installRuntime}
            disabled={runtimeInstalling}
          >
            {runtimeInstalling ? "Installing runtime" : "Install with uv"}
          </button>
        </section>
      ) : null}

      <section className="descriptor-action-block">
        {sourceState.status === "collection" ? (
          isGridRunning ? (
            <div className="descriptor-button-row descriptor-run-row">
              <div className="descriptor-run-title">
                <strong>Calculating descriptors</strong>
              </div>
              <button type="button" className="dock-action descriptor-inline-action" onClick={cancelGridCalculation}>
                Stop
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="dock-action descriptor-primary-action"
                disabled={!runtime?.available}
                onClick={runGridCalculation}
              >
                {gridSummary && gridSummary.calculatedRows > 0 && gridSummary.calculatedRows < gridSummary.totalRows
                  ? "Calculate missing descriptors"
                  : hasGridDescriptors
                    ? "Recalculate all descriptors"
                    : "Calculate descriptors"}
              </button>
              {!hasGridDescriptors ? <p className="descriptor-help">All Mordred 2D descriptors. Manual run recommended for large collections.</p> : null}
            </>
          )
        ) : (
          <>
            <button
              type="button"
              className="dock-action descriptor-primary-action"
              disabled={!runtime?.available || !source || calculating}
              onClick={runCalculation}
            >
              {calculating ? "Calculating descriptors" : "Calculate all descriptors"}
            </button>
            {source ? (
              <p className="descriptor-help">Mordred 2D · all available descriptors · may take time on large collections.</p>
            ) : null}
          </>
        )}
      </section>

      {sourceState.status === "collection" && showGridProgress ? (
        <div className="descriptor-job-status" data-status={gridJob?.status}>
          <div className="descriptor-job-row">
            <strong>{gridProgressTitle}</strong>
            <span>{gridProgress.label}</span>
          </div>
          <div
            className="descriptor-progress"
            data-indeterminate={gridJob?.running && gridProgress.percent === 0 ? "true" : "false"}
            aria-label="Descriptor calculation progress"
          >
            <span style={{ width: `${gridProgress.width}%` }} />
          </div>
          <div className="descriptor-job-row descriptor-job-counts">
            <span>{gridJob?.message}</span>
            {(gridJob?.failedRows ?? 0) > 0 ? <span>{(gridJob?.failedRows ?? 0).toLocaleString()} failed</span> : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="descriptor-status-warn">{error}</p> : null}

      {runtimeInstalling ? (
        <div className="descriptor-job-status" data-status="running">
          <div className="descriptor-job-row">
            <strong>Installing descriptor runtime with uv...</strong>
            <span>0%</span>
          </div>
          <div className="descriptor-progress" data-indeterminate="true" aria-label="Descriptor runtime install progress">
            <span style={{ width: "0%" }} />
          </div>
        </div>
      ) : null}

      {showCollectionSummary ? (
        <section className="descriptor-section descriptor-results-section">
          <div className="descriptor-section-header">
            <span>
              Summary
              <DescriptorInfoButton
                id="descriptors"
                label="Descriptors"
                open={openDescriptorInfoId === "descriptors"}
                onToggle={toggleDescriptorInfo}
              />
            </span>
          </div>
          {openDescriptorInfoId === "descriptors" ? <DescriptorInfoCard id="descriptors" label="Descriptors" /> : null}
          <div className="descriptor-summary-row">
            <DescriptorMetric label="Rows" value={gridSummary.totalRows.toLocaleString()} />
            <DescriptorMetric label="Calculated" value={gridSummary.calculatedRows.toLocaleString()} />
            <DescriptorMetric label="Failed" value={gridSummary.failedRows.toLocaleString()} />
            <DescriptorMetric label="Descriptors" value={gridSummary.descriptorIdCount.toLocaleString()} />
          </div>
          {showCollectionControls ? (
            <div className="descriptor-controls">
              <div className="descriptor-controls-header">
                <strong>Visible columns</strong>
              </div>
              <div className="descriptor-chip-row">
                {visibleDescriptorChips.map((definition) => (
                  <span className="descriptor-chip" key={definition.id}>{definition.label}</span>
                ))}
                {descriptorDefinitions.length > visibleDescriptorChips.length ? (
                  <span className="descriptor-chip descriptor-chip-muted">+{descriptorDefinitions.length - visibleDescriptorChips.length}</span>
                ) : null}
              </div>
              <details className="descriptor-control-disclosure" open={Boolean(filterMin || filterMax)}>
                <summary>Filters</summary>
                <DescriptorPicker
                  label="Filter descriptor"
                  definitions={descriptorDefinitions}
                  selectedId={filterDescriptorId}
                  onSelect={setFilterDescriptorId}
                />
                <div className="descriptor-range-row">
                  <label>
                    Min
                    <input value={filterMin} inputMode="decimal" onChange={(event) => setFilterMin(event.currentTarget.value)} />
                  </label>
                  <label>
                    Max
                    <input value={filterMax} inputMode="decimal" onChange={(event) => setFilterMax(event.currentTarget.value)} />
                  </label>
                </div>
              </details>
              <details className="descriptor-control-disclosure">
                <summary>Sort</summary>
                <DescriptorPicker
                  label="Sort descriptor"
                  definitions={descriptorDefinitions}
                  selectedId={sortDescriptorId}
                  onSelect={setSortDescriptorId}
                />
                <div className="descriptor-range-row">
                  <label>
                    Direction
                    <select value={sortDirection} onChange={(event) => setSortDirection(event.currentTarget.value === "desc" ? "desc" : "asc")}>
                      <option value="asc">Low to high</option>
                      <option value="desc">High to low</option>
                    </select>
                  </label>
                </div>
              </details>
              <div className="descriptor-button-row">
                <button type="button" className="dock-action descriptor-inline-action" onClick={applyCollectionControls}>Apply to table</button>
                <button type="button" className="dock-action descriptor-inline-action" onClick={clearCollectionControls}>Clear</button>
              </div>
            </div>
          ) : !showGridProgress ? (
            <p className="descriptor-help">No descriptor columns have been calculated yet.</p>
          ) : null}
        </section>
      ) : null}

      {result ? (
        <section className="descriptor-section descriptor-results-section">
          <div className="descriptor-section-header">
            <span>
              Results
              <DescriptorInfoButton
                id="descriptors"
                label="Descriptors"
                open={openDescriptorInfoId === "descriptors"}
                onToggle={toggleDescriptorInfo}
              />
            </span>
            <button type="button" className="dock-action descriptor-inline-action" onClick={copyResults} disabled={!result.values.length}>
              Copy
            </button>
          </div>
          {openDescriptorInfoId === "descriptors" ? <DescriptorInfoCard id="descriptors" label="Descriptors" /> : null}
          {result.molecule ? (
            <div className="descriptor-summary-row">
              <DescriptorMetric label="Atoms" value={String(result.molecule.atomCount)} />
              <DescriptorMetric label="Bonds" value={String(result.molecule.bondCount)} />
              <DescriptorMetric label="Values" value={String(result.values.length)} />
            </div>
          ) : null}
          <div className="descriptor-table" role="table" aria-label="Descriptor results">
            {result.values.map((value) => (
              <div className="descriptor-row" role="row" key={value.id}>
                <span role="cell" className="descriptor-name-cell">
                  <span>{value.label}</span>
                  <DescriptorInfoButton
                    id={value.id}
                    label={value.label}
                    open={openDescriptorInfoId === value.id}
                    onToggle={toggleDescriptorInfo}
                  />
                </span>
                <strong role="cell">{descriptorValueText(value)}</strong>
                {openDescriptorInfoId === value.id ? <DescriptorInfoCard id={value.id} label={value.label} /> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function descriptorFilterFromInputs(id: string, minText: string, maxText: string) {
  if (!id) return [];
  const min = optionalFiniteNumber(minText);
  const max = optionalFiniteNumber(maxText);
  if (min === undefined && max === undefined) return [];
  return [{ id, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) }];
}

function optionalFiniteNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : undefined;
}

function DescriptorPicker({
  label,
  definitions,
  selectedId,
  onSelect,
}: {
  label: string;
  definitions: DescriptorDefinition[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!normalizedQuery) return definitions;
    return definitions.filter((definition) => descriptorPickerSearchText(definition).includes(normalizedQuery));
  }, [definitions, normalizedQuery]);
  const visibleMatches = matches;
  const selectedDefinition = useMemo(
    () => definitions.find((definition) => definition.id === selectedId) ?? (selectedId ? descriptorDefinition(selectedId) : null),
    [definitions, selectedId],
  );
  return (
    <div className="descriptor-picker">
      <label>
        {label}
        <input
          type="search"
          value={query}
          placeholder="Search by id, module, description"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="descriptor-picker-selected">
        <strong>{selectedDefinition?.label ?? "No descriptor selected"}</strong>
        <span>{selectedId || "Choose a descriptor"}</span>
      </div>
      <div className="descriptor-picker-list" role="listbox" aria-label={label}>
        {visibleMatches.map((definition) => (
          <button
            key={definition.id}
            type="button"
            role="option"
            aria-selected={definition.id === selectedId}
            className={definition.id === selectedId ? "active" : ""}
            onClick={() => onSelect(definition.id)}
          >
            <strong>{definition.label}</strong>
            <span>{definition.id}</span>
            <small>{definition.module}</small>
          </button>
        ))}
        {matches.length === 0 ? <div className="descriptor-picker-more">No matching descriptors.</div> : null}
      </div>
    </div>
  );
}

function descriptorPickerSearchText(definition: DescriptorDefinition) {
  return [
    definition.id,
    definition.label,
    definition.module,
    definition.description,
    definition.units ?? "",
  ].join(" ").toLowerCase();
}

function DescriptorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dock-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DescriptorInfoButton({
  id,
  label,
  open,
  onToggle,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const definition = descriptorInfoDefinition(id, label);
  return (
    <button
      type="button"
      className="descriptor-info-button"
      aria-label={`${open ? "Hide" : "Explain"} ${definition.label}`}
      aria-expanded={open}
      title={`${definition.label}: ${definition.description}`}
      onClick={() => onToggle(id)}
    >
      i
    </button>
  );
}

function DescriptorInfoCard({ id, label }: { id: string; label: string }) {
  const definition = descriptorInfoDefinition(id, label);
  const details = [definition.module, definition.units].filter(Boolean).join(" / ");
  return (
    <div className="descriptor-info-card" role="tooltip">
      <strong>{definition.label}</strong>
      {details ? <small>{details}</small> : null}
      <span>{definition.description}</span>
    </div>
  );
}

function descriptorInfoDefinition(id: string, label: string) {
  const definition = id === "descriptors"
    ? {
        label: "Descriptors",
        module: "Mordred",
        description: "Molecular descriptors are numeric features computed from a molecule. They are useful for filtering, sorting, comparing, and building QSAR or screening tables.",
        units: undefined,
      }
    : descriptorDefinition(id, label);
  return definition;
}

function DescriptorDefinitionNote({ id }: { id: string }) {
  if (!id) return null;
  const definition = descriptorDefinition(id);
  return (
    <p className="descriptor-definition-note">
      <strong>{definition.label}</strong>
      <span>{definition.description}</span>
    </p>
  );
}

function descriptorValueText(value: {
  value?: number | string | boolean | null;
  missingKind?: string | null;
  errorText?: string | null;
}) {
  if (value.errorText) return value.errorText;
  if (value.missingKind) return value.missingKind;
  if (typeof value.value === "number") return Number.isInteger(value.value) ? String(value.value) : value.value.toPrecision(6);
  if (typeof value.value === "boolean") return value.value ? "true" : "false";
  if (value.value === null || value.value === undefined) return "Missing";
  return String(value.value);
}
