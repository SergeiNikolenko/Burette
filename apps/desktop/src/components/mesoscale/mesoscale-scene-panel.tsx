import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Focus } from "lucide-react";
import type { ViewerDocument } from "../../types";
import { loadMesoscaleHierarchy, previewMesoscaleObject, requestMesoscale, setMesoscaleVisibilityOptimistic, useMesoscaleStore } from "../../stores/mesoscale-store";
import type { MesoscaleHierarchyDetail, MesoscaleHierarchyObject, MesoscaleHierarchySelector } from "../../lib/mesoscale-contract";
import { showMesoscaleAppearanceMenu, showMesoscaleObjectMenu } from "./mesoscale-object-menu";
import { inclusiveMesoscaleTreeRange, mesoscaleTreeSelectionError } from "./mesoscale-tree-selection";

type SceneTreeNode = {
  item: MesoscaleHierarchyObject;
  children: SceneTreeNode[];
};

type TreeSelectionDrag = {
  pointerId: number;
  startRef: string;
  currentRef: string;
  startX: number;
  startY: number;
  additive: boolean;
  moved: boolean;
};

function colorHex(color: number | null) {
  return color === null ? null : `#${color.toString(16).padStart(6, "0")}`;
}

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

function detailKey(ownerRef: string, detailId: string) {
  return `${ownerRef}::${detailId}`;
}

// Operator rows are addressed by owner + selector rather than by a state ref, so the
// panel keeps its own ordered index of the visible ones to drive range and drag selection.
function visibleDetailIndex(items: MesoscaleHierarchyObject[], collapsedRefs: Set<string>) {
  const keys: string[] = [];
  const entries = new Map<string, { ownerRef: string; selector: MesoscaleHierarchySelector }>();
  const visit = (ownerRef: string, details: MesoscaleHierarchyDetail[]) => {
    for (const detail of details) {
      const key = detailKey(ownerRef, detail.id);
      const children = detail.children ?? [];
      if (detail.selector && children.length === 0) {
        keys.push(key);
        entries.set(key, { ownerRef, selector: detail.selector });
      }
      if (!collapsedRefs.has(key)) visit(ownerRef, children);
    }
  };
  for (const item of items) {
    if (collapsedRefs.has(item.ref)) continue;
    visit(item.ref, item.children ?? []);
  }
  return { keys, entries };
}

