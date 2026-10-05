import { Spinner } from "@/components/ui/spinner";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { join, resourceDir } from "@tauri-apps/api/path";
import type { MainModule as RDKitModule, Mol as RDKitMol } from "@rdkit/rdkit";
import type { ViewerDocument, ViewerPreferences } from "../../../types";
import { openBrowserDevTextDocument } from "../../../lib/browser-dev-documents";
import { parseFepNetworkText, type FepNetworkData, type FepNetworkEdge, type FepNetworkNode } from "../../../lib/fep-graphml";
import { loadRDKitModule } from "../../../lib/rdkit-module";
import { isTauriRuntime } from "../../../lib/tauri";
import { showNativeContextMenu } from "../../native-context-menu";
import type { ShellActions } from "../../types";
import { ArrowRotateCcw } from "../../ui/app-icons";
import { Button } from "../../ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/tooltip";
import { ViewerFrame } from "../viewer-frame";
import { definePageKind } from "./types";

type FepNetworkLocation = {
  kind: "fep-network";
  title?: string;
  graphmlText?: string;
};

type ViewMode = "graph" | "grid" | "structure";
type HighlightMode = "off" | "common" | "different";
type EdgeMetricMode = "score" | "energy";
type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Viewport = { x: number; y: number; scale: number };
type NodeHighlightSet = { common: number[]; different: number[] };
type HighlightMatch = { atoms: number[]; bonds: number[] };
type GridAssets = { base: string; rdkitWasmPath: string };
type DragState =
  | { kind: "pan"; startX: number; startY: number; origin: Point; moved: boolean }
  | { kind: "card"; id: string; startX: number; startY: number; origin: Point; positions: Record<string, Point>; cardSize: Size; moved: boolean }
  | { kind: "resize"; id: string; startX: number; startY: number; origin: number; positions: Record<string, Point>; moved: boolean };

