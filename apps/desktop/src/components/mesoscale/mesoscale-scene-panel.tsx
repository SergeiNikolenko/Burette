import { useEffect, useState } from "react";
import { Box, Camera, ChevronRight, Download, Eye, EyeOff, Focus, Layers, Plus, Trash2 } from "lucide-react";
import type { ViewerDocument } from "../../types";
import { loadMesoscaleHierarchy, previewMesoscaleObject, requestMesoscale, setMesoscaleVisibilityOptimistic, useMesoscaleStore } from "../../stores/mesoscale-store";
import type { MesoscaleHierarchyObject } from "../../lib/mesoscale-contract";

type SceneSection = "objects" | "snapshots" | "export";

export function MesoscaleScenePanel({ document }: { document: ViewerDocument }) {
  const session = useMesoscaleStore((state) => state.sessions[document.id]);
  const [section, setSection] = useState<SceneSection>("objects");
  const [filter, setFilter] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [styleColor, setStyleColor] = useState("#b9a4ff");
  const [styleOpacity, setStyleOpacity] = useState(1);
  const selected = session?.hierarchy.find((item) => item.selected) ?? null;

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
          <div className="mesoscale-object-list" aria-busy={session?.status === "busy"}>
            {session?.hierarchy.map((item) => <SceneObjectRow key={item.ref} documentId={document.id} item={item} />)}
            {session?.hierarchyNextCursor != null ? (
              <button className="mesoscale-load-more" type="button" onClick={() => void loadMesoscaleHierarchy(document.id, filter, session.hierarchyNextCursor ?? 0).catch(() => undefined)}>Show more</button>
            ) : null}
          </div>
          {selected ? (
            <section className="mesoscale-style-editor">
              <div className="mesoscale-section-title">Appearance · {selected.label}</div>
              <label>Color <input type="color" value={styleColor} onChange={(event) => setStyleColor(event.target.value)} /></label>
              <label>Opacity <input type="range" min="0" max="1" step="0.05" value={styleOpacity} onChange={(event) => setStyleOpacity(Number(event.target.value))} /><output>{Math.round(styleOpacity * 100)}%</output></label>
              <button type="button" className="mesoscale-primary-button" onClick={() => void run({ type: "setStyle", ref: selected.ref, color: Number.parseInt(styleColor.slice(1), 16), opacity: styleOpacity })}>Apply appearance</button>
            </section>
          ) : null}
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

function SceneObjectRow({ documentId, item }: { documentId: string; item: MesoscaleHierarchyObject }) {
  const hovered = useMesoscaleStore((state) => state.sessions[documentId]?.hoveredRef === item.ref);
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(documentId, action).catch(() => undefined);
  return (
    <div
      className={`mesoscale-object-row${item.selected ? " selected" : ""}${hovered ? " hovered" : ""}`}
      data-kind={item.kind}
      onPointerEnter={() => previewMesoscaleObject(documentId, item.ref)}
      onPointerLeave={() => previewMesoscaleObject(documentId, null)}
    >
      <button
        type="button"
        className="mesoscale-object-main"
        onClick={() => run({ type: "setSelection", ref: item.ref, mode: "replace" })}
        onDoubleClick={() => run({ type: "focusObject", ref: item.ref })}
        onFocus={() => previewMesoscaleObject(documentId, item.ref)}
        onBlur={() => previewMesoscaleObject(documentId, null)}
      >
        <span className="mesoscale-object-indent" aria-hidden="true">{item.parentRef ? <ChevronRight size={12} /> : null}</span>
        {item.kind === "group" ? <Layers size={14} /> : <Box size={14} />}
        <span><strong>{item.label}</strong><small>{item.description || `${item.instanceCount.toLocaleString()} instances`}</small></span>
      </button>
      <button type="button" aria-label={`Focus ${item.label}`} title="Focus" onClick={() => run({ type: "focusObject", ref: item.ref })}><Focus size={14} /></button>
      <button
        type="button"
        aria-label={`${item.hidden ? "Show" : "Hide"} ${item.label}`}
        title={item.hidden ? "Show" : "Hide"}
        onClick={() => {
          setMesoscaleVisibilityOptimistic(documentId, item.ref, !item.hidden);
          void requestMesoscale(documentId, { type: "setVisibility", ref: item.ref, visible: item.hidden })
            .catch(() => setMesoscaleVisibilityOptimistic(documentId, item.ref, item.hidden));
        }}
      >
        {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
