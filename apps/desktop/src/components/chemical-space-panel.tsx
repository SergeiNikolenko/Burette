import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  computeErrorMessage,
  invalidateChemicalSpaceFingerprintCache,
  runChemicalSpaceWorkflow,
  runChemicalSpaceStudyWorkflow,
  type BrowserChemicalSpaceInputRecord,
  type ChemicalSpaceOptions,
  type ChemicalSpaceMethod,
  type ChemicalSpaceRepresentation,
  type ChemicalSpaceProgress,
  type ChemicalSpaceResult,
} from "../lib/compute-cluster";
import {
  runBrowserDevChemicalSpace,
  runBrowserDevChemicalSpaceStudy,
} from "../lib/browser-dev-compute";
import { normalizeChemicalSpacePositions } from "../lib/chemical-space-normalization";
import { isTauriRuntime } from "../lib/tauri";
import { activeViewerIframeForDocument, isKnownViewerMessageSource } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";
import { ChemicalSpace3D } from "./chemical-space-3d";
import { useThemePortalContainer } from "./radix-menu";

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
const CHEMICAL_SPACE_REPRESENTATIONS: Array<{
  value: ChemicalSpaceRepresentation;
  label: string;
}> = [
  { value: "morgan", label: "Morgan · Tanimoto" },
  { value: "chemberta", label: "ChemBERTa 77M" },
  { value: "molformer", label: "MoLFormer XL" },
  { value: "unimol2-84m", label: "Uni-Mol2 84M" },
  { value: "unimol-v1", label: "Uni-Mol v1" },
];
const CHEMICAL_SPACE_METHODS: Array<{ value: ChemicalSpaceMethod; label: string }> = [
  { value: "umap", label: "UMAP" },
  { value: "tsne", label: "t-SNE" },
  { value: "pacmap", label: "PaCMAP" },
  { value: "localmap", label: "LocalMAP" },
  { value: "trimap", label: "TriMap" },
  { value: "dreams", label: "DREAMS" },
  { value: "cne", label: "CNE" },
  { value: "mmae", label: "MMAE" },
];
const completedEmbeddings = new Map<string, ChemicalSpaceResult>();
const GRID_SELECTION_BRIDGE_LIMIT = 100_000;
const MAX_MOLECULE_PREVIEW_BASE64_BYTES = 350_000;
const MAX_LASSO_POINTS = 4_096;
const DEFAULT_STUDY: StudyState = {
  parameter: "minDist",
  range: [0.02, 0.6],
  frames: 8,
};