const sampleGraphmlUrl = new URL("../../../../../../samples/fep/ligand_network.graphml", import.meta.url).href;
const gridAssetsBaseUrl = `${new URL("../../../../../../PreviewExtension/Web/", import.meta.url).href.replace(/\/?$/u, "/")}`;
const gridAssetVersion = "grid-ui-v104";
// Cards share one size in world space, which the corner grip of any card
// changes. The layout's 0-100 coordinates are stretched into a world shaped
// like the tab, cards are pushed apart until none overlap, and the viewport
// then scales that world to fill the tab.
const baseCardSize: Size = { width: 232, height: 220 };
const minCardScale = 0.6;
const maxCardScale = 2;
const cardGap: Size = { width: 104, height: 72 };
const fitPadding = 36;
const fitMaxScale = 1.6;
const minScale = 0.2;
const maxScale = 2.5;
// Cards a dragged card runs into are pushed aside to keep this much room.
const dragGap: Size = { width: 16, height: 16 };
// RDKit draws with these fixed colours; the drawing then swaps each for a
// theme colour, so the same picture reads on light and dark cards.
const commonHighlightHex = "#8FC2FA";
const differentHighlightHex = "#FCB86B";
const themedDrawingColors: Array<[RegExp, string]> = [
  [/#FFFFFF/giu, "var(--fep-paper)"],
  [/#000000/giu, "currentColor"],
  [/#(?:0000FF|3333FF)/giu, "var(--fep-atom-nitrogen)"],
  [new RegExp(commonHighlightHex, "giu"), "var(--fep-highlight-common)"],
  [new RegExp(differentHighlightHex, "giu"), "var(--fep-highlight-different)"],
];

export type { FepNetworkLocation };

export const fepNetworkKind = definePageKind<"fep-network", FepNetworkLocation>({
  kind: "fep-network",
  title: (location) => location.title ? `FEP Network: ${location.title}` : "FEP Network Preview",
  description: "FEP ligand network preview",
  Component: ({ actions, location, state }) => <FepNetworkPreview actions={actions} location={location} preferences={state.preferences} />,
  keepAlive: true,
  fromPayload: (data) => (data.kind === "fep-network" ? {
    kind: "fep-network",
    title: typeof data.title === "string" ? data.title : undefined,
    graphmlText: typeof data.graphmlText === "string" ? data.graphmlText : undefined,
  } : null),
  serialize: () => null,
});

function FepNetworkPreview({ actions, location, preferences }: { actions: ShellActions; location: FepNetworkLocation; preferences: ViewerPreferences }) {
  const [data, setData] = useState<FepNetworkData | null>(null);
  const [dataError, setDataError] = useState(false);
  const [rdkit, setRdkit] = useState<RDKitModule | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("off");
  const [showHydrogens, setShowHydrogens] = useState(false);
  const [structureDocument, setStructureDocument] = useState<ViewerDocument | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [edgeMetricMode, setEdgeMetricMode] = useState<EdgeMetricMode>("score");
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(() => new Set());
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cardScale, setCardScale] = useState(1);
  const cardSize = useMemo<Size>(
    () => ({ width: baseCardSize.width * cardScale, height: baseCardSize.height * cardScale }),
    [cardScale],
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gridAssets = useGridAssets();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  // The view keeps fitting the network to the tab until the user pans, zooms
  // or moves a card; Reset hands control back to the fit.
  const autoFitRef = useRef(true);

  useEffect(() => {
    let canceled = false;
    loadFepNetworkData(location.graphmlText)
      .then((next) => {
        if (canceled) return;
        autoFitRef.current = true;
        setData(next);
        setDataError(false);
        setHiddenNodes(new Set());
        setSelectedNodeId(null);
        setPositions({});
        setEdgeMetricMode(next.edges.some((edge) => edge.energy !== null) ? "energy" : "score");
      })
      .catch(() => {
        if (!canceled) setDataError(true);
      });
    loadRDKitModule()
      .then((module) => { if (!canceled) setRdkit(module); })
      .catch(() => {});
    return () => { canceled = true; };
  }, [location]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setStageSize((current) => (
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      ));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [data]);

  const visibleNodes = useMemo(
    () => data?.nodes.filter((node) => !hiddenNodes.has(node.id)) ?? [],
    [data?.nodes, hiddenNodes],
  );
  const nodeById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const visibleEdges = useMemo(
    () => data?.edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target)) ?? [],
    [data?.edges, nodeById],
  );
  const nodeEnergies = useMemo(() => relativeNodeEnergies(visibleNodes, visibleEdges), [visibleEdges, visibleNodes]);
  const highlightSets = useMemo(() => data ? fepHighlightSets(data) : new Map<string, NodeHighlightSet>(), [data]);
  const hasEnergyEdges = useMemo(() => visibleEdges.some((edge) => edge.energy !== null), [visibleEdges]);
  const hasAtomMapping = useMemo(() => data?.edges.some((edge) => edge.mapping.length > 0) ?? false, [data]);
  const activeEdgeKey = selectedEdgeKey ?? hoveredEdgeKey;
  const activeEdge = useMemo(
    () => visibleEdges.find((edge) => edgeKey(edge) === activeEdgeKey) ?? null,
    [activeEdgeKey, visibleEdges],
  );
  // While an edge is active its two ligands show what that one transformation
  // changes, instead of the summary over all of their edges.
  const activeEdgeSets = useMemo(() => {
    const source = activeEdge ? nodeById.get(activeEdge.source) : undefined;
    const target = activeEdge ? nodeById.get(activeEdge.target) : undefined;
    if (!activeEdge || !source || !target || activeEdge.mapping.length === 0) return null;
    const common = edgeCommonAtoms(activeEdge, source, target);
    return new Map([[source.id, nodeHighlightSet(source, common.source)], [target.id, nodeHighlightSet(target, common.target)]]);
  }, [activeEdge, nodeById]);
  const pictureHighlight = (id: string) => {
    const edgeSet = activeEdgeSets?.get(id);
    return edgeSet
      ? { highlightMode: highlightMode === "off" ? "different" as const : highlightMode, highlightSet: edgeSet, showHydrogens }
      : { highlightMode, highlightSet: highlightSets.get(id) ?? null, showHydrogens };
  };
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedEdge = activeEdge && selectedEdgeKey ? activeEdge : null;
  const cardRects = useMemo(
    () => visibleNodes.map((node) => cardRect(positions[node.id] ?? { x: 0, y: 0 }, cardSize)),
    [cardSize, positions, visibleNodes],
  );
  const edgeLayouts = useMemo(() => visibleEdges.flatMap((edge) => {
    const source = positions[edge.source];
    const target = positions[edge.target];
    if (!source || !target) return [];
    const a = cardBoundaryPoint(source, target, cardSize);
    const b = cardBoundaryPoint(target, source, cardSize);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 12) return [];
    const visual = edgeVisual(edge, edgeMetricMode);
    return [{ edge, key: edgeKey(edge), a, b, visual, label: visual.label ? edgeLabelPlacement(a, b, `${visual.metric} ${visual.label}`, cardRects) : null }];
  }), [cardRects, cardSize, edgeMetricMode, positions, visibleEdges]);
  const gridDocument = useMemo(
    () => data && gridAssets && viewMode === "grid"
      ? fepGridDocument(data, location.title || "ligand_network.graphml", gridAssets, appTheme(stageRef.current))
      : null,
    [data, gridAssets, location.title, viewMode],
  );
  const hasConformers = useMemo(() => data?.nodes.some((node) => node.molblock3d) ?? false, [data]);
  // The 3D view hands every ligand's own conformer to the structure viewer as
  // one collection, which it browses and overlays with its pose controls.
  const structureNodes = useMemo(
    () => viewMode === "structure" ? visibleNodes.filter((node) => node.molblock3d) : [],
    [viewMode, visibleNodes],
  );
  const structureSdf = useMemo(() => structureNodes
    .map((node) => `${(showHydrogens ? node.molblock3d : node.heavyMolblock3d).trimEnd()}\n$$$$\n`)
    .join(""), [showHydrogens, structureNodes]);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const cardWidthRef = useRef(cardSize.width);
  cardWidthRef.current = cardSize.width;
  useEffect(() => {
    setStructureDocument(null);
    if (!structureSdf) return;
    let canceled = false;
    const title = `${(location.title || "ligand_network").replace(/\.[^.]+$/u, "")}.sdf`;
    // Explicit viewer options keep a multi-ligand SDF out of the molecule grid.
    // Spreading the ligands apart keeps the arrangement of the graph cards.
    const points = structureNodes.map((node) => positionsRef.current[node.id] ?? { x: 0, y: 0 });
    const centre = {
      x: points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length),
      y: points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length),
    };
    const reloadOptions = {
      sdfPoseControlLabel: "Ligand",
      sdfCollectionSpreadCells: points.map((point): [number, number] => [
        (point.x - centre.x) / cardWidthRef.current,
        (centre.y - point.y) / cardWidthRef.current,
      ]),
    };
    const structurePreferences: ViewerPreferences = { ...preferencesRef.current, rendererMode: "molstar" };
    const opening = isTauriRuntime()
      ? invoke<ViewerDocument>("open_text_structure", {
          request: { title, extension: "sdf", text: structureSdf },
          preferences: structurePreferences,
          reloadOptions,
        })
      : openBrowserDevTextDocument(title, "sdf", structureSdf, structurePreferences, reloadOptions);
    opening.then((document) => { if (!canceled) setStructureDocument(document); }).catch(() => {});
    return () => { canceled = true; };
  }, [location.title, structureNodes, structureSdf]);

  // The ligands open overlaid; the viewer accepts the request once its scene has loaded.
  useEffect(() => {
    if (!structureDocument) return;
    const id = `fep-network-${crypto.randomUUID()}`;
    const frame = () => stageRef.current?.querySelector<HTMLIFrameElement>("iframe.viewer-iframe")?.contentWindow;
    const stop = () => { window.clearInterval(interval); window.clearTimeout(timeout); window.removeEventListener("message", receive); };
    const receive = (event: MessageEvent) => {
      const body = event.data?.source === "burette-agent-viewer" ? event.data.body : null;
      if (event.source === frame() && body?.type === "agent-action-result" && body.id === id && body.result?.ok) stop();
    };
    const interval = window.setInterval(() => frame()?.postMessage({
      source: "burette-agent-host",
      body: { type: "agent-action", id, action: { type: "set_sdf_pose_mode", mode: "all" } },
    }, "*"), 400);
    const timeout = window.setTimeout(stop, 20000);
    window.addEventListener("message", receive);
    return stop;
  }, [structureDocument]);

  // The layout waits for the tab to be measured so it can match its shape, and
  // keeps following that shape until the user arranges the network by hand.
  const laidOutRef = useRef<FepNetworkData | null>(null);
  useEffect(() => {
    if (!data || stageSize.width < 1 || stageSize.height < 1) return;
    if (laidOutRef.current === data && !autoFitRef.current) return;
    laidOutRef.current = data;
    setPositions(initialPositions(data, stageSize, cardSize));
  }, [cardSize, data, stageSize]);

  // A graph the user has moved keeps its centre when the edge panel resizes the stage.
  const fittedStageRef = useRef<Size>(stageSize);
  useEffect(() => {
    const previous = fittedStageRef.current;
    fittedStageRef.current = stageSize;
    if (autoFitRef.current || previous.width < 1 || stageSize.width < 1) return;
    const dx = (stageSize.width - previous.width) / 2;
    const dy = (stageSize.height - previous.height) / 2;
    if (dx || dy) setViewport((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }, [stageSize]);

  useEffect(() => {
    if (!autoFitRef.current || viewMode !== "graph" || stageSize.width < 1) return;
    const next = fitViewport(visibleNodes.flatMap((node) => positions[node.id] ?? []), stageSize, cardSize);
    if (next) setViewport(next);
  }, [cardSize, positions, stageSize, viewMode, visibleNodes]);

  useEffect(() => {
    if (!activeEdgeKey || visibleEdges.some((edge) => edgeKey(edge) === activeEdgeKey)) return;
    setHoveredEdgeKey(null);
    setSelectedEdgeKey(null);
  }, [activeEdgeKey, visibleEdges]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element || viewMode !== "graph") return;
    // Two-finger scroll pans, pinch or Command-scroll zooms around the pointer.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      autoFitRef.current = false;
      const unit = event.deltaMode === 1 ? 16 : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        setViewport((current) => {
          const scale = clamp(current.scale * Math.exp(-dy * 0.01), minScale, maxScale);
          const ratio = scale / current.scale;
          return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
        });
        return;
      }
      setViewport((current) => ({ ...current, x: current.x - dx, y: current.y - dy }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [viewMode, data]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      autoFitRef.current = false;
      if (drag.kind === "pan") {
        setViewport((current) => ({ ...current, x: drag.origin.x + dx, y: drag.origin.y + dy }));
        return;
      }
      const scale = viewportRef.current.scale;
      if (drag.kind === "resize") {
        // Cards grow from their centre, so the corner follows the pointer, and
        // the layout spreads with them around the dragged card.
        const delta = (dx / baseCardSize.width + dy / baseCardSize.height) / scale;
        const next = clamp(drag.origin + delta, minCardScale, maxCardScale);
        const ratio = next / drag.origin;
        const anchor = drag.positions[drag.id];
        setCardScale(next);
        setPositions(Object.fromEntries(Object.entries(drag.positions).map(([id, point]) => [
          id,
          { x: anchor.x + (point.x - anchor.x) * ratio, y: anchor.y + (point.y - anchor.y) * ratio },
        ])));
        return;
      }
      // Cards in the way step aside and return once the dragged card leaves.
      const ids = Object.keys(drag.positions);
      const points = ids.map((id) => (
        id === drag.id ? { x: drag.origin.x + dx / scale, y: drag.origin.y + dy / scale } : { ...drag.positions[id] }
      ));
      separatePoints(points, { width: drag.cardSize.width + dragGap.width, height: drag.cardSize.height + dragGap.height }, 1, ids.indexOf(drag.id));
      setPositions((current) => ({ ...current, ...Object.fromEntries(ids.map((id, index) => [id, points[index]])) }));
    };
    const onStop = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      if (!drag || drag.moved || drag.kind === "resize") return;
      setSelectedEdgeKey(null);
      setSelectedNodeId(drag.kind === "card" ? drag.id : null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onStop);
    window.addEventListener("pointercancel", onStop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onStop);
      window.removeEventListener("pointercancel", onStop);
    };
  }, []);

  const openInNewTab = useCallback((node: FepNetworkNode) => {
    void actions.openStructureRecords([{ path: `${node.label}.mol`, inputExtension: "mol", text: node.molblock3d || molblockForKetcher(rdkit, node) }]);
  }, [actions, rdkit]);

  const openContextMenu = useCallback((node: FepNetworkNode, event: ReactMouseEvent) => {
    event.preventDefault();
    const ketcherFragment = ketcherFragmentForNode(rdkit, node);
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
        text: "Open in new tab",
        action: () => openInNewTab(node),
      },
      { kind: "separator" },
      {
        kind: "item",
        id: "delete-node",
        text: "Delete from network",
        action: () => setHiddenNodes((current) => new Set([...current, node.id])),
      },
    ], { x: event.clientX, y: event.clientY });
  }, [actions, openInNewTab, rdkit]);

  const selectNode = useCallback((id: string) => {
    setSelectedEdgeKey(null);
    setSelectedNodeId(id);
  }, []);

  const startCardResize = useCallback((node: FepNetworkNode, event: ReactPointerEvent) => {
    if (event.button !== 0 || !positions[node.id]) return;
    event.stopPropagation();
    dragRef.current = { kind: "resize", id: node.id, startX: event.clientX, startY: event.clientY, origin: cardScale, positions, moved: false };
  }, [cardScale, positions]);

  const startCardDrag = useCallback((node: FepNetworkNode, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const origin = positions[node.id];
    if (!origin) return;
    const visible = Object.fromEntries(visibleNodes.flatMap((item) => positions[item.id] ? [[item.id, positions[item.id]]] : []));
    dragRef.current = { kind: "card", id: node.id, startX: event.clientX, startY: event.clientY, origin, positions: visible, cardSize, moved: false };
    setDraggingId(node.id);
  }, [cardSize, positions, visibleNodes]);

  const startPan = useCallback((event: ReactPointerEvent) => {
    if (viewMode !== "graph" || event.button !== 0) return;
    const { x, y } = viewportRef.current;
    dragRef.current = { kind: "pan", startX: event.clientX, startY: event.clientY, origin: { x, y }, moved: false };
  }, [viewMode]);

  const resetLayout = useCallback(() => {
    if (!data) return;
    autoFitRef.current = true;
    setHiddenNodes(new Set());
    setSelectedEdgeKey(null);
    setSelectedNodeId(null);
    setCardScale(1);
    setPositions(initialPositions(data, stageSize, baseCardSize));
  }, [data, stageSize]);

  const edgeHandlers = (key: string) => ({
    onPointerEnter: () => setHoveredEdgeKey(key),
    onPointerLeave: () => setHoveredEdgeKey((current) => (current === key ? null : current)),
    onPointerDown: (event: ReactPointerEvent) => event.stopPropagation(),
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation();
      setSelectedNodeId(null);
      setSelectedEdgeKey((current) => (current === key ? null : key));
    },
  });

  if (!data) {
    return (
      <section className="fep-network-workspace" aria-label="FEP network preview">
        <div className="fep-network-empty">{dataError ? "Could not open this network" : <Spinner aria-label="Loading FEP network preview" />}</div>
      </section>
    );
  }

  return (
    <TooltipProvider>
      <section className="fep-network-workspace" aria-label="FEP network preview">
        <header className="fep-network-toolbar">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="View"
            value={viewMode}
            onValueChange={(value) => { if (value === "graph" || value === "grid" || value === "structure") setViewMode(value); }}
          >
            <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
            <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
            {hasConformers ? <ToggleGroupItem value="structure">3D</ToggleGroupItem> : null}
          </ToggleGroup>
          {viewMode === "structure" ? (
            <div className="fep-network-toolbar-actions">
              <HydrogensToggle shown={showHydrogens} onChange={setShowHydrogens} />
            </div>
          ) : null}
          {viewMode === "graph" ? (
            <div className="fep-network-toolbar-actions">
              <HydrogensToggle shown={showHydrogens} onChange={setShowHydrogens} />
              {hasAtomMapping ? (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-label="Highlight atoms"
                  value={highlightMode === "off" ? "" : highlightMode}
                  onValueChange={(value) => setHighlightMode(value === "common" || value === "different" ? value : "off")}
                >
                  <ToggleGroupItem value="common">Common atoms</ToggleGroupItem>
                  <ToggleGroupItem value="different">Changed atoms</ToggleGroupItem>
                </ToggleGroup>
              ) : null}
              {hasEnergyEdges ? (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-label="Edge values"
                  value={edgeMetricMode}
                  onValueChange={(value) => { if (value === "score" || value === "energy") setEdgeMetricMode(value); }}
                >
                  <ToggleGroupItem value="energy">ΔΔG</ToggleGroupItem>
                  <ToggleGroupItem value="score">Score</ToggleGroupItem>
                </ToggleGroup>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Reset layout" onClick={resetLayout}>
                    <ArrowRotateCcw aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent showArrow={false}>Reset layout</TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </header>
        <div ref={stageRef} className="fep-network-stage" data-view={viewMode} onPointerDown={startPan}>
          {viewMode === "graph" ? (
            <>
              <div
                className="fep-network-canvas"
                style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
              >
                <svg className="fep-network-edges" aria-hidden="true">
                  <defs>
                    {["", "-active"].map((suffix) => (
                      <marker key={suffix} id={`fep-network-arrow${suffix}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path className={`fep-network-edge-arrow${suffix}`} d="M0 1 10 5 0 9z" />
                      </marker>
                    ))}
                  </defs>
                  {edgeLayouts.map(({ edge, key, a, b, visual }) => {
                    const isActive = activeEdgeKey
                      ? key === activeEdgeKey
                      : selectedNode !== null && (edge.source === selectedNode.id || edge.target === selectedNode.id);
                    return (
                      <g key={key} data-active={isActive ? "true" : undefined} data-dimmed={(activeEdgeKey || selectedNode) && !isActive ? "true" : undefined}>
                        <line
                          className="fep-network-edge"
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          strokeDasharray={visual.dash}
                          markerEnd={visual.directed ? `url(#fep-network-arrow${isActive ? "-active" : ""})` : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          className="fep-network-edge-hit"
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          strokeWidth={14}
                          vectorEffect="non-scaling-stroke"
                          {...edgeHandlers(key)}
                        />
                      </g>
                    );
                  })}
                </svg>
                {edgeLayouts.map(({ key, label, visual }) => label ? (
                  <button
                    type="button"
                    key={`${key}:label`}
                    className="fep-network-edge-label"
                    aria-pressed={key === selectedEdgeKey}
                    data-active={key === activeEdgeKey ? "true" : undefined}
                    data-dimmed={activeEdgeKey && key !== activeEdgeKey ? "true" : undefined}
                    style={{ left: label.x, top: label.y }}
                    title={visual.title}
                    {...edgeHandlers(key)}
                  >
                    <span>{visual.metric}</span>
                    {visual.label}
                  </button>
                ) : null)}
                {visibleNodes.map((node) => {
                  const position = positions[node.id];
                  if (!position) return null;
                  return (
                    <LigandCard
                      key={node.id}
                      node={node}
                      rdkit={rdkit}
                      energy={nodeEnergies.get(node.id) ?? null}
                      {...pictureHighlight(node.id)}
                      active={activeEdge ? activeEdge.source === node.id || activeEdge.target === node.id : false}
                      dimmed={activeEdge ? activeEdge.source !== node.id && activeEdge.target !== node.id : false}
                      selected={selectedNode === node}
                      dragging={draggingId === node.id}
                      onPointerDown={(event) => startCardDrag(node, event)}
                      onResizeStart={(event) => startCardResize(node, event)}
                      onSelect={() => selectNode(node.id)}
                      onOpen={() => openInNewTab(node)}
                      onContextMenu={(event) => openContextMenu(node, event)}
                      style={{
                        left: position.x - cardSize.width / 2,
                        top: position.y - cardSize.height / 2,
                        width: cardSize.width,
                        height: cardSize.height,
                      }}
                    />
                  );
                })}
              </div>
              {activeEdge && !selectedEdge ? (
                <EdgeDetails
                  edge={activeEdge}
                  source={nodeById.get(activeEdge.source) ?? null}
                  target={nodeById.get(activeEdge.target) ?? null}
                />
              ) : null}
            </>
          ) : (
            viewMode === "grid" ? (
              gridDocument ? <ViewerFrame document={gridDocument} className="fep-network-grid-frame viewer-iframe" readOnly /> : null
            ) : (
              structureDocument ? <ViewerFrame key={structureDocument.id} document={structureDocument} className="fep-network-grid-frame viewer-iframe" readOnly /> : null
            )
          )}
        </div>
        {viewMode === "graph" && selectedEdge ? (
          <aside className="fep-network-selection" aria-label="Selected edge" aria-live="polite">
            {[nodeById.get(selectedEdge.source), nodeById.get(selectedEdge.target)].map((node) => node ? (
              <figure key={node.id}>
                <LigandPicture node={node} rdkit={rdkit} {...pictureHighlight(node.id)} />
                <figcaption>
                  <span title={node.label}>{node.shortLabel}</span>
                  <EnergyValue energy={nodeEnergies.get(node.id) ?? null} />
                </figcaption>
              </figure>
            ) : null)}
            <dl>
              {selectedEdge.energy !== null ? <div><dt>ΔΔG</dt><dd>{energyLabel(selectedEdge)}</dd></div> : null}
              <div><dt>Score</dt><dd>{selectedEdge.score.toFixed(3)}</dd></div>
              {selectedEdge.mappedAtoms > 0 ? <div><dt>Mapped atoms</dt><dd>{selectedEdge.mappedAtoms}</dd></div> : null}
            </dl>
          </aside>
        ) : null}
      </section>
    </TooltipProvider>
  );
}

function HydrogensToggle({ shown, onChange }: { shown: boolean; onChange: (shown: boolean) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Hydrogens"
      value={shown ? "shown" : ""}
      onValueChange={(value) => onChange(value === "shown")}
    >
      <ToggleGroupItem value="shown" aria-label="Show hydrogens" title="Show hydrogens">H</ToggleGroupItem>
    </ToggleGroup>
  );
}

function EdgeDetails({ edge, source, target }: { edge: FepNetworkEdge; source: FepNetworkNode | null; target: FepNetworkNode | null }) {
  return (
    <div className="fep-network-edge-details" aria-live="polite">
      <strong>{source?.shortLabel ?? edge.source}</strong>
      <span aria-label="to">→</span>
      <strong>{target?.shortLabel ?? edge.target}</strong>
      {edge.energy !== null ? <span>ΔΔG {energyLabel(edge)}</span> : null}
      <span>Score {edge.score.toFixed(3)}</span>
      {edge.mappedAtoms > 0 ? <span>{edge.mappedAtoms} mapped atoms</span> : null}
    </div>
  );
}

function useGridAssets() {
  const [assets, setAssets] = useState<GridAssets | null>(() => (
    isTauriRuntime() ? null : { base: gridAssetsBaseUrl, rdkitWasmPath: "/__burette/rdkit-wasm" }
  ));
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let canceled = false;
    // Packaged builds have no repository checkout next to the bundle, so the
    // grid runtime reads its scripts and RDKit from the bundled ViewerWeb copy.
    resourceDir()
      .then((dir) => join(dir, "ViewerWeb"))
      .then((dir) => {
        if (canceled) return;
        const base = `${convertFileSrc(dir)}/`;
        setAssets({ base, rdkitWasmPath: `${base}rdkit/RDKit_minimal.wasm` });
      })
      .catch(() => {});
    return () => { canceled = true; };
  }, []);
  return assets;
}

function edgeKey(edge: FepNetworkEdge) {
  return `${edge.source}:${edge.target}`;
}

// Each edge measures ΔΔG = ΔG(target) − ΔG(source). Averaging those
// differences around every ligand until they settle gives one ΔG per ligand,
// relative to the first ligand of its connected part of the network.
function relativeNodeEnergies(nodes: FepNetworkNode[], edges: FepNetworkEdge[]) {
  const neighbours = new Map<string, Array<{ id: string; offset: number }>>();
  for (const edge of edges) {
    if (edge.energy === null) continue;
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), { id: edge.source, offset: edge.energy }]);
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), { id: edge.target, offset: -edge.energy }]);
  }
  const energies = new Map<string, number>();
  const references = new Set<string>();
  for (const node of nodes) {
    if (!neighbours.has(node.id) || energies.has(node.id)) continue;
    references.add(node.id);
    const queue = [node.id];
    energies.set(node.id, 0);
    for (let index = 0; index < queue.length; index += 1) {
      for (const { id, offset } of neighbours.get(queue[index]) ?? []) {
        if (energies.has(id)) continue;
        energies.set(id, (energies.get(queue[index]) ?? 0) - offset);
        queue.push(id);
      }
    }
  }
  for (let pass = 0; pass < 200; pass += 1) {
    let shift = 0;
    for (const [id, links] of neighbours) {
      if (references.has(id)) continue;
      const next = links.reduce((sum, link) => sum + (energies.get(link.id) ?? 0) + link.offset, 0) / links.length;
      shift = Math.max(shift, Math.abs(next - (energies.get(id) ?? 0)));
      energies.set(id, next);
    }
    if (shift < 1e-4) break;
  }
  return energies;
}

