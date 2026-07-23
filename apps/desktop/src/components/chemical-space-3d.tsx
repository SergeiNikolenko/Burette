import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Point2 = { x: number; y: number };
type ProjectedPoint = Point2 & { sourceRecordId: number };
type MoleculePreview = {
  sourceRecordId: number;
  name: string;
  smiles: string;
  svgUrl: string | null;
};

type ChemicalSpace3DProps = {
  positions: Array<[number, number, number]>;
  sourceRecordIds: number[];
  selected: Set<number>;
  hovered: number | null;
  preview: MoleculePreview | null;
  pointScale: number;
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
};

const MAX_LASSO_POINTS = 4_096;
const BASE_POINT_SIZE = 0.055;
const BASE_SELECTED_POINT_SIZE = 0.09;
const BASE_HOVERED_POINT_SIZE = 0.13;

export function ChemicalSpace3D({
  positions,
  sourceRecordIds,
  selected,
  hovered,
  preview,
  pointScale,
  tool,
  methodLabel,
  onHover,
  onSelect,
}: ChemicalSpace3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const lassoCanvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ThreeRuntime | null>(null);
  const projectedRef = useRef<ProjectedPoint[]>([]);
  const lassoRef = useRef<Point2[]>([]);
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);
  const previewRef = useRef(preview);
  const positionsRef = useRef(positions);
  const selectedRef = useRef(selected);
  const hoveredRef = useRef(hovered);
  const [lasso, setLasso] = useState<Point2[]>([]);
  const [previewAnchor, setPreviewAnchor] = useState<Point2 | null>(null);

  onHoverRef.current = onHover;
  onSelectRef.current = onSelect;
  previewRef.current = preview;
  positionsRef.current = positions;
  selectedRef.current = selected;
  hoveredRef.current = hovered;
  const sourceRecordIdsKey = sourceRecordIds.join(",");

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
    renderer.domElement.setAttribute("aria-keyshortcuts", "W A S D");
    renderer.domElement.setAttribute("role", "application");
    host.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.minDistance = 1.1;
    controls.maxDistance = 12;
    controls.target.set(0, 0, 0);

    const primaryColor = semanticColor(host, "text-primary", "#af52de");
    const foregroundColor = semanticColor(host, "text-foreground", "#f5f5f7");
    const pointColor = semanticColor(host, "text-foreground", "#f5f5f7");
    const pointTexture = circleTexture();
    const densityScale = adaptivePointScale(sourceRecordIds.length);
    const pointOpacity = adaptivePointOpacity(sourceRecordIds.length);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.flat(), 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: pointColor,
      map: pointTexture,
      alphaTest: 0.15,
      opacity: pointOpacity,
      size: BASE_POINT_SIZE * pointScale * densityScale,
      sizeAttenuation: true,
      transparent: true,
    }));
    scene.add(points);

    const selectedPoints = overlayPoints(primaryColor, pointTexture, BASE_SELECTED_POINT_SIZE * pointScale);
    const hoveredPoints = overlayPoints(foregroundColor, pointTexture, BASE_HOVERED_POINT_SIZE * pointScale);
    scene.add(selectedPoints, hoveredPoints);

    const grid = new THREE.GridHelper(2.5, 10, primaryColor, foregroundColor);
    grid.position.y = -1.08;
    grid.material.opacity = 0.3;
    grid.material.transparent = true;
    scene.add(grid);

    const axes = new THREE.AxesHelper(0.32);
    axes.position.set(-1.05, -1.07, -1.05);
    scene.add(axes);

    const indexById = new Map(sourceRecordIds.map((sourceRecordId, index) => [sourceRecordId, index]));
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.075 };
    const pointer = new THREE.Vector2();
    let pointerDown: Point2 | null = null;
    let pointerMoved = false;

    const projectPoints = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      projectedRef.current = positionsRef.current.map((position, index) => {
        const projected = new THREE.Vector3(...position).project(camera);
        return {
          x: (projected.x * 0.5 + 0.5) * width,
          y: (-projected.y * 0.5 + 0.5) * height,
          sourceRecordId: sourceRecordIds[index],
        };
      });
      const activePreview = previewRef.current;
      const anchor = activePreview
        ? projectedRef.current.find((point) => point.sourceRecordId === activePreview.sourceRecordId) ?? null
        : null;
      setPreviewAnchor(anchor);
    };

    const render = () => {
      renderer.render(scene, camera);
      projectPoints();
    };

    const updateSelected = (sourceRecordIds: Set<number>, shouldRender = true) => {
      updateOverlayGeometry(
        selectedPoints.geometry,
        [...sourceRecordIds].map((sourceRecordId) => indexById.get(sourceRecordId)).filter((index): index is number => index !== undefined),
        positionsRef.current,
      );
      if (shouldRender) render();
    };
    const updateHovered = (sourceRecordId: number | null, shouldRender = true) => {
      const index = sourceRecordId === null ? undefined : indexById.get(sourceRecordId);
      updateOverlayGeometry(hoveredPoints.geometry, index === undefined ? [] : [index], positionsRef.current);
      if (shouldRender) render();
    };
    const updatePositions = (nextPositions: Array<[number, number, number]>) => {
      positionsRef.current = nextPositions;
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(nextPositions.flat(), 3));
      geometry.computeBoundingSphere();
      updateSelected(selectedRef.current, false);
      updateHovered(hoveredRef.current, false);
      render();
    };
    const updatePreview = (nextPreview: MoleculePreview | null) => {
      previewRef.current = nextPreview;
      projectPoints();
    };
    const updatePointScale = (nextPointScale: number) => {
      points.material.size = BASE_POINT_SIZE * nextPointScale * densityScale;
      selectedPoints.material.size = BASE_SELECTED_POINT_SIZE * nextPointScale;
      hoveredPoints.material.size = BASE_HOVERED_POINT_SIZE * nextPointScale;
      render();
    };

    const localPoint = (event: PointerEvent): Point2 => {
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const hoverNearest = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersection = raycaster.intersectObject(points, false)[0];
      const sourceRecordId = intersection?.index === undefined ? null : sourceRecordIds[intersection.index] ?? null;
      onHoverRef.current(sourceRecordId);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      renderer.domElement.focus({ preventScroll: true });
      onHoverRef.current(null);
      pointerDown = localPoint(event);
      pointerMoved = false;
    };
    const onPointerMove = (event: PointerEvent) => {
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
      hoverNearest(event);
      const nextHovered = raycaster.intersectObject(points, false)[0]?.index;
      onSelectRef.current(nextHovered === undefined ? [] : [sourceRecordIds[nextHovered]]);
    };
    const onPointerLeave = () => {
      pointerDown = null;
      onHoverRef.current(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d"].includes(key)) return;
      event.preventDefault();
      const distance = camera.position.distanceTo(controls.target);
      const step = Math.max(0.025, distance * (event.shiftKey ? 0.08 : 0.035));
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const delta = new THREE.Vector3();
      if (key === "w") delta.addScaledVector(up, step);
      if (key === "s") delta.addScaledVector(up, -step);
      if (key === "a") delta.addScaledVector(right, -step);
      if (key === "d") delta.addScaledVector(right, step);
      camera.position.add(delta);
      controls.target.add(delta);
      render();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    renderer.domElement.tabIndex = 0;
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("keydown", onKeyDown);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    controls.addEventListener("change", render);

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    });
    resizeObserver.observe(host);

    runtimeRef.current = {
      updatePositions,
      updateHovered,
      updateSelected,
      updatePreview,
      updatePointScale,
    };
    updateSelected(selected);
    updateHovered(hovered);
    render();

    return () => {
      runtimeRef.current = null;
      resizeObserver.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      geometry.dispose();
      points.material.dispose();
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
  }, [methodLabel, sourceRecordIdsKey]);

  useEffect(() => runtimeRef.current?.updatePositions(positions), [positions]);
  useEffect(() => runtimeRef.current?.updateSelected(selected), [selected]);
  useEffect(() => runtimeRef.current?.updateHovered(hovered), [hovered]);
  useEffect(() => runtimeRef.current?.updatePreview(preview), [preview]);
  useEffect(() => runtimeRef.current?.updatePointScale(pointScale), [pointScale]);

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
            lassoRef.current = [...lassoRef.current, point];
            setLasso(lassoRef.current);
          }
        }}
        onPointerUp={() => {
          const polygon = lassoRef.current;
          const sourceRecordIds = polygon.length >= 3
            ? projectedRef.current.filter((point) => pointInPolygon(point, polygon)).map((point) => point.sourceRecordId)
            : [];
          lassoRef.current = [];
          setLasso([]);
          onSelect(sourceRecordIds);
        }}
        onPointerCancel={() => {
          lassoRef.current = [];
          setLasso([]);
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
        {selected.size.toLocaleString()} selected · drag to orbit · WASD to pan · wheel to zoom
      </div>
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