function visibleSelectableRefs(nodes: SceneTreeNode[], collapsedRefs: Set<string>) {
  const refs: string[] = [];
  const visit = (node: SceneTreeNode) => {
    if (node.item.kind !== "mesh") refs.push(node.item.ref);
    if (!collapsedRefs.has(node.item.ref)) node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return refs;
}

function sceneObjectDetail(item: MesoscaleHierarchyObject, childCount: number) {
  if (item.elementCount > 0) return `${item.elementCount.toLocaleString()} elements`;
  if (childCount > 0) return `${childCount.toLocaleString()} ${childCount === 1 ? "object" : "objects"}`;
  if (item.instanceCount > 0) return `${item.instanceCount.toLocaleString()} ${item.instanceCount === 1 ? "instance" : "instances"}`;
  const description = item.description.replaceAll("**", "").trim();
  return description && description.toLocaleLowerCase() !== item.label.toLocaleLowerCase() ? description : item.kind;
}

export function MesoscaleScenePanel({ document }: { document: ViewerDocument }) {
  const session = useMesoscaleStore((state) => state.sessions[document.id]);
  const [collapsedRefs, setCollapsedRefs] = useState<Set<string>>(() => new Set());
  const [rangeRefs, setRangeRefs] = useState<Set<string>>(() => new Set());
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const tree = useMemo(() => sceneTree(session?.hierarchy ?? []), [session?.hierarchy]);
  const selectableRefs = useMemo(() => visibleSelectableRefs(tree, collapsedRefs), [tree, collapsedRefs]);
  const detailIndex = useMemo(() => visibleDetailIndex(session?.hierarchy ?? [], collapsedRefs), [session?.hierarchy, collapsedRefs]);
  const selectedDetails = useMemo(
    () => new Set((session?.summary?.selectedDetails ?? []).map((detail) => detailKey(detail.ref, detail.id))),
    [session?.summary?.selectedDetails],
  );
  const [rangeDetailKeys, setRangeDetailKeys] = useState<Set<string>>(() => new Set());
  const dragRef = useRef<TreeSelectionDrag | null>(null);
  const detailDragRef = useRef<TreeSelectionDrag | null>(null);
  const anchorRef = useRef<string | null>(null);
  const detailAnchorRef = useRef<string | null>(null);
  const initializedDetailRefs = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!session || session.status === "loading" || session.status === "disposed") return;
    const timer = window.setTimeout(() => {
      void loadMesoscaleHierarchy(document.id, "", 0).catch(() => undefined);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [document.id, session?.status === "loading", session?.status === "disposed"]);

  useEffect(() => () => previewMesoscaleObject(document.id, null), [document.id]);

  useEffect(() => {
    const discovered = new Set<string>();
    const collectDetails = (ownerRef: string, details: MesoscaleHierarchyDetail[]) => {
      for (const detail of details) {
        const collapseRef = `${ownerRef}::${detail.id}`;
        if ((detail.children?.length ?? 0) > 0 || detail.childrenTruncated) discovered.add(collapseRef);
        collectDetails(ownerRef, detail.children ?? []);
      }
    };
    for (const item of session?.hierarchy ?? []) {
      if ((item.children?.length ?? 0) > 0 || item.childrenTruncated) discovered.add(item.ref);
      collectDetails(item.ref, item.children ?? []);
    }
    const additions = Array.from(discovered).filter((ref) => !initializedDetailRefs.current.has(ref));
    if (additions.length === 0) return;
    additions.forEach((ref) => initializedDetailRefs.current.add(ref));
    setCollapsedRefs((current) => new Set([...current, ...additions]));
  }, [session?.hierarchy]);

  const runSelection = async (refs: string[], mode: "replace" | "extend") => {
    const error = mesoscaleTreeSelectionError(refs);
    setSelectionError(error);
    if (error) return;
    if (refs.length === 1) await requestMesoscale(document.id, { type: "setSelection", ref: refs[0], mode });
    else await requestMesoscale(document.id, { type: "setSelectionBatch", refs, mode });
  };

  const selectOne = (ref: string, additive: boolean, shift: boolean) => {
    if (shift && anchorRef.current) {
      const refs = inclusiveMesoscaleTreeRange(selectableRefs, anchorRef.current, ref);
      void runSelection(refs, additive ? "extend" : "replace").catch(() => undefined);
    } else {
      setSelectionError(null);
      void requestMesoscale(document.id, { type: "setSelection", ref, mode: additive ? "toggle" : "replace" }).catch(() => undefined);
    }
    anchorRef.current = ref;
  };

  const runDetailSelection = async (keys: string[], mode: "replace" | "extend") => {
    const groups = new Map<string, MesoscaleHierarchySelector[]>();
    for (const key of keys) {
      const entry = detailIndex.entries.get(key);
      if (!entry) continue;
      const selectors = groups.get(entry.ownerRef) ?? [];
      selectors.push(entry.selector);
      groups.set(entry.ownerRef, selectors);
    }
    if (groups.size === 0) return;
    let replaced = mode === "extend";
    for (const [ref, selectors] of groups) {
      await requestMesoscale(document.id, { type: "setDetailSelectionBatch", ref, selectors, mode: replaced ? "extend" : "replace" });
      replaced = true;
    }
  };

  const selectOneDetail = (key: string, additive: boolean, shift: boolean) => {
    const entry = detailIndex.entries.get(key);
    if (!entry) return;
    setSelectionError(null);
    if (shift && detailAnchorRef.current) {
      const keys = inclusiveMesoscaleTreeRange(detailIndex.keys, detailAnchorRef.current, key);
      void runDetailSelection(keys, additive ? "extend" : "replace").catch(() => undefined);
    } else {
      void requestMesoscale(document.id, { type: "setDetailSelection", ref: entry.ownerRef, selector: entry.selector, mode: additive ? "toggle" : "replace" }).catch(() => undefined);
    }
    detailAnchorRef.current = key;
  };

  const beginDetailSelection = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    if (event.button !== 0) return;
    detailDragRef.current = {
      pointerId: event.pointerId,
      startRef: key,
      currentRef: key,
      startX: event.clientX,
      startY: event.clientY,
      additive: event.ctrlKey || event.metaKey,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDetailSelection = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = detailDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    const row = window.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-mesoscale-detail-key]");
    const nextKey = row?.dataset.mesoscaleDetailKey;
    if (!nextKey || !detailIndex.entries.has(nextKey) || nextKey === drag.currentRef) return;
    drag.currentRef = nextKey;
    setRangeDetailKeys(new Set(inclusiveMesoscaleTreeRange(detailIndex.keys, drag.startRef, nextKey)));
  };

  const finishDetailSelection = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = detailDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    detailDragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture already released */ }
    const keys = inclusiveMesoscaleTreeRange(detailIndex.keys, drag.startRef, drag.currentRef);
    setRangeDetailKeys(new Set());
    if (drag.moved) {
      void runDetailSelection(keys, drag.additive ? "extend" : "replace").catch(() => undefined);
      detailAnchorRef.current = drag.currentRef;
    } else {
      selectOneDetail(drag.startRef, drag.additive, event.shiftKey);
    }
  };

  const cancelDetailSelection = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = detailDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    detailDragRef.current = null;
    setRangeDetailKeys(new Set());
  };

  const beginSelection = (event: ReactPointerEvent<HTMLButtonElement>, ref: string) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startRef: ref,
      currentRef: ref,
      startX: event.clientX,
      startY: event.clientY,
      additive: event.ctrlKey || event.metaKey,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveSelection = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    const row = window.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-mesoscale-ref]");
    const nextRef = row?.dataset.mesoscaleRef;
    if (!nextRef || !selectableRefs.includes(nextRef) || nextRef === drag.currentRef) return;
    drag.currentRef = nextRef;
    setRangeRefs(new Set(inclusiveMesoscaleTreeRange(selectableRefs, drag.startRef, nextRef)));
  };

  const finishSelection = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture already released */ }
    const refs = inclusiveMesoscaleTreeRange(selectableRefs, drag.startRef, drag.currentRef);
    setRangeRefs(new Set());
    if (drag.moved) {
      void runSelection(refs, drag.additive ? "extend" : "replace").catch(() => undefined);
      anchorRef.current = drag.currentRef;
    } else {
      selectOne(drag.startRef, drag.additive, event.shiftKey);
    }
  };

  const cancelSelection = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setRangeRefs(new Set());
  };

  const detailInteraction: DetailInteraction = {
    selected: selectedDetails,
    rangeKeys: rangeDetailKeys,
    onPointerDown: beginDetailSelection,
    onPointerMove: moveDetailSelection,
    onPointerUp: finishDetailSelection,
    onPointerCancel: cancelDetailSelection,
    onKeyboardSelect: selectOneDetail,
  };

  const toggleCollapsed = (ref: string) => setCollapsedRefs((current) => {
    const next = new Set(current);
    if (next.has(ref)) next.delete(ref);
    else next.add(ref);
    return next;
  });

  return (
    <div className="mesoscale-panel mesoscale-scene-panel">
      <div className="mesoscale-object-summary">
        <span>{session?.hierarchyTotal.toLocaleString() ?? 0} objects</span>
        <span>{session?.summary?.selectedCount ?? session?.summary?.selectedRefs.length ?? 0} selected</span>
      </div>
      <div className="mesoscale-object-tree" role="tree" aria-label="Scene objects" aria-multiselectable="true" aria-busy={session?.status === "busy"}>
        {tree.map((node) => (
          <SceneObjectBranch
            key={node.item.ref}
            documentId={document.id}
            node={node}
            depth={1}
            collapsedRefs={collapsedRefs}
            rangeRefs={rangeRefs}
            onToggle={toggleCollapsed}
            onPointerDown={beginSelection}
            onPointerMove={moveSelection}
            onPointerUp={finishSelection}
            onPointerCancel={cancelSelection}
            onLostPointerCapture={cancelSelection}
            onKeyboardSelect={selectOne}
            detailInteraction={detailInteraction}
          />
        ))}
        {session?.hierarchyNextCursor != null ? (
          <button className="mesoscale-load-more" type="button" onClick={() => void loadMesoscaleHierarchy(document.id, "", session.hierarchyNextCursor ?? 0).catch(() => undefined)}>Show more</button>
        ) : null}
      </div>
      {selectionError ? <div className="mesoscale-error">{selectionError}</div> : null}
      {session?.error ? <div className="mesoscale-error">{session.error.message}</div> : null}
    </div>
  );
}