// Edges stay neutral so the ligands carry the colour; an edge whose ΔΔG is
// no larger than its own uncertainty is dashed.
function edgeVisual(edge: FepNetworkEdge, mode: EdgeMetricMode) {
  if (mode === "energy") {
    if (edge.energy === null) return { dash: undefined, directed: false, metric: "", label: "", title: scoreTitle(edge) };
    return {
      dash: edge.uncertainty !== null && edge.uncertainty >= Math.abs(edge.energy) ? "6 5" : undefined,
      // ΔΔG is the change from the source ligand to the one the arrow points at.
      directed: true,
      metric: "ΔΔG",
      label: energyLabel(edge),
      title: `ΔΔG ${energyLabel(edge)} kcal/mol, ${scoreTitle(edge)}`,
    };
  }
  return { dash: undefined, directed: false, metric: "Score", label: edge.score.toFixed(2), title: scoreTitle(edge) };
}

function scoreTitle(edge: FepNetworkEdge) {
  return `Score ${edge.score.toFixed(3)}${edge.mappedAtoms > 0 ? `, ${edge.mappedAtoms} mapped atoms` : ""}`;
}

function energyLabel(edge: FepNetworkEdge) {
  if (edge.energy === null) return "";
  const value = signedEnergy(edge.energy);
  return edge.uncertainty !== null ? `${value} ± ${edge.uncertainty.toFixed(2)}` : value;
}

