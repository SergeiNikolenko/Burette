import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  boundedEdgePositions,
  cameraAwarePointIndices,
  positionsForIndices,
  representativePointIndices,
  sourceRecordIdsInProjectedPolygon,
  type ProjectionSnapshot,
} from "../lib/chemical-space-3d-lod";
import { simplifyLassoPolygon } from "../lib/chemical-space-lasso";

type Point2 = { x: number; y: number };
type ProjectedPoint = Point2 & { sourceRecordId: number; depth: number };
type MoleculePreview = {
  sourceRecordId: number;
  name: string;
  smiles: string;
  svgUrl: string | null;
};

type ChemicalSpace3DProps = {
  positions: Array<[number, number, number]>;
  treeEdges: Array<[number, number]>;
  sourceRecordIds: number[];
  clusterIds: Array<number | null>;
  clusterColors: readonly string[];
  pointColors: Array<string | null> | null;
  cliffEdges: Array<[number, number]>;
  selected: Set<number>;
  hovered: number | null;
  preview: MoleculePreview | null;
  pointScale: number;
  treeLineScale: number;
  tool: "navigate" | "lasso";
  methodLabel: string;
  onHover: (sourceRecordId: number | null) => void;
  onSelect: (sourceRecordIds: number[]) => void;
};

type ThreeRuntime = {
  updatePositions: (positions: Array<[number, number, number]>) => void;
  updateHovered: (sourceRecordId: number | null) => void;
  updateSelected: (sourceRecordIds: Set<number>) => void;
  updatePreview: (preview: MoleculePreview | null) => void;
  updatePointScale: (pointScale: number) => void;
  updateTreeLineScale: (treeLineScale: number) => void;
  updateClusters: (clusterIds: Array<number | null>) => void;
  updateCliffs: (cliffEdges: Array<[number, number]>) => void;
  cancelSelection: () => void;
  selectPolygon: (polygon: Point2[]) => Promise<number[]>;
};

const MAX_LASSO_POINTS = 1_024;
const MAX_3D_RENDER_POINTS = 40_000;
const MAX_3D_RENDER_EDGES = 40_000;
const MAX_3D_RENDER_CLIFFS = 20_000;
const MAX_3D_OVERLAY_POINTS = 20_000;
const MAX_3D_SELECTION_POINTS = 100_000;
const CAMERA_LOD_SETTLE_MS = 90;
const BASE_POINT_SIZE = 0.055;
const POINT_HIT_RADIUS_PX = 6;
const PROJECTED_HOVER_CELL_SIZE = 8;
const MAX_PROJECTED_POINTS_PER_CELL = 8;

