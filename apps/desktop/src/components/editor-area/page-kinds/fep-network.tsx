import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join, resourceDir } from "@tauri-apps/api/path";
import type { ViewerDocument } from "../../../types";
import { parseFepNetworkText, type FepNetworkData, type FepNetworkEdge, type FepNetworkNode } from "../../../lib/fep-graphml";
import { isTauriRuntime } from "../../../lib/tauri";
import { showNativeContextMenu } from "../../native-context-menu";
import type { ShellActions } from "../../types";
import { ViewerFrame } from "../viewer-frame";
import { definePageKind } from "./types";

type RDKitModule = {
  get_mol: (input: string) => RDKitMol;
  get_qmol?: (input: string) => RDKitMol;
};

type RDKitModuleOptions = {
  locateFile?: (file: string) => string;
  wasmBinary?: Uint8Array;
};

type RDKitMol = {
  delete?: () => void;
  get_aromatic_form?: () => string;
  get_kekule_form?: () => string;
  get_new_coords?: (useCoordGen?: boolean) => string;
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
type NodeHighlightSet = { common: number[]; different: number[] };
type HighlightMatch = { atoms: number[]; bonds: number[] };

const rdkitScriptUrl = new URL("../../../../../../PreviewExtension/Web/rdkit/RDKit_minimal.js", import.meta.url).href;
const rdkitWasmUrl = new URL("../../../../../../PreviewExtension/Web/rdkit/RDKit_minimal.wasm", import.meta.url).href;
const sampleGraphmlUrl = new URL("../../../../../../samples/fep/ligand_network.graphml", import.meta.url).href;
const gridAssetsBaseUrl = `${new URL("../../../../../../PreviewExtension/Web/", import.meta.url).href.replace(/\/?$/u, "/")}`;
const gridAssetVersion = "grid-ui-v100";
const cardSize = { width: 16.4, height: 25.8 };
const edgeLabelAvoidanceCardSize = { width: 17.4, height: 29.2 };

declare global {
  interface Window {
    initRDKitModule?: (options?: RDKitModuleOptions) => Promise<RDKitModule>;
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
  }, [location]);

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
  const highlightSets = useMemo(() => data ? fepHighlightSets(data) : new Map<string, NodeHighlightSet>(), [data]);
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
    const ketcherFragment = ketcherFragmentForNode(rdkit, node);
    const editorMolblock = molblockForKetcher(rdkit, node);
    void showNativeContextMenu([
      {
        kind: "item",
        id: "open-ketcher",
        text: "Open in Ketcher",
        action: () => actions.openKetcherWithStructures([], [ketcherFragment]),
      },
      {
        kind: "item",
        id: "open-molstar",
        text: "Open in Molstar",
        action: () => void actions.openStructureRecords([{ path: `${node.label}.mol`, inputExtension: "mol", text: editorMolblock }]),
      },
      { kind: "separator" },
      {
        kind: "item",
        id: "delete-node",
        text: "Delete from network",
        action: () => setHiddenNodes((current) => new Set([...current, node.id])),
      },
    ], { x: event.clientX, y: event.clientY });
  }, [actions, rdkit]);

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
            {visibleNodes.map((node, index) => (
              <LigandCard
                key={node.id}
                node={node}
                displayIndex={index + 1}
                rdkit={rdkit}
                rdkitError={rdkitError}
                highlightMode={highlightMode}
                highlightSet={highlightSets.get(node.id) ?? null}
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
  displayIndex,
  rdkit,
  rdkitError,
  highlightMode,
  highlightSet,
  onPointerDown,
  onContextMenu,
  style,
}: {
  node: FepNetworkNode;
  displayIndex: number;
  rdkit: RDKitModule | null;
  rdkitError: string | null;
  highlightMode: HighlightMode;
  highlightSet: NodeHighlightSet | null;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  style?: CSSProperties;
}) {
  const svg = useMemo(
    () => drawRDKitMol(rdkit, node, highlightMode, highlightSet),
    [highlightMode, highlightSet, node, rdkit],
  );
  const moleculeMarkup = node.molblock.trim()
    ? svg || `<div class="fep-network-card-error">${rdkitError || "RDKit unavailable"}</div>`
    : `<div class="fep-network-card-error">Network node</div>`;
  return (
    <article
      className="fep-network-card buret-card"
      data-index={displayIndex - 1}
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
          __html: moleculeMarkup,
        }}
      />
      <footer>
        <span>{node.shortLabel}</span>
        <strong>{displayIndex}</strong>
      </footer>
    </article>
  );
}

