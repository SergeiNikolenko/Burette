import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { ViewerDocument } from "../../../types";
import { parseFepGraphml, type FepNetworkData, type FepNetworkEdge, type FepNetworkNode } from "../../../lib/fep-graphml";
import { showNativeContextMenu } from "../../native-context-menu";
import type { ShellActions } from "../../types";
import { ViewerFrame } from "../viewer-frame";
import { definePageKind } from "./types";

type RDKitModule = {
  get_mol: (input: string) => RDKitMol;
  get_qmol?: (input: string) => RDKitMol;
};

type RDKitMol = {
  delete?: () => void;
  get_molblock?: () => string;
  get_smiles?: () => string;
  get_svg: (width?: number, height?: number) => string;
  get_svg_with_highlights?: (details: string) => string;
  get_substruct_match?: (query: RDKitMol) => string | { atoms?: number[]; bonds?: number[] };
  is_valid?: () => boolean;
  set_new_coords?: () => void;
};

type FepNetworkLocation = {
  kind: "fep-network";
  title?: string;
  graphmlText?: string;
};

type ViewMode = "graph" | "grid";
type HighlightMode = "off" | "common" | "different";
type EdgeMetricMode = "score" | "energy";
type CanvasSize = { width: number; height: number };

const rdkitScriptUrl = new URL("../../../../../../PreviewExtension/Web/rdkit/RDKit_minimal.js", import.meta.url).href;
const rdkitWasmUrl = new URL("../../../../../../PreviewExtension/Web/rdkit/RDKit_minimal.wasm", import.meta.url).href;
const sampleGraphmlUrl = new URL("../../../../../../prototypes/ligand_network.graphml", import.meta.url).href;
const gridAssetsBaseUrl = `${new URL("../../../../../../PreviewExtension/Web/", import.meta.url).href.replace(/\/?$/u, "/")}`;
const commonCoreSmarts = "c1ccccc1";
const gridAssetVersion = "grid-ui-v94";
const cardSize = { width: 14.4, height: 13.6 };
const edgeLabelAvoidanceCardSize = { width: 15.2, height: 22.6 };

declare global {
  interface Window {
    initRDKitModule?: (options?: { locateFile?: (file: string) => string }) => Promise<RDKitModule>;
  }
}

export type { FepNetworkLocation };

export const fepNetworkKind = definePageKind<"fep-network", FepNetworkLocation>({
  kind: "fep-network",
  title: (location) => location.title ? `FEP Network: ${location.title}` : "FEP Network Preview",
  description: "FEP ligand network preview",
  Component: ({ actions, location }) => <FepNetworkPreview actions={actions} location={location} />,
  keepAlive: true,
  fromPayload: (data) => (data.kind === "fep-network" ? {
    kind: "fep-network",
    title: typeof data.title === "string" ? data.title : undefined,
    graphmlText: typeof data.graphmlText === "string" ? data.graphmlText : undefined,
  } : null),
  serialize: () => null,
});