export function ChemicalSpacePanel({ document }: ChemicalSpacePanelProps) {
  const portalContainer = useThemePortalContainer();
  const [draft, setDraft] = useState(DEFAULT_OPTIONS);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [result, setResult] = useState<ChemicalSpaceResult | null>(null);
  const [progress, setProgress] = useState<ChemicalSpaceProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const [preview, setPreview] = useState<MoleculePreview | null>(null);
  const [pointScale, setPointScale] = useState(1);
  const [tool, setTool] = useState<"navigate" | "lasso">("navigate");
  const [study, setStudy] = useState(DEFAULT_STUDY);
  const [completedStudy, setCompletedStudy] = useState<CompletedStudy | null>(null);
  const [studyPosition, setStudyPosition] = useState(0);
  const [studyPlaying, setStudyPlaying] = useState(false);
  const [studyRunning, setStudyRunning] = useState(false);
  const workflowControllerRef = useRef<AbortController | null>(null);
  const studyControllerRef = useRef<AbortController | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const documentId = document?.renderer === "grid2d" ? document.id : null;
  hoveredRef.current = hovered;
  const commitOptions = (next: ChemicalSpaceOptions) => {
    setCompletedStudy(null);
    setStudyPlaying(false);
    setStudyPosition(0);
    setOptions(next);
  };

  useEffect(() => {
    setResult(null);
    setError(null);
    setProgress(null);
    setSelected(new Set());
    setHovered(null);
    setPreview(null);
    setCompletedStudy(null);
    setStudyPosition(0);
    setStudyPlaying(false);
    setStudyRunning(false);
  }, [documentId]);

  useEffect(() => {
    if (!documentId) return;
    const key = embeddingCacheKey(documentId, options);
    const cached = completedEmbeddings.get(key);
    if (cached) {
      setResult(cached);
      setProgress(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    workflowControllerRef.current = controller;
    setResult(null);
    setError(null);
    setProgress({ phase: "queued" });
    const workflow = isTauriRuntime()
      ? runChemicalSpaceWorkflow(documentId, options, setProgress, controller.signal)
      : requestBrowserChemicalSpaceRecords(documentId, controller.signal)
        .then((records) => runBrowserDevChemicalSpace(records, options, setProgress, controller.signal));
    void workflow
      .then((next) => {
        if (controller.signal.aborted) return;
        completedEmbeddings.set(key, next);
        setResult(next);
        setProgress(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setProgress(null);
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
  }, [documentId, options]);

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
        data?.source !== "burrete-grid"
        || data.body?.documentId !== documentId
        || !isKnownViewerMessageSource(event.source, documentId)
      ) return;
      if (data.body.type === "gridMenuStateChanged" && Array.isArray(data.body.selectedSourceIndexes)) {
        setSelected(new Set(data.body.selectedSourceIndexes
          .slice(0, GRID_SELECTION_BRIDGE_LIMIT)
          .map(Number)
          .filter((index) => Number.isSafeInteger(index) && index >= 0)));
      }
      if (data.body.type === "gridDirtyChanged" && data.body.dirty === true) {
        invalidateChemicalSpaceFingerprintCache(documentId);
        invalidateCompletedEmbeddings(documentId);
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
      source: "burrete-grid-host",
      body: { type: "chemicalSpaceRequestState", documentId },
    }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [documentId]);

  const postToGrid = useCallback((body: Record<string, unknown>) => {
    if (!documentId) return;
    activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
      source: "burrete-grid-host",
      body: { ...body, documentId },
    }, "*");
  }, [documentId]);
  const stopCalculation = useCallback(() => {
    workflowControllerRef.current?.abort();
    workflowControllerRef.current = null;
    setProgress(null);
    setResult(null);
    setError("Calculation stopped.");
  }, []);
  const stopStudy = useCallback(() => {
    studyControllerRef.current?.abort();
    studyControllerRef.current = null;
    setProgress(null);
    setStudyRunning(false);
  }, []);

  if (!documentId) {
    return <ChemicalSpaceEmpty message="Open a molecular Grid to build its chemical-space map." />;
  }
  const runningLabel = progressLabel(progress);
  const displayedResult = completedStudy
    ? interpolateStudyResult(completedStudy.results, studyPosition)
    : result;
  const runStudy = async () => {
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
    setProgress({ phase: "queued" });
    setStudyPlaying(false);
    setStudyRunning(true);
    try {
      const results = isTauriRuntime()
        ? await runChemicalSpaceStudyWorkflow(documentId, frames, setProgress, controller.signal)
        : await requestBrowserChemicalSpaceRecords(documentId, controller.signal)
          .then((records) => runBrowserDevChemicalSpaceStudy(records, frames, setProgress, controller.signal));
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
      setError(computeErrorMessage(cause));
    } finally {
      if (studyControllerRef.current === controller) {
        studyControllerRef.current = null;
      }
    }
  };
  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="chemical-space-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
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
                {representation.label}
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
          <Field orientation="horizontal" className="w-44 shrink-0 gap-2">
            <FieldLabel className="text-xs text-muted-foreground">Size</FieldLabel>
            <Slider
              className="w-20"
              tone="neutral"
              min={0.5}
              max={3}
              step={0.1}
              value={[pointScale]}
              aria-label="Point size"
              onValueChange={([value]) => setPointScale(value)}
            />
            <span className="w-9 text-right font-mono text-[10px] text-muted-foreground">
              {Math.round(pointScale * 100)}%
            </span>
          </Field>
          {displayedResult ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  className="ml-auto"
                  variant="outline"
                  aria-label={`${displayedResult.successfulRecords.toLocaleString()} molecules, Metal. ${representationLabel(displayedResult.representation)}. Similarity graph ${similarityTimeLabel(displayedResult)}. Embedding ${displayedResult.embeddingGpuTimeMs} milliseconds.`}
                >
                  {displayedResult.successfulRecords.toLocaleString()} molecules · Metal
                </Badge>
              </TooltipTrigger>
              <TooltipContent showArrow={false}>
                {representationLabel(displayedResult.representation)}
                {": "}{similarityTimeLabel(displayedResult)}
                {" · "}embedding: {displayedResult.embeddingGpuTimeMs} ms
              </TooltipContent>
            </Tooltip>
          ) : (
            <Badge className="ml-auto" variant="outline">
              {progress ? <Spinner data-icon="inline-start" /> : null}
              {runningLabel}
            </Badge>
          )}
        </div>

        <div className="relative min-h-0 flex-1">
          {displayedResult ? (
            <ChemicalSpaceCanvas
              result={displayedResult}
              selected={selected}
              hovered={hovered}
              preview={preview}
              pointScale={pointScale}
              tool={tool}
              onHover={(sourceRecordId) => {
                setHovered(sourceRecordId);
                setPreview((current) => current?.sourceRecordId === sourceRecordId ? current : null);
                postToGrid({ type: "chemicalSpaceHoverChanged", sourceRecordId });
              }}
              onSelect={(sourceRecordIds) => {
                const bounded = sourceRecordIds.slice(0, GRID_SELECTION_BRIDGE_LIMIT);
                setSelected(new Set(bounded));
                postToGrid({
                  type: "chemicalSpaceSelectionChanged",
                  sourceRecordIds: bounded,
                  filterToSelection: tool === "lasso",
                });
              }}
            />
          ) : error ? (
            <ChemicalSpaceEmpty message={error} actionLabel="Retry" onAction={() => commitOptions({ ...draft })} />
          ) : (
            <ChemicalSpaceLoading
              message={runningLabel || "Preparing chemical space…"}
              progress={progress}
              onStop={stopCalculation}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center border-t border-border px-3 py-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">{methodLabel(draft.method)} parameters</Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              sideOffset={8}
              container={portalContainer}
              className="max-h-[min(70vh,32rem)] w-80 overflow-y-auto"
            >
              <PopoverHeader className="flex-row items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <PopoverTitle>{methodLabel(draft.method)} parameters</PopoverTitle>
                  <PopoverDescription>
                    k={draft.neighbors} · min dist={draft.minDist.toFixed(2)}
                  </PopoverDescription>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setDraft((current) => ({
                    ...DEFAULT_OPTIONS,
                    representation: current.representation,
                    method: current.method,
                    dimensions: current.dimensions,
                  }))}
                >
                  Reset
                </Button>
              </PopoverHeader>
              <FieldGroup className="gap-4">
                <ParameterField label="Neighbors" value={draft.neighbors}>
                  <Slider tone="neutral" min={2} max={64} step={1} value={[draft.neighbors]} onValueChange={([neighbors]) => setDraft((value) => ({ ...value, neighbors }))} />
                </ParameterField>
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
              </FieldGroup>
              <Button className="mt-4 w-full" variant="outline" size="sm" disabled={Boolean(progress)} onClick={() => commitOptions({ ...draft })}>
                Rebuild on Metal
              </Button>
              <Separator className="my-4" />
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="chemical-space-study-parameter">Parameter study</FieldLabel>
                  <NativeSelect
                    id="chemical-space-study-parameter"
                    size="sm"
                    value={study.parameter}
                    onChange={(event) => setStudy(studyDefaults(event.currentTarget.value as StudyParameter))}
                  >
                    <NativeSelectOption value="minDist">Minimum distance</NativeSelectOption>
                    <NativeSelectOption value="neighbors">Neighbors</NativeSelectOption>
                    <NativeSelectOption value="learningRate">Learning rate</NativeSelectOption>
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
              <Button className="mt-4 w-full" variant="secondary" size="sm" disabled={Boolean(progress)} onClick={() => void runStudy()}>
                Run animated study on Metal
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        {studyRunning ? (
          <div
            className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-3 py-2"
            data-testid="parameter-study-timeline"
          >
            <Spinner data-icon="inline-start" />
            <Progress
              className="flex-1"
              value={progressPercent(progress) ?? undefined}
              indeterminate={progressPercent(progress) === null}
              aria-label={runningLabel || "Parameter study calculation in progress"}
            />
            <span className="min-w-28 text-right font-mono text-xs text-muted-foreground">
              {runningLabel || "Preparing study…"}
            </span>
            <Button size="xs" variant="outline" onClick={stopStudy}>
              Stop
            </Button>
          </div>
        ) : completedStudy && displayedResult ? (
          <div
            className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-3 py-2"
            data-testid="parameter-study-timeline"
          >
            <Button
              size="xs"
              variant="outline"
              onClick={() => setStudyPlaying((value) => !value)}
            >
              {studyPlaying ? "Pause" : "Play"}
            </Button>
            <Slider
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
    </TooltipProvider>
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
  selected: Set<number>;
  hovered: number | null;
  preview: MoleculePreview | null;
  pointScale: number;
  tool: "navigate" | "lasso";
  onHover: (sourceRecordId: number | null) => void;
  onSelect: (sourceRecordIds: number[]) => void;
};

function ChemicalSpaceCanvas(props: ChemicalSpaceCanvasProps) {
  const normalized = useMemo(
    () => normalizeChemicalSpacePositions(props.result.positions),
    [props.result.positions],
  );
  if (props.result.dimensions === 3) {
    return (
      <ChemicalSpace3D
        positions={normalized}
        sourceRecordIds={props.result.sourceRecordIds}
        selected={props.selected}
        hovered={props.hovered}
        preview={props.preview}
        pointScale={props.pointScale}
        tool={props.tool}
        methodLabel={methodLabel(props.result.method)}
        onHover={props.onHover}
        onSelect={props.onSelect}
      />
    );
  }
  return <ChemicalSpace2D {...props} normalized={normalized} />;
}

function ChemicalSpace2D({
  result,
  selected,
  hovered,
  preview,
  pointScale,
  tool,
  onHover,
  onSelect,
  normalized,
}: ChemicalSpaceCanvasProps & { normalized: Array<[number, number, number]> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectedRef = useRef<ProjectedPoint[]>([]);
  const pointerRef = useRef<{ start: Point2; last: Point2; moved: boolean } | null>(null);
  const lassoRef = useRef<Point2[]>([]);
  const hoverRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1, pixelRatio: 1 });
  const [camera, setCamera] = useState({ yaw: -0.45, pitch: 0.35, zoom: 1, panX: 0, panY: 0 });
  const [lasso, setLasso] = useState<Point2[]>([]);
  const [cursor, setCursor] = useState<Point2 | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, entry.contentRect.width);
      const height = Math.max(1, entry.contentRect.height);
      setViewport({ width, height, pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = Math.round(viewport.width * viewport.pixelRatio);
    canvas.height = Math.round(viewport.height * viewport.pixelRatio);
    context.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
    const styles = getComputedStyle(canvas);
    context.clearRect(0, 0, viewport.width, viewport.height);
    const projected = projectPositions(normalized, result.sourceRecordIds, viewport, camera, 2);
    projectedRef.current = projected;
    const selectedColor = styles.getPropertyValue("--primary").trim() || "#af52de";
    const pointColor = styles.color || "#f5f5f7";
    const ringColor = pointColor;
    const basePointRadius = adaptivePointRadius(result.successfulRecords);
    const basePointOpacity = adaptivePointOpacity(result.successfulRecords);
    for (const point of [...projected].sort((left, right) => left.depth - right.depth)) {
      const active = selected.has(point.sourceRecordId);
      const hot = hovered === point.sourceRecordId;
      context.beginPath();
      context.arc(
        point.x,
        point.y,
        basePointRadius * pointScale,
        0,
        Math.PI * 2,
      );
      context.fillStyle = active || hot ? selectedColor : pointColor;
      context.globalAlpha = active || hot ? 1 : basePointOpacity;
      context.fill();
      if (hot) {
        context.lineWidth = 1.5;
        context.strokeStyle = ringColor;
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    if (lasso.length > 1) {
      context.beginPath();
      context.moveTo(lasso[0].x, lasso[0].y);
      for (const point of lasso.slice(1)) context.lineTo(point.x, point.y);
      context.strokeStyle = selectedColor;
      context.lineWidth = 1.5;
      context.setLineDash([5, 4]);
      context.stroke();
      context.setLineDash([]);
    }
  }, [camera, hovered, lasso, normalized, pointScale, result.sourceRecordIds, selected, viewport]);

  const localPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const hoverNearest = (point: Point2) => {
    let nearest: ProjectedPoint | null = null;
    let distanceSquared = Math.max(4, adaptivePointRadius(result.successfulRecords) * pointScale + 3) ** 2;
    for (const candidate of projectedRef.current) {
      const nextDistance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
      if (nextDistance < distanceSquared) {
        nearest = candidate;
        distanceSquared = nextDistance;
      }
    }
    const sourceRecordId = nearest?.sourceRecordId ?? null;
    if (sourceRecordId === hoverRef.current) return;
    hoverRef.current = sourceRecordId;
    onHover(sourceRecordId);
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
            const zoom = Math.max(0.35, Math.min(5, value.zoom * factor));
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
              lassoRef.current = [...lassoRef.current, point];
              setLasso(lassoRef.current);
            }
          } else {
            setCamera((value) => ({ ...value, panX: value.panX + dx, panY: value.panY + dy }));
          }
        }}
        onPointerUp={(event) => {
          const pointer = pointerRef.current;
          pointerRef.current = null;
          if (tool === "lasso") {
            const polygon = lassoRef.current;
            const sourceRecordIds = polygon.length >= 3
              ? projectedRef.current.filter((point) => pointInPolygon(point, polygon)).map((point) => point.sourceRecordId)
              : [];
            lassoRef.current = [];
            setLasso([]);
            onSelect(sourceRecordIds);
          } else if (pointer && !pointer.moved) {
            hoverNearest(localPoint(event));
            onSelect(hoverRef.current === null ? [] : [hoverRef.current]);
          }
        }}
        onPointerCancel={() => {
          pointerRef.current = null;
          lassoRef.current = [];
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
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
        {selected.size.toLocaleString()} selected · WASD or drag to pan · wheel to zoom
      </div>
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

function embeddingCacheKey(documentId: string, options: ChemicalSpaceOptions) {
  return `${documentId}:${JSON.stringify(options)}`;
}

function invalidateCompletedEmbeddings(documentId: string) {
  const prefix = `${documentId}:`;
  for (const key of completedEmbeddings.keys()) {
    if (key.startsWith(prefix)) completedEmbeddings.delete(key);
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

function pointInPolygon(point: Point2, polygon: Point2[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const left = polygon[index];
    const right = polygon[previous];
    const crosses = (left.y > point.y) !== (right.y > point.y)
      && point.x < ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y || Number.EPSILON) + left.x;
    if (crosses) inside = !inside;
  }
  return inside;
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
      source: "burrete-grid-host",
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
        data?.source !== "burrete-grid"
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

function isBrowserChemicalSpaceRecord(value: unknown): value is BrowserChemicalSpaceInputRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BrowserChemicalSpaceInputRecord>;
  return Number.isSafeInteger(record.sourceRecordId)
    && typeof record.moleculeContentSha256 === "string"
    && (record.format === "smiles" || record.format === "molblock")
    && typeof record.input === "string"
    && record.input.length > 0;
}
