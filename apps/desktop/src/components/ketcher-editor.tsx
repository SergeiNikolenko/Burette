import { useCallback, useEffect, useMemo, useState } from "react";
import type { Ketcher } from "ketcher-core";

export type KetcherEditorApi = Pick<Ketcher, "addFragment" | "getMolfile" | "getSmiles" | "setMolecule">;
type KetcherReactModule = typeof import("ketcher-react");
type KetcherStandaloneModule = typeof import("ketcher-standalone");
type KetcherRequireShim = ((moduleName: string) => unknown) & { __burreteKetcherShim?: true };
type KetcherEditorDeps = {
  Editor: KetcherReactModule["Editor"];
  StandaloneStructServiceProvider: KetcherStandaloneModule["StandaloneStructServiceProvider"];
};

type KetcherGlobal = typeof globalThis & {
  __burreteRequire?: KetcherRequireShim;
};

export function KetcherEditor({
  onReady,
  onStatus,
  onLoadError,
}: {
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
  onLoadError?: (error: Error) => void;
}) {
  const [deps, setDeps] = useState<KetcherEditorDeps | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    onStatus("Loading editor");
    setLoadError(null);
    setDeps(null);

    void (async () => {
      await installKetcherRuntimeShims();
      const ketcherStandalone = await import("ketcher-standalone");
      const ketcherReact = await import("ketcher-react");
      await import("ketcher-react/dist/index.css");
      return { ketcherReact, ketcherStandalone };
    })()
      .then(({ ketcherReact, ketcherStandalone }) => {
        if (cancelled) return;
        setDeps({
          Editor: ketcherReact.Editor,
          StandaloneStructServiceProvider: ketcherStandalone.StandaloneStructServiceProvider,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        setLoadError(normalizedError);
        onLoadError?.(normalizedError);
        onStatus("Ketcher failed to load");
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadError, onStatus]);

  const structServiceProvider = useMemo(() => (
    deps ? new deps.StandaloneStructServiceProvider() : null
  ), [deps]);

  const handleInit = useCallback((instance: Ketcher) => {
    onReady(instance);
    onStatus("Ready");
  }, [onReady, onStatus]);

  const handleError = useCallback((message: string) => {
    onStatus(message);
  }, [onStatus]);

  if (loadError) {
    return null;
  }

  if (!deps || !structServiceProvider) {
    return <div className="ketcher-loading">Loading editor</div>;
  }

  const Editor = deps.Editor;

  return (
    <Editor
      disableMacromoleculesEditor
      staticResourcesUrl={import.meta.env.BASE_URL}
      structServiceProvider={structServiceProvider}
      onInit={handleInit}
      errorHandler={handleError}
    />
  );
}

async function installKetcherRuntimeShims() {
  const browserGlobal = globalThis as KetcherGlobal;
  if (browserGlobal.__burreteRequire?.__burreteKetcherShim) return;
  const raphaelModule = await import("raphael");
  const requireShim: KetcherRequireShim = (moduleName: string) => {
    if (moduleName === "raphael") return raphaelModule;
    throw new Error(`Unsupported Ketcher CommonJS module: ${moduleName}`);
  };
  requireShim.__burreteKetcherShim = true;
  browserGlobal.__burreteRequire = requireShim;
}
