import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  cancelChemicalSpaceModelRuntimeInstall,
  chemicalSpaceScopeSignature,
  computeErrorMessage,
  fetchChemicalSpaceModelRuntimeStatus,
  invalidateChemicalSpaceFingerprintCache,
  isRepresentationUnavailableError,
  runChemicalSpaceClusteringWorkflow,
  runChemicalSpaceWorkflow,
  runChemicalSpaceStudyWorkflow,
  startChemicalSpaceModelRuntimeInstall,
  type BrowserChemicalSpaceInputRecord,
  type ChemicalSpaceModelRuntimeStatus,
  type ChemicalSpaceOptions,
  type ChemicalSpaceMethod,
  type ChemicalSpaceClusterResult,
  type ChemicalSpaceRepresentation,
  type ChemicalSpaceProgress,
  type ChemicalSpaceResult,
} from "../lib/compute-cluster";
import {
  runBrowserDevChemicalSpace,
  runBrowserDevChemicalSpaceClustering,
  runBrowserDevChemicalSpaceStudy,
} from "../lib/browser-dev-compute";
import { normalizeChemicalSpacePositions } from "../lib/chemical-space-normalization";
import {
  buildCameraScreenPointIndex,
  buildSpatialPointIndex,
  nearestScreenPoint,
  sourceRecordIdsInSpatialPolygon,
  type ScreenPointIndex,
  type SpatialPointIndex,
} from "../lib/chemical-space-screen-index";
import {
  simplifyLassoPolygon,
} from "../lib/chemical-space-lasso";
import { isTauriRuntime } from "../lib/tauri";
import { activeViewerIframeForDocument, isKnownViewerMessageSource } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";
import { useThemePortalContainer } from "./radix-menu";

const ChemicalSpace3D = lazy(() => import("./chemical-space-3d").then((module) => ({
  default: module.ChemicalSpace3D,
})));

type ChemicalSpacePanelProps = {
  document: ViewerDocument | null;
};

type Point2 = { x: number; y: number };
type ProjectedPoint = Point2 & { sourceRecordId: number; depth: number };
type MoleculePreview = {
  sourceRecordId: number;
  name: string;
  smiles: string;
  svgUrl: string | null;
};
type StudyParameter = "neighbors" | "minDist" | "learningRate";
type StudyState = {
  parameter: StudyParameter;
  range: [number, number];
  frames: number;
};
type CompletedStudy = {
  results: ChemicalSpaceResult[];
};
type ClusteringMethod = "none" | "butina";
type GridIndexState = {
  recordsIndexed: number;
  recordsTotal: number;
  bytesIndexed: number;
  bytesTotal: number;
  indexing: boolean;
  indexReady: boolean;
  indexError: string | null;
  sourceRevision: number;
};
type ActivityColumn = { id: string; label: string };
type ActivityDirection = "higherActive" | "lowerActive";
type ActivityColoring = { colors: Map<number, string>; min: number; max: number };
type ActivityCliff = {
  sourceA: number;
  sourceB: number;
  indexA: number;
  indexB: number;
  similarity: number;
  delta: number;
  sali: number;
};

const DEFAULT_OPTIONS: ChemicalSpaceOptions = {
  representation: "morgan",
  method: "umap",
  dimensions: 2,
  neighbors: 15,
  epochs: 500,
  minDist: 0.1,
  spread: 1,
  learningRate: 1,
  negativeSampleRate: 5,
  randomSeed: 42,
};
// ChemBERTa and Uni-Mol v1 stay supported by the worker for old documents,
// but the picker offers only the representations worth choosing today:
// Morgan for SAR work, MoLFormer for learned 2D chemistry, Uni-Mol2 for 3D.
const CHEMICAL_SPACE_REPRESENTATIONS: Array<{
  value: ChemicalSpaceRepresentation;
  label: string;
}> = [
  { value: "morgan", label: "Morgan · Tanimoto" },
  { value: "molformer", label: "MoLFormer XL" },
  { value: "unimol2-84m", label: "Uni-Mol2 84M" },
];
const CHEMICAL_SPACE_METHODS: Array<{ value: ChemicalSpaceMethod; label: string }> = [
  { value: "umap", label: "UMAP" },
  { value: "tmap", label: "TMAP" },
  { value: "tsne", label: "t-SNE" },
  { value: "pacmap", label: "PaCMAP" },
  { value: "localmap", label: "LocalMAP" },
  { value: "trimap", label: "TriMap" },
  { value: "dreams", label: "DREAMS" },
  { value: "cne", label: "CNE" },
  { value: "mmae", label: "MMAE" },
];
const completedEmbeddings = new Map<string, ChemicalSpaceResult>();
let completedEmbeddingRecordCount = 0;
const MAX_COMPLETED_EMBEDDING_CACHE_ENTRIES = 6;
const MAX_COMPLETED_EMBEDDING_CACHE_RECORDS = 500_000;
const GRID_SELECTION_BRIDGE_LIMIT = 100_000;
const MAX_MOLECULE_PREVIEW_BASE64_BYTES = 350_000;
const MAX_LASSO_POINTS = 1_024;
const MAX_HIGHLIGHT_POINTS = 4_096;
const MAX_VISIBLE_EDGES = 30_000;
// Cliff edges beyond the strongest pairs turn the map into a hairball; the
// table still lists everything, the map draws only the top of the ranking.
const MAX_VISIBLE_CLIFF_EDGES = 150;
const DEFAULT_TMAP_LINE_SCALE = 1;
const CLUSTER_COLORS = [
  "#38bdf8", "#fb7185", "#4ade80", "#facc15", "#f97316",
  "#22d3ee", "#a3e635", "#f472b6", "#60a5fa", "#fbbf24",
] as const;
const DEFAULT_STUDY: StudyState = {
  parameter: "minDist",
  range: [0.02, 0.6],
  frames: 8,
};
// Collections at or below this size embed fast enough that opening the panel can
// just run them. Larger ones wait for an explicit confirmation, because a
// several-hundred-thousand molecule embedding is a long, heavy job that nobody
// asked for by merely opening a tab.
const AUTO_RUN_RECORD_LIMIT = 5_000;
// Throughput used to estimate how long an embedding will take, refined from the
// last run that completed on this machine. The seed is deliberately pessimistic;
// it only has to put the first estimate in the right order of magnitude.
const SEED_RECORDS_PER_SECOND = 1_200;
const THROUGHPUT_STORAGE_KEY = "burette.chemicalSpace.recordsPerSecond";