function signedEnergy(value: number) {
  const rounded = Math.abs(value).toFixed(2);
  return `${value < 0 && rounded !== "0.00" ? "−" : ""}${rounded}`;
}

function LigandPicture({
  node,
  rdkit,
  highlightMode,
  highlightSet,
  showHydrogens,
}: {
  node: FepNetworkNode;
  rdkit: RDKitModule | null;
  highlightMode: HighlightMode;
  highlightSet: NodeHighlightSet | null;
  showHydrogens: boolean;
}) {
  const svg = useMemo(
    () => drawRDKitMol(rdkit, node, highlightMode, highlightSet, showHydrogens),
    [highlightMode, highlightSet, node, rdkit, showHydrogens],
  );
  return <div className="fep-network-card-picture" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function EnergyValue({ energy }: { energy: number | null }) {
  if (energy === null) return null;
  return (
    <span
      className="fep-network-card-energy"
      data-sign={energy < -0.005 ? "negative" : energy > 0.005 ? "positive" : undefined}
      title="Relative ΔG, kcal/mol"
    >
      {signedEnergy(energy)}
    </span>
  );
}

function LigandCard({
  node,
  rdkit,
  energy,
  highlightMode,
  highlightSet,
  showHydrogens,
  active,
  dimmed,
  selected,
  dragging,
  onPointerDown,
  onResizeStart,
  onSelect,
  onOpen,
  onContextMenu,
  style,
}: {
  node: FepNetworkNode;
  rdkit: RDKitModule | null;
  energy: number | null;
  highlightMode: HighlightMode;
  highlightSet: NodeHighlightSet | null;
  showHydrogens: boolean;
  active: boolean;
  dimmed: boolean;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  style: CSSProperties;
}) {
  return (
    <article
      className="fep-network-card"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-active={active ? "true" : undefined}
      data-dimmed={dimmed ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      style={style}
      title={node.label}
      onPointerDown={onPointerDown}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
      onContextMenu={onContextMenu}
    >
      <LigandPicture node={node} rdkit={rdkit} highlightMode={highlightMode} highlightSet={highlightSet} showHydrogens={showHydrogens} />
      <footer>
        <span>{node.shortLabel}</span>
        <EnergyValue energy={energy} />
      </footer>
      <span className="fep-network-card-grip" aria-hidden="true" onPointerDown={onResizeStart} />
    </article>
  );
}

function initialPositions(data: FepNetworkData, stage: Size, cardSize: Size) {
  const aspect = clamp(stage.width / Math.max(stage.height, 1), 0.6, 2.4);
  const cell = { width: cardSize.width + cardGap.width, height: cardSize.height + cardGap.height };
  const width = Math.sqrt(data.nodes.length * cell.width * cell.height * aspect);
  const height = width / aspect;
  const points = data.nodes.map((node) => ({ x: (node.x / 100) * width, y: (node.y / 100) * height }));
  separatePoints(points, cell, aspect);
  return Object.fromEntries(data.nodes.map((node, index) => [node.id, points[index]]));
}

// Pushes apart, in place, every pair of cards closer than one cell, along the
// axis where they overlap least, until the layout settles. A pinned card keeps
// its place and its neighbours take the whole push.
function separatePoints(points: Point[], cell: Size, aspect: number, pinned = -1) {
  for (let pass = 0; pass < 120; pass += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const dx = points[j].x - points[i].x;
        const dy = points[j].y - points[i].y;
        const overlapX = cell.width - Math.abs(dx);
        const overlapY = cell.height - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        const shareI = i === pinned ? 0 : j === pinned ? 1 : 0.5;
        if (overlapX / aspect < overlapY) {
          const push = overlapX * (dx < 0 ? -1 : 1);
          points[i].x -= push * shareI;
          points[j].x += push * (1 - shareI);
        } else {
          const push = overlapY * (dy < 0 ? -1 : 1);
          points[i].y -= push * shareI;
          points[j].y += push * (1 - shareI);
        }
      }
    }
    if (!moved) break;
  }
}

