import { useMemo, useRef } from "react";
import type { PreparedGeometryTopology } from "../lib/source-editing/context";
import type { GeometryBinding } from "../lib/geometry-binding";
import { requestViewerAction } from "../lib/viewer-bridge";
import { sha256Hex } from "../lib/source-editing/source-identity";
import { logicalSourceFor } from "../lib/science-session/state";
import { topologyAtomMapping, remapSourcePoints } from "../lib/science-session/atom-provenance";
import { scientificStateFor, type ImportedRevision } from "../lib/workbench/scientific-source-state";
import type { ViewerDocument } from "../types";

type Item = Record<string, unknown> & { points: number[][] };
type Component = Record<string, unknown> & { kind: "static" | "bundle"; indices?: number[] };
type Snapshot = {
  scene: Record<string, unknown> & { atomCount: number; components: Component[]; selection: number[]; camera: unknown };
  measurements: Record<string, unknown> & { items: Item[]; atomCount: number };
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clone = <T,>(value: T): T => structuredClone(value);
function fail(): never { throw new Error("The scene or scientific source changed before topology editing."); }

// The renderer validates every field and refuses unsupported native objects. The host
// additionally validates the exact source/count/provenance and the combined payload bound.
function captured(scene: Record<string, unknown>, measurements: Record<string, unknown>, count: number, hash: string): Snapshot {
  if (scene.version !== 1 || scene.atomCount !== count || !Array.isArray(scene.components) || scene.components.length > 32
    || !Array.isArray(scene.selection) || scene.selection.length > 256 || scene.focus !== null
    || measurements.atomCount !== count || measurements.sourceFormat !== "xyz" || measurements.sourceSha256 !== hash
    || !Array.isArray(measurements.items) || measurements.items.length > 32) fail();
  const indices = (value: unknown): number[] => {
    if (!Array.isArray(value) || value.length > 256 || new Set(value).size !== value.length
      || value.some(n => !Number.isInteger(n) || n < 0 || n >= count)) fail();
    return value;
  };
  const components = scene.components.map((component): Component => {
    if (!object(component) || (component.kind !== "static" && component.kind !== "bundle")) fail();
    return { ...component, kind: component.kind, ...(component.kind === "bundle" ? { indices: indices(component.indices) } : {}) };
  });
  const items = measurements.items.map((item): Item => {
    if (!object(item) || !Array.isArray(item.points) || item.points.length > 8) fail();
    return { ...item, points: item.points.map(indices) };
  });
  const { receipt: _receipt, ...transfer } = scene;
  return clone({ scene: { ...transfer, atomCount: count, components, selection: indices(scene.selection), camera: scene.camera },
    measurements: { atomCount: count, items, group: measurements.group,
      ...(measurements.groupParams === undefined ? {} : { groupParams: measurements.groupParams }),
      ...(measurements.groupTags === undefined ? {} : { groupTags: measurements.groupTags }) } });
}

export function useTopologyTransfer() {
  // Actual logical-source and revision object lifetimes own snapshots, including deleted objects restored by Undo.
  // Closing/replacing a source releases its revisions; no second document registry is retained.
  const snapshots = useRef(new WeakMap<object, WeakMap<ImportedRevision, Snapshot>>());
  const preparedEdits = useRef(new WeakSet<PreparedGeometryTopology>());
  return useMemo(() => ({
    owns: (prepared: PreparedGeometryTopology) => preparedEdits.current.has(prepared),
    prepare: async (document: ViewerDocument, target: ImportedRevision, binding: GeometryBinding, isCurrent: () => boolean) => {
      const owner = logicalSourceFor(document.id);
      if (!owner || owner.extension !== "xyz" || !isCurrent() || !binding.target.isCurrent()) fail();
      let history = snapshots.current.get(owner);
      if (!history) { history = new WeakMap(); snapshots.current.set(owner, history); }
      const source = scientificStateFor(document.id, binding.text), from = source.revision;
      if (!from || !source.revisions) fail();
      const mapping = topologyAtomMapping(source.revisions, from, target);
      const current = () => isCurrent() && logicalSourceFor(document.id) === owner && binding.target.isCurrent()
        && scientificStateFor(document.id, binding.text).revision === from
        && scientificStateFor(document.id, binding.text).original === source.original;
      if (!current()) fail();
      const scene = await requestViewerAction(document.id, { type: "geometry_topology_scene_capture", label: "Geometry", notify: false, lease: binding.lease }, 5000, undefined, { target: binding.target });
      if (!current() || typeof scene.receipt !== "string" || !scene.receipt || scene.receipt.length > 128) fail();
      const receipt = scene.receipt;
      const [hash, targetHash] = await Promise.all([sha256Hex(binding.text), sha256Hex(target.text)]);
      if (!current()) fail();
      const measurements = await requestViewerAction(document.id, { type: "measurement_preview_capture", label: "Geometry", notify: false, sourceExtension: "xyz", lease: binding.lease }, 5000, undefined, { target: binding.target });
      if (!current()) fail();
      const baseline = captured(scene, measurements, from.document.atoms.length, hash);
      const validate = async (guard: () => boolean, signal?: AbortSignal) => {
        if (!guard() || !binding.target.isCurrent() || signal?.aborted) fail();
        await requestViewerAction(document.id, { type: "geometry_topology_scene_validate", label: "Geometry", notify: false, receipt, lease: binding.lease }, 5000, signal, { target: binding.target });
        if (!guard() || !binding.target.isCurrent() || signal?.aborted) fail();
      };
      await validate(current);
      const previous = history.get(from), cached = history.get(target), next = clone(baseline);
      history.set(from, baseline);
      const inverse = new Map(mapping.flatMap((old, index) => old < 0 ? [] : [[old, index] as const]));
      const surviving = (indices: number[]) => indices.flatMap(index => inverse.has(index) ? [inverse.get(index)!] : []).sort((a, b) => a - b);
      next.measurements.items = next.measurements.items.flatMap(item => {
        const points = remapSourcePoints(item.points, mapping, baseline.scene.atomCount);
        return points ? [{ ...item, points: points.map(point => point.sort((a, b) => a - b)) }] : [];
      });
      next.scene.components = next.scene.components.flatMap(component => {
        if (component.kind !== "bundle") return [component];
        const indices = surviving(component.indices ?? []);
        return indices.length ? [{ ...component, indices }] : [];
      });
      next.scene.selection = surviving(next.scene.selection);
      if (cached) {
        // Only objects whose anchors did not exist in the current scene reappear.
        // Surviving objects keep their current settings; duplicate measurements need no guessed matching.
        const restored = cached.measurements.items.filter(item => item.points.some(point => point.some(index => mapping[index] === -1)));
        next.measurements.items.push(...clone(restored));
        if (restored.length && !baseline.measurements.items.length && baseline.measurements.groupParams === undefined
          && object(baseline.measurements.group) && Object.values(baseline.measurements.group).every(value => value === false)) {
          next.measurements.group = clone(cached.measurements.group);
          if (cached.measurements.groupParams !== undefined) next.measurements.groupParams = clone(cached.measurements.groupParams);
          if (cached.measurements.groupTags !== undefined) next.measurements.groupTags = clone(cached.measurements.groupTags);
        }
        for (const layer of cached.scene.components.filter(component => component.kind === "bundle")) {
          const restoredAtoms = layer.indices!.filter(index => mapping[index] === -1);
          if (!restoredAtoms.length) continue;
          const current = next.scene.components.find(component => component.kind === "bundle" && component.layerId === layer.layerId);
          if (current) current.indices = [...new Set([...current.indices!, ...restoredAtoms])].sort((a, b) => a - b);
          else if (!previous?.scene.components.some(component => component.kind === "bundle" && component.layerId === layer.layerId)) next.scene.components.push(clone(layer));
        }
        if (previous && JSON.stringify(previous.scene.selection) === JSON.stringify(baseline.scene.selection)) {
          next.scene.selection = [...new Set([...next.scene.selection, ...cached.scene.selection.filter(index => mapping[index] === -1)])].sort((a, b) => a - b);
        }
      }
      next.scene.atomCount = next.measurements.atomCount = target.document.atoms.length;
      // Topology Undo restores object definitions, while retaining the user's current viewpoint.
      next.scene.camera = baseline.scene.camera;
      const rendererViewState = JSON.stringify({ version: 1, topologyScene: next.scene,
        measurementTransfer: { ...next.measurements, version: 1, sourceFormat: "xyz", targetSourceSha256: targetHash } });
      if (new TextEncoder().encode(rendererViewState).byteLength > 8192) throw new Error("There are too many scene settings to retain. Remove some layers or measurements before editing.");
      const prepared: PreparedGeometryTopology = Object.freeze({ fromText: binding.text, text: target.text, rendererViewState,
        selection: next.scene.selection, canPublish: current, validate,
        accepted: () => { history.set(target, next); } });
      preparedEdits.current.add(prepared);
      return prepared;
    },
  }), []);
}