function storedThroughput(): number {
  const raw = Number(localStorage.getItem(THROUGHPUT_STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : SEED_RECORDS_PER_SECOND;
}

function rememberThroughput(records: number, elapsedMs: number) {
  if (records <= 0 || elapsedMs <= 0) return;
  const observed = records / (elapsedMs / 1000);
  if (!Number.isFinite(observed) || observed <= 0) return;
  // Average with the previous figure so one unusual run cannot swing the estimate.
  const blended = (storedThroughput() + observed) / 2;
  localStorage.setItem(THROUGHPUT_STORAGE_KEY, String(Math.round(blended)));
}

function formatDuration(seconds: number): string {
  if (seconds < 45) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

function estimatedEmbeddingDuration(records: number): string {
  return formatDuration(records / storedThroughput());
}

function indexingProgressLabel(state: GridIndexState | null) {
  const records = state?.recordsIndexed.toLocaleString() ?? "0";
  if (!state || state.bytesTotal <= 0) return `${records} molecules indexed`;
  const percent = Math.min(99, Math.max(0, Math.floor((state.bytesIndexed / state.bytesTotal) * 100)));
  return `${percent}% · ${records} molecules indexed`;
}

export function ChemicalSpacePanel({ document }: ChemicalSpacePanelProps) {
  const portalContainer = useThemePortalContainer();
  const [draft, setDraft] = useState(DEFAULT_OPTIONS);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [result, setResult] = useState<ChemicalSpaceResult | null>(null);
  const [progress, setProgress] = useState<ChemicalSpaceProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCliffIndex, setActiveCliffIndex] = useState<number | null>(null);
  // A missing learned-model runtime is a configuration state, not a transient
  // failure, so the panel offers installation and a way back to Morgan
  // instead of Retry.
  const [errorNeedsModelRuntime, setErrorNeedsModelRuntime] = useState(false);
  const [learnedRepsInstalled, setLearnedRepsInstalled] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [visibleSourceIds, setVisibleSourceIds] = useState<Set<number> | null>(null);
  // "all" embeds the whole collection and dims filtered-out molecules;
  // "filtered" recomputes the embedding over just the filtered subset.
  const [scope, setScope] = useState<"all" | "filtered">("all");
  const [hovered, setHovered] = useState<number | null>(null);
  const [preview, setPreview] = useState<MoleculePreview | null>(null);
  const [pointScale, setPointScale] = useState(1);
  const [tmapLineScale, setTmapLineScale] = useState(DEFAULT_TMAP_LINE_SCALE);
  const [tool, setTool] = useState<"navigate" | "lasso">("navigate");
  const [study, setStudy] = useState(DEFAULT_STUDY);
  const [completedStudy, setCompletedStudy] = useState<CompletedStudy | null>(null);
  const [studyPosition, setStudyPosition] = useState(0);
  const [studyPlaying, setStudyPlaying] = useState(false);
  const [studyRunning, setStudyRunning] = useState(false);
  const [clusteringMethod, setClusteringMethod] = useState<ClusteringMethod>("none");
  const [clusterCutoff, setClusterCutoff] = useState(0.6);
  const [clusterResult, setClusterResult] = useState<ChemicalSpaceClusterResult | null>(null);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [clusterRunning, setClusterRunning] = useState(false);
  const [activityColumns, setActivityColumns] = useState<ActivityColumn[]>([]);
  const [activityColumnId, setActivityColumnId] = useState<string | null>(null);
  const [activityDirection, setActivityDirection] = useState<ActivityDirection>("higherActive");
  const [activityValues, setActivityValues] = useState<Map<number, number>>(new Map());
  const [cliffsEnabled, setCliffsEnabled] = useState(false);
  const [cliffMinSimilarity, setCliffMinSimilarity] = useState(0.6);
  const [cliffMinDelta, setCliffMinDelta] = useState(1);
  const [indexState, setIndexState] = useState<GridIndexState | null>(null);
  const [indexStateDocumentKey, setIndexStateDocumentKey] = useState<string | null>(null);
  // Whether the index state above has been answered yet. Until it has, the size
  // of the collection is unknown, and treating unknown as "small and ready" let
  // the panel submit the job the gate exists to hold back.
  const [indexProbed, setIndexProbed] = useState(false);
  const [indexProbeError, setIndexProbeError] = useState<string | null>(null);
  const [indexProbeAttempt, setIndexProbeAttempt] = useState(0);
  const [confirmedLargeRunDocumentKey, setConfirmedLargeRunDocumentKey] = useState<string | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const sourceRevisionRef = useRef(0);
  useEffect(() => {
    let disposed = false;
    void fetchChemicalSpaceModelRuntimeStatus()
      .then((status) => {
        if (!disposed) setLearnedRepsInstalled(status.installed);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);
  const workflowControllerRef = useRef<AbortController | null>(null);
  const studyControllerRef = useRef<AbortController | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const documentId = document?.renderer === "grid2d" ? document.id : null;
  const documentInstanceKey = useMemo(
    () => document?.renderer === "grid2d" ? gridDocumentInstanceKey(document) : null,
    [document],
  );
  hoveredRef.current = hovered;
  const applySourceRevision = useCallback((nextRevision: number) => {
    if (
      !documentId
      || !Number.isSafeInteger(nextRevision)
      || nextRevision <= sourceRevisionRef.current
    ) return;
    sourceRevisionRef.current = nextRevision;
    workflowControllerRef.current?.abort();
    workflowControllerRef.current = null;
    studyControllerRef.current?.abort();
    studyControllerRef.current = null;
    invalidateChemicalSpaceFingerprintCache(documentId);
    invalidateCompletedEmbeddings(documentId);
    setProgress(null);
    setResult(null);
    setCompletedStudy(null);
    setStudyRunning(false);
    setStudyPlaying(false);
    setClusterResult(null);
    setConfirmedLargeRunDocumentKey(null);
    setSourceRevision(nextRevision);
  }, [documentId]);
  const commitOptions = (next: ChemicalSpaceOptions) => {
    setCompletedStudy(null);
    setStudyPlaying(false);
    setStudyPosition(0);
    setOptions(next);
  };

  useEffect(() => {
    setResult(null);
    setError(null);
    setErrorNeedsModelRuntime(false);
    setProgress(null);
    setSelected(new Set());
    setVisibleSourceIds(null);
    setHovered(null);
    setPreview(null);
    setTmapLineScale(DEFAULT_TMAP_LINE_SCALE);
    setCompletedStudy(null);
    setStudyPosition(0);
    setStudyPlaying(false);
    setStudyRunning(false);
    setClusterResult(null);
    setClusterError(null);
    setClusterRunning(false);
    setActivityColumnId(null);
    setActivityDirection("higherActive");
    setActivityValues(new Map());
    setCliffsEnabled(false);
    setCliffMinSimilarity(0.6);
    setCliffMinDelta(1);
    setConfirmedLargeRunDocumentKey(null);
    sourceRevisionRef.current = 0;
    setSourceRevision(0);
    setIndexProbeError(null);
  }, [documentInstanceKey]);

  // Polls the grid runtime while it indexes. Compute is refused until the index
  // is complete, so the panel has to know that state rather than submitting and
  // reporting the refusal as a failure.
  useEffect(() => {
    if (!documentId) {
      setIndexState(null);
      setIndexStateDocumentKey(null);
      setIndexProbed(true);
      return;
    }
    setIndexState(null);
    setIndexStateDocumentKey(documentInstanceKey);
    setIndexProbed(false);
    setIndexProbeError(null);
    const controller = new AbortController();
    let timer = 0;
    const poll = () => {
      void requestChemicalSpaceIndexState(documentId, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          applySourceRevision(next.sourceRevision);
          setIndexState(next);
          setIndexStateDocumentKey(documentInstanceKey);
          setIndexProbed(true);
          setIndexProbeError(null);
          if (!next.indexError && (!next.indexReady || next.indexing)) {
            timer = window.setTimeout(poll, 800);
          }
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (isTauriRuntime()) {
            setIndexState(null);
            setIndexStateDocumentKey(documentInstanceKey);
            setIndexProbed(true);
            setIndexProbeError("Could not verify the collection index. No calculation was started.");
            return;
          }
          // Browser-dev has no native Grid index contract, so retain its existing
          // fail-open fallback after the probe has timed out.
          setIndexState(null);
          setIndexStateDocumentKey(documentInstanceKey);
          setIndexProbed(true);
        });
    };
    poll();
    return () => {
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [applySourceRevision, documentId, documentInstanceKey, indexProbeAttempt]);

  useEffect(() => {
    if (!documentId) {
      setActivityColumns([]);
      return;
    }
    const controller = new AbortController();
    void requestChemicalSpaceColumns(documentId, controller.signal)
      .then((columns) => {
        if (!controller.signal.aborted) setActivityColumns(columns);
      })
      .catch(() => {
        if (!controller.signal.aborted) setActivityColumns([]);
      });
    return () => controller.abort();
  }, [documentId, documentInstanceKey, sourceRevision]);

  useEffect(() => {
    if (!documentId || !activityColumnId) {
      setActivityValues(new Map());
      return;
    }
    const controller = new AbortController();
    void requestChemicalSpaceColumnValues(documentId, activityColumnId, controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) setActivityValues(new Map(entries));
      })
      .catch(() => {
        if (!controller.signal.aborted) setActivityValues(new Map());
      });
    return () => controller.abort();
  }, [documentId, documentInstanceKey, sourceRevision, activityColumnId]);

  useEffect(() => {
    if (activityValues.size === 0) return;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of activityValues.values()) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const range = max - min;
    setCliffMinDelta(range > 0 ? Math.round(range * 0.2 * 100) / 100 : 1);
  }, [activityValues]);

  const indexStateMatchesDocument = indexStateDocumentKey === documentInstanceKey;
  const recordCount = indexStateMatchesDocument ? indexState?.recordsTotal ?? 0 : 0;
  const indexing = indexStateMatchesDocument && indexState?.indexing === true;
  const indexReady = !isTauriRuntime()
    || (indexStateMatchesDocument && indexState?.indexReady === true && indexState?.indexError === null);
  // A filter can only ever shrink the collection, so the confirmation gate and
  // the run-size estimate follow the scoped subset when it is active.
  const scopedSourceIds = useMemo(
    () => (scope === "filtered" && visibleSourceIds
      ? [...visibleSourceIds].sort((left, right) => left - right)
      : null),
    [scope, visibleSourceIds],
  );
  const scopeKey = useMemo(
    () => (scopedSourceIds ? chemicalSpaceScopeSignature(scopedSourceIds) : "all"),
    [scopedSourceIds],
  );
  const effectiveRecordCount = scopedSourceIds ? scopedSourceIds.length : recordCount;
  useEffect(() => {
    if (scope === "filtered" && !visibleSourceIds) setScope("all");
  }, [scope, visibleSourceIds]);
  const largeRunConfirmationKey = documentInstanceKey === null
    ? null
    : `${documentInstanceKey}:${sourceRevision}:${scopeKey}`;
  const needsConfirmation = indexReady
    && !indexing
    && effectiveRecordCount > AUTO_RUN_RECORD_LIMIT
    && confirmedLargeRunDocumentKey !== largeRunConfirmationKey;
  // An unanswered probe holds the job back: the collection could be mid-index or
  // far past the auto-run limit, and both are decided by the answer.
  const awaitingIndexState = indexStateDocumentKey !== documentInstanceKey || !indexProbed;
  const computeBlockedByIndex = awaitingIndexState || indexProbeError !== null || !indexReady || indexing;

  useEffect(() => {
    if (!documentId || !documentInstanceKey) return;
    // A cached embedding is still a compute result and therefore must obey the
    // same source-index and explicit-large-run gates as a fresh submission.
    // Otherwise reopening a changed source at the same path could display a
    // stale map while the replacement source is still being indexed.
    if (computeBlockedByIndex || needsConfirmation) {
      setResult(null);
      setProgress(null);
      return;
    }
    if (scopedSourceIds && scopedSourceIds.length < 2) {
      setResult(null);
      setProgress(null);
      setError("The active filters leave fewer than two molecules to embed.");
      setErrorNeedsModelRuntime(false);
      return;
    }
    const key = embeddingCacheKey(documentId, documentInstanceKey, sourceRevision, options, scopeKey);
    const cached = cachedCompletedEmbedding(key);
    if (cached) {
      setResult(cached);
      setProgress(null);
      setError(null);
      setErrorNeedsModelRuntime(false);
      return;
    }
    const startedAt = Date.now();
    const controller = new AbortController();
    workflowControllerRef.current = controller;
    setResult(null);
    setError(null);
    setErrorNeedsModelRuntime(false);
    setProgress({ phase: "queued" });
    const workflow = isTauriRuntime()
      ? runChemicalSpaceWorkflow(documentId, options, setProgress, controller.signal, scopedSourceIds)
      : requestBrowserChemicalSpaceRecords(documentId, controller.signal)
        .then((records) => runBrowserDevChemicalSpace(
          scopedBrowserRecords(records, scopedSourceIds),
          options,
          setProgress,
          controller.signal,
        ));
    void workflow
      .then((next) => {
        if (controller.signal.aborted) return;
        cacheCompletedEmbedding(key, next);
        rememberThroughput(next.sourceRecordIds.length, Date.now() - startedAt);
        setResult(next);
        setProgress(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setProgress(null);
        setErrorNeedsModelRuntime(isRepresentationUnavailableError(cause));
        setError(computeErrorMessage(cause));
      })
      .finally(() => {
        if (workflowControllerRef.current === controller) {
          workflowControllerRef.current = null;
        }
      });
    return () => {
      controller.abort();
      if (workflowControllerRef.current === controller) {
        workflowControllerRef.current = null;
      }
    };
  }, [computeBlockedByIndex, documentId, documentInstanceKey, needsConfirmation, options, scopeKey, scopedSourceIds, sourceRevision]);

  useEffect(() => {
    // An empty filtered scope must not fall through to the whole collection:
    // preparing a job with no source indexes means "all records".
    const scopeTooSmall = scopedSourceIds !== null && scopedSourceIds.length < 2;
    if (!documentId || clusteringMethod === "none" || computeBlockedByIndex || needsConfirmation || scopeTooSmall) {
      setClusterResult(null);
      setClusterError(null);
      setClusterRunning(false);
      return;
    }
    const controller = new AbortController();
    setClusterRunning(true);
    setClusterError(null);
    setClusterResult(null);
    const updateProgress = () => undefined;
    const workflow = isTauriRuntime()
      ? runChemicalSpaceClusteringWorkflow(documentId, clusterCutoff, updateProgress, controller.signal, scopedSourceIds)
      : requestBrowserChemicalSpaceRecords(documentId, controller.signal)
        .then((records) => runBrowserDevChemicalSpaceClustering(
          scopedBrowserRecords(records, scopedSourceIds),
          clusterCutoff,
          updateProgress,
          controller.signal,
        ));
    void workflow
      .then((next) => {
        if (!controller.signal.aborted) setClusterResult(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setClusterError(computeErrorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setClusterRunning(false);
      });
    return () => controller.abort();
  }, [clusterCutoff, clusteringMethod, computeBlockedByIndex, documentId, needsConfirmation, scopedSourceIds, sourceRevision]);

  useEffect(() => {
    if (!studyPlaying || !completedStudy) return;
    let animationFrame = 0;
    let previousTime = performance.now();
    const animate = (time: number) => {
      const elapsed = Math.min(100, time - previousTime);
      previousTime = time;
      setStudyPosition((value) => (
        value + elapsed / 900 >= completedStudy.results.length - 1
          ? 0
          : value + elapsed / 900
      ));
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [completedStudy, studyPlaying]);

  useEffect(() => {
    if (!documentId) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data && typeof event.data === "object"
        ? event.data as { source?: unknown; body?: Record<string, unknown> }
        : null;
      if (
        data?.source !== "burette-grid"
        || data.body?.documentId !== documentId
        || !isKnownViewerMessageSource(event.source, documentId)
      ) return;
      if (data.body.type === "gridMenuStateChanged" && Array.isArray(data.body.selectedSourceIndexes)) {
        setSelected(new Set(data.body.selectedSourceIndexes
          .slice(0, GRID_SELECTION_BRIDGE_LIMIT)
          .map(Number)
          .filter((index) => Number.isSafeInteger(index) && index >= 0)));
      }
      if (data.body.type === "gridDirtyChanged") {
        const recordsTotal = Number(data.body.recordsTotal);
        const reportedRevision = Number(data.body.sourceRevision);
        if (Number.isSafeInteger(reportedRevision) && reportedRevision >= 0) {
          applySourceRevision(reportedRevision);
        } else if (data.body.dirty === true) {
          applySourceRevision(sourceRevisionRef.current + 1);
        }
        if (Number.isSafeInteger(recordsTotal) && recordsTotal >= 0) {
          setIndexState((current) => current
            ? { ...current, recordsTotal }
            : current);
        }
      }
      if (data.body.type === "chemicalSpaceVisibilityChanged") {
        if (data.body.kind === "filtered" && Array.isArray(data.body.sourceRecordIds)) {
          setVisibleSourceIds(new Set(data.body.sourceRecordIds
            .slice(0, GRID_SELECTION_BRIDGE_LIMIT)
            .map(Number)
            .filter((index) => Number.isSafeInteger(index) && index >= 0)));
        } else {
          setVisibleSourceIds(null);
        }
      }
      if (data.body.type === "gridHoverChanged") {
        const index = Number(data.body.sourceRecordId);
        const nextHovered = Number.isSafeInteger(index) && index >= 0 ? index : null;
        setHovered(nextHovered);
        setPreview((current) => current?.sourceRecordId === nextHovered ? current : null);
      }
      if (data.body.type === "chemicalSpaceMoleculePreview") {
        const index = Number(data.body.sourceRecordId);
        if (!Number.isSafeInteger(index) || index < 0 || index !== hoveredRef.current) {
          setPreview(null);
          return;
        }
        const svgBase64 = typeof data.body.svgBase64 === "string"
          && data.body.svgBase64.length <= MAX_MOLECULE_PREVIEW_BASE64_BYTES
          ? data.body.svgBase64
          : "";
        setPreview({
          sourceRecordId: index,
          name: typeof data.body.name === "string" ? data.body.name : `Molecule ${index + 1}`,
          smiles: typeof data.body.smiles === "string" ? data.body.smiles : "",
          svgUrl: svgBase64 ? `data:image/svg+xml;base64,${svgBase64}` : null,
        });
      }
    };
    window.addEventListener("message", onMessage);
    activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
      source: "burette-grid-host",
      body: { type: "chemicalSpaceRequestState", documentId },
    }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [applySourceRevision, documentId]);

  const postToGrid = useCallback((body: Record<string, unknown>) => {
    if (!documentId) return;
    activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
      source: "burette-grid-host",
      body: { ...body, documentId },
    }, "*");
  }, [documentId]);
  const stopCalculation = useCallback(() => {
    workflowControllerRef.current?.abort();
    workflowControllerRef.current = null;
    setProgress(null);
    setResult(null);
    setError("Calculation stopped.");
    setErrorNeedsModelRuntime(false);
  }, []);
  const stopStudy = useCallback(() => {
    studyControllerRef.current?.abort();
    studyControllerRef.current = null;
    setProgress(null);
    setStudyRunning(false);
  }, []);
  const retryIndexCheck = () => {
    setIndexState(null);
    setIndexStateDocumentKey(documentInstanceKey);
    setIndexProbed(false);
    setIndexProbeError(null);
    setIndexProbeAttempt((attempt) => attempt + 1);
  };

  if (!documentId) {
    return <ChemicalSpaceEmpty message="Open a molecular Grid to build its chemical-space map." />;
  }
  const runningLabel = progressLabel(progress);
  const displayedResult = completedStudy
    ? interpolateStudyResult(completedStudy.results, studyPosition)
    : result;
  const runStudy = async () => {
    if (computeBlockedByIndex || needsConfirmation) return;
    if (scopedSourceIds && scopedSourceIds.length < 2) {
      setError("The active filters leave fewer than two molecules to embed.");
      setErrorNeedsModelRuntime(false);
      return;
    }
    studyControllerRef.current?.abort();
    const controller = new AbortController();
    studyControllerRef.current = controller;
    const values = studyValues(study);
    const frames = values.map((value) => ({
      ...draft,
      [study.parameter]: value,
      randomSeed: draft.randomSeed,
    }));
    setError(null);
    setErrorNeedsModelRuntime(false);
    setProgress({ phase: "queued" });
    setStudyPlaying(false);
    setStudyRunning(true);
    try {
      const results = isTauriRuntime()
        ? await runChemicalSpaceStudyWorkflow(documentId, frames, setProgress, controller.signal, scopedSourceIds)
        : await requestBrowserChemicalSpaceRecords(documentId, controller.signal)
          .then((records) => runBrowserDevChemicalSpaceStudy(
            scopedBrowserRecords(records, scopedSourceIds),
            frames,
            setProgress,
            controller.signal,
          ));
      if (controller.signal.aborted) return;
      const aligned = alignStudyResults(results);
      setCompletedStudy({ results: aligned });
      setStudyPosition(0);
      setStudyPlaying(true);
      setProgress(null);
      setStudyRunning(false);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setProgress(null);
      setStudyRunning(false);
      setErrorNeedsModelRuntime(isRepresentationUnavailableError(cause));
      setError(computeErrorMessage(cause));
    } finally {
      if (studyControllerRef.current === controller) {
        studyControllerRef.current = null;
      }
    }
  };
  const activityColoring = useMemo(
    () => (activityColumnId ? buildActivityColoring(activityValues, activityDirection) : null),
    [activityColumnId, activityValues, activityDirection],
  );
  const cliffs = useMemo(
    () => (cliffsEnabled && displayedResult && activityColumnId
      ? computeActivityCliffs(displayedResult, activityValues, cliffMinSimilarity, cliffMinDelta)
      : []),
    [cliffsEnabled, displayedResult, activityColumnId, activityValues, cliffMinSimilarity, cliffMinDelta],
  );
  const activityColumnLabel = activityColumns.find((column) => column.id === activityColumnId)?.label ?? "activity";
  const cliffDeltaMax = activityColoring && activityColoring.max > activityColoring.min
    ? Math.round((activityColoring.max - activityColoring.min) * 100) / 100
    : 10;
  const cliffDeltaStep = Math.max(0.01, Math.round((cliffDeltaMax / 50) * 100) / 100);
  const cliffsRef = useRef(cliffs);
  cliffsRef.current = cliffs;
  useEffect(() => {
    setActiveCliffIndex(null);
  }, [cliffs]);
  const selectCliffPair = useCallback((cliffIndex: number) => {
    const cliff = cliffsRef.current[cliffIndex];
    if (!cliff) return;
    setActiveCliffIndex(cliffIndex);
    const pair = [cliff.sourceA, cliff.sourceB];
    setSelected(new Set(pair));
    postToGrid({
      type: "chemicalSpaceSelectionChanged",
      sourceRecordIds: pair,
      filterToSelection: false,
    });
  }, [postToGrid]);
  // Rapid hovering over a dense cloud must not spam the grid with preview
  // renders; the highlight is instant, the preview request trails behind.
  const hoverPostTimerRef = useRef(0);
  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="chemical-space-panel">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              size="sm"
              aria-label="Molecular representation engine"
              value={draft.representation}
              onChange={(event) => {
                const representation = event.currentTarget.value as ChemicalSpaceRepresentation;
                const next = { ...draft, representation };
                setDraft(next);
                commitOptions(next);
              }}
            >
              {CHEMICAL_SPACE_REPRESENTATIONS.map((representation) => (
                <NativeSelectOption key={representation.value} value={representation.value}>
                  {representation.value !== "morgan" && learnedRepsInstalled === false
                    ? `${representation.label} · not installed`
                    : representation.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              size="sm"
              aria-label="Chemical-space method"
              value={draft.method}
              onChange={(event) => {
                const method = event.currentTarget.value as ChemicalSpaceMethod;
                const next = { ...draft, method };
                setDraft(next);
                if (method === "tmap") setStudy(studyDefaults("neighbors"));
                commitOptions(next);
              }}
            >
              {CHEMICAL_SPACE_METHODS.map((method) => (
                <NativeSelectOption key={method.value} value={method.value}>{method.label}</NativeSelectOption>
              ))}
            </NativeSelect>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={draft.dimensions.toString()}
              aria-label="Embedding dimensions"
              onValueChange={(value) => {
                if (value !== "2" && value !== "3") return;
                const dimensions = Number(value) as 2 | 3;
                const next = { ...draft, dimensions };
                setDraft(next);
                commitOptions(next);
              }}
            >
              <ToggleGroupItem value="2" aria-label="2D embedding">2D</ToggleGroupItem>
              <ToggleGroupItem value="3" aria-label="3D embedding">3D</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={tool}
              aria-label="Chemical-space interaction"
              onValueChange={(value) => {
                if (value === "navigate" || value === "lasso") setTool(value);
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value="navigate">Explore</ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent showArrow={false}>Pan, orbit, zoom, and inspect molecules</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value="lasso">Lasso</ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent showArrow={false}>Draw a free-form selection linked to Grid</TooltipContent>
              </Tooltip>
            </ToggleGroup>
            {visibleSourceIds || scope === "filtered" ? (
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={scope}
                aria-label="Embedding scope"
                onValueChange={(value) => {
                  if (value === "all" || value === "filtered") setScope(value);
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem value="all">All</ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent showArrow={false}>Embed every molecule and dim the filtered-out ones</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem value="filtered" disabled={!visibleSourceIds}>
                      {visibleSourceIds ? `Filtered · ${visibleSourceIds.size.toLocaleString()}` : "Filtered"}
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent showArrow={false}>Recompute the map over just the filtered molecules</TooltipContent>
                </Tooltip>
              </ToggleGroup>
            ) : null}
            {displayedResult ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    className="ml-auto"
                    variant="outline"
                    aria-label={resultTimingDescription(displayedResult)}
                  >
                    {displayedResult.successfulRecords.toLocaleString()} molecules · Metal
                  </Badge>
                </TooltipTrigger>
                <TooltipContent showArrow={false}>
                  {representationLabel(displayedResult.representation)}
                  {": "}{similarityTimeLabel(displayedResult)}
                  {" · "}{resultTimingLabel(displayedResult)}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Badge className="ml-auto" variant="outline">
                {progress ? <Spinner data-icon="inline-start" /> : null}
                {runningLabel}
              </Badge>
            )}
          </div>
          <div
            className="chemical-space-visual-controls flex w-full items-center gap-3"
            data-testid="chemical-space-visual-controls"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Field orientation="horizontal" className="min-w-0 max-w-44 flex-1 gap-2">
                  <FieldLabel className="chemical-space-control-name shrink-0 text-xs text-muted-foreground">Size</FieldLabel>
                  <Slider
                    className="min-w-10 flex-1"
                    tone="neutral"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={[pointScale]}
                    aria-label="Point size"
                    onValueChange={([value]) => setPointScale(value)}
                  />
                  <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                    {Math.round(pointScale * 100)}%
                  </span>
                </Field>
              </TooltipTrigger>
              <TooltipContent showArrow={false}>Point size · {Math.round(pointScale * 100)}%</TooltipContent>
            </Tooltip>
            {draft.method === "tmap" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Field orientation="horizontal" className="min-w-0 max-w-44 flex-1 gap-2">
                    <FieldLabel className="chemical-space-control-name shrink-0 text-xs text-muted-foreground">Width</FieldLabel>
                    <Slider
                      className="min-w-10 flex-1"
                      tone="neutral"
                      aria-label="TMAP tree line width"
                      min={0.5}
                      max={3}
                      step={0.1}
                      value={[tmapLineScale]}
                      onValueChange={([scale]) => setTmapLineScale(scale)}
                    />
                    <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                      {Math.round(tmapLineScale * 100)}%
                    </span>
                  </Field>
                </TooltipTrigger>
                <TooltipContent showArrow={false}>TMAP line width · {Math.round(tmapLineScale * 100)}%</TooltipContent>
              </Tooltip>
            ) : null}
            {activityColumns.length > 0 ? (
              <Field orientation="horizontal" className="min-w-0 max-w-80 flex-1 gap-2">
                <FieldLabel className="chemical-space-control-name shrink-0 text-xs text-muted-foreground">Activity</FieldLabel>
                <NativeSelect
                  size="sm"
                  className="min-w-28 flex-1"
                  aria-label="Activity colour column"
                  value={activityColumnId ?? ""}
                  onChange={(event) => setActivityColumnId(event.currentTarget.value || null)}
                >
                  <NativeSelectOption value="">None</NativeSelectOption>
                  {activityColumns.map((column) => (
                    <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>
                  ))}
                </NativeSelect>
                {activityColumnId ? (
                  <NativeSelect
                    size="sm"
                    className="shrink-0"
                    aria-label="Activity direction"
                    value={activityDirection}
                    onChange={(event) => setActivityDirection(event.currentTarget.value as ActivityDirection)}
                  >
                    <NativeSelectOption value="higherActive">High = active</NativeSelectOption>
                    <NativeSelectOption value="lowerActive">Low = active</NativeSelectOption>
                  </NativeSelect>
                ) : null}
              </Field>
            ) : null}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {displayedResult ? (
            <ChemicalSpaceCanvas
              result={displayedResult}
              clusters={clusteringMethod === "butina" ? clusterResult : null}
              selected={selected}
              hovered={hovered}
              preview={preview}
              pointScale={pointScale}
              tmapLineScale={tmapLineScale}
              activityColors={activityColoring?.colors ?? null}
              visibleSourceIds={scope === "filtered" ? null : visibleSourceIds}
              cliffs={cliffs}
              activeCliffIndex={activeCliffIndex}
              onSelectCliff={selectCliffPair}
              tool={tool}
              onHover={(sourceRecordId) => {
                setHovered(sourceRecordId);
                setPreview((current) => current?.sourceRecordId === sourceRecordId ? current : null);
                window.clearTimeout(hoverPostTimerRef.current);
                hoverPostTimerRef.current = window.setTimeout(() => {
                  postToGrid({ type: "chemicalSpaceHoverChanged", sourceRecordId });
                }, 120);
              }}
              onSelect={(sourceRecordIds) => {
                const expanded = tool === "navigate" && sourceRecordIds.length === 1
                  ? clusterMembersForSource(clusterResult, sourceRecordIds[0])
                  : sourceRecordIds;
                const bounded = expanded.slice(0, GRID_SELECTION_BRIDGE_LIMIT);
                setSelected(new Set(bounded));
                postToGrid({
                  type: "chemicalSpaceSelectionChanged",
                  sourceRecordIds: bounded,
                  filterToSelection: tool === "lasso",
                });
              }}
            />
          ) : awaitingIndexState ? (
            <ChemicalSpaceChecking message="Checking the collection…" />
          ) : indexProbeError ? (
            <ChemicalSpaceEmpty message={indexProbeError} actionLabel="Retry index check" onAction={retryIndexCheck} />
          ) : indexState?.indexError ? (
            <ChemicalSpaceEmpty
              message={`Collection indexing failed: ${indexState.indexError}. Close and reopen the collection after fixing the source file.`}
            />
          ) : indexing ? (
            <ChemicalSpaceEmpty
              message={`Indexing this collection — ${indexingProgressLabel(indexState)}. Chemical space starts once indexing finishes.`}
            />
          ) : !indexReady ? (
            <ChemicalSpaceEmpty
              message="Waiting for the collection index before starting chemical space."
              actionLabel="Retry index check"
              onAction={retryIndexCheck}
            />
          ) : needsConfirmation ? (
            <ChemicalSpaceEmpty
              message={`${scopedSourceIds ? "The filtered subset has" : "This collection has"} ${effectiveRecordCount.toLocaleString()} molecules. Embedding it takes ${estimatedEmbeddingDuration(effectiveRecordCount)} and runs the whole time.`}
              actionLabel="Calculate chemical space"
              onAction={() => setConfirmedLargeRunDocumentKey(largeRunConfirmationKey)}
            />
          ) : error ? (
            errorNeedsModelRuntime ? (
              <ChemicalSpaceRepresentationUnavailable
                representation={representationLabel(options.representation)}
                onInstalled={() => {
                  setLearnedRepsInstalled(true);
                  commitOptions({ ...draft });
                }}
                onUseMorgan={() => {
                  const next = { ...draft, representation: "morgan" as const };
                  setDraft(next);
                  commitOptions(next);
                }}
              />
            ) : (
              <ChemicalSpaceEmpty message={error} actionLabel="Retry" onAction={() => commitOptions({ ...draft })} />
            )
          ) : (
            <ChemicalSpaceLoading
              message={runningLabel || "Preparing chemical space…"}
              progress={progress}
              onStop={stopCalculation}
            />
          )}
          {displayedResult && activityColoring ? (
            <ActivityLegend
              label={activityColumns.find((column) => column.id === activityColumnId)?.label ?? "Activity"}
              coloring={activityColoring}
              direction={activityDirection}
            />
          ) : null}
          {displayedResult && cliffsEnabled && cliffs.length > 0 ? (
            <CliffTable
              cliffs={cliffs}
              activityLabel={activityColumnLabel}
              activeCliffIndex={activeCliffIndex}
              onSelectPair={selectCliffPair}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-2">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button className="shrink-0" variant="ghost" size="sm">
                {methodLabel(draft.method)} parameters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              sideOffset={8}
              container={portalContainer}
              className="max-h-[min(70vh,32rem)] w-72"
            >
              <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
                <span className="text-sm font-medium text-foreground">
                  {methodLabel(draft.method)} parameters
                </span>
                <span className="font-normal">
                  {draft.method === "tmap"
                    ? `k=${draft.neighbors} · Metal kNN → minimum spanning tree`
                    : `k=${draft.neighbors} · min dist=${draft.minDist.toFixed(2)}`}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup className="px-2 py-1.5">
                <FieldGroup className="gap-3">
                  <ParameterField label="Neighbors" value={draft.neighbors}>
                    <Slider tone="neutral" min={2} max={64} step={1} value={[draft.neighbors]} onValueChange={([neighbors]) => setDraft((value) => ({ ...value, neighbors }))} />
                  </ParameterField>
                  {draft.method !== "tmap" ? (
                    <>
                      <ParameterField label="Minimum distance" value={draft.minDist.toFixed(2)}>
                        <Slider tone="neutral" min={0} max={1} step={0.01} value={[draft.minDist]} onValueChange={([minDist]) => setDraft((value) => ({ ...value, minDist }))} />
                      </ParameterField>
                      <ParameterField label="Cluster spread" value={draft.spread.toFixed(1)}>
                        <Slider tone="neutral" min={1} max={3} step={0.1} value={[draft.spread]} onValueChange={([spread]) => setDraft((value) => ({ ...value, spread }))} />
                      </ParameterField>
                      <ParameterField label="Epochs" value={draft.epochs}>
                        <Slider tone="neutral" min={100} max={1500} step={100} value={[draft.epochs]} onValueChange={([epochs]) => setDraft((value) => ({ ...value, epochs }))} />
                      </ParameterField>
                      <ParameterField label="Learning rate" value={draft.learningRate.toFixed(1)}>
                        <Slider tone="neutral" min={0.1} max={3} step={0.1} value={[draft.learningRate]} onValueChange={([learningRate]) => setDraft((value) => ({ ...value, learningRate }))} />
                      </ParameterField>
                    </>
                  ) : null}
                </FieldGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onSelect={() => {
                    setTmapLineScale(DEFAULT_TMAP_LINE_SCALE);
                    setDraft((current) => ({
                      ...DEFAULT_OPTIONS,
                      representation: current.representation,
                      method: current.method,
                      dimensions: current.dimensions,
                    }));
                  }}
                >
                  Reset to defaults
                </DropdownMenuItem>
                <DropdownMenuItem disabled={Boolean(progress)} onSelect={() => commitOptions({ ...draft })}>
                  Rebuild on Metal
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Clustering</DropdownMenuLabel>
              <DropdownMenuGroup className="px-2 py-1.5">
                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor="chemical-space-clustering">Method</FieldLabel>
                    <NativeSelect
                      id="chemical-space-clustering"
                      size="sm"
                      value={clusteringMethod}
                      onChange={(event) => setClusteringMethod(event.currentTarget.value as ClusteringMethod)}
                    >
                      <NativeSelectOption value="none">None</NativeSelectOption>
                      <NativeSelectOption value="butina">Butina · Tanimoto</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  {clusteringMethod === "butina" ? (
                    <ParameterField label="Tanimoto cutoff" value={clusterCutoff.toFixed(2)}>
                      <Slider
                        tone="neutral"
                        min={0.3}
                        max={0.95}
                        step={0.01}
                        value={[clusterCutoff]}
                        onValueChange={([cutoff]) => setClusterCutoff(cutoff)}
                      />
                    </ParameterField>
                  ) : null}
                </FieldGroup>
              </DropdownMenuGroup>
              {clusteringMethod === "butina" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>
                    {clusterRunning
                      ? "Clustering on Metal…"
                      : clusterError
                        ? clusterError
                        : `${clusterResult?.clusterCount ?? 0} clusters · click a point to select its cluster`}
                  </DropdownMenuLabel>
                </>
              ) : null}
              {activityColumnId ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Activity cliffs</DropdownMenuLabel>
                  <DropdownMenuGroup className="px-2 py-1.5">
                    <FieldGroup className="gap-3">
                      <Field orientation="horizontal" className="items-center justify-between">
                        <FieldLabel htmlFor="chemical-space-cliffs" className="text-xs">Discover cliffs</FieldLabel>
                        <input
                          id="chemical-space-cliffs"
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={cliffsEnabled}
                          onChange={(event) => setCliffsEnabled(event.currentTarget.checked)}
                        />
                      </Field>
                      {cliffsEnabled ? (
                        <>
                          <ParameterField label="Min similarity" value={cliffMinSimilarity.toFixed(2)}>
                            <Slider tone="neutral" min={0.3} max={0.95} step={0.01} value={[cliffMinSimilarity]} onValueChange={([value]) => setCliffMinSimilarity(value)} />
                          </ParameterField>
                          <ParameterField label={`Min Δ ${activityColumnLabel}`} value={cliffMinDelta.toFixed(2)}>
                            <Slider tone="neutral" min={0} max={cliffDeltaMax} step={cliffDeltaStep} value={[Math.min(cliffMinDelta, cliffDeltaMax)]} onValueChange={([value]) => setCliffMinDelta(value)} />
                          </ParameterField>
                          <span className="text-[11px] text-muted-foreground">
                            SALI = Δactivity / (1 − Tanimoto) · {cliffs.length} pair{cliffs.length === 1 ? "" : "s"}
                          </span>
                        </>
                      ) : null}
                    </FieldGroup>
                  </DropdownMenuGroup>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Parameter study</DropdownMenuLabel>
              <DropdownMenuGroup className="px-2 py-1.5">
                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor="chemical-space-study-parameter">Parameter</FieldLabel>
                    <NativeSelect
                      id="chemical-space-study-parameter"
                      size="sm"
                      value={study.parameter}
                      onChange={(event) => setStudy(studyDefaults(event.currentTarget.value as StudyParameter))}
                    >
                      <NativeSelectOption value="neighbors">Neighbors</NativeSelectOption>
                      {draft.method !== "tmap" ? (
                        <>
                          <NativeSelectOption value="minDist">Minimum distance</NativeSelectOption>
                          <NativeSelectOption value="learningRate">Learning rate</NativeSelectOption>
                        </>
                      ) : null}
                    </NativeSelect>
                  </Field>
                  <ParameterField
                    label="Sweep range"
                    value={`${formatStudyValue(study.parameter, study.range[0])}–${formatStudyValue(study.parameter, study.range[1])}`}
                  >
                    <Slider
                      tone="neutral"
                      {...studySliderBounds(study.parameter)}
                      value={study.range}
                      onValueChange={(range) => setStudy((value) => ({ ...value, range: range as [number, number] }))}
                    />
                  </ParameterField>
                  <ParameterField label="Frames" value={study.frames}>
                    <Slider
                      tone="neutral"
                      min={3}
                      max={16}
                      step={1}
                      value={[study.frames]}
                      onValueChange={([frames]) => setStudy((value) => ({ ...value, frames }))}
                    />
                  </ParameterField>
                </FieldGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={Boolean(progress)} onSelect={() => void runStudy()}>
                  Run animated study on Metal
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {studyRunning ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-2"
              data-testid="parameter-study-timeline"
            >
              <Spinner data-icon="inline-start" />
              <Progress
                className="min-w-20 flex-1"
                value={progressPercent(progress) ?? undefined}
                indeterminate={progressPercent(progress) === null}
                aria-label={runningLabel || "Parameter study calculation in progress"}
              />
              <span className="truncate text-right font-mono text-xs text-muted-foreground">
                {runningLabel || "Preparing study…"}
              </span>
              <Button className="shrink-0" size="xs" variant="outline" onClick={stopStudy}>
                Stop
              </Button>
            </div>
          ) : completedStudy && displayedResult ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-2"
              data-testid="parameter-study-timeline"
            >
              <Button
                className="shrink-0"
                size="xs"
                variant="outline"
                onClick={() => setStudyPlaying((value) => !value)}
              >
                {studyPlaying ? "Pause" : "Play"}
              </Button>
              <Slider
                className="min-w-20 flex-1"
                tone="neutral"
                min={0}
                max={completedStudy.results.length - 1}
                step={0.01}
                value={[studyPosition]}
                aria-label="Parameter study timeline"
                onValueChange={([value]) => {
                  setStudyPlaying(false);
                  setStudyPosition(value);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}

function CliffTable({
  cliffs,
  activityLabel,
  activeCliffIndex,
  onSelectPair,
}: {
  cliffs: ActivityCliff[];
  activityLabel: string;
  activeCliffIndex: number | null;
  onSelectPair: (cliffIndex: number) => void;
}) {
  const [sortBy, setSortBy] = useState<"sali" | "delta" | "similarity">("sali");
  const sorted = useMemo(
    () => cliffs
      .map((cliff, cliffIndex) => ({ cliff, cliffIndex }))
      .sort((left, right) => right.cliff[sortBy] - left.cliff[sortBy]),
    [cliffs, sortBy],
  );
  const header = (key: "sali" | "delta" | "similarity", label: string) => (
    <button
      type="button"
      className={`text-right tabular-nums ${sortBy === key ? "text-foreground" : "text-muted-foreground"}`}
      onClick={() => setSortBy(key)}
    >
      {label}{sortBy === key ? " ↓" : ""}
    </button>
  );
  return (
    <div className="pointer-events-auto absolute right-3 top-3 flex max-h-[min(65%,22rem)] w-60 flex-col overflow-hidden rounded-md border border-border bg-background/90 text-[11px] shadow-sm backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-2 py-1 font-medium text-foreground">
        <span>Activity cliffs · {activityLabel}</span>
        <span className="text-muted-foreground">{cliffs.length}</span>
      </div>
      <div className="grid grid-cols-[1fr_2.2rem_2.6rem_2.8rem] gap-1 border-b border-border px-2 py-1">
        <span className="text-muted-foreground">pair</span>
        {header("similarity", "sim")}
        {header("delta", "Δ")}
        {header("sali", "SALI")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sorted.map(({ cliff, cliffIndex }) => (
          <button
            key={`${cliff.sourceA}-${cliff.sourceB}`}
            type="button"
            className={`grid w-full grid-cols-[1fr_2.2rem_2.6rem_2.8rem] gap-1 px-2 py-1 text-left tabular-nums hover:bg-accent ${
              cliffIndex === activeCliffIndex ? "bg-accent" : ""
            }`}
            onClick={() => onSelectPair(cliffIndex)}
          >
            <span className="truncate">#{cliff.sourceA + 1} ↔ #{cliff.sourceB + 1}</span>
            <span className="text-right text-muted-foreground">{cliff.similarity.toFixed(2)}</span>
            <span className="text-right text-muted-foreground">{cliff.delta.toFixed(2)}</span>
            <span className="text-right font-medium text-foreground">{cliff.sali.toFixed(1)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ActivityLegend({
  label,
  coloring,
  direction,
}: {
  label: string;
  coloring: ActivityColoring;
  direction: ActivityDirection;
}) {
  const gradient = `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
    .map((t) => viridisColor(direction === "lowerActive" ? 1 - t : t))
    .join(", ")})`;
  const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toPrecision(3));
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border bg-background/85 px-3 py-2 text-xs shadow-sm backdrop-blur">
      <div className="mb-1.5 font-medium text-foreground">{label}</div>
      <div className="h-3 w-48 rounded-sm" style={{ background: gradient }} />
      <div className="mt-1 flex w-48 justify-between font-mono text-muted-foreground">
        <span>{format(coloring.min)}</span>
        <span>{format(coloring.max)}</span>
      </div>
    </div>
  );
}

function ParameterField({ label, value, children }: { label: string; value: string | number; children: ReactNode }) {
  return (
    <Field>
      <FieldLabel className="flex w-full justify-between text-xs">
        <FieldTitle>{label}</FieldTitle>
        <span className="font-mono text-muted-foreground">{value}</span>
      </FieldLabel>
      {children}
    </Field>
  );
}

type ChemicalSpaceCanvasProps = {
  result: ChemicalSpaceResult;
  clusters: ChemicalSpaceClusterResult | null;
  selected: Set<number>;
  hovered: number | null;
  preview: MoleculePreview | null;
  pointScale: number;
  tmapLineScale: number;
  activityColors: Map<number, string> | null;
  // Molecules passing the grid's filters; null when no filter is active.
  // Everything outside the set renders dimmed so the map mirrors the grid.
  visibleSourceIds: Set<number> | null;
  cliffs: ActivityCliff[];
  activeCliffIndex: number | null;
  onSelectCliff: (cliffIndex: number) => void;
  tool: "navigate" | "lasso";
  onHover: (sourceRecordId: number | null) => void;
  onSelect: (sourceRecordIds: number[]) => void;
};

const DIMMED_POINT_COLOR = "#71717a";

function ChemicalSpaceCanvas(props: ChemicalSpaceCanvasProps) {
  const normalized = useMemo(
    () => normalizeChemicalSpacePositions(props.result.positions),
    [props.result.positions],
  );
  const aligned3DClusterIds = useMemo(
    () => alignedClusterIds(props.result.sourceRecordIds, props.clusters),
    [props.clusters, props.result.sourceRecordIds],
  );
  const pointColors3D = useMemo(
    () => {
      if (!props.activityColors && !props.visibleSourceIds) return null;
      return props.result.sourceRecordIds.map((sourceRecordId) => {
        if (props.visibleSourceIds && !props.visibleSourceIds.has(sourceRecordId)) {
          return DIMMED_POINT_COLOR;
        }
        return props.activityColors?.get(sourceRecordId) ?? null;
      });
    },
    [props.activityColors, props.result.sourceRecordIds, props.visibleSourceIds],
  );
  const cliffEdges3D = useMemo(
    () => props.cliffs
      .slice(0, MAX_VISIBLE_CLIFF_EDGES)
      .map((cliff) => [cliff.indexA, cliff.indexB] as [number, number]),
    [props.cliffs],
  );
  if (props.result.dimensions === 3) {
    return (
      <Suspense fallback={<ChemicalSpaceChecking message="Loading the 3D renderer…" />}>
        <ChemicalSpace3D
          positions={normalized}
          treeEdges={props.result.treeEdges}
          sourceRecordIds={props.result.sourceRecordIds}
          clusterIds={aligned3DClusterIds}
          clusterColors={CLUSTER_COLORS}
          pointColors={pointColors3D}
          cliffEdges={cliffEdges3D}
          selected={props.selected}
          hovered={props.hovered}
          preview={props.preview}
          pointScale={props.pointScale}
          treeLineScale={props.tmapLineScale}
          tool={props.tool}
          methodLabel={methodLabel(props.result.method)}
          onHover={props.onHover}
          onSelect={props.onSelect}
        />
      </Suspense>
    );
  }
  return <ChemicalSpace2D {...props} normalized={normalized} />;
}

function ChemicalSpace2D({
  result,
  clusters,
  selected,
  hovered,
  preview,
  pointScale,
  tmapLineScale,
  activityColors,
  visibleSourceIds,
  cliffs,
  activeCliffIndex,
  onSelectCliff,
  tool,
  onHover,
  onSelect,
  normalized,
}: ChemicalSpaceCanvasProps & { normalized: Array<[number, number, number]> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spatialIndexRef = useRef<SpatialPointIndex | null>(null);
  const screenIndexRef = useRef<ScreenPointIndex | null>(null);
  const pointerRef = useRef<{ start: Point2; last: Point2; moved: boolean } | null>(null);
  const lassoRef = useRef<Point2[]>([]);
  const lassoPaintFrameRef = useRef(0);
  const hoverRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1, pixelRatio: 1 });
  const [camera, setCamera] = useState({ yaw: -0.45, pitch: 0.35, zoom: 1, panX: 0, panY: 0 });
  const [lasso, setLasso] = useState<Point2[]>([]);
  const [cursor, setCursor] = useState<Point2 | null>(null);
  const clusterIds = useMemo(
    () => alignedClusterIds(result.sourceRecordIds, clusters),
    [clusters, result.sourceRecordIds],
  );
  const clusterBySource = useMemo(
    () => new Map(result.sourceRecordIds.map((sourceRecordId, index) => [sourceRecordId, clusterIds[index]])),
    [clusterIds, result.sourceRecordIds],
  );
  const sourceIndexById = useMemo(
    () => new Map(result.sourceRecordIds.map((sourceRecordId, index) => [sourceRecordId, index])),
    [result.sourceRecordIds],
  );
  const projected = useMemo(
    () => projectPositions(
      normalized,
      result.sourceRecordIds,
      viewport,
      { ...camera, zoom: 1, panX: 0, panY: 0 },
      2,
    ),
    [camera.pitch, camera.yaw, normalized, result.sourceRecordIds, viewport],
  );
  const spatialIndex = useMemo(
    () => buildSpatialPointIndex(projected),
    [projected],
  );
  const screenIndex = useMemo(
    () => buildCameraScreenPointIndex(spatialIndex, viewport, camera),
    [camera, spatialIndex, viewport],
  );

  useEffect(() => {
    spatialIndexRef.current = spatialIndex;
    screenIndexRef.current = screenIndex;
  }, [screenIndex, spatialIndex]);

  useEffect(() => () => {
    if (lassoPaintFrameRef.current) {
      cancelAnimationFrame(lassoPaintFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let resizeTimer = 0;
    let measured = false;
    let pendingViewport = { width: 1, height: 1, pixelRatio: 1 };
    const commitViewport = () => {
      resizeTimer = 0;
      const next = pendingViewport;
      setViewport((current) => (
        current.width === next.width
        && current.height === next.height
        && current.pixelRatio === next.pixelRatio
          ? current
          : next
      ));
    };
    const observer = new ResizeObserver(([entry]) => {
      pendingViewport = {
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      };
      if (!measured) {
        measured = true;
        commitViewport();
        return;
      }
      if (resizeTimer) window.clearTimeout(resizeTimer);
      // Reprojecting and rebuilding the quadtree is O(N). Let CSS stretch the
      // existing canvas while the window moves, then rebuild once at rest.
      resizeTimer = window.setTimeout(commitViewport, 90);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (resizeTimer) window.clearTimeout(resizeTimer);
    };
  }, []);

  // The scene renders in layers so pointer work stays cheap: the point cloud
  // and edges paint once into an offscreen base, the selection into its own
  // layer, and every hover, click, or lasso frame only re-composites blits.
  const baseLayerRef = useRef<HTMLCanvasElement | null>(null);
  const selectionLayerRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<(hoveredNow: number | null, lassoNow: Point2[]) => void>(() => undefined);
  const hoveredNowRef = useRef(hovered);
  hoveredNowRef.current = hovered;
  const lassoNowRef = useRef(lasso);
  lassoNowRef.current = lasso;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const layerWidth = Math.round(viewport.width * viewport.pixelRatio);
    const layerHeight = Math.round(viewport.height * viewport.pixelRatio);
    canvas.width = layerWidth;
    canvas.height = layerHeight;
    const base = baseLayerRef.current ?? document.createElement("canvas");
    baseLayerRef.current = base;
    base.width = layerWidth;
    base.height = layerHeight;
    const baseContext = base.getContext("2d");
    if (!baseContext) return;
    baseContext.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
    baseContext.clearRect(0, 0, viewport.width, viewport.height);
    const styles = getComputedStyle(canvas);
    const selectedColor = styles.getPropertyValue("--primary").trim() || "#af52de";
    // The inherited foreground is solid #0d0d0d in the light theme, which renders a
    // dense map as an ink blot. The secondary text tone carries its own alpha and
    // stays legible on either background.
    const pointColor = styles.getPropertyValue("--text-muted").trim()
      || styles.color
      || "#f5f5f7";
    const ringColor = pointColor;
    const basePointRadius = adaptivePointRadius(result.successfulRecords);
    // Points share the camera's sense of depth: zooming in grows them, zooming
    // out shrinks them. The square root keeps the growth gentler than the
    // coordinate scale so dense regions stay readable.
    const zoomPointScale = Math.max(0.6, Math.min(2.6, Math.sqrt(camera.zoom)));
    const basePointOpacity = adaptivePointOpacity(result.successfulRecords);
    if (result.treeEdges.length > 0) {
      baseContext.beginPath();
      const edgeStep = Math.max(1, Math.ceil(result.treeEdges.length / MAX_VISIBLE_EDGES));
      for (let edgeIndex = 0; edgeIndex < result.treeEdges.length; edgeIndex += edgeStep) {
        const [leftIndex, rightIndex] = result.treeEdges[edgeIndex];
        const leftBase = projected[leftIndex];
        const rightBase = projected[rightIndex];
        if (!leftBase || !rightBase) continue;
        const left = screenPointForCamera(leftBase, viewport, camera);
        const right = screenPointForCamera(rightBase, viewport, camera);
        baseContext.moveTo(left.x, left.y);
        baseContext.lineTo(right.x, right.y);
      }
      baseContext.strokeStyle = pointColor;
      baseContext.globalAlpha = 0.48;
      baseContext.lineWidth = Math.max(1.5, Math.min(3.5, pointScale * 1.5)) * tmapLineScale;
      baseContext.stroke();
    }
    if (cliffs.length > 0) {
      const maxSali = cliffs[0]?.sali || 1;
      const drawCliff = (cliffIndex: number, muted: boolean) => {
        const cliff = cliffs[cliffIndex];
        const leftBase = projected[cliff.indexA];
        const rightBase = projected[cliff.indexB];
        if (!leftBase || !rightBase) return;
        const left = screenPointForCamera(leftBase, viewport, camera);
        const right = screenPointForCamera(rightBase, viewport, camera);
        const intensity = Math.max(0.25, Math.min(1, cliff.sali / maxSali));
        const activeEdge = cliffIndex === activeCliffIndex;
        baseContext.beginPath();
        baseContext.moveTo(left.x, left.y);
        baseContext.lineTo(right.x, right.y);
        baseContext.strokeStyle = activeEdge ? "#f87171" : "#ef4444";
        baseContext.globalAlpha = (0.35 + intensity * 0.5) * (muted ? 0.15 : 1);
        baseContext.lineWidth = 1 + intensity * 2.5 + (activeEdge ? 1.5 : 0);
        baseContext.stroke();
      };
      const visibleCliffCount = Math.min(cliffs.length, MAX_VISIBLE_CLIFF_EDGES);
      const mutedByActive = activeCliffIndex !== null;
      for (let cliffIndex = 0; cliffIndex < visibleCliffCount; cliffIndex += 1) {
        if (cliffIndex === activeCliffIndex) continue;
        drawCliff(cliffIndex, mutedByActive);
      }
      if (activeCliffIndex !== null && cliffs[activeCliffIndex]) {
        drawCliff(activeCliffIndex, false);
      }
      baseContext.globalAlpha = 1;
    }
    for (const point of screenIndex.renderPoints) {
      if (point.x < 0 || point.x > viewport.width || point.y < 0 || point.y > viewport.height) continue;
      const dimmed = visibleSourceIds !== null && !visibleSourceIds.has(point.sourceRecordId);
      const aggregateCount = screenIndex.renderPointCounts.get(point.sourceRecordId) ?? 1;
      const aggregateScale = 1 + Math.min(0.7, Math.log2(aggregateCount) * 0.12);
      baseContext.beginPath();
      baseContext.arc(
        point.x,
        point.y,
        basePointRadius * pointScale * zoomPointScale * aggregateScale,
        0,
        Math.PI * 2,
      );
      const clusterId = clusterBySource.get(point.sourceRecordId) ?? null;
      const activityColor = activityColors?.get(point.sourceRecordId) ?? null;
      baseContext.fillStyle = dimmed
        ? DIMMED_POINT_COLOR
        : activityColor
          ? activityColor
          : clusterId === null
            ? pointColor
            : CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
      baseContext.globalAlpha = dimmed
        ? Math.min(0.18, basePointOpacity)
        : Math.min(1, basePointOpacity * (1 + Math.log2(aggregateCount) * 0.08));
      baseContext.fill();
    }
    baseContext.globalAlpha = 1;
    overlayRef.current = (hoveredNow, lassoNow) => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, layerWidth, layerHeight);
      context.drawImage(base, 0, 0);
      const selectionLayer = selectionLayerRef.current;
      if (selectionLayer && selectionLayer.width === layerWidth && selectionLayer.height === layerHeight) {
        context.drawImage(selectionLayer, 0, 0);
      }
      context.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
      if (hoveredNow !== null) {
        const indexed = screenIndex.bySourceRecordId.get(hoveredNow) ?? null;
        const hoveredIndex = indexed ? undefined : sourceIndexById.get(hoveredNow);
        const hoveredBasePoint = hoveredIndex === undefined ? null : projected[hoveredIndex];
        const point = indexed
          ?? (hoveredBasePoint ? screenPointForCamera(hoveredBasePoint, viewport, camera) : null);
        if (point) {
          context.beginPath();
          context.arc(point.x, point.y, basePointRadius * pointScale * zoomPointScale, 0, Math.PI * 2);
          context.fillStyle = selectedColor;
          context.globalAlpha = 1;
          context.fill();
          context.lineWidth = 1.5;
          context.strokeStyle = ringColor;
          context.stroke();
        }
      }
      if (lassoNow.length > 1) {
        context.beginPath();
        context.moveTo(lassoNow[0].x, lassoNow[0].y);
        for (const point of lassoNow.slice(1)) context.lineTo(point.x, point.y);
        context.strokeStyle = selectedColor;
        context.lineWidth = 1.5;
        context.setLineDash([5, 4]);
        context.stroke();
        context.setLineDash([]);
      }
      context.globalAlpha = 1;
    };
    overlayRef.current(hoveredNowRef.current, lassoNowRef.current);
  }, [activeCliffIndex, activityColors, camera, cliffs, clusterBySource, pointScale, projected, result.successfulRecords, result.treeEdges, screenIndex, sourceIndexById, tmapLineScale, viewport, visibleSourceIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const layerWidth = Math.round(viewport.width * viewport.pixelRatio);
    const layerHeight = Math.round(viewport.height * viewport.pixelRatio);
    const layer = selectionLayerRef.current ?? document.createElement("canvas");
    selectionLayerRef.current = layer;
    layer.width = layerWidth;
    layer.height = layerHeight;
    const layerContext = layer.getContext("2d");
    if (!layerContext) return;
    layerContext.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
    layerContext.clearRect(0, 0, viewport.width, viewport.height);
    if (selected.size > 0) {
      const selectedColor = getComputedStyle(canvas).getPropertyValue("--primary").trim() || "#af52de";
      const radius = adaptivePointRadius(result.successfulRecords)
        * pointScale
        * Math.max(0.6, Math.min(2.6, Math.sqrt(camera.zoom)));
      layerContext.fillStyle = selectedColor;
      layerContext.globalAlpha = 0.9;
      let offIndexDrawn = 0;
      for (const sourceRecordId of selected) {
        let point = screenIndex.bySourceRecordId.get(sourceRecordId) ?? null;
        if (!point) {
          if (offIndexDrawn >= MAX_HIGHLIGHT_POINTS) continue;
          const sourceIndex = sourceIndexById.get(sourceRecordId);
          const basePoint = sourceIndex === undefined ? null : projected[sourceIndex];
          if (!basePoint) continue;
          point = screenPointForCamera(basePoint, viewport, camera);
          offIndexDrawn += 1;
        }
        layerContext.beginPath();
        layerContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
        layerContext.fill();
      }
      layerContext.globalAlpha = 1;
    }
    overlayRef.current(hoveredNowRef.current, lassoNowRef.current);
  }, [camera, pointScale, projected, result.successfulRecords, screenIndex, selected, sourceIndexById, viewport]);

  useEffect(() => {
    overlayRef.current(hovered, lasso);
  }, [hovered, lasso]);

  const localPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const hoverNearest = (point: Point2) => {
    const nearest = nearestScreenPoint(
      screenIndexRef.current,
      point,
      Math.max(4, adaptivePointRadius(result.successfulRecords) * pointScale + 3),
    );
    const sourceRecordId = nearest?.sourceRecordId ?? null;
    if (sourceRecordId === hoverRef.current) return;
    hoverRef.current = sourceRecordId;
    onHover(sourceRecordId);
  };

  // Cliff edges are clickable: the nearest drawn edge within a few pixels wins,
  // though points always take precedence.
  const nearestVisibleCliff = (point: Point2) => {
    if (cliffs.length === 0) return null;
    let best: number | null = null;
    let bestDistance = 36;
    const consider = (cliffIndex: number) => {
      const cliff = cliffs[cliffIndex];
      const leftBase = projected[cliff.indexA];
      const rightBase = projected[cliff.indexB];
      if (!leftBase || !rightBase) return;
      const left = screenPointForCamera(leftBase, viewport, camera);
      const right = screenPointForCamera(rightBase, viewport, camera);
      const distance = distanceToSegmentSquared(point, left, right);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cliffIndex;
      }
    };
    const limit = Math.min(cliffs.length, MAX_VISIBLE_CLIFF_EDGES);
    for (let cliffIndex = 0; cliffIndex < limit; cliffIndex += 1) consider(cliffIndex);
    if (activeCliffIndex !== null && activeCliffIndex >= limit && cliffs[activeCliffIndex]) {
      consider(activeCliffIndex);
    }
    return best;
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-muted/20">
      <canvas
        ref={canvasRef}
        className="size-full touch-none text-foreground outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30"
        tabIndex={0}
        aria-label={`${result.dimensions}D ${methodLabel(result.method)} chemical-space map`}
        aria-keyshortcuts="W A S D"
        onKeyDown={(event) => {
          const key = event.key.toLowerCase();
          if (!["w", "a", "s", "d"].includes(key) || tool !== "navigate") return;
          event.preventDefault();
          const step = (event.shiftKey ? 64 : 28) / Math.max(0.35, camera.zoom);
          setCamera((value) => ({
            ...value,
            panX: value.panX + (key === "a" ? step : key === "d" ? -step : 0),
            panY: value.panY + (key === "w" ? step : key === "s" ? -step : 0),
          }));
        }}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY > 0 ? 0.9 : 1.1;
          const cursor = localPoint(event);
          setCamera((value) => {
            const zoom = Math.max(0.35, Math.min(20, value.zoom * factor));
            const ratio = zoom / value.zoom;
            const centerX = viewport.width / 2;
            const centerY = viewport.height / 2;
            return {
              ...value,
              zoom,
              panX: cursor.x - centerX - (cursor.x - centerX - value.panX) * ratio,
              panY: cursor.y - centerY - (cursor.y - centerY - value.panY) * ratio,
            };
          });
        }}
        onPointerDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = localPoint(event);
          hoverRef.current = null;
          onHover(null);
          pointerRef.current = { start: point, last: point, moved: false };
          if (tool === "lasso") {
            lassoRef.current = [point];
            setLasso([point]);
          }
        }}
        onPointerMove={(event) => {
          const point = localPoint(event);
          setCursor(point);
          const pointer = pointerRef.current;
          if (!pointer) {
            hoverNearest(point);
            return;
          }
          const dx = point.x - pointer.last.x;
          const dy = point.y - pointer.last.y;
          pointer.moved ||= Math.abs(point.x - pointer.start.x) + Math.abs(point.y - pointer.start.y) > 3;
          pointer.last = point;
          if (tool === "lasso") {
            const previous = lassoRef.current.at(-1);
            if (
              lassoRef.current.length < MAX_LASSO_POINTS
              && (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) >= 2)
            ) {
              lassoRef.current.push(point);
              if (!lassoPaintFrameRef.current) {
                lassoPaintFrameRef.current = requestAnimationFrame(() => {
                  lassoPaintFrameRef.current = 0;
                  setLasso(lassoRef.current.slice());
                });
              }
            }
          } else {
            setCamera((value) => ({ ...value, panX: value.panX + dx, panY: value.panY + dy }));
          }
        }}
        onPointerUp={(event) => {
          const pointer = pointerRef.current;
          pointerRef.current = null;
          if (tool === "lasso") {
            const polygon = simplifyLassoPolygon(lassoRef.current);
            const basePolygon = polygon.map((point) => screenPointFromCamera(point, viewport, camera));
            const sourceRecordIds = polygon.length >= 3
              ? sourceRecordIdsInSpatialPolygon(
                  spatialIndexRef.current,
                  basePolygon,
                  GRID_SELECTION_BRIDGE_LIMIT,
                )
              : [];
            lassoRef.current = [];
            if (lassoPaintFrameRef.current) {
              cancelAnimationFrame(lassoPaintFrameRef.current);
              lassoPaintFrameRef.current = 0;
            }
            setLasso([]);
            onSelect(sourceRecordIds);
          } else if (pointer && !pointer.moved) {
            const point = localPoint(event);
            hoverNearest(point);
            if (hoverRef.current !== null) {
              onSelect([hoverRef.current]);
            } else {
              const cliffIndex = nearestVisibleCliff(point);
              if (cliffIndex !== null) onSelectCliff(cliffIndex);
              else onSelect([]);
            }
          }
        }}
        onPointerCancel={() => {
          pointerRef.current = null;
          lassoRef.current = [];
          if (lassoPaintFrameRef.current) {
            cancelAnimationFrame(lassoPaintFrameRef.current);
            lassoPaintFrameRef.current = 0;
          }
          setLasso([]);
        }}
        onPointerLeave={() => {
          if (pointerRef.current) return;
          setCursor(null);
          hoverRef.current = null;
          onHover(null);
        }}
      />
      {preview && hovered === preview.sourceRecordId && cursor ? (
        <div
          className="pointer-events-none absolute z-10 w-52 overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
          style={{
            left: Math.min(Math.max(8, viewport.width - 220), Math.max(8, cursor.x + 12)),
            top: Math.min(Math.max(8, viewport.height - 188), Math.max(8, cursor.y + 12)),
          }}
        >
          {preview.svgUrl ? <img className="h-28 w-full rounded-lg bg-white object-contain" src={preview.svgUrl} alt="" /> : null}
          <div className="mt-1 truncate text-xs font-medium">{preview.name}</div>
          {preview.smiles ? <div className="truncate font-mono text-[10px] text-muted-foreground">{preview.smiles}</div> : null}
        </div>
      ) : null}
      {selected.size > 0 ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
          {selected.size.toLocaleString()} selected
        </div>
      ) : null}
      {clusters ? <ClusterLegend clusters={clusters} /> : null}
    </div>
  );
}

function ClusterLegend({ clusters }: { clusters: ChemicalSpaceClusterResult }) {
  const counts = new Map<number, number>();
  for (const clusterId of clusters.clusterIds) {
    counts.set(clusterId, (counts.get(clusterId) ?? 0) + 1);
  }
  const visible = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8);
  return (
    <div className="pointer-events-none absolute right-2 top-2 max-w-48 rounded-lg border border-border bg-background/90 p-2 shadow-sm backdrop-blur">
      <div className="mb-1 text-[10px] font-medium">Butina clusters</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {visible.map(([clusterId, count]) => (
          <div key={clusterId} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length] }}
            />
            <span>#{clusterId + 1}</span>
            <span className="font-mono">{count}</span>
          </div>
        ))}
      </div>
      {clusters.clusterCount > visible.length ? (
        <div className="mt-1 text-[10px] text-muted-foreground">
          +{clusters.clusterCount - visible.length} more
        </div>
      ) : null}
    </div>
  );
}

function alignedClusterIds(
  sourceRecordIds: number[],
  clusters: ChemicalSpaceClusterResult | null,
): Array<number | null> {
  if (!clusters) return sourceRecordIds.map(() => null);
  const bySource = new Map(
    clusters.sourceRecordIds.map((sourceRecordId, index) => [
      sourceRecordId,
      clusters.clusterIds[index],
    ]),
  );
  return sourceRecordIds.map((sourceRecordId) => bySource.get(sourceRecordId) ?? null);
}

function clusterMembersForSource(
  clusters: ChemicalSpaceClusterResult | null,
  sourceRecordId: number,
) {
  if (!clusters) return [sourceRecordId];
  const index = clusters.sourceRecordIds.indexOf(sourceRecordId);
  const clusterId = index < 0 ? undefined : clusters.clusterIds[index];
  if (clusterId === undefined) return [sourceRecordId];
  return clusters.sourceRecordIds.filter((_, memberIndex) => clusters.clusterIds[memberIndex] === clusterId);
}

function ChemicalSpaceRepresentationUnavailable({
  representation,
  onInstalled,
  onUseMorgan,
}: {
  representation: string;
  onInstalled: () => void;
  onUseMorgan: () => void;
}) {
  return (
    <Empty className="h-full min-h-40">
      <EmptyHeader>
        <EmptyTitle>{representation} needs the model runtime</EmptyTitle>
        <EmptyDescription>
          Learned representations run on a one-time download.
          Morgan · Tanimoto works right away without one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ChemicalSpaceModelRuntimeInstall onInstalled={onInstalled} />
        <Button size="sm" variant="outline" onClick={onUseMorgan}>Use Morgan · Tanimoto</Button>
      </EmptyContent>
    </Empty>
  );
}

// Self-contained install flow for the learned-model runtime: shows the
// one-time download size up front, streams the installer's current line while
// it runs, and supports cancellation. Completion hands control back to the
// panel, which re-runs the interrupted workflow.
function ChemicalSpaceModelRuntimeInstall({ onInstalled }: { onInstalled: () => void }) {
  const [status, setStatus] = useState<ChemicalSpaceModelRuntimeStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;
  useEffect(() => {
    let disposed = false;
    void fetchChemicalSpaceModelRuntimeStatus()
      .then((next) => {
        if (disposed) return;
        setStatus(next);
        if (next.installPhase === "installing") setInstalling(true);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!installing) return;
    let disposed = false;
    const poll = window.setInterval(() => {
      void fetchChemicalSpaceModelRuntimeStatus()
        .then((next) => {
          if (disposed) return;
          setStatus(next);
          if (next.installPhase === "completed" && next.installed) {
            setInstalling(false);
            onInstalledRef.current();
          } else if (next.installPhase === "failed" || next.installPhase === "cancelled") {
            setInstalling(false);
            setInstallError(next.installError ?? "The model runtime installation failed.");
          }
        })
        .catch(() => undefined);
    }, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(poll);
    };
  }, [installing]);
  if (!status) return null;
  if (installing) {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Installing the model runtime…
        </div>
        {status.installLine ? (
          <div className="w-full truncate text-center font-mono text-[10px] text-muted-foreground">
            {status.installLine}
          </div>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void cancelChemicalSpaceModelRuntimeInstall().catch(() => undefined);
          }}
        >
          Cancel installation
        </Button>
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2">
      {status.installerAvailable ? (
        <Button
          size="sm"
          onClick={() => {
            setInstallError(null);
            setInstalling(true);
            void startChemicalSpaceModelRuntimeInstall().catch((cause) => {
              setInstalling(false);
              setInstallError(computeErrorMessage(cause));
            });
          }}
        >
          Install model runtime ({status.installSizeHint})
        </Button>
      ) : null}
      <div className="text-center text-[11px] text-muted-foreground">
        {status.installHint} {status.weightsNote}
      </div>
      {installError ? (
        <div className="text-center text-[11px] text-destructive">{installError}</div>
      ) : null}
    </div>
  );
}

function ChemicalSpaceEmpty({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <Empty className="h-full min-h-40">
      <EmptyHeader>
        <EmptyTitle>Chemical space</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      {actionLabel && onAction ? (
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onAction}>{actionLabel}</Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

function ChemicalSpaceChecking({ message }: { message: string }) {
  return (
    <Empty className="h-full min-h-40">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Spinner /></EmptyMedia>
        <EmptyTitle>Checking collection</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ChemicalSpaceLoading({
  message,
  progress,
  onStop,
}: {
  message: string;
  progress: ChemicalSpaceProgress | null;
  onStop: () => void;
}) {
  const value = progressPercent(progress);
  return (
    <div className="relative flex h-full min-h-40 items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-45" aria-hidden="true">
        <Skeleton className="absolute left-[18%] top-[28%] size-2 rounded-full" />
        <Skeleton className="absolute left-[35%] top-[61%] size-3 rounded-full" />
        <Skeleton className="absolute right-[31%] top-[38%] size-2.5 rounded-full" />
        <Skeleton className="absolute bottom-[22%] right-[18%] size-2 rounded-full" />
      </div>
      <Empty className="z-10 max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Spinner /></EmptyMedia>
          <EmptyTitle>Building chemical space</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex flex-col gap-3">
          <Progress
            className="w-56"
            value={value ?? undefined}
            indeterminate={value === null}
            aria-label={value === null ? "Chemical-space calculation in progress" : `Chemical-space calculation ${Math.round(value)}% complete`}
          />
          <Button size="sm" variant="outline" onClick={onStop}>
            Stop calculation
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

function gridDocumentInstanceKey(document: ViewerDocument) {
  // Native Grid runtimes live in a fresh UUID directory for each open. Keep
  // only a bounded suffix here because browser-dev may carry generated HTML in
  // runtimePath; its length plus tail still distinguish rebuilt runtimes
  // without retaining another unbounded copy in every cache key.
  const runtimeTail = document.runtimePath.slice(-192);
  return `${document.id}:${document.byteCount}:${document.runtimePath.length}:${runtimeTail}`;
}

function distanceToSegmentSquared(point: Point2, left: Point2, right: Point2) {
  const segmentX = right.x - left.x;
  const segmentY = right.y - left.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - left.x) * segmentX + (point.y - left.y) * segmentY) / lengthSquared));
  const nearestX = left.x + t * segmentX;
  const nearestY = left.y + t * segmentY;
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;
}

function embeddingCacheKey(
  documentId: string,
  documentInstanceKey: string,
  sourceRevision: number,
  options: ChemicalSpaceOptions,
  scopeKey: string,
) {
  return `${documentId}:${documentInstanceKey}:${sourceRevision}:${scopeKey}:${JSON.stringify(options)}`;
}

function scopedBrowserRecords(
  records: BrowserChemicalSpaceInputRecord[],
  scopedSourceIds: number[] | null,
) {
  if (!scopedSourceIds) return records;
  const wanted = new Set(scopedSourceIds);
  return records.filter((record) => wanted.has(record.sourceRecordId));
}

function cachedCompletedEmbedding(key: string) {
  const cached = completedEmbeddings.get(key);
  if (!cached) return null;
  completedEmbeddings.delete(key);
  completedEmbeddings.set(key, cached);
  return cached;
}

function cacheCompletedEmbedding(key: string, result: ChemicalSpaceResult) {
  const previous = completedEmbeddings.get(key);
  if (previous) {
    completedEmbeddingRecordCount -= previous.sourceRecordIds.length;
    completedEmbeddings.delete(key);
  }
  const recordCount = result.sourceRecordIds.length;
  if (recordCount > MAX_COMPLETED_EMBEDDING_CACHE_RECORDS) return;
  completedEmbeddings.set(key, result);
  completedEmbeddingRecordCount += recordCount;
  while (
    completedEmbeddings.size > MAX_COMPLETED_EMBEDDING_CACHE_ENTRIES
    || completedEmbeddingRecordCount > MAX_COMPLETED_EMBEDDING_CACHE_RECORDS
  ) {
    const oldestKey = completedEmbeddings.keys().next().value;
    if (typeof oldestKey !== "string") break;
    deleteCompletedEmbedding(oldestKey);
  }
}

function deleteCompletedEmbedding(key: string) {
  const cached = completedEmbeddings.get(key);
  if (!cached) return;
  completedEmbeddingRecordCount = Math.max(
    0,
    completedEmbeddingRecordCount - cached.sourceRecordIds.length,
  );
  completedEmbeddings.delete(key);
}

function invalidateCompletedEmbeddings(documentId: string) {
  const prefix = `${documentId}:`;
  for (const key of completedEmbeddings.keys()) {
    if (key.startsWith(prefix)) deleteCompletedEmbedding(key);
  }
}

function progressPercent(progress: ChemicalSpaceProgress | null) {
  if (progress?.phase === "representations" && typeof progress.percent === "number") {
    return Math.min(100, Math.max(0, progress.percent));
  }
  if (progress?.phase === "fingerprints" && progress.totalRecords) {
    return Math.min(100, ((progress.completedRecords ?? 0) / progress.totalRecords) * 100);
  }
  if (progress?.phase === "study" && progress.totalFrames) {
    return Math.min(100, ((progress.completedFrames ?? 0) / progress.totalFrames) * 100);
  }
  return null;
}

function progressLabel(progress: ChemicalSpaceProgress | null) {
  if (!progress) return "";
  if (progress.phase === "fingerprints") {
    return `Fingerprints ${Math.min(progress.completedRecords ?? 0, progress.totalRecords ?? 0).toLocaleString()} / ${(progress.totalRecords ?? 0).toLocaleString()}`;
  }
  if (progress.phase === "representations") {
    const completed = Math.min(progress.completedRecords ?? 0, progress.totalRecords ?? 0).toLocaleString();
    const total = (progress.totalRecords ?? 0).toLocaleString();
    const stage = progress.representationStage === "preparing"
      ? "Preparing molecules"
      : progress.representationStage === "loading"
        ? "Loading model"
        : progress.representationStage === "similarity"
          ? "Metal similarity"
          : "Metal embeddings";
    return `${stage} ${completed} / ${total}`;
  }
  if (progress.phase === "embedding") return "Metal similarity + embedding…";
  if (progress.phase === "study") {
    return `Metal study ${Math.min(progress.completedFrames ?? 0, progress.totalFrames ?? 0)} / ${progress.totalFrames ?? 0}`;
  }
  return "Preparing snapshot…";
}

function representationLabel(representation: ChemicalSpaceRepresentation) {
  return CHEMICAL_SPACE_REPRESENTATIONS.find((entry) => entry.value === representation)?.label
    ?? representation;
}

function similarityTimeLabel(result: ChemicalSpaceResult) {
  if (result.representation === "morgan") {
    return result.tanimotoGpuTimeMs === 0 ? "cached" : `${result.tanimotoGpuTimeMs} ms`;
  }
  return result.similarityGpuTimeMs === 0 ? "cached" : `${result.similarityGpuTimeMs ?? 0} ms`;
}

function resultTimingLabel(result: ChemicalSpaceResult) {
  return result.method === "tmap"
    ? `tree layout: ${result.layoutHostTimeMs.toFixed(1)} ms`
    : `embedding: ${result.embeddingGpuTimeMs} ms`;
}

function resultTimingDescription(result: ChemicalSpaceResult) {
  const prefix = `${result.successfulRecords.toLocaleString()} molecules, Metal. ${representationLabel(result.representation)}. Similarity graph ${similarityTimeLabel(result)}.`;
  if (result.method === "tmap") {
    return `${prefix} Minimum spanning tree with ${result.treeEdges.length.toLocaleString()} edges. Layout ${result.layoutHostTimeMs.toFixed(1)} milliseconds.`;
  }
  return `${prefix} Embedding ${result.embeddingGpuTimeMs} milliseconds.`;
}

function methodLabel(method: ChemicalSpaceMethod) {
  return CHEMICAL_SPACE_METHODS.find((entry) => entry.value === method)?.label ?? method;
}

function adaptivePointRadius(recordCount: number) {
  return Math.max(1.1, Math.min(2.6, 2.6 * Math.sqrt(1_000 / Math.max(1_000, recordCount))));
}

function adaptivePointOpacity(recordCount: number) {
  return Math.max(0.5, Math.min(0.78, 0.78 * Math.sqrt(2_500 / Math.max(2_500, recordCount))));
}

function projectPositions(
  positions: Array<[number, number, number]>,
  sourceRecordIds: number[],
  viewport: { width: number; height: number },
  camera: { yaw: number; pitch: number; zoom: number; panX: number; panY: number },
  dimensions: 2 | 3,
): ProjectedPoint[] {
  const scale = Math.max(20, Math.min(viewport.width, viewport.height) * 0.42 * camera.zoom);
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  return positions.map((position, index) => {
    const yawX = position[0] * cosYaw - position[2] * sinYaw;
    const yawZ = position[0] * sinYaw + position[2] * cosYaw;
    const pitchY = position[1] * cosPitch - yawZ * sinPitch;
    const pitchZ = position[1] * sinPitch + yawZ * cosPitch;
    const perspective = dimensions === 3 ? 1 / Math.max(0.45, 1.8 - pitchZ * 0.55) : 1;
    return {
      x: viewport.width / 2 + camera.panX + yawX * scale * perspective,
      y: viewport.height / 2 + camera.panY - pitchY * scale * perspective,
      depth: pitchZ,
      sourceRecordId: sourceRecordIds[index],
    };
  });
}

function screenPointForCamera(
  point: ProjectedPoint,
  viewport: { width: number; height: number },
  camera: { zoom: number; panX: number; panY: number },
): ProjectedPoint {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return {
    ...point,
    x: centerX + camera.panX + (point.x - centerX) * camera.zoom,
    y: centerY + camera.panY + (point.y - centerY) * camera.zoom,
  };
}

function screenPointFromCamera(
  point: Point2,
  viewport: { width: number; height: number },
  camera: { zoom: number; panX: number; panY: number },
): Point2 {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return {
    x: centerX + (point.x - centerX - camera.panX) / camera.zoom,
    y: centerY + (point.y - centerY - camera.panY) / camera.zoom,
  };
}

function studyDefaults(parameter: StudyParameter): StudyState {
  if (parameter === "neighbors") return { parameter, range: [5, 40], frames: 8 };
  if (parameter === "learningRate") return { parameter, range: [0.3, 2], frames: 8 };
  return { ...DEFAULT_STUDY };
}

function studySliderBounds(parameter: StudyParameter) {
  if (parameter === "neighbors") return { min: 2, max: 64, step: 1 };
  if (parameter === "learningRate") return { min: 0.1, max: 3, step: 0.1 };
  return { min: 0, max: 1, step: 0.01 };
}

function studyValues(study: StudyState) {
  return Array.from({ length: study.frames }, (_, index) => {
    const progress = study.frames === 1 ? 0 : index / (study.frames - 1);
    const value = study.range[0] + (study.range[1] - study.range[0]) * progress;
    return study.parameter === "neighbors" ? Math.round(value) : value;
  });
}

function formatStudyValue(parameter: StudyParameter, value: number) {
  return parameter === "neighbors" ? Math.round(value).toString() : value.toFixed(2);
}

function interpolateStudyResult(results: ChemicalSpaceResult[], position: number) {
  const leftIndex = Math.max(0, Math.min(results.length - 1, Math.floor(position)));
  const rightIndex = Math.min(results.length - 1, leftIndex + 1);
  const progress = position - leftIndex;
  const left = results[leftIndex];
  const right = results[rightIndex];
  if (!right || right === left || progress <= 0) return left;
  return {
    ...left,
    positions: left.positions.map((position, index) => {
      const target = right.positions[index] ?? position;
      return position.map((value, axis) => (
        value + (target[axis] - value) * smoothStep(progress)
      )) as [number, number, number];
    }),
  };
}

function alignStudyResults(results: ChemicalSpaceResult[]) {
  const alignedResults: ChemicalSpaceResult[] = [];
  for (const result of results) {
    const positions = normalizeChemicalSpacePositions(result.positions);
    if (alignedResults.length === 0) {
      alignedResults.push({ ...result, positions });
      continue;
    }
    const previousPositions = alignedResults.at(-1)?.positions ?? [];
    const aligned = positions.map((position) => [...position] as [number, number, number]);
    for (let axis = 0; axis < result.dimensions; axis += 1) {
      const correlation = aligned.reduce(
        (sum, position, positionIndex) => (
          sum + position[axis] * (previousPositions[positionIndex]?.[axis] ?? 0)
        ),
        0,
      );
      if (correlation < 0) {
        for (const position of aligned) position[axis] *= -1;
      }
    }
    alignedResults.push({ ...result, positions: aligned });
  }
  return alignedResults;
}

function smoothStep(value: number) {
  return value * value * (3 - 2 * value);
}

function requestBrowserChemicalSpaceRecords(
  documentId: string,
  signal: AbortSignal,
): Promise<BrowserChemicalSpaceInputRecord[]> {
  const requestId = `chemical-space-records-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const retryDelays = [0, 250, 1_000, 3_000, 7_000];
    const retryTimers: number[] = [];
    const iframeLoadListeners = new Map<HTMLIFrameElement, () => void>();
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The Grid did not provide molecular records for browser chemical space."));
    }, 15_000);
    const requestPayload = {
      source: "burette-grid-host",
      body: { type: "chemicalSpaceRequestRecords", requestId, documentId },
    };
    const postRequest = (target?: MessageEventSource | null) => {
      if (signal.aborted) return;
      if (target && typeof target === "object" && "postMessage" in target) {
        (target as Window).postMessage(requestPayload, "*");
        return;
      }
      const escapedId = CSS.escape(documentId);
      const candidates = [
        activeViewerIframeForDocument(documentId, "grid2d"),
        ...document.querySelectorAll<HTMLIFrameElement>(
          `.viewer-iframe[data-document-id="${escapedId}"][data-renderer="grid2d"]`,
        ),
      ];
      const targets = new Set<Window>();
      for (const iframe of candidates) {
        if (!iframe) continue;
        const contentWindow = iframe.contentWindow;
        if (contentWindow) targets.add(contentWindow);
        if (!iframeLoadListeners.has(iframe)) {
          const onLoad = () => postRequest(iframe.contentWindow);
          iframeLoadListeners.set(iframe, onLoad);
          iframe.addEventListener("load", onLoad);
        }
      }
      for (const contentWindow of targets) contentWindow.postMessage(requestPayload, "*");
    };
    const onAbort = () => {
      cleanup();
      const error = new Error("Chemical-space calculation was cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data && typeof event.data === "object"
        ? event.data as { source?: unknown; body?: Record<string, unknown> }
        : null;
      if (
        data?.source !== "burette-grid"
        || data.body?.documentId !== documentId
        || !isKnownViewerMessageSource(event.source, documentId)
      ) return;
      if (data.body.type === "ready") {
        postRequest(event.source);
        return;
      }
      if (
        data.body.type !== "chemicalSpaceRecords"
        || data.body.requestId !== requestId
      ) return;
      const records = Array.isArray(data.body.records)
        ? data.body.records.filter(isBrowserChemicalSpaceRecord).slice(0, 20_000)
        : [];
      cleanup();
      if (records.length < 2) {
        reject(new Error("The Grid contains fewer than two molecules that RDKit can fingerprint."));
      } else {
        resolve(records);
      }
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      for (const timer of retryTimers) window.clearTimeout(timer);
      for (const [iframe, onLoad] of iframeLoadListeners) iframe.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    for (const delay of retryDelays) {
      retryTimers.push(window.setTimeout(postRequest, delay));
    }
  });
}

function requestFromGridViewer<T>(
  documentId: string,
  request: Record<string, unknown>,
  parse: (body: Record<string, unknown>) => T | null,
  signal: AbortSignal,
  timeoutMs = 12_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestPayload = { source: "burette-grid-host", body: { ...request, documentId } };
    const iframeLoadListeners = new Map<HTMLIFrameElement, () => void>();
    const retryTimers: number[] = [];
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The Grid did not respond to a chemical-space column request."));
    }, timeoutMs);
    const postRequest = (target?: MessageEventSource | null) => {
      if (signal.aborted) return;
      if (target && typeof target === "object" && "postMessage" in target) {
        (target as Window).postMessage(requestPayload, "*");
        return;
      }
      const escapedId = CSS.escape(documentId);
      const candidates = [
        activeViewerIframeForDocument(documentId, "grid2d"),
        ...document.querySelectorAll<HTMLIFrameElement>(
          `.viewer-iframe[data-document-id="${escapedId}"][data-renderer="grid2d"]`,
        ),
      ];
      const targets = new Set<Window>();
      for (const iframe of candidates) {
        if (!iframe) continue;
        if (iframe.contentWindow) targets.add(iframe.contentWindow);
        if (!iframeLoadListeners.has(iframe)) {
          const onLoad = () => postRequest(iframe.contentWindow);
          iframeLoadListeners.set(iframe, onLoad);
          iframe.addEventListener("load", onLoad);
        }
      }
      for (const contentWindow of targets) contentWindow.postMessage(requestPayload, "*");
    };
    const onAbort = () => {
      cleanup();
      const error = new Error("Chemical-space calculation was cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data && typeof event.data === "object"
        ? event.data as { source?: unknown; body?: Record<string, unknown> }
        : null;
      if (
        data?.source !== "burette-grid"
        || data.body?.documentId !== documentId
        || !isKnownViewerMessageSource(event.source, documentId)
      ) return;
      if (data.body.type === "ready") {
        postRequest(event.source);
        return;
      }
      const parsed = parse(data.body);
      if (parsed === null) return;
      cleanup();
      resolve(parsed);
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      for (const timer of retryTimers) window.clearTimeout(timer);
      for (const [iframe, onLoad] of iframeLoadListeners) iframe.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    for (const delay of [0, 250, 1_000, 3_000]) {
      retryTimers.push(window.setTimeout(postRequest, delay));
    }
  });
}

function requestChemicalSpaceIndexState(documentId: string, signal: AbortSignal): Promise<GridIndexState> {
  const requestId = `chemical-space-index-${crypto.randomUUID()}`;
  return requestFromGridViewer<GridIndexState>(
    documentId,
    { type: "chemicalSpaceRequestIndexState", requestId },
    (body) => {
      if (body.type !== "chemicalSpaceIndexState" || body.requestId !== requestId) return null;
      const recordsIndexed = Number(body.recordsIndexed ?? 0);
      const recordsTotal = Number(body.recordsTotal ?? 0);
      const bytesIndexed = Number(body.bytesIndexed ?? 0);
      const bytesTotal = Number(body.bytesTotal ?? 0);
      const sourceRevision = Number(body.sourceRevision ?? 0);
      return {
        recordsIndexed: Number.isFinite(recordsIndexed) ? recordsIndexed : 0,
        recordsTotal: Number.isFinite(recordsTotal) ? recordsTotal : 0,
        bytesIndexed: Number.isFinite(bytesIndexed) ? bytesIndexed : 0,
        bytesTotal: Number.isFinite(bytesTotal) ? bytesTotal : 0,
        indexing: body.indexing === true,
        indexReady: body.indexReady !== false,
        indexError: body.indexError == null ? null : String(body.indexError),
        sourceRevision: Number.isSafeInteger(sourceRevision) && sourceRevision >= 0
          ? sourceRevision
          : 0,
      };
    },
    signal,
  );
}

function requestChemicalSpaceColumns(documentId: string, signal: AbortSignal): Promise<ActivityColumn[]> {
  const requestId = `chemical-space-columns-${crypto.randomUUID()}`;
  return requestFromGridViewer<ActivityColumn[]>(
    documentId,
    { type: "chemicalSpaceRequestColumns", requestId },
    (body) => {
      if (body.type !== "chemicalSpaceColumns" || body.requestId !== requestId) return null;
      if (!Array.isArray(body.columns)) return [];
      return body.columns.filter(
        (column): column is ActivityColumn =>
          Boolean(column) && typeof column === "object"
          && typeof (column as ActivityColumn).id === "string"
          && typeof (column as ActivityColumn).label === "string",
      );
    },
    signal,
  );
}

function requestChemicalSpaceColumnValues(
  documentId: string,
  columnId: string,
  signal: AbortSignal,
): Promise<Array<[number, number]>> {
  const requestId = `chemical-space-values-${crypto.randomUUID()}`;
  return requestFromGridViewer<Array<[number, number]>>(
    documentId,
    { type: "chemicalSpaceRequestColumnValues", requestId, columnId },
    (body) => {
      if (body.type !== "chemicalSpaceColumnValues" || body.requestId !== requestId) return null;
      if (body.columnId !== columnId || !Array.isArray(body.values)) return [];
      const entries: Array<[number, number]> = [];
      for (const entry of body.values) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const sourceRecordId = Number(entry[0]);
        const value = Number(entry[1]);
        if (Number.isSafeInteger(sourceRecordId) && sourceRecordId >= 0 && Number.isFinite(value)) {
          entries.push([sourceRecordId, value]);
        }
      }
      return entries;
    },
    signal,
  );
}

function viridisColor(t: number): string {
  const stops = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  const from = stops[index];
  const to = stops[index + 1];
  const channel = (component: number) => Math.round(from[component] + (to[component] - from[component]) * fraction);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function buildActivityColoring(
  values: Map<number, number>,
  direction: ActivityDirection,
): ActivityColoring | null {
  if (values.size === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values.values()) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = max - min;
  const colors = new Map<number, string>();
  for (const [sourceRecordId, value] of values) {
    const normalized = span > 0 ? (value - min) / span : 0.5;
    const t = direction === "lowerActive" ? 1 - normalized : normalized;
    colors.set(sourceRecordId, viridisColor(t));
  }
  return { colors, min, max };
}

const MAX_CLIFF_RESULTS = 500;

// Sparse activity-cliff discovery over the Metal kNN neighbour graph. SALI is
// the structure–activity landscape index (Δactivity / (1 − Tanimoto)); raw Δ is
// kept alongside it. No dense pairwise matrix is ever built — we only walk the
// bounded neighbour edges the backend already computed.
function computeActivityCliffs(
  result: ChemicalSpaceResult,
  activityValues: Map<number, number>,
  minSimilarity: number,
  minDelta: number,
): ActivityCliff[] {
  const edges = result.neighborEdges ?? [];
  const similarities = result.neighborSimilarities ?? [];
  if (edges.length === 0 || activityValues.size === 0) return [];
  const ids = result.sourceRecordIds;
  const cliffs: ActivityCliff[] = [];
  for (let edge = 0; edge < edges.length; edge += 1) {
    const similarity = similarities[edge] ?? 0;
    if (similarity < minSimilarity) continue;
    const [indexA, indexB] = edges[edge];
    const sourceA = ids[indexA];
    const sourceB = ids[indexB];
    if (sourceA === undefined || sourceB === undefined) continue;
    const activityA = activityValues.get(sourceA);
    const activityB = activityValues.get(sourceB);
    if (activityA === undefined || activityB === undefined) continue;
    const delta = Math.abs(activityA - activityB);
    if (delta < minDelta) continue;
    const gap = 1 - similarity;
    // Pairs the descriptor cannot separate (stereo isomers, tautomers, repeated
    // measurements) leave no gap to divide by. Equal activity is no cliff at all;
    // otherwise the pair is a genuine landscape singularity, marked for capping.
    const sali = gap > 0 ? delta / gap : delta > 0 ? Number.POSITIVE_INFINITY : 0;
    cliffs.push({ sourceA, sourceB, indexA, indexB, similarity, delta, sali });
  }
  // DataWarrior pins those singularities to twice the strongest finite SALI so
  // they stay on top without saturating the scale. Clamping the divisor instead
  // scored them near 1e6, which buried every real cliff and flattened the edge
  // shading, since the map reads intensity as sali / cliffs[0].sali.
  const maxFiniteSali = cliffs.reduce(
    (max, cliff) => (Number.isFinite(cliff.sali) && cliff.sali > max ? cliff.sali : max),
    0,
  );
  for (const cliff of cliffs) {
    // Δ keeps the ranking meaningful when every retained pair is a singularity.
    if (cliff.sali === Number.POSITIVE_INFINITY) cliff.sali = 2 * maxFiniteSali || cliff.delta;
  }
  cliffs.sort((left, right) => right.sali - left.sali);
  return cliffs.slice(0, MAX_CLIFF_RESULTS);
}

function isBrowserChemicalSpaceRecord(value: unknown): value is BrowserChemicalSpaceInputRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BrowserChemicalSpaceInputRecord>;
  return Number.isSafeInteger(record.sourceRecordId)
    && typeof record.moleculeContentSha256 === "string"
    && (record.format === "smiles" || record.format === "molblock")
    && typeof record.input === "string"
    && record.input.length > 0;
}