function FepNetworkPreview({ actions, location }: { actions: ShellActions; location: FepNetworkLocation }) {
  const [data, setData] = useState<FepNetworkData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [rdkit, setRdkit] = useState<RDKitModule | null>(null);
  const [rdkitError, setRdkitError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("off");
  const [edgeMetricMode, setEdgeMetricMode] = useState<EdgeMetricMode>("score");
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(() => new Set());
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 1, height: 1 });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | {
    type: "card" | "pan";
    id?: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>(null);

  useEffect(() => {
    let canceled = false;
    loadFepNetworkData(location.graphmlText)
      .then((next) => {
        if (canceled) return;
        setData(next);
        setDataError(null);
        setPositions(Object.fromEntries(next.nodes.map((node) => [node.id, { x: node.x, y: node.y }])));
      })
      .catch((error) => {
        if (!canceled) setDataError(error instanceof Error ? error.message : String(error));
      });
    loadRDKit()
      .then((module) => { if (!canceled) setRdkit(module); })
      .catch((error) => { if (!canceled) setRdkitError(error instanceof Error ? error.message : String(error)); });
    return () => { canceled = true; };
  }, [location.graphmlText]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.type === "pan") {
        setViewport((current) => ({ ...current, x: drag.originX + dx, y: drag.originY + dy }));
        return;
      }
      if (drag.id) {
        const id = drag.id;
        setPositions((current) => ({
          ...current,
          [id]: {
            x: Math.max(6, Math.min(94, drag.originX + dx / 10 / viewport.scale)),
            y: Math.max(8, Math.min(92, drag.originY + dy / 8 / viewport.scale)),
          },
        }));
      }
    };
    const onStop = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onStop);
    window.addEventListener("pointercancel", onStop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onStop);
      window.removeEventListener("pointercancel", onStop);
    };
  }, [viewport.scale]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || viewMode !== "graph") return;
    const updateCanvasSize = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      setCanvasSize((current) => (
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height }
      ));
    };
    updateCanvasSize();
    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [data, viewMode]);

  const visibleNodes = useMemo(
    () => data?.nodes.filter((node) => !hiddenNodes.has(node.id)) ?? [],
    [data?.nodes, hiddenNodes],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => data?.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) ?? [],
    [data?.edges, visibleNodeIds],
  );
  const nodeById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const edgeStats = useMemo(() => edgeMetricStats(visibleEdges), [visibleEdges]);
  const hasEnergyEdges = edgeStats.energy !== null;
  const activeEdgeKey = selectedEdgeKey ?? hoveredEdgeKey;
  const activeEdge = useMemo(
    () => visibleEdges.find((edge) => edgeKey(edge) === activeEdgeKey) ?? null,
    [activeEdgeKey, visibleEdges],
  );
  const gridDocument = useMemo(
    () => data ? fepGridDocument(data, location.title || "ligand_network.graphml") : null,
    [data, location.title],
  );

  useEffect(() => {
    if (!data) return;
    setEdgeMetricMode(hasEnergyEdges ? "energy" : "score");
  }, [data, hasEnergyEdges]);

  useEffect(() => {
    if (!activeEdgeKey || visibleEdges.some((edge) => edgeKey(edge) === activeEdgeKey)) return;
    setHoveredEdgeKey(null);
    setSelectedEdgeKey(null);
  }, [activeEdgeKey, visibleEdges]);

  const openContextMenu = useCallback((node: FepNetworkNode, event: ReactMouseEvent) => {
    event.preventDefault();
    void showNativeContextMenu([
      {
        kind: "item",
        id: "open-ketcher",
        text: "Open in Ketcher",
        action: () => actions.openKetcherWithStructures([], [{ title: `${node.label}.mol`, text: molblockForKetcher(node) }]),
      },
      {
        kind: "item",
        id: "open-molstar",
        text: "Open in Molstar",
        action: () => void actions.openStructureRecords([{ path: `${node.label}.mol`, inputExtension: "mol", text: molblockForKetcher(node) }]),
      },
      { kind: "separator" },
      {
        kind: "item",
        id: "delete-node",
        text: "Delete from network",
        action: () => setHiddenNodes((current) => new Set([...current, node.id])),
      },
    ], { x: event.clientX, y: event.clientY });
  }, [actions]);

  const startCardDrag = useCallback((node: FepNetworkNode, event: ReactPointerEvent) => {
    if (viewMode !== "graph" || event.button !== 0) return;
    const current = positions[node.id] ?? { x: node.x, y: node.y };
    dragRef.current = {
      type: "card",
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }, [positions, viewMode]);

  const startPan = useCallback((event: ReactPointerEvent) => {
    if (viewMode !== "graph" || event.button !== 0) return;
    dragRef.current = {
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
  }, [viewMode, viewport.x, viewport.y]);

  const zoom = useCallback((event: ReactWheelEvent) => {
    if (viewMode !== "graph") return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setViewport((current) => ({
      ...current,
      scale: Math.max(0.55, Math.min(1.8, current.scale + direction * 0.08)),
    }));
  }, [viewMode]);

  if (!data) {
    return (
      <section className="fep-network-workspace" aria-label="FEP network preview">
        <div className="fep-network-empty">{dataError || "Loading FEP network preview..."}</div>
      </section>
    );
  }

  return (
    <section className="fep-network-workspace" aria-label="FEP network preview">
      <header className="fep-network-toolbar">
        <div className="fep-network-title">
          <span>FEP Network</span>
          <strong>{location.title || "ligand_network.graphml"}</strong>
        </div>
        <SegmentedControl
          label="View"
          value={viewMode}
          options={[["graph", "Graph"], ["grid", "Grid"]]}
          onChange={(value) => setViewMode(value as ViewMode)}
        />
        <SegmentedControl
          label="Highlight"
          value={highlightMode}
          options={[["common", "Common"], ["different", "Different"], ["off", "Off"]]}
          onChange={(value) => setHighlightMode(value as HighlightMode)}
        />
        <SegmentedControl
          label="Edges"
          value={edgeMetricMode}
          options={[["score", "Score"], ["energy", "Energy"]]}
          disabledValues={hasEnergyEdges ? [] : ["energy"]}
          onChange={(value) => setEdgeMetricMode(value as EdgeMetricMode)}
        />
        <button
          type="button"
          className="fep-network-button"
          onClick={() => {
            setHiddenNodes(new Set());
            setPositions(Object.fromEntries(data.nodes.map((node) => [node.id, { x: node.x, y: node.y }])));
            setViewport({ x: 0, y: 0, scale: 1 });
          }}
        >
          Reset
        </button>
      </header>
      <div
        className="fep-network-stage"
        data-view={viewMode}
        onPointerDown={startPan}
        onWheel={zoom}
      >
        {viewMode === "graph" ? (
          <div
            ref={canvasRef}
            className="fep-network-canvas"
            style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
          >
            <svg className="fep-network-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {visibleEdges.map((edge) => {
                const source = data.nodes.find((node) => node.id === edge.source);
                const target = data.nodes.find((node) => node.id === edge.target);
                if (!source || !target) return null;
                const a = edgeAnchor(positions[source.id] ?? source, positions[target.id] ?? target);
                const b = edgeAnchor(positions[target.id] ?? target, positions[source.id] ?? source);
                const visual = edgeVisual(edge, edgeMetricMode, edgeStats);
                const key = edgeKey(edge);
                const isActive = key === activeEdgeKey;
                return (
                  <g key={key}>
                    <line
                      className="fep-network-edge"
                      data-active={isActive ? "true" : undefined}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={visual.color}
                      strokeWidth={isActive ? visual.width + 1.25 : visual.width}
                      strokeDasharray={visual.dash}
                      vectorEffect="non-scaling-stroke"
                      style={{ opacity: activeEdgeKey && !isActive ? Math.max(0.34, visual.opacity * 0.48) : visual.opacity } as CSSProperties}
                    />
                    <line
                      className="fep-network-edge-hit"
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="currentColor"
                      strokeWidth={12}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="stroke"
                      onPointerEnter={() => setHoveredEdgeKey(key)}
                      onPointerLeave={() => setHoveredEdgeKey((current) => (current === key ? null : current))}
                      onMouseOver={() => setHoveredEdgeKey(key)}
                      onMouseMove={() => setHoveredEdgeKey(key)}
                      onMouseOut={() => setHoveredEdgeKey((current) => (current === key ? null : current))}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEdgeKey((current) => (current === key ? null : key));
                      }}
                      aria-label={visual.title}
                    />
                  </g>
                );
              })}
            </svg>
            {visibleEdges.map((edge) => {
              const source = data.nodes.find((node) => node.id === edge.source);
              const target = data.nodes.find((node) => node.id === edge.target);
              if (!source || !target) return null;
              const sourcePosition = positions[source.id] ?? source;
              const targetPosition = positions[target.id] ?? target;
              const a = edgeAnchor(sourcePosition, targetPosition);
              const b = edgeAnchor(targetPosition, sourcePosition);
              const visual = edgeVisual(edge, edgeMetricMode, edgeStats);
              const key = edgeKey(edge);
              const isActive = key === activeEdgeKey;
              const label = edgeLabelPlacement(a, b, visibleNodes, positions, visual.label, canvasSize);
              return (
                <div
                  key={`${key}:label`}
                  className="fep-network-edge-label"
                  data-active={isActive ? "true" : undefined}
                  style={{
                    left: `${label.x}%`,
                    top: `${label.y}%`,
                    transform: "translate(-50%, -50%)",
                  } as CSSProperties}
                  aria-hidden="true"
                >
                  <span style={{ transform: `rotate(${label.angle}deg)` } as CSSProperties}>{visual.label}</span>
                </div>
              );
            })}
            {visibleNodes.map((node) => (
              <LigandCard
                key={node.id}
                node={node}
                rdkit={rdkit}
                rdkitError={rdkitError}
                highlightMode={highlightMode}
                onPointerDown={(event) => startCardDrag(node, event)}
                onContextMenu={(event) => openContextMenu(node, event)}
                style={{
                  left: `${positions[node.id]?.x ?? node.x}%`,
                  top: `${positions[node.id]?.y ?? node.y}%`,
                }}
              />
            ))}
            <EdgeLegend
              mode={edgeMetricMode}
              stats={edgeStats}
              edge={activeEdge}
              source={activeEdge ? nodeById.get(activeEdge.source) ?? null : null}
              target={activeEdge ? nodeById.get(activeEdge.target) ?? null : null}
              visual={activeEdge ? edgeVisual(activeEdge, edgeMetricMode, edgeStats) : null}
            />
          </div>
        ) : (
          gridDocument ? <ViewerFrame document={gridDocument} className="fep-network-grid-frame viewer-iframe" /> : null
        )}
      </div>
    </section>
  );
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
  disabledValues = [],
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  disabledValues?: string[];
}) {
  const disabled = new Set(disabledValues);
  return (
    <div className="fep-network-segment" role="group" aria-label={label}>
      <span>{label}</span>
      {options.map(([optionValue, optionLabel]) => (
        <button
          key={optionValue}
          type="button"
          aria-pressed={value === optionValue}
          disabled={disabled.has(optionValue)}
          title={disabled.has(optionValue) ? `${optionLabel} data is not available` : undefined}
          onClick={() => onChange(optionValue)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

function EdgeLegend({
  mode,
  stats,
  edge,
  source,
  target,
  visual,
}: {
  mode: EdgeMetricMode;
  stats: EdgeStats;
  edge: FepNetworkEdge | null;
  source: FepNetworkNode | null;
  target: FepNetworkNode | null;
  visual: ReturnType<typeof edgeVisual> | null;
}) {
  if (edge && visual) {
    return (
      <div className="fep-network-edge-legend" data-active-edge="true">
        <span>Edge</span>
        <strong>{source?.shortLabel ?? edge.source} - {target?.shortLabel ?? edge.target}</strong>
        <em>{visual.label}</em>
      </div>
    );
  }
  const range = mode === "energy" ? stats.energy : stats.score;
  if (mode === "energy" && !range) {
    return (
      <div className="fep-network-edge-legend">
        <span>Edges</span>
        <strong>No energy data</strong>
      </div>
    );
  }
  return (
    <div className="fep-network-edge-legend">
      <span>{mode === "energy" ? "ΔΔG" : "Score"}</span>
      <div className={`fep-network-edge-ramp fep-network-edge-ramp-${mode}`} />
      <strong>{range ? `${formatMetric(range.min, mode)} - ${formatMetric(range.max, mode)}` : "n/a"}</strong>
    </div>
  );
}

function edgeKey(edge: FepNetworkEdge) {
  return `${edge.source}:${edge.target}`;
}

type MetricRange = {
  min: number;
  max: number;
};

type EdgeStats = {
  score: MetricRange | null;
  energy: MetricRange | null;
  uncertainty: MetricRange | null;
};

function edgeMetricStats(edges: FepNetworkEdge[]): EdgeStats {
  return {
    score: numberRange(edges.map((edge) => edge.score)),
    energy: numberRange(edges.map((edge) => edge.energy)),
    uncertainty: numberRange(edges.map((edge) => edge.uncertainty)),
  };
}

function numberRange(values: Array<number | null | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return null;
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function edgeVisual(edge: FepNetworkEdge, mode: EdgeMetricMode, stats: EdgeStats) {
  if (mode === "energy" && edge.energy !== null && stats.energy) {
    const normalized = signedMetric(edge.energy, stats.energy);
    const uncertainty = edge.uncertainty !== null && stats.uncertainty
      ? normalizedMetric(edge.uncertainty, stats.uncertainty)
      : 0;
    return {
      color: energyColor(normalized),
      dash: uncertainty > 0.58 ? "1.8 1.2" : undefined,
      label: `ΔΔG: ${edge.energy.toFixed(2)}${edge.uncertainty !== null ? ` ± ${edge.uncertainty.toFixed(2)}` : ""}`,
      opacity: 0.72 + (1 - uncertainty) * 0.2,
      title: `Energy ${edge.energy.toFixed(3)}${edge.uncertainty !== null ? ` ± ${edge.uncertainty.toFixed(3)}` : ""}; score ${edge.score.toFixed(3)}; mapped atoms ${edge.mappedAtoms}`,
      width: 1.8 + Math.max(0.15, 1 - uncertainty) * 0.4,
    };
  }
  const normalized = stats.score ? normalizedMetric(edge.score, stats.score) : Math.max(0, Math.min(1, edge.score));
  return {
    color: scoreColor(normalized),
    dash: undefined,
    label: `score: ${edge.score.toFixed(3)}`,
    opacity: 0.7 + normalized * 0.22,
    title: `Mapping score ${edge.score.toFixed(3)}; mapped atoms ${edge.mappedAtoms}`,
    width: 1.8 + normalized * 0.4,
  };
}

function normalizedMetric(value: number, range: MetricRange) {
  if (range.max === range.min) return 1;
  return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
}

function signedMetric(value: number, range: MetricRange) {
  const maxAbs = Math.max(Math.abs(range.min), Math.abs(range.max), 0.001);
  return Math.max(-1, Math.min(1, value / maxAbs));
}

function scoreColor(normalized: number) {
  const accentMix = Math.round(66 + normalized * 20);
  return `color-mix(in srgb, var(--accent) ${accentMix}%, var(--text-secondary))`;
}

function energyColor(normalized: number) {
  const accentMix = Math.round(68 + Math.abs(normalized) * 18);
  return `color-mix(in srgb, var(--accent) ${accentMix}%, var(--text-secondary))`;
}

function formatMetric(value: number, mode: EdgeMetricMode) {
  return mode === "energy" ? value.toFixed(2) : value.toFixed(3);
}

function LigandCard({
  node,
  rdkit,
  rdkitError,
  highlightMode,
  onPointerDown,
  onContextMenu,
  style,
}: {
  node: FepNetworkNode;
  rdkit: RDKitModule | null;
  rdkitError: string | null;
  highlightMode: HighlightMode;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  style?: CSSProperties;
}) {
  const svg = useMemo(
    () => drawRDKitMol(rdkit, node, highlightMode),
    [highlightMode, node, rdkit],
  );
  return (
    <article
      className="fep-network-card buret-card"
      data-index={Number(node.id.replace("mol", ""))}
      data-renderer="rdkit"
      data-highlight={highlightMode}
      style={style}
      title={`${node.label}\n${node.atoms} atoms, ${node.bonds} bonds`}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      <div
        className="fep-network-card-picture buret-molecule-picture"
        dangerouslySetInnerHTML={{
          __html: svg || `<div class="fep-network-card-error">${rdkitError || "RDKit unavailable"}</div>`,
        }}
      />
      <footer>
        <span>{node.shortLabel}</span>
        <strong>{Number(node.id.replace("mol", "")) + 1}</strong>
      </footer>
    </article>
  );
}

function molblockForKetcher(node: FepNetworkNode) {
  return normalizeMolblockForKetcher(molblockWithFallbackCoordinates(node.molblock));
}

function molblockWithFallbackCoordinates(molblock: string) {
  const lines = molblock.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const countsIndex = lines.findIndex(isMolfileCountsLine);
  if (countsIndex < 0) return molblock;
  const counts = lines[countsIndex].trim().split(/\s+/u);
  const atomCount = Number.parseInt(counts[0] ?? "", 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) return molblock;
  const atomStart = countsIndex + 1;
  const radius = Math.max(2.2, Math.min(4.6, atomCount * 0.12));
  for (let index = 0; index < atomCount; index += 1) {
    const lineIndex = atomStart + index;
    const line = lines[lineIndex];
    if (!line) continue;
    const angle = (index / atomCount) * Math.PI * 2;
    const suffix = line.length > 30 ? line.slice(30) : " C   0  0  0  0  0  0  0  0  0  0  0  0";
    lines[lineIndex] = `${molCoord(Math.cos(angle) * radius)}${molCoord(Math.sin(angle) * radius)}    0.0000${suffix}`;
  }
  return lines.join("\n");
}

function normalizeMolblockForKetcher(molblock: string) {
  const lines = molblock.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const countsIndex = lines.findIndex(isMolfileCountsLine);
  if (countsIndex < 0) return molblock;
  const counts = lines[countsIndex].trim().split(/\s+/u);
  const atomCount = Number.parseInt(counts[0] ?? "", 10);
  const bondCount = Number.parseInt(counts[1] ?? "", 10);
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount)) return molblock;
  const bondStart = countsIndex + 1 + atomCount;
  for (let index = 0; index < bondCount; index += 1) {
    const lineIndex = bondStart + index;
    const line = lines[lineIndex];
    if (!line) continue;
    const parts = line.trim().split(/\s+/u);
    if (parts.length < 3 || parts[2] !== "4") continue;
    parts[2] = "1";
    lines[lineIndex] = parts.map((part) => part.padStart(3, " ")).join("");
  }
  return lines.join("\n");
}

function isMolfileCountsLine(line: string) {
  return /^\s*\d+\s+\d+(?:\s+\d+){4,}\s+V(?:2000|3000)\s*$/u.test(line);
}

function molCoord(value: number) {
  return value.toFixed(4).padStart(10, " ");
}

function edgeAnchor(source: { x: number; y: number }, target: { x: number; y: number }) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  return {
    x: source.x + (dx / length) * (cardSize.width / 2),
    y: source.y + (dy / length) * (cardSize.height / 2),
  };
}

function edgeAngle(source: { x: number; y: number }, target: { x: number; y: number }, canvasSize: CanvasSize) {
  return Math.atan2(
    (target.y - source.y) * Math.max(1, canvasSize.height),
    (target.x - source.x) * Math.max(1, canvasSize.width),
  ) * 180 / Math.PI;
}

function readableEdgeAngle(source: { x: number; y: number }, target: { x: number; y: number }, canvasSize: CanvasSize) {
  const angle = edgeAngle(source, target, canvasSize);
  if (angle > 90) return angle - 180;
  if (angle < -90) return angle + 180;
  return angle;
}

function edgeLabelPlacement(
  a: { x: number; y: number },
  b: { x: number; y: number },
  nodes: FepNetworkNode[],
  positions: Record<string, { x: number; y: number }>,
  text: string,
  canvasSize: CanvasSize,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const labelBox = edgeLabelBox(text, a, b, canvasSize);
  const blocked = nodes.map((node) => {
    const position = positions[node.id] ?? node;
    return {
      left: position.x - edgeLabelAvoidanceCardSize.width / 2 - labelBox.halfWidth - 1.2,
      right: position.x + edgeLabelAvoidanceCardSize.width / 2 + labelBox.halfWidth + 1.2,
      top: position.y - edgeLabelAvoidanceCardSize.height / 2 - labelBox.halfHeight - 1.2,
      bottom: position.y + edgeLabelAvoidanceCardSize.height / 2 + labelBox.halfHeight + 1.2,
    };
  });
  const candidates = [0.5, 0.43, 0.57, 0.36, 0.64, 0.29, 0.71];
  for (const t of candidates) {
    const x = clamp(a.x + dx * t, labelBox.halfWidth + 1, 99 - labelBox.halfWidth);
    const y = clamp(a.y + dy * t, labelBox.halfHeight + 1, 99 - labelBox.halfHeight);
    if (!blocked.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) {
      return { x, y, angle: readableEdgeAngle(a, b, canvasSize) };
    }
  }
  return {
    x: clamp((a.x + b.x) / 2, labelBox.halfWidth + 1, 99 - labelBox.halfWidth),
    y: clamp((a.y + b.y) / 2, labelBox.halfHeight + 1, 99 - labelBox.halfHeight),
    angle: readableEdgeAngle(a, b, canvasSize),
  };
}

function edgeLabelBox(text: string, source: { x: number; y: number }, target: { x: number; y: number }, canvasSize: CanvasSize) {
  const width = Math.max(5.2, Math.min(14.8, text.length * 0.46 + 1.8));
  const height = 2.5;
  const radians = Math.abs(readableEdgeAngle(source, target, canvasSize)) * Math.PI / 180;
  return {
    halfWidth: (Math.cos(radians) * width + Math.sin(radians) * height) / 2,
    halfHeight: (Math.sin(radians) * width + Math.cos(radians) * height) / 2,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function loadFepNetworkData(graphmlText?: string) {
  if (graphmlText) return parseFepGraphml(graphmlText);
  const response = await fetch(sampleGraphmlUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load sample GraphML: ${response.status} ${response.statusText}`);
  return parseFepGraphml(await response.text());
}

async function loadRDKit() {
  if (!window.initRDKitModule) await loadScript(rdkitScriptUrl);
  if (!window.initRDKitModule) throw new Error("RDKit loader is unavailable");
  return window.initRDKitModule({ locateFile: () => rdkitWasmUrl });
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

type FepGridRecord = {
  index: number;
  name: string;
  molblock: string;
  props: Record<string, string>;
};

function fepGridDocument(data: FepNetworkData, title: string): ViewerDocument {
  const records = data.nodes.map((node, index) => fepGridRecord(node, index));
  const runtimePath = fepGridHtml(title, records);
  return {
    id: "fep-network-grid",
    path: title,
    title,
    extension: "sdf",
    renderer: "grid2d",
    runtimePath,
    byteCount: new TextEncoder().encode(runtimePath).byteLength,
    virtual: true,
  };
}

function fepGridRecord(node: FepNetworkNode, index: number): FepGridRecord {
  const props: Record<string, string> = {
    Ligand: node.shortLabel,
    Atoms: String(node.atoms),
    "Heavy atoms": String(node.heavyAtoms),
    Bonds: String(node.bonds),
  };
  if (node.dockingScore !== null) props["Docking score"] = node.dockingScore.toFixed(3);
  return {
    index,
    name: node.label,
    molblock: molblockForKetcher(node),
    props,
  };
}

function fepGridHtml(title: string, records: FepGridRecord[]) {
  const config = {
    mode: "grid2d",
    format: "sdf",
    renderer: "grid2d",
    documentId: "fep-network-grid",
    sourcePath: title,
    label: title,
    byteCount: records.reduce((total, record) => total + record.molblock.length, 0),
    host: "browser-dev",
    quickLookBuild: "burrete-browser-dev-grid2d",
    debug: false,
    appViewer: true,
    tauriViewer: false,
    theme: "auto",
    canvasBackground: "auto",
    overlayOpacity: 0.9,
    transparentBackground: false,
    recordsTotal: records.length,
    recordsIncluded: records.length,
    recordsTruncated: false,
    pageSize: 720,
    rdkitWasmPath: "/__burette/rdkit-wasm",
    capabilities: {
      selection: true,
      export: true,
      substructureSearch: true,
      rendererSwitch: false,
    },
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${gridAssetsBaseUrl}" />
  <title>Burrete FEP Grid - ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="grid.css?v=${gridAssetVersion}" />
  <script>
    window.__mqlPost = function (type, message, payload) {
      try {
        const body = { type, message: String(message || ''), ...(payload || {}) };
        if (window.BurreteConfig && window.BurreteConfig.documentId) body.documentId = String(window.BurreteConfig.documentId);
        window.parent && window.parent.postMessage({ source: 'burrete-grid', body }, '*');
      } catch (_) {}
    };
    window.BurreteInlineMode = true;
    window.BurreteGridMode = true;
    window.BurreteDebug = false;
  </script>
</head>
<body class="burette-opaque-background">
  <div id="app"></div>
  <div id="status">Loading molecule grid...</div>
  <script>window.BurreteConfig = ${JSON.stringify(config)};</script>
  <script>window.BurreteGridRecords = ${JSON.stringify(records)};</script>
  <script src="rdkit/RDKit_minimal.js?v=${gridAssetVersion}"></script>
  <script src="grid-ui.js?v=${gridAssetVersion}"></script>
  <script src="grid-viewer.js?v=${gridAssetVersion}"></script>
</body>
</html>`;
}

function cssEscape(value: string) {
  return value.replace(/["\\]/gu, "\\$&");
}

function drawRDKitMol(rdkit: RDKitModule | null, node: FepNetworkNode, highlightMode: HighlightMode) {
  if (!rdkit) return "";
  let mol: RDKitMol | null = null;
  try {
    mol = rdkit.get_mol(node.molblock);
    if (!mol || (typeof mol.is_valid === "function" && !mol.is_valid())) throw new Error("invalid molecule");
    try { mol.set_new_coords?.(); } catch (_) {}
    const match = highlightMode === "off" ? null : substructureMatch(rdkit, mol, node, highlightMode);
    const raw = match && typeof mol.get_svg_with_highlights === "function"
      ? mol.get_svg_with_highlights(JSON.stringify({
          atoms: match.atoms,
          bonds: match.bonds,
          width: 300,
          height: 240,
          highlightAtomColors: Object.fromEntries(match.atoms.map((atom: number) => [atom, highlightMode === "common" ? [0.68, 0.42, 0.86] : [0.96, 0.58, 0.18]])),
        }))
      : mol.get_svg(300, 240);
    return sanitizeSvg(raw);
  } catch (_) {
    return "";
  } finally {
    try { mol?.delete?.(); } catch (_) {}
  }
}

function substructureMatch(rdkit: RDKitModule, mol: RDKitMol, node: FepNetworkNode, highlightMode: HighlightMode) {
  if (highlightMode === "common" && rdkit.get_qmol && mol.get_substruct_match) {
    let qmol: RDKitMol | null = null;
    try {
      qmol = rdkit.get_qmol(commonCoreSmarts);
      const raw = mol.get_substruct_match(qmol);
      const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
      const atoms = Array.isArray(parsed?.atoms) ? parsed.atoms.filter(Number.isInteger) : [];
      const bonds = Array.isArray(parsed?.bonds) ? parsed.bonds.filter(Number.isInteger) : [];
      if (atoms.length > 0) return { atoms, bonds };
    } catch (_) {
      return null;
    } finally {
      try { qmol?.delete?.(); } catch (_) {}
    }
  }
  if (highlightMode === "different") {
    const count = Math.max(0, node.heavyAtoms || node.atoms);
    const highlightCount = Math.min(8, count);
    const start = Math.max(0, count - highlightCount);
    return { atoms: Array.from({ length: highlightCount }, (_, index) => start + index), bonds: [] };
  }
  return null;
}

function sanitizeSvg(svg: string) {
  return String(svg || "")
    .replace(/<script[\s\S]*?<\/script>/giu, "")
    .replace(/\s(?:on\w+)=(?:"[^"]*"|'[^']*')/giu, "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