function molblockForKetcher(rdkit: RDKitModule | null, node: FepNetworkNode) {
  return normalizeMolblockForKetcher(rdkitMolblockForKetcher(rdkit, node.molblock) ?? node.molblock);
}

function ketcherFragmentForNode(rdkit: RDKitModule | null, node: FepNetworkNode) {
  return { title: `${node.label}.sdf`, text: molblockToSdf(molblockForKetcher(rdkit, node), node.label) };
}

function molblockToSdf(molblock: string, title: string) {
  const lines = molblock.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd().split("\n");
  if (lines.length > 0) lines[0] = title.slice(0, 80);
  return `${lines.join("\n")}\n$$$$\n`;
}

function rdkitMolblockForKetcher(rdkit: RDKitModule | null, molblock: string) {
  if (!rdkit) return null;
  let mol: RDKitMol | null = null;
  let prepared: RDKitMol | null = null;
  try {
    mol = rdkit.get_mol(molblock);
    if (!mol || (typeof mol.is_valid === "function" && !mol.is_valid())) return null;
    const structuralMolblock = mol.get_kekule_form?.() || mol.get_aromatic_form?.() || molblock;
    prepared = rdkit.get_mol(structuralMolblock);
    if (!prepared || (typeof prepared.is_valid === "function" && !prepared.is_valid())) return structuralMolblock;
    return prepared.get_new_coords?.(true) || prepared.get_new_coords?.() || structuralMolblock;
  } catch (_) {
    return null;
  } finally {
    try { prepared?.delete?.(); } catch (_) {}
    try { mol?.delete?.(); } catch (_) {}
  }
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
  const width = Math.max(5.8, Math.min(17.2, text.length * 0.54 + 2.1));
  const height = 3.1;
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
  if (graphmlText) return parseFepNetworkText(graphmlText);
  const response = await fetch(sampleGraphmlUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load sample GraphML: ${response.status} ${response.statusText}`);
  return parseFepNetworkText(await response.text());
}

async function loadRDKit() {
  if (!window.initRDKitModule) await loadScript(rdkitScriptUrl);
  if (!window.initRDKitModule) throw new Error("RDKit loader is unavailable");
  const wasm = await loadRDKitWasmBinary();
  return window.initRDKitModule({ locateFile: () => wasm.path, wasmBinary: wasm.bytes });
}

async function loadRDKitWasmBinary() {
  const candidates = await rdkitWasmCandidates();
  const failures: string[] = [];
  for (const path of candidates) {
    try {
      const response = await fetch(path, { cache: "force-cache" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
      return { path, bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not load RDKit wasm: ${failures.join("; ") || "no candidate paths"}`);
}

async function rdkitWasmCandidates() {
  const paths: string[] = [];
  const push = (value: string | null | undefined) => {
    const path = String(value || "").trim();
    if (path && !paths.includes(path)) paths.push(path);
  };
  if (isTauriRuntime()) {
    try {
      push(convertFileSrc(await join(await resourceDir(), "ViewerWeb", "rdkit", "RDKit_minimal.wasm")));
    } catch (_) {}
  }
  push(rdkitWasmUrl);
  try {
    push(new URL("rdkit/RDKit_minimal.wasm", gridAssetsBaseUrl).href);
  } catch (_) {}
  push("/__burette/rdkit-wasm");
  return paths;
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
    molblock: molblockForKetcher(null, node),
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

function fepHighlightSets(data: FepNetworkData) {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const incidentCommonAtoms = new Map<string, Set<number>[]>();
  for (const edge of data.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || edge.mapping.length === 0) continue;
    const sourceAtoms = new Set<number>();
    const targetAtoms = new Set<number>();
    for (const [sourceAtom, targetAtom] of edge.mapping) {
      const sourceMolAtom = source.sourceAtomToMolAtom[sourceAtom];
      const targetMolAtom = target.sourceAtomToMolAtom[targetAtom];
      if (!Number.isInteger(sourceMolAtom) || !Number.isInteger(targetMolAtom)) continue;
      if (source.sourceAtomAtomicNumbers[sourceAtom] !== target.sourceAtomAtomicNumbers[targetAtom]) continue;
      sourceAtoms.add(sourceMolAtom);
      targetAtoms.add(targetMolAtom);
    }
    if (sourceAtoms.size > 0) pushIncidentAtoms(incidentCommonAtoms, source.id, sourceAtoms);
    if (targetAtoms.size > 0) pushIncidentAtoms(incidentCommonAtoms, target.id, targetAtoms);
  }

  const result = new Map<string, NodeHighlightSet>();
  for (const node of data.nodes) {
    const common = intersectAtomSets(incidentCommonAtoms.get(node.id) ?? []);
    const commonSet = new Set(common);
    const different = Array.from({ length: node.heavyAtoms }, (_, index) => index).filter((atom) => !commonSet.has(atom));
    result.set(node.id, { common, different });
  }
  return result;
}

