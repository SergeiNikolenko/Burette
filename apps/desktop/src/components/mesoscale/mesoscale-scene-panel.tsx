import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronRight, Download, Eye, EyeOff, Focus, Plus, Trash2 } from "lucide-react";
import type { ViewerDocument } from "../../types";
import { loadMesoscaleHierarchy, previewMesoscaleObject, requestMesoscale, setMesoscaleVisibilityOptimistic, useMesoscaleStore } from "../../stores/mesoscale-store";
import type { MesoscaleHierarchyObject } from "../../lib/mesoscale-contract";
import { showNativeContextMenu } from "../native-context-menu";
import type { MenuItemSpec } from "../menu-types";

type SceneSection = "objects" | "snapshots" | "export";
type SetStyleAction = Extract<Parameters<typeof requestMesoscale>[1], { type: "setStyle" }>;

const MESOSCALE_COLORS = ["#af52de", "#0a84ff", "#40c8e0", "#32d74b", "#ffd60a", "#ff9f0a", "#ff453a", "#ff6482", "#98989d", "#f2f2f7"];
const styleQueues = new Map<string, Promise<void>>();
const GROUP_LONG_PRESS_MS = 520;
const GROUP_LONG_PRESS_MOVE_PX = 6;

function colorHex(color: number | null) {
  return color === null ? null : `#${color.toString(16).padStart(6, "0")}`;
}

function queueStyleChange(documentId: string, action: SetStyleAction) {
  const previous = styleQueues.get(documentId) ?? Promise.resolve();
  const next = previous
    .then(() => requestMesoscale(documentId, action))
    .then(() => undefined, () => undefined);
  styleQueues.set(documentId, next);
  void next.then(() => {
    if (styleQueues.get(documentId) === next) styleQueues.delete(documentId);
  });
}

export function MesoscaleScenePanel({ document }: { document: ViewerDocument }) {
  const session = useMesoscaleStore((state) => state.sessions[document.id]);
  const [section, setSection] = useState<SceneSection>("objects");
  const [filter, setFilter] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [collapsedRefs, setCollapsedRefs] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => sceneTree(session?.hierarchy ?? []), [session?.hierarchy]);

  useEffect(() => {
    if (!session || session.status === "loading" || session.status === "disposed") return;
    const timer = window.setTimeout(() => {
      void loadMesoscaleHierarchy(document.id, filter, 0).catch(() => undefined);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [document.id, filter, session?.status === "loading", session?.status === "disposed"]);

  useEffect(() => () => previewMesoscaleObject(document.id, null), [document.id]);

  const run = (action: Parameters<typeof requestMesoscale>[1]) => requestMesoscale(document.id, action).catch(() => undefined);
  return (
    <div className="mesoscale-panel mesoscale-scene-panel">
      <div className="mesoscale-segmented" role="tablist" aria-label="Scene sections">
        {(["objects", "snapshots", "export"] as SceneSection[]).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={section === item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item[0].toUpperCase() + item.slice(1)}</button>
        ))}
      </div>
      {section === "objects" ? (
        <>
          <input className="mesoscale-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter groups and entities" aria-label="Filter scene objects" />
          <div className="mesoscale-object-summary">
            <span>{session?.hierarchyTotal.toLocaleString() ?? 0} objects</span>
            <span>{session?.summary?.selectedRefs.length ?? 0} selected</span>
          </div>
          <div className="mesoscale-object-tree" role="tree" aria-label="Scene objects" aria-busy={session?.status === "busy"}>
            {tree.map((node) => (
              <SceneObjectBranch
                key={node.item.ref}
                documentId={document.id}
                node={node}
                collapsedRefs={collapsedRefs}
                onToggle={(ref) => setCollapsedRefs((current) => {
                  const next = new Set(current);
                  if (next.has(ref)) next.delete(ref);
                  else next.add(ref);
                  return next;
                })}
              />
            ))}
            {session?.hierarchyNextCursor != null ? (
              <button className="mesoscale-load-more" type="button" onClick={() => void loadMesoscaleHierarchy(document.id, filter, session.hierarchyNextCursor ?? 0).catch(() => undefined)}>Show more</button>
            ) : null}
          </div>
        </>
      ) : null}
      {section === "snapshots" ? (
        <div className="mesoscale-section-stack">
          <div className="mesoscale-inline-form">
            <input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} placeholder="Snapshot name" aria-label="Snapshot name" />
            <button type="button" aria-label="Create snapshot" disabled={!snapshotName.trim()} onClick={() => { void run({ type: "createSnapshot", name: snapshotName.trim() }); setSnapshotName(""); }}><Plus size={15} /></button>
          </div>
          {session?.summary?.snapshots.map((snapshot) => (
            <div className="mesoscale-snapshot-row" key={snapshot.id}>
              <button type="button" className={snapshot.current ? "current" : ""} onClick={() => void run({ type: "applySnapshot", id: snapshot.id })}><Camera size={14} /><span>{snapshot.name}</span></button>
              <button type="button" aria-label={`Delete ${snapshot.name}`} onClick={() => void run({ type: "deleteSnapshot", id: snapshot.id })}><Trash2 size={14} /></button>
            </div>
          ))}
          {!session?.summary?.snapshots.length ? <div className="mesoscale-empty">No snapshots yet</div> : null}
        </div>
      ) : null}
      {section === "export" ? (
        <div className="mesoscale-export-grid">
          <button type="button" onClick={() => void run({ type: "exportPng" })}><Camera size={18} /><span>PNG image</span><small>Current viewport</small></button>
          <button type="button" onClick={() => void run({ type: "exportState", format: "molx" })}><Download size={18} /><span>Mol* state</span><small>Binary .molx</small></button>
          <button type="button" onClick={() => void run({ type: "exportState", format: "molj" })}><Download size={18} /><span>JSON state</span><small>Portable .molj</small></button>
        </div>
      ) : null}
      {session?.error ? <div className="mesoscale-error">{session.error.message}</div> : null}
    </div>
  );
}