function fitViewport(points: Point[], stage: Size, cardSize: Size): Viewport | null {
  if (!points.length) return null;
  const left = Math.min(...points.map((point) => point.x)) - cardSize.width / 2;
  const right = Math.max(...points.map((point) => point.x)) + cardSize.width / 2;
  const top = Math.min(...points.map((point) => point.y)) - cardSize.height / 2;
  const bottom = Math.max(...points.map((point) => point.y)) + cardSize.height / 2;
  const scale = clamp(
    Math.min((stage.width - fitPadding * 2) / (right - left), (stage.height - fitPadding * 2) / (bottom - top), fitMaxScale),
    minScale,
    maxScale,
  );
  return {
    scale,
    x: (stage.width - (right - left) * scale) / 2 - left * scale,
    y: (stage.height - (bottom - top) * scale) / 2 - top * scale,
  };
}

type Rect = { left: number; right: number; top: number; bottom: number };

function cardRect(center: Point, cardSize: Size): Rect {
  return {
    left: center.x - cardSize.width / 2,
    right: center.x + cardSize.width / 2,
    top: center.y - cardSize.height / 2,
    bottom: center.y + cardSize.height / 2,
  };
}

// Where the line from one card centre towards another leaves the card border.
function cardBoundaryPoint(from: Point, toward: Point, cardSize: Size): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const t = Math.min(
    dx === 0 ? Infinity : cardSize.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : cardSize.height / 2 / Math.abs(dy),
  );
  return { x: from.x + dx * t, y: from.y + dy * t };
}

