import { Suspense, lazy, useRef, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import type { DockFileEntry } from "../lib/dock";
import type { ShellActions, ShellViewState } from "./types";
import { estimatedSceneBytes } from "./editor-area/scene-residency";
import type { ViewerDocument } from "../types";
import { ViewerFrame } from "./editor-area/viewer-frame";
import { TextFileViewer } from "./text-file-viewer";
import { SpectrumViewer } from "./spectrum-viewer";

const DocumentSurface = lazy(() => import("./document-page").then(module => ({ default: module.DocumentSurface })));

// Only visited files mount. Stable order keeps iframe documents, cameras, table
// filters and image zoom alive when the selected file or panel size changes.
export function DockFileViews({ entries, activeKey, textViews, state, actions, renderText, visible }: {
  visible: boolean;
  entries: DockFileEntry[];
  activeKey: string | null;
  textViews: Record<string, boolean>;
  state: ShellViewState;
  actions: ShellActions;
  renderText: (entry: DockFileEntry) => ReactNode;
}) {
  const visited = useRef<DockFileEntry[]>([]);
  visited.current = visited.current.filter(entry => entries.some(current => current.key === entry.key));
  const recency = useRef<string[]>([]);
  recency.current = [...recency.current.filter(key => key !== activeKey && entries.some(entry => entry.key === key)), ...(activeKey ? [activeKey] : [])];
  let retainedBytes = 0;
  const retained = new Set<string>();
  for (const key of [...recency.current].reverse()) {
    const entry = entries.find(entry => entry.key === key);
    const document = entry?.kind === "document" ? state.documents.find(doc => doc.id === entry.documentId) : undefined;
    const cost = estimatedSceneBytes(document);
    if (key === activeKey || (retained.size < 4 && retainedBytes + cost <= 256 * 1024 * 1024)) {
      retained.add(key); retainedBytes += cost;
    }
  }
  visited.current = visited.current.filter(entry => retained.has(entry.key));
  const active = entries.find(entry => entry.key === activeKey);
  if (active && !visited.current.some(entry => entry.key === active.key)) visited.current.push(active);
  return <>{visited.current.map(entry => {
    const selected = entry.key === activeKey;
    const document = entry.kind === "document" ? state.documents.find(doc => doc.id === entry.documentId) : null;
    const textDocument = entry.kind === "text-document" ? state.textDocuments.find(doc => doc.id === entry.documentId) : null;
    return <div key={entry.key} className="dock-viewer" hidden={!selected} inert={!selected}
      style={selected ? undefined : { display: "none" }} data-dock-file={entry.key}>
      {textViews[entry.key] ? renderText(entry)
        : entry.kind === "media" ? <Suspense fallback={null}><DocumentSurface path={entry.path} /></Suspense>
        : document?.renderer === "spectrum" ? <SpectrumViewer document={document} embedded />
        : document ? <DockStructureView document={document} visible={visible && selected} />
        : textDocument ? <TextFileViewer document={textDocument} openPaths={actions.openPaths} onStructureSelection={actions.selectTextStructure} />
        : null}
    </div>;
  })}</>;
}

function DockStructureView({ document, visible }: { document: ViewerDocument; visible: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const visibility = useCallback((target = frame.current) => {
    target?.contentWindow?.postMessage({ source: "burette-host", body: {
      type: "viewerVisibilityChanged", documentId: document.id, visible,
    } }, "*");
  }, [document.id, visible]);
  useEffect(() => { visibility(); }, [visibility]);
  return <ViewerFrame document={document} readOnly iframeRef={frame} onViewerLoad={visibility} />;
}