export function ChemicalSpace3D({
  positions,
  treeEdges,
  sourceRecordIds,
  clusterIds,
  clusterColors,
  pointColors,
  cliffEdges,
  selected,
  hovered,
  preview,
  pointScale,
  treeLineScale,
  tool,
  methodLabel,
  onHover,
  onSelect,
}: ChemicalSpace3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const lassoCanvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ThreeRuntime | null>(null);
  const lassoRef = useRef<Point2[]>([]);
  const lassoPaintFrameRef = useRef(0);
  const lassoSelectionGenerationRef = useRef(0);
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);
  const previewRef = useRef(preview);
  const positionsRef = useRef(positions);
  const selectedRef = useRef(selected);
  const hoveredRef = useRef(hovered);
  const clusterIdsRef = useRef(clusterIds);
  const pointColorsRef = useRef<Array<string | null>>(pointColors ?? []);
  const cliffEdgesRef = useRef(cliffEdges);
  const [lasso, setLasso] = useState<Point2[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [previewAnchor, setPreviewAnchor] = useState<Point2 | null>(null);

  onHoverRef.current = onHover;
  onSelectRef.current = onSelect;
  previewRef.current = preview;
  positionsRef.current = positions;
  selectedRef.current = selected;
  hoveredRef.current = hovered;
  clusterIdsRef.current = clusterIds;
  pointColorsRef.current = pointColors ?? [];
  cliffEdgesRef.current = cliffEdges;
  const hasClusters = useMemo(
    () => clusterIds.some((clusterId) => clusterId !== null),
    [clusterIds],
  );

  useEffect(() => () => {
    lassoSelectionGenerationRef.current += 1;
    if (lassoPaintFrameRef.current) {
      window.cancelAnimationFrame(lassoPaintFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(2.4, 1.7, 2.6);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "size-full touch-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30";
    renderer.domElement.setAttribute("aria-label", `Interactive 3D ${methodLabel} chemical-space map`);
    renderer.domElement.setAttribute("aria-keyshortcuts", "W A S D Q E");
    renderer.domElement.setAttribute("role", "application");
    host.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.enableZoom = false;
    controls.minDistance = 0.15;
    controls.maxDistance = 12;
    controls.target.set(0, 0, 0);

    const primaryColor = semanticColor(host, "text-primary", "#af52de");
    const foregroundColor = semanticColor(host, "text-foreground", "#f5f5f7");
    const pointColor = semanticColor(host, "text-foreground", "#f5f5f7");
    const pointTexture = circleTexture();
    const densityScale = adaptivePointScale(sourceRecordIds.length);
    const pointOpacity = adaptivePointOpacity(sourceRecordIds.length);
    let displayedIndices = representativePointIndices(
      sourceRecordIds.length,
      MAX_3D_RENDER_POINTS,
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positionsForIndices(positions, displayedIndices), 3),
    );
    const treeGeometry = new LineSegmentsGeometry();
    const treePositions = (nextPositions: Array<[number, number, number]>) =>
      boundedEdgePositions(nextPositions, treeEdges, MAX_3D_RENDER_EDGES);
    treeGeometry.setPositions(treePositions(positions));
    const treeMaterial = new LineMaterial({
      color: foregroundColor.getHex(),
      linewidth: 2.25 * treeLineScale,
      opacity: 0.5,
      transparent: true,
    });
    const treeLines = new LineSegments2(
      treeGeometry,
      treeMaterial,
    );
    treeLines.computeLineDistances();
    scene.add(treeLines);
    const cliffPositions = (
      nextPositions: Array<[number, number, number]>,
      edges: Array<[number, number]>,
    ) => boundedEdgePositions(nextPositions, edges, MAX_3D_RENDER_CLIFFS);
    const cliffGeometry = new LineSegmentsGeometry();
    cliffGeometry.setPositions(cliffPositions(positions, cliffEdgesRef.current));
    const cliffMaterial = new LineMaterial({
      color: 0xef4444,
      linewidth: 2.5,
      opacity: 0.85,
      transparent: true,
    });
    const cliffLines = new LineSegments2(cliffGeometry, cliffMaterial);
    cliffLines.computeLineDistances();
    scene.add(cliffLines);
    const clusterColorValues = (ids: Array<number | null>) =>
      displayedIndices.flatMap((index) => {
        const clusterId = ids[index] ?? null;
        const override = pointColorsRef.current[index] ?? null;
        const color = override
          ? new THREE.Color(override)
          : clusterId === null
            ? pointColor
            : new THREE.Color(clusterColors[clusterId % clusterColors.length]);
        return [color.r, color.g, color.b];
      });
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(clusterColorValues(clusterIdsRef.current), 3),
    );
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: pointTexture,
      alphaTest: 0.15,
      opacity: pointOpacity,
      size: BASE_POINT_SIZE * pointScale * densityScale,
      sizeAttenuation: true,
      transparent: true,
    }));
    scene.add(points);

    const selectedPoints = overlayPoints(primaryColor, pointTexture, BASE_POINT_SIZE * pointScale * densityScale);
    const hoveredPoints = overlayPoints(primaryColor, pointTexture, BASE_POINT_SIZE * pointScale * densityScale);
    scene.add(selectedPoints, hoveredPoints);

    const grid = new THREE.GridHelper(2.5, 10, primaryColor, foregroundColor);
    grid.position.y = -1.08;
    grid.material.opacity = 0.3;
    grid.material.transparent = true;
    scene.add(grid);

    const axes = new THREE.AxesHelper(0.32);
    axes.position.set(-1.05, -1.07, -1.05);
    scene.add(axes);

    const indexById = new Map<number, number>();
    for (let index = 0; index < sourceRecordIds.length; index += 1) {
      indexById.set(sourceRecordIds[index], index);
    }
    let pointerDown: Point2 | null = null;
    let pointerMoved = false;
    let projectedBuckets = new Map<string, ProjectedPoint[]>();
    let viewRenderFrame = 0;
    let lodSettleTimer = 0;
    let lodGeneration = 0;
    let selectionGeneration = 0;
    const projectedVector = new THREE.Vector3();

    const draw = () => {
      renderer.render(scene, camera);
    };
    const projectionSnapshot = (): ProjectionSnapshot => {
      camera.updateMatrixWorld();
      const viewProjection = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
      return {
        elements: viewProjection.elements.slice(),
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
      };
    };
    const rebuildProjectedIndex = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const nextBuckets = new Map<string, ProjectedPoint[]>();
      for (const sourceIndex of displayedIndices) {
        const position = positionsRef.current[sourceIndex];
        const sourceRecordId = sourceRecordIds[sourceIndex];
        if (!position || sourceRecordId === undefined) continue;
        projectedVector.set(position[0], position[1], position[2]).project(camera);
        if (projectedVector.z < -1 || projectedVector.z > 1) continue;
        const candidate = {
          x: (projectedVector.x * 0.5 + 0.5) * width,
          y: (-projectedVector.y * 0.5 + 0.5) * height,
          depth: projectedVector.z,
          sourceRecordId,
        };
        if (
          candidate.x < -POINT_HIT_RADIUS_PX
          || candidate.x > width + POINT_HIT_RADIUS_PX
          || candidate.y < -POINT_HIT_RADIUS_PX
          || candidate.y > height + POINT_HIT_RADIUS_PX
        ) continue;
        addProjectedCandidate(nextBuckets, candidate);
      }
      projectedBuckets = nextBuckets;
    };
    const renderView = () => {
      draw();
      rebuildProjectedIndex();
    };
    const scheduleViewRender = () => {
      if (viewRenderFrame) return;
      viewRenderFrame = window.requestAnimationFrame(() => {
        viewRenderFrame = 0;
        renderView();
      });
      scheduleLodRefinement();
    };
    const applyDisplayedIndices = (nextIndices: number[]) => {
      displayedIndices = nextIndices;
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          positionsForIndices(positionsRef.current, displayedIndices),
          3,
        ),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(clusterColorValues(clusterIdsRef.current), 3),
      );
      geometry.computeBoundingSphere();
      renderView();
    };
    const refineCameraLod = async (generation: number) => {
      // Camera-aware culling only pays off past the render budget. Below it the
      // full set is already on the GPU, and swapping it for a frustum subset
      // makes points pop in and out on every orbit or zoom.
      if (positionsRef.current.length <= MAX_3D_RENDER_POINTS) {
        if (displayedIndices.length !== positionsRef.current.length) {
          applyDisplayedIndices(
            representativePointIndices(positionsRef.current.length, MAX_3D_RENDER_POINTS),
          );
        }
        return;
      }
      const nextIndices = await cameraAwarePointIndices(
        positionsRef.current,
        projectionSnapshot(),
        MAX_3D_RENDER_POINTS,
        () => generation !== lodGeneration,
      );
      if (generation !== lodGeneration) return;
      applyDisplayedIndices(nextIndices);
    };
    const scheduleLodRefinement = (delay = CAMERA_LOD_SETTLE_MS) => {
      lodGeneration += 1;
      const generation = lodGeneration;
      if (lodSettleTimer) window.clearTimeout(lodSettleTimer);
      lodSettleTimer = window.setTimeout(() => {
        lodSettleTimer = 0;
        void refineCameraLod(generation);
      }, delay);
    };

    const updateSelected = (sourceRecordIds: Set<number>, shouldRender = true) => {
      const selectedIndices = [...sourceRecordIds]
        .map((sourceRecordId) => indexById.get(sourceRecordId))
        .filter((index): index is number => index !== undefined);
      updateOverlayGeometry(
        selectedPoints.geometry,
        boundedSubset(selectedIndices, MAX_3D_OVERLAY_POINTS),
        positionsRef.current,
      );
      if (shouldRender) draw();
    };
    const updateHovered = (sourceRecordId: number | null, shouldRender = true) => {
      const index = sourceRecordId === null ? undefined : indexById.get(sourceRecordId);
      updateOverlayGeometry(hoveredPoints.geometry, index === undefined ? [] : [index], positionsRef.current);
      if (shouldRender) draw();
    };
    const updatePositions = (nextPositions: Array<[number, number, number]>) => {
      positionsRef.current = nextPositions;
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positionsForIndices(nextPositions, displayedIndices), 3),
      );
      geometry.computeBoundingSphere();
      treeGeometry.setPositions(treePositions(nextPositions));
      treeGeometry.computeBoundingSphere();
      treeLines.computeLineDistances();
      cliffGeometry.setPositions(cliffPositions(nextPositions, cliffEdgesRef.current));
      cliffLines.computeLineDistances();
      updateSelected(selectedRef.current, false);
      updateHovered(hoveredRef.current, false);
      renderView();
      scheduleLodRefinement(0);
    };
    const updatePreview = (nextPreview: MoleculePreview | null) => {
      previewRef.current = nextPreview;
    };
    const updatePointScale = (nextPointScale: number) => {
      points.material.size = BASE_POINT_SIZE * nextPointScale * densityScale;
      selectedPoints.material.size = BASE_POINT_SIZE * nextPointScale * densityScale;
      hoveredPoints.material.size = BASE_POINT_SIZE * nextPointScale * densityScale;
      draw();
    };
    const updateTreeLineScale = (nextTreeLineScale: number) => {
      treeMaterial.linewidth = 2.25 * nextTreeLineScale;
      draw();
    };
    const updateClusters = (nextClusterIds: Array<number | null>) => {
      clusterIdsRef.current = nextClusterIds;
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(clusterColorValues(nextClusterIds), 3),
      );
      draw();
    };
    const updateCliffs = (nextCliffEdges: Array<[number, number]>) => {
      cliffEdgesRef.current = nextCliffEdges;
      cliffGeometry.setPositions(cliffPositions(positionsRef.current, nextCliffEdges));
      cliffLines.computeLineDistances();
      draw();
    };
    const cancelSelection = () => {
      selectionGeneration += 1;
    };
    const selectPolygon = async (polygon: Point2[]) => {
      selectionGeneration += 1;
      const generation = selectionGeneration;
      return sourceRecordIdsInProjectedPolygon(
        positionsRef.current,
        sourceRecordIds,
        projectionSnapshot(),
        polygon,
        MAX_3D_SELECTION_POINTS,
        () => generation !== selectionGeneration,
      );
    };

    const localPoint = (event: PointerEvent): Point2 => {
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const nearestProjectedPoint = (point: Point2) => {
      let nearest: ProjectedPoint | null = null;
      let distanceSquared = POINT_HIT_RADIUS_PX ** 2;
      const centerX = Math.floor(point.x / PROJECTED_HOVER_CELL_SIZE);
      const centerY = Math.floor(point.y / PROJECTED_HOVER_CELL_SIZE);
      const cellRange = Math.ceil(POINT_HIT_RADIUS_PX / PROJECTED_HOVER_CELL_SIZE);
      for (let cellY = centerY - cellRange; cellY <= centerY + cellRange; cellY += 1) {
        for (let cellX = centerX - cellRange; cellX <= centerX + cellRange; cellX += 1) {
          const candidates = projectedBuckets.get(`${cellX}:${cellY}`);
          if (!candidates) continue;
          for (const candidate of candidates) {
            const nextDistance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
            if (
              nextDistance < distanceSquared
              || (nextDistance === distanceSquared && (nearest === null || candidate.depth < nearest.depth))
            ) {
              nearest = candidate;
              distanceSquared = nextDistance;
            }
          }
        }
      }
      return nearest;
    };
    const hoverNearest = (event: PointerEvent) => {
      const sourceRecordId = nearestProjectedPoint(localPoint(event))?.sourceRecordId ?? null;
      if (sourceRecordId === hoveredRef.current) return sourceRecordId;
      hoveredRef.current = sourceRecordId;
      onHoverRef.current(sourceRecordId);
      return sourceRecordId;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector3(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
        0.5,
      ).unproject(camera);
      const rayDirection = pointer.sub(camera.position).normalize();
      const viewDirection = new THREE.Vector3();
      camera.getWorldDirection(viewDirection);
      const denominator = rayDirection.dot(viewDirection);
      if (Math.abs(denominator) < Number.EPSILON) return;

      const anchorDistance = controls.target.clone().sub(camera.position).dot(viewDirection) / denominator;
      const anchor = camera.position.clone().addScaledVector(rayDirection, anchorDistance);
      const currentDistance = camera.position.distanceTo(controls.target);
      const factor = event.deltaY > 0 ? 1.1 : 0.9;
      const nextDistance = Math.max(controls.minDistance, Math.min(controls.maxDistance, currentDistance * factor));
      const ratio = nextDistance / currentDistance;
      camera.position.sub(anchor).multiplyScalar(ratio).add(anchor);
      controls.target.sub(anchor).multiplyScalar(ratio).add(anchor);
      controls.update();
      scheduleViewRender();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      renderer.domElement.focus({ preventScroll: true });
      if (hoveredRef.current !== null) {
        hoveredRef.current = null;
        onHoverRef.current(null);
      }
      pointerDown = localPoint(event);
      pointerMoved = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      setPreviewAnchor(localPoint(event));
      if (pointerDown) {
        const point = localPoint(event);
        pointerMoved ||= Math.hypot(point.x - pointerDown.x, point.y - pointerDown.y) > 3;
        return;
      }
      hoverNearest(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDown || pointerMoved) {
        pointerDown = null;
        return;
      }
      pointerDown = null;
      const sourceRecordId = hoverNearest(event);
      onSelectRef.current(sourceRecordId === null ? [] : [sourceRecordId]);
    };
    const onPointerLeave = () => {
      pointerDown = null;
      setPreviewAnchor(null);
      if (hoveredRef.current !== null) {
        hoveredRef.current = null;
        onHoverRef.current(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e"].includes(key)) return;
      event.preventDefault();
      const distance = camera.position.distanceTo(controls.target);
      const step = Math.max(0.025, distance * (event.shiftKey ? 0.08 : 0.035));
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const delta = new THREE.Vector3();
      if (key === "w") delta.addScaledVector(forward, step);
      if (key === "s") delta.addScaledVector(forward, -step);
      if (key === "a") delta.addScaledVector(right, -step);
      if (key === "d") delta.addScaledVector(right, step);
      if (key === "q") delta.addScaledVector(up, -step);
      if (key === "e") delta.addScaledVector(up, step);
      camera.position.add(delta);
      controls.target.add(delta);
      scheduleViewRender();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onControlsEnd = () => scheduleLodRefinement(0);

    renderer.domElement.tabIndex = 0;
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("keydown", onKeyDown);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    controls.addEventListener("change", scheduleViewRender);
    controls.addEventListener("end", onControlsEnd);

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      treeMaterial.resolution.set(width, height);
      cliffMaterial.resolution.set(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      scheduleViewRender();
    });
    resizeObserver.observe(host);

    runtimeRef.current = {
      updatePositions,
      updateHovered,
      updateSelected,
      updatePreview,
      updatePointScale,
      updateTreeLineScale,
      updateClusters,
      updateCliffs,
      cancelSelection,
      selectPolygon,
    };
    updateSelected(selected, false);
    updateHovered(hovered, false);
    renderView();
    scheduleLodRefinement(0);

    return () => {
      runtimeRef.current = null;
      lodGeneration += 1;
      selectionGeneration += 1;
      resizeObserver.disconnect();
      controls.removeEventListener("change", scheduleViewRender);
      controls.removeEventListener("end", onControlsEnd);
      if (viewRenderFrame) window.cancelAnimationFrame(viewRenderFrame);
      if (lodSettleTimer) window.clearTimeout(lodSettleTimer);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      geometry.dispose();
      points.material.dispose();
      treeGeometry.dispose();
      treeMaterial.dispose();
      cliffGeometry.dispose();
      cliffMaterial.dispose();
      selectedPoints.geometry.dispose();
      selectedPoints.material.dispose();
      hoveredPoints.geometry.dispose();
      hoveredPoints.material.dispose();
      grid.geometry.dispose();
      disposeMaterial(grid.material);
      axes.geometry.dispose();
      disposeMaterial(axes.material);
      pointTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [methodLabel, sourceRecordIds, treeEdges]);

  useEffect(() => runtimeRef.current?.updatePositions(positions), [positions]);
  useEffect(() => runtimeRef.current?.updateSelected(selected), [selected]);
  useEffect(() => runtimeRef.current?.updateHovered(hovered), [hovered]);
  useEffect(() => runtimeRef.current?.updatePreview(preview), [preview]);
  useEffect(() => runtimeRef.current?.updatePointScale(pointScale), [pointScale]);
  useEffect(() => runtimeRef.current?.updateTreeLineScale(treeLineScale), [treeLineScale]);
  useEffect(() => runtimeRef.current?.updateClusters(clusterIds), [clusterIds]);
  useEffect(() => runtimeRef.current?.updateClusters(clusterIdsRef.current), [pointColors]);
  useEffect(() => runtimeRef.current?.updateCliffs(cliffEdges), [cliffEdges]);

  useEffect(() => {
    const canvas = lassoCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * pixelRatio);
    canvas.height = Math.round(rect.height * pixelRatio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    if (lasso.length < 2) return;
    context.beginPath();
    context.moveTo(lasso[0].x, lasso[0].y);
    for (const point of lasso.slice(1)) context.lineTo(point.x, point.y);
    context.strokeStyle = getComputedStyle(canvas).getPropertyValue("--primary").trim() || "#af52de";
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.stroke();
  }, [lasso]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-muted/20">
      <div ref={hostRef} className="absolute inset-0" />
      <canvas
        ref={lassoCanvasRef}
        className={tool === "lasso" ? "absolute inset-0 size-full touch-none cursor-crosshair" : "pointer-events-none absolute inset-0 size-full"}
        aria-label="3D chemical-space lasso surface"
        onPointerDown={(event) => {
          if (tool !== "lasso") return;
          event.currentTarget.setPointerCapture(event.pointerId);
          lassoSelectionGenerationRef.current += 1;
          runtimeRef.current?.cancelSelection();
          setSelecting(false);
          const point = localCanvasPoint(event);
          lassoRef.current = [point];
          setLasso([point]);
        }}
        onPointerMove={(event) => {
          if (tool !== "lasso" || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const point = localCanvasPoint(event);
          const previous = lassoRef.current.at(-1);
          if (
            lassoRef.current.length < MAX_LASSO_POINTS
            && (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) >= 2)
          ) {
            lassoRef.current.push(point);
            if (!lassoPaintFrameRef.current) {
              lassoPaintFrameRef.current = window.requestAnimationFrame(() => {
                lassoPaintFrameRef.current = 0;
                setLasso(lassoRef.current.slice());
              });
            }
          }
        }}
        onPointerUp={() => {
          const polygon = simplifyLassoPolygon(lassoRef.current);
          lassoRef.current = [];
          if (lassoPaintFrameRef.current) {
            window.cancelAnimationFrame(lassoPaintFrameRef.current);
            lassoPaintFrameRef.current = 0;
          }
          setLasso([]);
          if (polygon.length < 3 || !runtimeRef.current) {
            setSelecting(false);
            onSelectRef.current([]);
            return;
          }
          const generation = lassoSelectionGenerationRef.current + 1;
          lassoSelectionGenerationRef.current = generation;
          setSelecting(true);
          void runtimeRef.current.selectPolygon(polygon).then((sourceRecordIds) => {
            if (generation !== lassoSelectionGenerationRef.current) return;
            setSelecting(false);
            onSelectRef.current(sourceRecordIds);
          });
        }}
        onPointerCancel={() => {
          lassoSelectionGenerationRef.current += 1;
          runtimeRef.current?.cancelSelection();
          lassoRef.current = [];
          if (lassoPaintFrameRef.current) {
            window.cancelAnimationFrame(lassoPaintFrameRef.current);
            lassoPaintFrameRef.current = 0;
          }
          setLasso([]);
          setSelecting(false);
        }}
      />
      {preview && hovered === preview.sourceRecordId && previewAnchor ? (
        <div
          className="pointer-events-none absolute w-52 overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
          style={{
            left: `clamp(8px, ${previewAnchor.x + 12}px, calc(100% - 220px))`,
            top: `clamp(8px, ${previewAnchor.y + 12}px, calc(100% - 188px))`,
          }}
        >
          {preview.svgUrl ? <img className="h-28 w-full rounded-lg bg-white object-contain" src={preview.svgUrl} alt="" /> : null}
          <div className="mt-1 truncate text-xs font-medium">{preview.name}</div>
          {preview.smiles ? <div className="truncate font-mono text-[10px] text-muted-foreground">{preview.smiles}</div> : null}
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
        {selecting ? "Selecting molecules…" : `${selected.size.toLocaleString()} selected`}
        {" · drag to orbit · WASD+QE to fly · wheel to zoom"}
      </div>
      {hasClusters ? (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
          Colored by Butina cluster
        </div>
      ) : null}
    </div>
  );
}

function overlayPoints(color: THREE.Color, texture: THREE.Texture, size: number) {
  return new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      color,
      map: texture,
      alphaTest: 0.15,
      size,
      sizeAttenuation: true,
      transparent: true,
    }),
  );
}

function addProjectedCandidate(
  buckets: Map<string, ProjectedPoint[]>,
  candidate: ProjectedPoint,
) {
  const key = `${
    Math.floor(candidate.x / PROJECTED_HOVER_CELL_SIZE)
  }:${Math.floor(candidate.y / PROJECTED_HOVER_CELL_SIZE)}`;
  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, [candidate]);
    return;
  }
  if (bucket.length < MAX_PROJECTED_POINTS_PER_CELL) {
    bucket.push(candidate);
    return;
  }
  let farthestIndex = 0;
  for (let index = 1; index < bucket.length; index += 1) {
    if (bucket[index].depth > bucket[farthestIndex].depth) farthestIndex = index;
  }
  if (candidate.depth < bucket[farthestIndex].depth) bucket[farthestIndex] = candidate;
}

function boundedSubset(indices: number[], limit: number) {
  if (indices.length <= limit) return indices;
  return representativePointIndices(indices.length, limit).map((index) => indices[index]);
}

function adaptivePointScale(recordCount: number) {
  return Math.max(0.45, Math.min(1, Math.sqrt(1_000 / Math.max(1_000, recordCount))));
}

function adaptivePointOpacity(recordCount: number) {
  return Math.max(0.48, Math.min(0.82, 0.82 * Math.sqrt(2_500 / Math.max(2_500, recordCount))));
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
}

function updateOverlayGeometry(
  geometry: THREE.BufferGeometry,
  indices: number[],
  positions: Array<[number, number, number]>,
) {
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(indices.flatMap((index) => positions[index] ?? []), 3),
  );
  geometry.computeBoundingSphere();
}

function semanticColor(host: HTMLElement, className: string, fallback: string) {
  const probe = document.createElement("span");
  probe.className = className;
  host.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return new THREE.Color(fallback);
  context.fillStyle = value || fallback;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

function circleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 30);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.72, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function localCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