type SceneTreeNode = {
  item: MesoscaleHierarchyObject;
  children: SceneTreeNode[];
};

function sceneTree(items: MesoscaleHierarchyObject[]) {
  const nodes = new Map(items.map((item) => [item.ref, { item, children: [] as SceneTreeNode[] }]));
  const roots: SceneTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.item.parentRef ? nodes.get(node.item.parentRef) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function sceneObjectDetail(item: MesoscaleHierarchyObject, childCount: number) {
  if (item.elementCount > 0) return item.elementCount.toLocaleString();
  if (childCount > 0) return `${childCount.toLocaleString()} ${childCount === 1 ? "object" : "objects"}`;
  if (item.instanceCount > 0) return `${item.instanceCount.toLocaleString()} ${item.instanceCount === 1 ? "instance" : "instances"}`;
  const description = item.description.replaceAll("**", "").trim();
  return description && description.toLocaleLowerCase() !== item.label.toLocaleLowerCase() ? description : item.kind;
}

function appearanceMenu(item: MesoscaleHierarchyObject, run: (action: SetStyleAction) => void): MenuItemSpec[] {
  const activeColor = colorHex(item.color) ?? undefined;
  return [
    { kind: "label", id: "mesoscale-appearance-label", text: `Appearance · ${item.label}` },
    { kind: "swatches", id: "mesoscale-colors", colors: MESOSCALE_COLORS, activeColor, label: "Color", action: (color) => run({ type: "setStyle", ref: item.ref, color: Number.parseInt(color.slice(1), 16) }) },
    { kind: "number", id: "mesoscale-opacity", label: "Opacity", value: item.opacity ?? 1, min: 0, max: 1, step: 0.05, action: (opacity) => run({ type: "setStyle", ref: item.ref, opacity }) },
    { kind: "number", id: "mesoscale-emissive", label: "Emissive", value: item.emissive ?? 0, min: 0, max: 1, step: 0.05, action: (emissive) => run({ type: "setStyle", ref: item.ref, emissive }) },
  ];
}

function SceneObjectBranch({
  documentId,
  node,
  collapsedRefs,
  onToggle,
}: {
  documentId: string;
  node: SceneTreeNode;
  collapsedRefs: Set<string>;
  onToggle: (ref: string) => void;
}) {
  const { item, children } = node;
  const hovered = useMesoscaleStore((state) => state.sessions[documentId]?.hoveredRef === item.ref);
  const longPressRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number; timer: number; target: HTMLButtonElement } | null>(null);
  const suppressClickRef = useRef(false);
  const rightMouseDownRef = useRef(0);
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(documentId, action).catch(() => undefined);
  const runStyle = (action: SetStyleAction) => queueStyleChange(documentId, action);
  const collapsed = collapsedRefs.has(item.ref);
  const detail = sceneObjectDetail(item, children.length);
  const ariaDetail = item.elementCount > 0 ? `${detail} elements` : detail;
  const setVisible = (visible: boolean) => {
    setMesoscaleVisibilityOptimistic(documentId, item.ref, !visible);
    void requestMesoscale(documentId, { type: "setVisibility", ref: item.ref, visible })
      .catch(() => setMesoscaleVisibilityOptimistic(documentId, item.ref, visible));
  };
  const showObjectMenu = (point: { x: number; y: number }, bulk = false) => {
    void showNativeContextMenu([
      { kind: "label", id: "mesoscale-object-label", text: `${bulk || item.kind === "group" ? "Group actions" : "Structure actions"} · ${item.label}` },
      ...appearanceMenu(item, runStyle),
      { kind: "separator" },
      { kind: "item", id: "mesoscale-select", text: item.kind === "group" ? "Select all in group" : "Select", disabled: item.kind === "mesh", action: () => run({ type: "setSelection", ref: item.ref, mode: "replace" }) },
      { kind: "item", id: "mesoscale-add-selection", text: "Add to Selection", disabled: item.kind === "mesh", action: () => run({ type: "setSelection", ref: item.ref, mode: "extend" }) },
      { kind: "item", id: "mesoscale-toggle-selection", text: item.selected ? "Remove from Selection" : "Toggle Selection", disabled: item.kind === "mesh", action: () => run({ type: "setSelection", ref: item.ref, mode: "toggle" }) },
      { kind: "separator" },
      { kind: "item", id: "mesoscale-focus", text: "Focus", disabled: item.kind === "mesh", action: () => run({ type: "focusObject", ref: item.ref }) },
      { kind: "item", id: "mesoscale-isolate", text: "Isolate", action: () => run({ type: "isolateObjects", refs: [item.ref] }) },
      { kind: "item", id: "mesoscale-visibility", text: item.hidden ? "Show" : "Hide", action: () => setVisible(item.hidden) },
      ...(item.selected ? [
        { kind: "separator" as const },
        { kind: "item" as const, id: "mesoscale-clear-selection", text: "Clear Selection", action: () => run({ type: "setSelection", mode: "clear" }) },
      ] : []),
    ], point, { forceWeb: true });
  };
  const openContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const now = window.performance.now();
    if (event.type === "contextmenu" && now - rightMouseDownRef.current < 500) return;
    if (event.type === "mousedown") rightMouseDownRef.current = now;
    previewMesoscaleObject(documentId, item.ref);
    showObjectMenu({ x: event.clientX, y: event.clientY });
  };
  const openAppearanceMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(appearanceMenu(item, runStyle), { x: rect.right + 6, y: rect.top }, { forceWeb: true });
  };
  const clearLongPress = () => {
    const press = longPressRef.current;
    if (!press) return;
    window.clearTimeout(press.timer);
    try {
      if (press.target.hasPointerCapture(press.pointerId)) press.target.releasePointerCapture(press.pointerId);
    } catch { /* pointer capture may already be released */ }
    longPressRef.current = null;
  };
  useEffect(() => clearLongPress, []);
  const startLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || item.kind !== "group") return;
    clearLongPress();
    const press = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      timer: 0,
      target: event.currentTarget,
    };
    press.timer = window.setTimeout(() => {
      if (longPressRef.current !== press) return;
      longPressRef.current = null;
      suppressClickRef.current = true;
      try {
        if (press.target.hasPointerCapture(press.pointerId)) press.target.releasePointerCapture(press.pointerId);
      } catch { /* pointer capture may already be released */ }
      previewMesoscaleObject(documentId, item.ref);
      void requestMesoscale(documentId, { type: "setSelection", ref: item.ref, mode: "replace" })
        .then(() => showObjectMenu({ x: press.x, y: press.y }, true), () => undefined);
    }, GROUP_LONG_PRESS_MS);
    longPressRef.current = press;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = longPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - press.startX) > GROUP_LONG_PRESS_MOVE_PX || Math.abs(event.clientY - press.startY) > GROUP_LONG_PRESS_MOVE_PX) clearLongPress();
  };
  const actualColor = colorHex(item.color);
  return (
    <div
      className="mesoscale-tree-branch"
      role="treeitem"
      aria-expanded={children.length > 0 ? !collapsed : undefined}
      aria-selected={item.selected}
    >
      <div
        className={`mesoscale-object-row${item.selected ? " selected" : ""}${hovered ? " hovered" : ""}`}
        data-kind={item.kind}
        onMouseDown={(event) => { if (event.button === 2) openContextMenu(event); }}
        onPointerEnter={() => previewMesoscaleObject(documentId, item.ref)}
        onPointerLeave={() => previewMesoscaleObject(documentId, null)}
        onContextMenu={openContextMenu}
      >
        {children.length > 0 ? (
          <button type="button" className="mesoscale-tree-disclosure" aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.label}`} onClick={() => onToggle(item.ref)}>
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : <span className="mesoscale-tree-leaf" aria-hidden="true" />}
        <button
          type="button"
          className="mesoscale-object-main"
          aria-label={`${item.label}, ${ariaDetail}`}
          disabled={item.kind === "mesh"}
          onPointerDown={startLongPress}
          onPointerMove={moveLongPress}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            run({ type: "setSelection", ref: item.ref, mode: "replace" });
          }}
          onDoubleClick={() => run({ type: "focusObject", ref: item.ref })}
          onFocus={() => previewMesoscaleObject(documentId, item.ref)}
          onBlur={() => previewMesoscaleObject(documentId, null)}
        >
          <span className="mesoscale-tree-bar" data-kind={item.kind} style={actualColor ? { backgroundColor: actualColor } : undefined} aria-hidden="true" />
          <strong>{item.label}</strong>
          <small>{detail}</small>
        </button>
        <button className="mesoscale-tree-color" type="button" aria-label={`Color ${item.label}`} title={`Color ${item.label}`} style={actualColor ? { backgroundColor: actualColor } : undefined} onClick={openAppearanceMenu} />
        <button className="mesoscale-tree-action" type="button" disabled={item.kind === "mesh"} aria-label={`Focus ${item.label}`} title="Focus" onClick={() => run({ type: "focusObject", ref: item.ref })}><Focus size={14} /></button>
        <button
          className="mesoscale-tree-action"
          type="button"
          aria-label={`${item.hidden ? "Show" : "Hide"} ${item.label}`}
          title={item.hidden ? "Show" : "Hide"}
          onClick={() => setVisible(item.hidden)}
        >
          {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {children.length > 0 && !collapsed ? (
        <div className="mesoscale-tree-group" role="group">
          {children.map((child) => <SceneObjectBranch key={child.item.ref} documentId={documentId} node={child} collapsedRefs={collapsedRefs} onToggle={onToggle} />)}
        </div>
      ) : null}
    </div>
  );
}
