import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  computeErrorMessage,
  runChemicalSpaceWorkflow,
  type ChemicalSpaceOptions,
  type ChemicalSpaceProgress,
  type ChemicalSpaceResult,
} from "../lib/compute-cluster";
import { isTauriRuntime } from "../lib/tauri";
import { activeViewerIframeForDocument, isKnownViewerMessageSource } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";

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

const DEFAULT_OPTIONS: ChemicalSpaceOptions = {
  dimensions: 2,
  neighbors: 15,
  epochs: 500,
  minDist: 0.1,
  spread: 1,
  learningRate: 1,
  negativeSampleRate: 5,
  randomSeed: 42,
};
const completedEmbeddings = new Map<string, ChemicalSpaceResult>();
const GRID_SELECTION_BRIDGE_LIMIT = 100_000;
const MAX_MOLECULE_PREVIEW_BASE64_BYTES = 350_000;
const MAX_LASSO_POINTS = 4_096;

export function ChemicalSpacePanel({ document }: ChemicalSpacePanelProps) {
  const [draft, setDraft] = useState(DEFAULT_OPTIONS);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [result, setResult] = useState<ChemicalSpaceResult | null>(null);
  const [progress, setProgress] = useState<ChemicalSpaceProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const [preview, setPreview] = useState<MoleculePreview | null>(null);
  const [tool, setTool] = useState<"navigate" | "lasso">("navigate");
  const documentId = document?.renderer === "grid2d" ? document.id : null;

  useEffect(() => {
    setResult(null);
    setError(null);
    setProgress(null);
    setSelected(new Set());
    setHovered(null);
    setPreview(null);
  }, [documentId]);

  useEffect(() => {
    if (!documentId || !isTauriRuntime()) return;
    const key = embeddingCacheKey(documentId, options);
    const cached = completedEmbeddings.get(key);
    if (cached) {
      setResult(cached);
      setProgress(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setResult(null);
    setError(null);
    setProgress({ phase: "queued" });
    void runChemicalSpaceWorkflow(documentId, options, setProgress, controller.signal)
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
      });
    return () => controller.abort();
  }, [documentId, options]);

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
      if (data.body.type === "gridHoverChanged") {
        const index = Number(data.body.sourceRecordId);
        setHovered(Number.isSafeInteger(index) && index >= 0 ? index : null);
      }
      if (data.body.type === "chemicalSpaceMoleculePreview") {
        const index = Number(data.body.sourceRecordId);
        if (!Number.isSafeInteger(index) || index < 0) {
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

  if (!documentId) {
    return <ChemicalSpaceEmpty message="Open a molecular Grid to build its chemical-space map." />;
  }
  if (!isTauriRuntime()) {
    return <ChemicalSpaceEmpty message="Metal chemical space is available in the Burrete desktop app." />;
  }

  const runningLabel = progressLabel(progress);
  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="chemical-space-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={draft.dimensions.toString()}
            aria-label="UMAP dimensions"
            onValueChange={(value) => {
              if (value !== "2" && value !== "3") return;
              const dimensions = Number(value) as 2 | 3;
              const next = { ...draft, dimensions };
              setDraft(next);
              setOptions(next);
            }}
          >
            <ToggleGroupItem value="2" aria-label="2D UMAP">2D</ToggleGroupItem>
            <ToggleGroupItem value="3" aria-label="3D UMAP">3D</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant={tool === "navigate" ? "secondary" : "ghost"} onClick={() => setTool("navigate")}>Explore</Button>
              </TooltipTrigger>
              <TooltipContent>Pan, orbit, zoom, and inspect molecules</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant={tool === "lasso" ? "secondary" : "ghost"} onClick={() => setTool("lasso")}>Lasso</Button>
              </TooltipTrigger>
              <TooltipContent>Draw a free-form selection linked to Grid</TooltipContent>
            </Tooltip>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {result ? `${result.successfulRecords.toLocaleString()} molecules · Metal` : runningLabel}
          </span>
        </div>

        <div className="relative min-h-0 flex-1">
          {result ? (
            <ChemicalSpaceCanvas
              result={result}
              selected={selected}
              hovered={hovered}
              preview={preview}
              tool={tool}
              onHover={(sourceRecordId) => {
                setHovered(sourceRecordId);
                if (sourceRecordId === null) setPreview(null);
                postToGrid({ type: "chemicalSpaceHoverChanged", sourceRecordId });
              }}
              onSelect={(sourceRecordIds) => {
                const bounded = sourceRecordIds.slice(0, GRID_SELECTION_BRIDGE_LIMIT);
                setSelected(new Set(bounded));
                postToGrid({ type: "chemicalSpaceSelectionChanged", sourceRecordIds: bounded });
              }}
            />
          ) : error ? (
            <ChemicalSpaceEmpty message={error} actionLabel="Retry" onAction={() => setOptions({ ...draft })} />
          ) : (
            <ChemicalSpaceEmpty message={runningLabel || "Preparing chemical space…"} />
          )}
        </div>

        <Collapsible className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">UMAP parameters</Button>
            </CollapsibleTrigger>
            <span className="text-xs text-muted-foreground">
              k={draft.neighbors} · min dist={draft.minDist.toFixed(2)}
            </span>
          </div>
          <CollapsibleContent className="pt-3">
            <FieldGroup className="gap-4">
              <ParameterField label="Neighbors" value={draft.neighbors}>
                <Slider min={2} max={64} step={1} value={[draft.neighbors]} onValueChange={([neighbors]) => setDraft((value) => ({ ...value, neighbors }))} />
              </ParameterField>
              <ParameterField label="Minimum distance" value={draft.minDist.toFixed(2)}>
                <Slider min={0} max={1} step={0.01} value={[draft.minDist]} onValueChange={([minDist]) => setDraft((value) => ({ ...value, minDist }))} />
              </ParameterField>
              <ParameterField label="Epochs" value={draft.epochs}>
                <Slider min={100} max={1500} step={100} value={[draft.epochs]} onValueChange={([epochs]) => setDraft((value) => ({ ...value, epochs }))} />
              </ParameterField>
              <ParameterField label="Learning rate" value={draft.learningRate.toFixed(1)}>
                <Slider min={0.1} max={3} step={0.1} value={[draft.learningRate]} onValueChange={([learningRate]) => setDraft((value) => ({ ...value, learningRate }))} />
              </ParameterField>
            </FieldGroup>
            <Button className="mt-4 w-full" size="sm" disabled={Boolean(progress)} onClick={() => setOptions({ ...draft })}>
              Rebuild on Metal
            </Button>
          </CollapsibleContent>
        </Collapsible>
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

function ChemicalSpaceCanvas({
  result,
  selected,
  hovered,
  preview,
  tool,
  onHover,
  onSelect,
}: {
  result: ChemicalSpaceResult;
  selected: Set<number>;
  hovered: number | null;
  preview: MoleculePreview | null;
  tool: "navigate" | "lasso";
  onHover: (sourceRecordId: number | null) => void;
  onSelect: (sourceRecordIds: number[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectedRef = useRef<ProjectedPoint[]>([]);
  const pointerRef = useRef<{ start: Point2; last: Point2; moved: boolean } | null>(null);
  const lassoRef = useRef<Point2[]>([]);
  const hoverRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1, pixelRatio: 1 });
  const [camera, setCamera] = useState({ yaw: -0.45, pitch: 0.35, zoom: 1, panX: 0, panY: 0 });
  const [lasso, setLasso] = useState<Point2[]>([]);
  const normalized = useMemo(() => normalizePositions(result.positions), [result.positions]);

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
    const projected = projectPositions(normalized, result.sourceRecordIds, viewport, camera, result.dimensions);
    projectedRef.current = projected;
    const selectedColor = styles.getPropertyValue("--primary").trim() || "#af52de";
    const pointColor = styles.getPropertyValue("--muted-foreground").trim() || "#8e8e93";
    const ringColor = styles.getPropertyValue("--foreground").trim() || "#f5f5f7";
    for (const point of [...projected].sort((left, right) => left.depth - right.depth)) {
      const active = selected.has(point.sourceRecordId);
      const hot = hovered === point.sourceRecordId;
      context.beginPath();
      context.arc(point.x, point.y, hot ? 5.5 : active ? 4.5 : 2.6, 0, Math.PI * 2);
      context.fillStyle = active || hot ? selectedColor : pointColor;
      context.globalAlpha = active || hot ? 1 : 0.62;
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
  }, [camera, hovered, lasso, normalized, result.dimensions, result.sourceRecordIds, selected, viewport]);

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const hoverNearest = (point: Point2) => {
    let nearest: ProjectedPoint | null = null;
    let distanceSquared = 64;
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

  const previewPoint = preview
    ? projectedRef.current.find((point) => point.sourceRecordId === preview.sourceRecordId) ?? null
    : null;
  return (
    <div className="absolute inset-0 overflow-hidden bg-muted/20">
      <canvas
        ref={canvasRef}
        className="size-full touch-none"
        aria-label={`${result.dimensions}D UMAP chemical-space map`}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY > 0 ? 0.9 : 1.1;
          setCamera((value) => ({ ...value, zoom: Math.max(0.35, Math.min(5, value.zoom * factor)) }));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = localPoint(event);
          pointerRef.current = { start: point, last: point, moved: false };
          if (tool === "lasso") {
            lassoRef.current = [point];
            setLasso([point]);
          }
        }}
        onPointerMove={(event) => {
          const point = localPoint(event);
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
          } else if (result.dimensions === 3) {
            setCamera((value) => ({ ...value, yaw: value.yaw + dx * 0.008, pitch: Math.max(-1.4, Math.min(1.4, value.pitch + dy * 0.008)) }));
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
          hoverRef.current = null;
          onHover(null);
        }}
      />
      {preview && previewPoint ? (
        <div
          className="pointer-events-none absolute z-10 w-52 overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
          style={{
            left: Math.min(Math.max(8, viewport.width - 220), Math.max(8, previewPoint.x + 12)),
            top: Math.min(Math.max(8, viewport.height - 188), Math.max(8, previewPoint.y + 12)),
          }}
        >
          {preview.svgUrl ? <img className="h-28 w-full rounded-lg bg-white object-contain" src={preview.svgUrl} alt="" /> : null}
          <div className="mt-1 truncate text-xs font-medium">{preview.name}</div>
          {preview.smiles ? <div className="truncate font-mono text-[10px] text-muted-foreground">{preview.smiles}</div> : null}
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
        {selected.size.toLocaleString()} selected · wheel to zoom{result.dimensions === 3 ? " · drag to orbit" : " · drag to pan"}
      </div>
    </div>
  );
}

function ChemicalSpaceEmpty({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <span>{message}</span>
      {actionLabel && onAction ? <Button size="sm" variant="outline" onClick={onAction}>{actionLabel}</Button> : null}
    </div>
  );
}

function embeddingCacheKey(documentId: string, options: ChemicalSpaceOptions) {
  return `${documentId}:${JSON.stringify(options)}`;
}

function progressLabel(progress: ChemicalSpaceProgress | null) {
  if (!progress) return "";
  if (progress.phase === "fingerprints") {
    return `Fingerprints ${Math.min(progress.completedRecords ?? 0, progress.totalRecords ?? 0).toLocaleString()} / ${(progress.totalRecords ?? 0).toLocaleString()}`;
  }
  if (progress.phase === "embedding") return "Metal Tanimoto + UMAP…";
  return "Preparing snapshot…";
}

function normalizePositions(positions: Array<[number, number, number]>) {
  if (!positions.length) return [];
  const center = [0, 1, 2].map((axis) => positions.reduce((sum, position) => sum + position[axis], 0) / positions.length);
  const centered = positions.map((position) => [position[0] - center[0], position[1] - center[1], position[2] - center[2]] as [number, number, number]);
  const radius = Math.max(1e-6, ...centered.map((position) => Math.hypot(...position)));
  return centered.map((position) => position.map((value) => value / radius) as [number, number, number]);
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