type DetailInteraction = {
  selected: Set<string>;
  rangeKeys: Set<string>;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, key: string) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyboardSelect: (key: string, additive: boolean, shift: boolean) => void;
};

type SceneBranchProps = {
  documentId: string;
  node: SceneTreeNode;
  depth: number;
  collapsedRefs: Set<string>;
  rangeRefs: Set<string>;
  onToggle: (ref: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, ref: string) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyboardSelect: (ref: string, additive: boolean, shift: boolean) => void;
  detailInteraction: DetailInteraction;
};

function SceneObjectBranch({ documentId, node, depth, collapsedRefs, rangeRefs, onToggle, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onKeyboardSelect, detailInteraction }: SceneBranchProps) {
  const { item, children } = node;
  const hovered = useMesoscaleStore((state) => state.sessions[documentId]?.hoveredRef === item.ref);
  const selectedCount = useMesoscaleStore((state) => {
    const summary = state.sessions[documentId]?.summary;
    return summary?.selectedCount ?? summary?.selectedRefs.length ?? 0;
  });
  const selectionVersion = useMesoscaleStore((state) => state.sessions[documentId]?.summary?.selectionVersion);
  const rightMouseDownRef = useRef(0);
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(documentId, action).catch(() => undefined);
  const detailChildren = item.children ?? [];
  const hasChildren = children.length > 0 || detailChildren.length > 0 || Boolean(item.childrenTruncated);
  const collapsed = collapsedRefs.has(item.ref);
  const detail = sceneObjectDetail(item, children.length);
  const setVisible = (visible: boolean) => {
    setMesoscaleVisibilityOptimistic(documentId, item.ref, !visible);
    void requestMesoscale(documentId, { type: "setVisibility", ref: item.ref, visible })
      .catch(() => setMesoscaleVisibilityOptimistic(documentId, item.ref, visible));
  };
  const showObjectMenu = (point: { x: number; y: number }) => { void showMesoscaleObjectMenu(documentId, item, selectedCount, point, selectionVersion); };
  const openContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "contextmenu" && event.button === 0 && event.ctrlKey) return;
    const now = window.performance.now();
    if (event.type === "contextmenu" && now - rightMouseDownRef.current < 500) return;
    if (event.type === "mousedown") rightMouseDownRef.current = now;
    previewMesoscaleObject(documentId, item.ref);
    showObjectMenu({ x: event.clientX, y: event.clientY });
  };
  const openAppearanceMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    void showMesoscaleAppearanceMenu(documentId, item, { x: rect.right + 6, y: rect.top });
  };
  const actualColor = colorHex(item.color);
  return (
    <div className="mesoscale-tree-branch" role="treeitem" aria-level={depth} aria-expanded={hasChildren ? !collapsed : undefined} aria-selected={item.selected}>
      <div
        className={`mesoscale-object-row${item.selected ? " selected" : ""}${rangeRefs.has(item.ref) ? " range-selected" : ""}${hovered ? " hovered" : ""}`}
        data-kind={item.kind}
        data-mesoscale-ref={item.ref}
        onMouseDown={(event) => { if (event.button === 2) openContextMenu(event); }}
        onPointerEnter={() => previewMesoscaleObject(documentId, item.ref)}
        onPointerLeave={() => previewMesoscaleObject(documentId, null)}
        onContextMenu={openContextMenu}
      >
        {hasChildren ? (
          <button type="button" className="mesoscale-tree-disclosure" aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.label}`} onClick={() => onToggle(item.ref)}>
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : <span className="mesoscale-tree-leaf" aria-hidden="true" />}
        <button
          type="button"
          className="mesoscale-object-main"
          aria-label={`${item.label}, ${detail}`}
          disabled={item.kind === "mesh"}
          onPointerDown={(event) => onPointerDown(event, item.ref)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onLostPointerCapture}
          onClick={(event) => { if (event.detail === 0) onKeyboardSelect(item.ref, event.ctrlKey || event.metaKey, event.shiftKey); }}
          onDoubleClick={() => run({ type: "focusObject", ref: item.ref })}
          onFocus={() => previewMesoscaleObject(documentId, item.ref)}
          onBlur={() => previewMesoscaleObject(documentId, null)}
        >
          <span className="mesoscale-tree-bar" data-kind={item.kind} style={actualColor ? { backgroundColor: actualColor } : undefined} aria-hidden="true" />
          <strong>{item.label}</strong>
          <small title={detail}>{detail}</small>
        </button>
        <button className="mesoscale-tree-color" type="button" aria-label={`Color ${item.label}`} title={`Color ${item.label}`} style={actualColor ? { backgroundColor: actualColor } : undefined} onClick={openAppearanceMenu} />
        <button className="mesoscale-tree-action" type="button" disabled={item.kind === "mesh"} aria-label={`Focus ${item.label}`} title="Focus" onClick={() => run({ type: "focusObject", ref: item.ref })}><Focus size={14} /></button>
        <button className="mesoscale-tree-action" type="button" aria-label={`${item.hidden ? "Show" : "Hide"} ${item.label}`} title={item.hidden ? "Show" : "Hide"} onClick={() => setVisible(item.hidden)}>
          {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {hasChildren && !collapsed ? (
        <div className="mesoscale-tree-group" role="group">
          {children.map((child) => <SceneObjectBranch key={child.item.ref} documentId={documentId} node={child} depth={depth + 1} collapsedRefs={collapsedRefs} rangeRefs={rangeRefs} onToggle={onToggle} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onLostPointerCapture={onLostPointerCapture} onKeyboardSelect={onKeyboardSelect} detailInteraction={detailInteraction} />)}
          {detailChildren.map((child) => <SceneDetailBranch key={child.id} documentId={documentId} ownerRef={item.ref} detail={child} depth={depth + 1} collapsedRefs={collapsedRefs} onToggle={onToggle} interaction={detailInteraction} />)}
          {item.childrenTruncated ? <SceneTruncationRow depth={depth + 1} remaining={Math.max(1, (item.childCount ?? detailChildren.length) - detailChildren.length)} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function SceneDetailBranch({ documentId, ownerRef, detail, depth, collapsedRefs, onToggle, interaction }: { documentId: string; ownerRef: string; detail: MesoscaleHierarchyDetail; depth: number; collapsedRefs: Set<string>; onToggle: (ref: string) => void; interaction: DetailInteraction }) {
  const collapseRef = detailKey(ownerRef, detail.id);
  const children = detail.children ?? [];
  const collapsed = collapsedRefs.has(collapseRef);
  const hasChildren = children.length > 0 || Boolean(detail.childrenTruncated);
  const selector = !hasChildren ? detail.selector : undefined;
  const selected = Boolean(selector) && interaction.selected.has(collapseRef);
  const rangeSelected = Boolean(selector) && interaction.rangeKeys.has(collapseRef);
  return (
    <div className="mesoscale-tree-branch mesoscale-detail-branch" role="treeitem" aria-level={depth} aria-expanded={hasChildren ? !collapsed : undefined} aria-selected={selector ? selected : undefined}>
      <div
        className={`mesoscale-object-row mesoscale-detail-row${selected ? " selected" : ""}${rangeSelected ? " range-selected" : ""}`}
        data-mesoscale-detail-id={detail.id}
        data-mesoscale-detail-key={selector ? collapseRef : undefined}
        onPointerEnter={() => previewMesoscaleObject(documentId, ownerRef, selector)}
        onPointerLeave={() => previewMesoscaleObject(documentId, null)}
      >
        {hasChildren ? (
          <button type="button" className="mesoscale-tree-disclosure" aria-label={`${collapsed ? "Expand" : "Collapse"} ${detail.label}`} onClick={() => onToggle(collapseRef)}>
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : <span className="mesoscale-tree-leaf" aria-hidden="true" />}
        <button
          type="button"
          className="mesoscale-detail-main"
          aria-label={hasChildren ? `${collapsed ? "Open" : "Close"} ${detail.label} details` : `${detail.label}, ${detail.detail}`}
          onPointerDown={selector ? (event) => interaction.onPointerDown(event, collapseRef) : undefined}
          onPointerMove={selector ? interaction.onPointerMove : undefined}
          onPointerUp={selector ? interaction.onPointerUp : undefined}
          onPointerCancel={selector ? interaction.onPointerCancel : undefined}
          onLostPointerCapture={selector ? interaction.onPointerCancel : undefined}
          onClick={(event) => {
            if (hasChildren) onToggle(collapseRef);
            else if (selector && event.detail === 0) interaction.onKeyboardSelect(collapseRef, event.ctrlKey || event.metaKey, event.shiftKey);
          }}
          onDoubleClick={selector ? () => void requestMesoscale(documentId, { type: "focusDetail", ref: ownerRef, selector }).catch(() => undefined) : undefined}
          onFocus={() => previewMesoscaleObject(documentId, ownerRef, selector)}
          onBlur={() => previewMesoscaleObject(documentId, null)}
        >
          <strong>{detail.label}</strong>
          <small title={detail.detail}>{detail.detail}</small>
        </button>
      </div>
      {hasChildren && !collapsed ? (
        <div className="mesoscale-tree-group" role="group">
          {children.map((child) => <SceneDetailBranch key={child.id} documentId={documentId} ownerRef={ownerRef} detail={child} depth={depth + 1} collapsedRefs={collapsedRefs} onToggle={onToggle} interaction={interaction} />)}
          {detail.childrenTruncated ? <SceneTruncationRow depth={depth + 1} remaining={Math.max(1, (detail.childCount ?? children.length) - children.length)} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function SceneTruncationRow({ depth, remaining }: { depth: number; remaining: number }) {
  return (
    <div className="mesoscale-tree-branch mesoscale-detail-branch" role="treeitem" aria-level={depth}>
      <div className="mesoscale-object-row mesoscale-detail-row mesoscale-truncation-row">
        <span className="mesoscale-tree-leaf" aria-hidden="true" />
        <div className="mesoscale-detail-main"><strong>More details</strong><small>{remaining.toLocaleString()} not shown</small></div>
      </div>
    </div>
  );
}
