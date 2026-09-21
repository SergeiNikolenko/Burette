import type { MesoscaleAction, MesoscaleClipShape, MesoscaleHierarchyObject } from "../../lib/mesoscale-contract";
import { mesoscaleFrameGeneration, requestMesoscale, setMesoscaleVisibilityOptimistic } from "../../stores/mesoscale-store";
import type { MenuItemSpec } from "../menu-types";
import { showNativeContextMenu } from "../native-context-menu";

const MESOSCALE_COLORS = ["#af52de", "#0a84ff", "#40c8e0", "#32d74b", "#ffd60a", "#ff9f0a", "#ff453a", "#ff6482", "#98989d", "#f2f2f7"];
const mutationQueues = new Map<string, Promise<void>>();

function colorHex(color: number | null) {
  return color === null ? null : `#${color.toString(16).padStart(6, "0")}`;
}

function queueMutation(documentId: string, action: MesoscaleAction, generation = mesoscaleFrameGeneration(documentId)) {
  const previous = mutationQueues.get(documentId) ?? Promise.resolve();
  const next = previous
    .then(() => mesoscaleFrameGeneration(documentId) === generation ? requestMesoscale(documentId, action) : undefined)
    .then(() => undefined, () => undefined);
  mutationQueues.set(documentId, next);
  void next.then(() => {
    if (mutationQueues.get(documentId) === next) mutationQueues.delete(documentId);
  });
}

function appearanceMenu(documentId: string, item: MesoscaleHierarchyObject, bulk: boolean, selectedCount: number, selectionVersion?: number): MenuItemSpec[] {
  const activeColor = colorHex(item.color) ?? undefined;
  const generation = mesoscaleFrameGeneration(documentId);
  let pendingValues: { color?: number; opacity?: number; emissive?: number } = {};
  let pendingTimer = 0;
  const apply = (values: { color?: number; opacity?: number; emissive?: number }) => {
    pendingValues = { ...pendingValues, ...values };
    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      const next = pendingValues;
      pendingValues = {};
      queueMutation(documentId, bulk
        ? { type: "setSelectionStyle", ...next, selectionVersion }
        : { type: "setStyle", ref: item.ref, ...next }, generation);
    }, 80);
  };
  return [
    { kind: "label", id: "mesoscale-appearance-label", text: bulk ? `Appearance · ${selectedCount} structures` : `Appearance · ${item.label}` },
    { kind: "swatches", id: "mesoscale-colors", colors: MESOSCALE_COLORS, activeColor, label: "Color", action: (color) => apply({ color: Number.parseInt(color.slice(1), 16) }) },
    { kind: "number", id: "mesoscale-opacity", label: "Opacity", value: item.opacity ?? 1, min: 0, max: 1, step: 0.05, action: (opacity) => apply({ opacity }) },
    { kind: "number", id: "mesoscale-emissive", label: "Emissive", value: item.emissive ?? 0, min: 0, max: 1, step: 0.05, action: (emissive) => apply({ emissive }) },
  ];
}

// Mol* cuts an object with a single clip shape, so the menu names the shape and
// the runtime places it against the scene bounds. "None" removes the cut again.
function clipMenu(documentId: string, item: MesoscaleHierarchyObject): MenuItemSpec[] {
  const clip = (shape: MesoscaleClipShape, invert = false) => queueMutation(documentId, { type: "setClip", ref: item.ref, shape, invert });
  return [
    { kind: "item", id: "mesoscale-clip-none", text: "No clip", action: () => clip("none") },
    { kind: "separator" },
    { kind: "item", id: "mesoscale-clip-plane", text: "Plane", action: () => clip("plane") },
    { kind: "item", id: "mesoscale-clip-sphere", text: "Sphere", action: () => clip("sphere") },
    { kind: "item", id: "mesoscale-clip-cube", text: "Cube", action: () => clip("cube") },
    { kind: "item", id: "mesoscale-clip-cylinder", text: "Cylinder", action: () => clip("cylinder") },
    { kind: "separator" },
    { kind: "item", id: "mesoscale-clip-sphere-invert", text: "Sphere, inverted", action: () => clip("sphere", true) },
    { kind: "item", id: "mesoscale-clip-cube-invert", text: "Cube, inverted", action: () => clip("cube", true) },
  ];
}

