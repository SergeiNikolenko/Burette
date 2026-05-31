import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type ErrorInfo,
  type MouseEvent,
  type ReactNode,
} from "react";

import ligandProLogo from "../assets/short-logo-ligandpro.svg";
import { collectionExtension, collectionFamily } from "../lib/collection-documents";
import { readStructureText } from "../lib/structure-text";
import { hasStructureDrag, readStructureDragPayload, structureDragRecordsToFragments } from "../lib/structure-drag";
import type { KetcherEditorApi } from "./ketcher-editor";
import { showNativeContextMenu } from "./native-context-menu";
import type { KetcherSketchTarget, ShellActions, ShellViewState } from "./types";

type KetcherEditorComponent = ComponentType<{
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
}>;

export function KetcherPage({
  state,
  actions,
  isActive,
}: {
  state: ShellViewState;
  actions: ShellActions;
  isActive: boolean;
}) {
  const [ketcher, setKetcher] = useState<KetcherEditorApi | null>(null);
  const [status, setStatus] = useState("Loading editor");
  const [output, setOutput] = useState("");
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const handledImportRequestIdRef = useRef<number | null>(null);

  const handleReady = useCallback((instance: KetcherEditorApi) => {
    setKetcher(instance);
  }, []);

  const retryEditorLoad = useCallback(() => {
    setKetcher(null);
    setStatus("Loading editor");
    setEditorReloadKey((key) => key + 1);
  }, []);

  const collectionTargets = useMemo(() => (
    state.documents
      .filter((document) => collectionFamily(collectionExtension(document.path)) === "sdf")
      .map((document) => ({
        path: document.path,
        title: document.title || fileName(document.path),
      }))
  ), [state.documents]);

  const exportSmiles = useCallback(async () => {
    if (!ketcher) return;
    const smiles = await ketcher.getSmiles();
    setOutput(smiles || "Empty structure");
  }, [ketcher]);

  const exportMolfile = useCallback(async () => {
    if (!ketcher) return;
    const molfile = await ketcher.getMolfile("v3000");
    setOutput(molfile || "Empty structure");
  }, [ketcher]);

  const openSketch = useCallback(async (target: KetcherSketchTarget, collectionTargetPath?: string | null) => {
    if (!ketcher) return;
    try {
      setStatus("Exporting sketch");
      const [smiles, molfile] = await Promise.all([
        ketcher.getSmiles(),
        ketcher.getMolfile("v2000"),
      ]);
      if (!smiles.trim() || !molfile.trim()) {
        setStatus("Draw a molecule first");
        return;
      }
      await actions.openKetcherSketch({
        title: "ketcher-sketch.sdf",
        extension: "sdf",
        text: molfileToSdf(molfile, smiles),
        target,
        collectionTargetPath,
      });
      setStatus(target === "collection" ? "Sent sketch to collection" : "Opened sketch in viewer");
    } catch (error) {
      setStatus("Ketcher export failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [actions, ketcher]);

  const showCollectionTargetMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const items = [
      ...(collectionTargets.length > 0
        ? collectionTargets.map((target, index) => ({
            kind: "item" as const,
            id: `add-to-collection-${index}`,
            text: `Add to ${target.title}`,
            action: () => {
              void openSketch("collection", target.path);
            },
          }))
        : [
            {
              kind: "item" as const,
              id: "no-open-sdf-collections",
              text: "No open SDF collections",
              disabled: true,
            },
          ]),
      { kind: "separator" as const },
      {
        kind: "item" as const,
        id: "open-as-new-collection",
        text: "Open as new collection",
        action: () => {
          void openSketch("collection", null);
        },
      },
    ];
    void showNativeContextMenu(items, {
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
    });
  }, [collectionTargets, openSketch]);

  const importStructures = useCallback(async (paths: string[], fragments: Array<{ title: string; text: string }> = []) => {
    if (!ketcher) {
      setStatus("Ketcher is not ready");
      return;
    }
    const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    const cleanFragments = fragments.filter((fragment) => fragment.text.trim());
    if (cleanPaths.length === 0 && cleanFragments.length === 0) return;
    const itemCount = cleanPaths.length + cleanFragments.length;
    const label = itemCount === 1
      ? (cleanPaths[0] ? fileName(cleanPaths[0]) : cleanFragments[0]?.title || "structure")
      : `${itemCount} structures`;
    try {
      setStatus("Adding " + label);
      for (const path of cleanPaths) {
        const text = await readStructureText(path);
        await ketcher.addFragment(text, { needZoom: true });
      }
      for (const fragment of cleanFragments) {
        await ketcher.addFragment(fragment.text, { needZoom: true });
      }
      setOutput("");
      setStatus("Added " + label);
    } catch (error) {
      setStatus("Ketcher import failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [ketcher]);

  useEffect(() => {
    const request = state.ketcherImportRequest;
    if (!request || !isActive || !ketcher || handledImportRequestIdRef.current === request.id) return;
    handledImportRequestIdRef.current = request.id;
    void importStructures(request.paths, request.fragments).finally(() => {
      actions.clearKetcherImportRequest(request.id);
    });
  }, [actions, importStructures, isActive, ketcher, state.ketcherImportRequest]);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    actions.setStructureDragActive(false);
    setDropActive(false);
    const payload = readStructureDragPayload(event.dataTransfer);
    const fragments = structureDragRecordsToFragments(payload.records);
    if (payload.paths.length === 0 && fragments.length === 0) return;
    void importStructures(payload.paths, fragments);
  }, [actions, importStructures]);

  return (
    <section
      className="ketcher-page"
      aria-label="Ketcher"
      data-drop-active={dropActive || undefined}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
    >
      <header className="ketcher-page-header">
        <div className="ketcher-page-title">
          <span className="ketcher-page-icon" aria-hidden="true">
            <KetcherLogo />
          </span>
          <div>
            <h1>Ketcher</h1>
            <p>New molecule sketch</p>
          </div>
        </div>
        <div className="ketcher-page-actions" aria-label="Sketch actions">
          <button type="button" disabled={!ketcher} onClick={() => void openSketch("molstar")}>Mol*</button>
          <button type="button" disabled={!ketcher} onClick={() => void openSketch("xyzrender")}>xyzrender</button>
          <button type="button" disabled={!ketcher} onClick={showCollectionTargetMenu}>Add to collection</button>
        </div>
      </header>
      <div className="ketcher-page-body">
        <div
          className="ketcher-editor-shell"
          data-drop-active={dropActive || undefined}
        >
          <KetcherErrorBoundary>
            <KetcherEditorLoader
              key={editorReloadKey}
              onReady={handleReady}
              onStatus={setStatus}
              onRetry={retryEditorLoad}
            />
          </KetcherErrorBoundary>
          <div className="ketcher-empty-watermark" aria-hidden="true">
            <KetcherLogo />
          </div>
          {dropActive && (
            <div className="ketcher-drop-overlay">
              <div>Add to Ketcher</div>
            </div>
          )}
        </div>
        {output ? <pre className="ketcher-output">{output}</pre> : null}
      </div>
      <footer className="ketcher-page-footer">
        <span className="ketcher-page-status">{status}</span>
        <button type="button" onClick={actions.openCommandPalette}>Command Palette</button>
        <button type="button" disabled={!ketcher} onClick={exportSmiles}>SMILES</button>
        <button type="button" disabled={!ketcher} onClick={exportMolfile}>Molfile</button>
        <button type="button" className="ketcher-primary-action" disabled>Apply</button>
      </footer>
    </section>
  );
}

function molfileToSdf(molfile: string, smiles: string) {
  return [
    molfile.trimEnd(),
    "> <SMILES>",
    smiles.trim(),
    "",
    "$$$$",
    "",
  ].join("\n");
}

function fileName(path: string) {
  return path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
}

function KetcherLogo() {
  return <img src={ligandProLogo} alt="" aria-hidden="true" />;
}

function KetcherEditorLoader({
  onReady,
  onStatus,
  onRetry,
}: {
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
  onRetry: () => void;
}) {
  const [EditorComponent, setEditorComponent] = useState<KetcherEditorComponent | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    onStatus("Loading editor");
    setLoadError(null);
    setEditorComponent(null);

    void import("./ketcher-editor")
      .then((module) => {
        if (cancelled) return;
        setEditorComponent(() => module.KetcherEditor);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        setLoadError(normalizedError);
        onStatus("Ketcher failed to load");
      });

    return () => {
      cancelled = true;
    };
  }, [onStatus]);

  if (loadError) {
    return <KetcherErrorPanel error={loadError} onRetry={onRetry} />;
  }

  if (!EditorComponent) {
    return <div className="ketcher-loading">Loading editor</div>;
  }

  return <EditorComponent onReady={onReady} onStatus={onStatus} />;
}

function KetcherErrorPanel({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="ketcher-error-panel" role="alert">
      <strong>Ketcher failed to load</strong>
      <span>{error.message}</span>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  );
}

class KetcherErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[KetcherErrorBoundary]", error, info.componentStack);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <KetcherErrorPanel error={this.state.error} onRetry={this.retry} />;
    }

    return this.props.children;
  }
}
