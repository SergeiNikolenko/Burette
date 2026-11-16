import { useMemo } from "react";
import { contourSegments, type GridSlice } from "../../lib/molecular-workbench/scalar-field-ops";
import type { MolecularAtom, Vec3 } from "../../lib/molecular-workbench/types";

// The scene colours the same plane red at the range minimum through white to blue at its maximum.
const STOPS: Array<[number, number, number]> = [[0xd6, 0x27, 0x28], [0xf7, 0xf7, 0xf7], [0x1f, 0x63, 0xd1]];

function colour(value: number, min: number, max: number, out: Uint8ClampedArray, at: number) {
  const t = Math.min(1, Math.max(0, (value - min) / (max - min))) * 2;
  const k = Math.min(1, Math.floor(t)), f = t - k;
  for (let c = 0; c < 3; c++) out[at + c] = STOPS[k][c] + (STOPS[k + 1][c] - STOPS[k][c]) * f;
  out[at + 3] = 255;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };

/**
 * The slice in its own plane, u to the right and v up, in Å: a colour map of the grid values
 * with contour lines (dashed below zero) and the atoms within half a grid step of the plane.
 */
export function FieldSlicePlot({ slice, atoms, min, max, contours, label }: { slice: GridSlice; atoms: MolecularAtom[]; min: number; max: number; contours: number; label: string }) {
  const frame = useMemo(() => {
    const e1 = unit(slice.u);
    const along = dot(slice.v, e1);
    const e2 = unit([slice.v[0] - along * e1[0], slice.v[1] - along * e1[1], slice.v[2] - along * e1[2]]);
    const normal = unit([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
    // Grid (i, j) to plot coordinates; plot y grows downwards, so v points up.
    const m = [dot(slice.u, e1), -dot(slice.u, e2), dot(slice.v, e1), -dot(slice.v, e2)] as const;
    const corners = [[-0.5, -0.5], [slice.width - 0.5, -0.5], [-0.5, slice.height - 0.5], [slice.width - 0.5, slice.height - 0.5]]
      .map(([i, j]) => [m[0] * i + m[2] * j, m[1] * i + m[3] * j]);
    const xs = corners.map((point) => point[0]), ys = corners.map((point) => point[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const halfStep = Math.abs(dot(slice.normal, normal)) / 2;
    const near = atoms.flatMap((atom) => {
      const d: Vec3 = [atom.x - slice.origin[0], atom.y - slice.origin[1], atom.z - slice.origin[2]];
      return Math.abs(dot(d, normal)) <= halfStep ? [{ element: atom.element, x: dot(d, e1), y: -dot(d, e2) }] : [];
    });
    const outline = `M${corners[0].join(" ")}L${corners[1].join(" ")}L${corners[3].join(" ")}L${corners[2].join(" ")}Z`;
    return { m, box, near, outline };
  }, [slice, atoms]);

  const image = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = slice.width; canvas.height = slice.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const pixels = context.createImageData(slice.width, slice.height);
    for (let k = 0; k < slice.values.length; k++) colour(slice.values[k], min, max, pixels.data, k * 4);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL();
  }, [slice, min, max]);

  const lines = useMemo(() => Array.from({ length: contours }, (_, k) => {
    const level = min + (k + 1) * (max - min) / (contours + 1);
    const segments = contourSegments(slice, level);
    let path = "";
    for (let s = 0; s < segments.length; s += 4) path += `M${segments[s].toFixed(3)} ${segments[s + 1].toFixed(3)}L${segments[s + 2].toFixed(3)} ${segments[s + 3].toFixed(3)}`;
    return { level, path };
  }), [slice, min, max, contours]);

  const { m, box, near, outline } = frame;
  const size = Math.max(box.width, box.height);
  const matrix = `matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} 0 0)`;
  return (
    <svg className="field-slice-plot" role="img" aria-label={`Slice of ${label}`} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} preserveAspectRatio="xMidYMid meet">
      {image ? <image href={image} width={slice.width} height={slice.height} preserveAspectRatio="none"
        transform={`matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${-0.5 * (m[0] + m[2])} ${-0.5 * (m[1] + m[3])})`} /> : null}
      <g transform={matrix}>
        {lines.map(({ level, path }) => path ? <path key={level} d={path} className="field-slice-contour" data-negative={level < 0 || undefined} /> : null)}
      </g>
      <path d={outline} className="field-slice-frame" />
      {near.map((atom, k) => (
        <g key={k} className="field-slice-atom">
          <circle cx={atom.x} cy={atom.y} r={size * 0.012} />
          <text x={atom.x} y={atom.y - size * 0.025} fontSize={size * 0.04}>{atom.element}</text>
        </g>
      ))}
    </svg>
  );
}