export function showMesoscaleAppearanceMenu(documentId: string, item: MesoscaleHierarchyObject, point: { x: number; y: number }) {
  return showNativeContextMenu(appearanceMenu(documentId, item, false, 1), point, { forceWeb: true });
}

export function showMesoscaleObjectMenu(
  documentId: string,
  item: MesoscaleHierarchyObject,
  selectedCount: number,
  point: { x: number; y: number },
  selectionVersion?: number,
) {
  const bulk = item.selected && selectedCount > 1;
  const run = (action: MesoscaleAction) => void requestMesoscale(documentId, action).catch(() => undefined);
  const setVisible = (visible: boolean) => {
    setMesoscaleVisibilityOptimistic(documentId, item.ref, !visible);
    void requestMesoscale(documentId, { type: "setVisibility", ref: item.ref, visible })
      .catch(() => setMesoscaleVisibilityOptimistic(documentId, item.ref, visible));
  };
  const selectionItems: MenuItemSpec[] = bulk
    ? [
        { kind: "item", id: "mesoscale-isolate-selection", text: "Isolate Selection", action: () => run({ type: "isolateSelection" }) },
        { kind: "item", id: "mesoscale-hide-selection", text: "Hide Selection", action: () => run({ type: "setSelectionVisibility", visible: false }) },
        { kind: "item", id: "mesoscale-show-selection", text: "Show Selection", action: () => run({ type: "setSelectionVisibility", visible: true }) },
        { kind: "separator" },
        { kind: "item", id: "mesoscale-clear-selection", text: "Clear Selection", action: () => run({ type: "setSelection", mode: "clear" }) },
      ]
    : [
        { kind: "item", id: "mesoscale-select", text: item.kind === "group" ? "Select all in group" : "Select", disabled: item.kind === "mesh", action: () => run({ type: "setSelection", ref: item.ref, mode: "replace" }) },
        { kind: "item", id: "mesoscale-add-selection", text: "Add to Selection", disabled: item.kind === "mesh", action: () => run({ type: "setSelection", ref: item.ref, mode: "extend" }) },
        { kind: "item", id: "mesoscale-toggle-selection", text: item.selected ? "Remove from Selection" : "Toggle Selection", disabled: item.kind === "mesh", action: () => run({ type: "setSelection", ref: item.ref, mode: "toggle" }) },
        ...(item.selected ? [
          { kind: "separator" as const },
          { kind: "item" as const, id: "mesoscale-clear-selection", text: "Clear Selection", action: () => run({ type: "setSelection", mode: "clear" }) },
        ] : []),
      ];
  const items: MenuItemSpec[] = [
    { kind: "label", id: "mesoscale-object-label", text: bulk ? `Selection · ${selectedCount} structures` : `${item.kind === "group" ? "Group" : "Structure"} · ${item.label}` },
    { kind: "submenu", id: "mesoscale-appearance", text: "Appearance", items: appearanceMenu(documentId, item, bulk, selectedCount, selectionVersion) },
    { kind: "submenu", id: "mesoscale-selection", text: "Selection", items: selectionItems },
    { kind: "submenu", id: "mesoscale-clip", text: "Clip", disabled: item.kind === "mesh", items: clipMenu(documentId, item) },
    { kind: "separator" },
    { kind: "item", id: "mesoscale-focus", text: "Focus", disabled: item.kind === "mesh", action: () => run({ type: "focusObject", ref: item.ref }) },
    { kind: "item", id: "mesoscale-isolate", text: bulk ? "Isolate Selection" : "Isolate", action: () => run(bulk ? { type: "isolateSelection" } : { type: "isolateObjects", refs: [item.ref] }) },
    { kind: "item", id: "mesoscale-visibility", text: item.hidden ? "Show" : "Hide", action: () => setVisible(item.hidden) },
  ];
  return showNativeContextMenu(items, point, { forceWeb: true });
}
