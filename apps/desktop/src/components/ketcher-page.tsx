import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type DragEvent,
  type ErrorInfo,
  type ReactNode,
} from "react";

import ligandProLogo from "../assets/short-logo-ligandpro.svg";
import { readStructureText } from "../lib/structure-text";
import { hasStructureDrag, readStructureDrag } from "../lib/structure-drag";
import type { KetcherEditorApi } from "./ketcher-editor";
import type { ShellActions } from "./types";

type KetcherEditorComponent = ComponentType<{
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
}>;

export function KetcherPage({ actions }: { actions: ShellActions }) {
  const [ketcher, setKetcher] = useState<KetcherEditorApi | null>(null);
  const [status, setStatus] = useState("Loading editor");
  const [output, setOutput] = useState("");
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [dropActive, setDropActive] = useState(false);

  const handleReady = useCallback((instance: KetcherEditorApi) => {
    setKetcher(instance);
  }, []);

  const retryEditorLoad = useCallback(() => {
    setKetcher(null);
    setStatus("Loading editor");
    setEditorReloadKey((key) => key + 1);
  }, []);

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

  const importStructure = useCallback(async (path: string) => {
    if (!ketcher) {
      setStatus("Ketcher is not ready");
      return;
    }
    try {
      setStatus("Importing " + fileName(path));
      const text = await readStructureText(path);
      await ketcher.setMolecule(text, { needZoom: true });
      setOutput("");
      setStatus("Imported " + fileName(path));
    } catch (error) {
      setStatus("Ketcher import failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [ketcher]);

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
    const [path] = readStructureDrag(event.dataTransfer);
    if (!path) return;
    void importStructure(path);
  }, [actions, importStructure]);

  return (
    <section className="ketcher-page" aria-label="Ketcher">
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
      </header>
      <div className="ketcher-page-body">
        <div
          className="ketcher-editor-shell"
          data-drop-active={dropActive || undefined}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
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
              <div>Import into Ketcher</div>
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