function pushIncidentAtoms(target: Map<string, Set<number>[]>, id: string, atoms: Set<number>) {
  const current = target.get(id);
  if (current) {
    current.push(atoms);
    return;
  }
  target.set(id, [atoms]);
}

function intersectAtomSets(sets: Set<number>[]) {
  if (sets.length === 0) return [];
  const first = sets[0];
  if (!first) return [];
  const rest = sets.slice(1);
  return [...first].filter((atom) => rest.every((set) => set.has(atom))).sort((left, right) => left - right);
}

function drawRDKitMol(rdkit: RDKitModule | null, node: FepNetworkNode, highlightMode: HighlightMode, highlightSet: NodeHighlightSet | null) {
  if (!rdkit) return "";
  let mol: RDKitMol | null = null;
  try {
    mol = rdkit.get_mol(node.molblock);
    if (!mol || (typeof mol.is_valid === "function" && !mol.is_valid())) throw new Error("invalid molecule");
    try { mol.set_new_coords?.(); } catch (_) {}
    const match = highlightMode === "off" ? null : highlightMatch(node, highlightMode, highlightSet);
    const raw = match && typeof mol.get_svg_with_highlights === "function"
      ? mol.get_svg_with_highlights(JSON.stringify({
          atoms: match.atoms,
          bonds: match.bonds,
          width: 300,
          height: 240,
          highlightAtomColors: Object.fromEntries(match.atoms.map((atom: number) => [atom, highlightMode === "common" ? [0.68, 0.42, 0.86] : [0.96, 0.58, 0.18]])),
          highlightAtomRadii: Object.fromEntries(match.atoms.map((atom: number) => [atom, 0.28])),
          highlightBondColors: Object.fromEntries(match.bonds.map((bond: number) => [bond, highlightMode === "common" ? [0.68, 0.42, 0.86] : [0.96, 0.58, 0.18]])),
          highlightBondWidthMultiplier: 24,
        }))
      : mol.get_svg(300, 240);
    return sanitizeSvg(raw);
  } catch (_) {
    return "";
  } finally {
    try { mol?.delete?.(); } catch (_) {}
  }
}

function highlightMatch(node: FepNetworkNode, highlightMode: HighlightMode, highlightSet: NodeHighlightSet | null): HighlightMatch | null {
  const atoms = highlightMode === "common" ? highlightSet?.common : highlightSet?.different;
  if (!atoms || atoms.length === 0) return null;
  return { atoms, bonds: molblockBondsForAtoms(node.molblock, new Set(atoms)) };
}

function molblockBondsForAtoms(molblock: string, atoms: Set<number>) {
  const lines = molblock.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const countsIndex = lines.findIndex(isMolfileCountsLine);
  if (countsIndex < 0) return [];
  const counts = lines[countsIndex].trim().split(/\s+/u);
  const atomCount = Number.parseInt(counts[0] ?? "", 10);
  const bondCount = Number.parseInt(counts[1] ?? "", 10);
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount)) return [];
  const bondStart = countsIndex + 1 + atomCount;
  const bonds: number[] = [];
  for (let index = 0; index < bondCount; index += 1) {
    const parts = lines[bondStart + index]?.trim().split(/\s+/u) ?? [];
    const left = Number.parseInt(parts[0] ?? "", 10) - 1;
    const right = Number.parseInt(parts[1] ?? "", 10) - 1;
    if (atoms.has(left) && atoms.has(right)) bonds.push(index);
  }
  return bonds;
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