// Labels sit horizontally on the visible part of the edge, sliding along it
// when the midpoint would land on another card.
function edgeLabelPlacement(a: Point, b: Point, text: string, cards: Rect[]): Point {
  const halfWidth = (text.length * 7.2 + 18) / 2;
  const halfHeight = 12;
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const blocked = cards.some((rect) => (
      x + halfWidth > rect.left - 4 && x - halfWidth < rect.right + 4 && y + halfHeight > rect.top - 4 && y - halfHeight < rect.bottom + 4
    ));
    if (!blocked) return { x, y };
  }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
    if (!mol || !mol.is_valid()) return null;
    const structuralMolblock = mol.get_kekule_form() || mol.get_aromatic_form() || molblock;
    prepared = rdkit.get_mol(structuralMolblock);
    if (!prepared || !prepared.is_valid()) return structuralMolblock;
    return prepared.get_new_coords(true) || prepared.get_new_coords() || structuralMolblock;
  } catch (_) {
    return null;
  } finally {
    try { prepared?.delete(); } catch (_) {}
    try { mol?.delete(); } catch (_) {}
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

async function loadFepNetworkData(graphmlText?: string) {
  if (graphmlText) return parseFepNetworkText(graphmlText);
  const response = await fetch(sampleGraphmlUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load sample GraphML: ${response.status} ${response.statusText}`);
  return parseFepNetworkText(await response.text());
}

type FepGridRecord = {
  index: number;
  name: string;
  molblock: string;
  props: Record<string, string>;
};

// The grid follows the app's theme, which can differ from the system one.
function appTheme(element: HTMLElement | null) {
  const theme = element?.closest<HTMLElement>(".app-shell")?.dataset.effectiveTheme;
  return theme === "light" || theme === "dark" ? theme : "auto";
}

function fepGridDocument(data: FepNetworkData, title: string, assets: GridAssets, theme: string): ViewerDocument {
  const records = data.nodes.map((node, index) => fepGridRecord(node, index));
  const runtimePath = fepGridHtml(title, records, assets, theme);
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

function fepGridHtml(title: string, records: FepGridRecord[], assets: GridAssets, theme: string) {
  const config = {
    mode: "grid2d",
    format: "sdf",
    renderer: "grid2d",
    documentId: "fep-network-grid",
    sourcePath: title,
    label: title,
    byteCount: records.reduce((total, record) => total + record.molblock.length, 0),
    host: "browser-dev",
    quickLookBuild: "burette-browser-dev-grid2d",
    debug: false,
    appViewer: true,
    tauriViewer: false,
    theme,
    canvasBackground: "auto",
    overlayOpacity: 0.9,
    transparentBackground: false,
    recordsTotal: records.length,
    recordsIncluded: records.length,
    recordsTruncated: false,
    pageSize: 720,
    rdkitWasmPath: assets.rdkitWasmPath,
    capabilities: {
      editing: false,
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
  <base href="${escapeHtml(assets.base)}" />
  <title>Burette FEP Grid - ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="grid.css?v=${gridAssetVersion}" />
  <script>
    window.__mqlPost = function (type, message, payload) {
      try {
        const body = { type, message: String(message || ''), ...(payload || {}) };
        if (window.BuretteConfig && window.BuretteConfig.documentId) body.documentId = String(window.BuretteConfig.documentId);
        window.parent && window.parent.postMessage({ source: 'burette-grid', body }, '*');
      } catch (_) {}
    };
    window.BuretteInlineMode = true;
    window.BuretteGridMode = true;
    window.BuretteDebug = false;
  </script>
</head>
<body class="burette-opaque-background">
  <div id="app"></div>
  <div id="status">Loading molecule grid...</div>
  <script>window.BuretteConfig = ${JSON.stringify(config).replaceAll("<", "\\u003c")};</script>
  <script>window.BuretteGridRecords = ${JSON.stringify(records).replaceAll("<", "\\u003c")};</script>
  <script src="rdkit/RDKit_minimal.js?v=${gridAssetVersion}"></script>
  <script src="grid-ui.js?v=${gridAssetVersion}"></script>
  <script src="grid-viewer.js?v=${gridAssetVersion}"></script>
</body>
</html>`;
}

function fepHighlightSets(data: FepNetworkData) {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const incidentCommonAtoms = new Map<string, Set<number>[]>();
  for (const edge of data.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || edge.mapping.length === 0) continue;
    const common = edgeCommonAtoms(edge, source, target);
    if (common.source.size > 0) pushIncidentAtoms(incidentCommonAtoms, source.id, common.source);
    if (common.target.size > 0) pushIncidentAtoms(incidentCommonAtoms, target.id, common.target);
  }

  const result = new Map<string, NodeHighlightSet>();
  for (const node of data.nodes) {
    result.set(node.id, nodeHighlightSet(node, new Set(intersectAtomSets(incidentCommonAtoms.get(node.id) ?? []))));
  }
  return result;
}

// Heavy atoms an edge maps onto the same element in both of its ligands.
function edgeCommonAtoms(edge: FepNetworkEdge, source: FepNetworkNode, target: FepNetworkNode) {
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
  return { source: sourceAtoms, target: targetAtoms };
}

function nodeHighlightSet(node: FepNetworkNode, common: Set<number>): NodeHighlightSet {
  const atoms = Array.from({ length: node.heavyAtoms }, (_, index) => index);
  return { common: atoms.filter((atom) => common.has(atom)), different: atoms.filter((atom) => !common.has(atom)) };
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

function drawRDKitMol(rdkit: RDKitModule | null, node: FepNetworkNode, highlightMode: HighlightMode, highlightSet: NodeHighlightSet | null, showHydrogens: boolean) {
  if (!rdkit || !node.molblock.trim()) return "";
  let mol: RDKitMol | null = null;
  try {
    mol = rdkit.get_mol(node.molblock);
    if (!mol || !mol.is_valid()) return "";
    // Added hydrogens follow the heavy atoms, so highlight indexes stay valid.
    if (showHydrogens) { try { mol.add_hs_in_place(); } catch (_) {} }
    // Network nodes carry 3D conformers; cards show a clean 2D depiction.
    try { mol.set_new_coords(); } catch (_) {}
    const match = highlightMode === "off" ? null : highlightMatch(node, highlightMode, highlightSet);
    const color = rgbFromHex(highlightMode === "common" ? commonHighlightHex : differentHighlightHex);
    const svg = sanitizeSvg(mol.get_svg_with_highlights(JSON.stringify({
      // Drawn at twice the card's picture size with thin bonds and large atom
      // labels, so the picture stays crisp and balanced when cards are enlarged.
      width: 464,
      height: 372,
      padding: 0.04,
      bondLineWidth: 2,
      multipleBondOffset: 0.18,
      baseFontSize: 0.85,
      minFontSize: 20,
      additionalAtomLabelPadding: 0.08,
      ...(match ? {
        atoms: match.atoms,
        bonds: match.bonds,
        highlightAtomColors: Object.fromEntries(match.atoms.map((atom: number) => [atom, color])),
        highlightAtomRadii: Object.fromEntries(match.atoms.map((atom: number) => [atom, 0.36])),
        highlightBondColors: Object.fromEntries(match.bonds.map((bond: number) => [bond, color])),
        highlightBondWidthMultiplier: 12,
      } : {}),
    })));
    return themedDrawingColors.reduce((text, [from, to]) => text.replace(from, to), svg);
  } catch (_) {
    return "";
  } finally {
    try { mol?.delete(); } catch (_) {}
  }
}

function rgbFromHex(hex: string) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
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
