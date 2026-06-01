import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
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
import type { KetcherSketchTarget, ShellActions, ShellViewState } from "./types";

type KetcherEditorComponent = ComponentType<{
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
  onLoadError?: (error: Error) => void;
}>;

const KETCHER_UI_SCALES = [0.76, 0.82, 0.88, 0.94, 1] as const;
const DEFAULT_KETCHER_UI_SCALE_INDEX = 2;
const KETCHER_EXPORT_TIMEOUT_MS = 4500;

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
  const [editorHasActivated, setEditorHasActivated] = useState(false);
  const [exportingSketch, setExportingSketch] = useState(false);
  const [ketcherUIScaleIndex, setKetcherUIScaleIndex] = useState(DEFAULT_KETCHER_UI_SCALE_INDEX);
  const handledImportRequestIdRef = useRef<number | null>(null);
  const shouldMountEditor = isActive || editorHasActivated;
  const ketcherUIScale = KETCHER_UI_SCALES[ketcherUIScaleIndex];
  const ketcherUIScalePercent = Math.round(ketcherUIScale * 100);
  const ketcherUIScaleStyle = useMemo(() => ({
    "--ketcher-ui-scale": String(ketcherUIScale),
    "--ketcher-ui-scale-inverse": String(1 / ketcherUIScale),
  }) as CSSProperties, [ketcherUIScale]);

  useEffect(() => {
    if (!isActive || editorHasActivated) return;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        setEditorHasActivated(true);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [editorHasActivated, isActive]);

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
    setStatus("Exporting SMILES");
    try {
      const smiles = await withKetcherTimeout(ketcher.getSmiles(), "SMILES export");
      setOutput(smiles || "Empty structure");
      setStatus("Ready");
    } catch (error) {
      setStatus(ketcherExportErrorMessage(error));
    }
  }, [ketcher]);

  const exportMolfile = useCallback(async () => {
    if (!ketcher) return;
    setStatus("Exporting Molfile");
    try {
      const molfile = await withKetcherTimeout(ketcher.getMolfile("v3000"), "Molfile export");
      setOutput(molfile || "Empty structure");
      setStatus("Ready");
    } catch (error) {
      setStatus(ketcherExportErrorMessage(error));
    }
  }, [ketcher]);

  const openSketch = useCallback(async (target: KetcherSketchTarget, collectionTargetPath?: string | null) => {
    if (!ketcher || exportingSketch) return;
    setExportingSketch(true);
    try {
      setStatus("Exporting sketch");
      const molfile = await withKetcherTimeout(ketcher.getMolfile("v2000"), "Sketch export");
      if (!molfile.trim()) {
        setStatus("Draw a molecule first");
        return;
      }
      await actions.openKetcherSketch({
        title: "ketcher-sketch.sdf",
        extension: "sdf",
        text: molfileToSdf(molfile),
        target,
        collectionTargetPath,
      });
      setStatus(target === "collection" ? "Sent sketch to collection" : "Opened sketch in viewer");
    } catch (error) {
      setStatus(ketcherExportErrorMessage(error));
    } finally {
      setExportingSketch(false);
    }
  }, [actions, exportingSketch, ketcher]);

  const addSketchToCollection = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const latestCollection = collectionTargets.at(-1);
    void openSketch("collection", latestCollection?.path ?? null);
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
      let hasImportedStructure = false;
      const addStructure = async (text: string) => {
        const importText = normalizeKetcherImportText(text);
        if (!importText.trim()) return;
        if (hasImportedStructure) {
          await ketcher.addFragment(importText, { needZoom: true });
          return;
        }
        await ketcher.setMolecule(importText, { needZoom: true });
        hasImportedStructure = true;
      };
      for (const path of cleanPaths) {
        const text = await readStructureText(path);
        await addStructure(text);
      }
      for (const fragment of cleanFragments) {
        await addStructure(fragment.text);
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

  const decreaseKetcherScale = useCallback(() => {
    setKetcherUIScaleIndex((index) => Math.max(0, index - 1));
  }, []);

  const increaseKetcherScale = useCallback(() => {
    setKetcherUIScaleIndex((index) => Math.min(KETCHER_UI_SCALES.length - 1, index + 1));
  }, []);

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
          <button type="button" disabled={!ketcher || exportingSketch} onClick={() => void openSketch("molstar")}>Mol*</button>
          <button type="button" disabled={!ketcher || exportingSketch} onClick={() => void openSketch("xyzrender")}>xyzrender</button>
          <button type="button" disabled={!ketcher || exportingSketch} onClick={addSketchToCollection}>Add to collection</button>
          <div className="ketcher-scale-control" aria-label="Ketcher scale">
            <button type="button" aria-label="Decrease Ketcher scale" disabled={ketcherUIScaleIndex === 0} onClick={decreaseKetcherScale}>-</button>
            <span>{ketcherUIScalePercent}%</span>
            <button type="button" aria-label="Increase Ketcher scale" disabled={ketcherUIScaleIndex === KETCHER_UI_SCALES.length - 1} onClick={increaseKetcherScale}>+</button>
          </div>
        </div>
      </header>
      <div className="ketcher-page-body">
        <div
          className="ketcher-editor-shell"
          data-drop-active={dropActive || undefined}
          style={ketcherUIScaleStyle}
        >
          {shouldMountEditor ? (
            <KetcherErrorBoundary>
              <KetcherEditorLoader
                key={editorReloadKey}
                onReady={handleReady}
                onStatus={setStatus}
                onRetry={retryEditorLoad}
              />
            </KetcherErrorBoundary>
          ) : (
            <div className="ketcher-loading">Loading editor</div>
          )}
          <img className="ketcher-empty-watermark" src={ligandProLogo} alt="" aria-hidden="true" />
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

function molfileToSdf(molfile: string, smiles?: string) {
  const fields = smiles?.trim()
    ? ["> <SMILES>", smiles.trim(), ""]
    : [];
  return [
    molfile.trimEnd(),
    ...fields,
    "$$$$",
    "",
  ].join("\n");
}

function withKetcherTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, KETCHER_EXPORT_TIMEOUT_MS);

    operation
      .then(resolve, reject)
      .finally(() => {
        window.clearTimeout(timeout);
      });
  });
}

function ketcherExportErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) {
    return "Ketcher did not return a sketch. Draw a molecule first or try again.";
  }
  return "Ketcher export failed: " + message;
}

function normalizeKetcherImportText(text: string) {
  const trimmed = text.trim();
  if (looksLikeSdfRecord(trimmed)) {
    return trimmed.replace(/\n?\$\$\$\$\s*$/u, "").trimEnd() + "\n";
  }
  return trimmed;
}

function looksLikeSdfRecord(text: string) {
  return /\nM\s+END(?:\n|$)/u.test(text) && /\n?\$\$\$\$\s*$/u.test(text);
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

  return <EditorComponent onReady={onReady} onStatus={onStatus} onLoadError={setLoadError} />;
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
