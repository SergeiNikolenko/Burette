import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ketcher, Struct } from "ketcher-core";
import { installKetcherBrowserRequire, installKetcherRaphaelBrowserModules } from "../lib/ketcher-browser-require";
import "ketcher-react/dist/index.css";

export type KetcherEditorApi = {
  addFragment: Ketcher["addFragment"];
  getKet: Ketcher["getKet"];
  getMolfile: Ketcher["getMolfile"];
  getSmiles: Ketcher["getSmiles"];
  setMolecule: Ketcher["setMolecule"];
};

type KetcherReactModule = typeof import("ketcher-react");
type EveModule = typeof import("eve-raphael");
type RaphaelModule = typeof import("raphael");
type KetcherCoreModule = typeof import("ketcher-core");
type KetcherStandaloneModule = typeof import("ketcher-standalone");
type KetcherStruct = Struct & { isBlank?: () => boolean };
type KetcherWithEditorStruct = Ketcher & { editor: { struct: () => KetcherStruct } };

installKetcherBrowserRequire();

function installRaphaelBrowserModules(eveModule: EveModule, raphaelModule: RaphaelModule) {
  installKetcherRaphaelBrowserModules(eveModule, raphaelModule);
}

function suppressFilledKetcherSelectionPaths(root: HTMLElement) {
  const rootRect = root.getBoundingClientRect();
  const minWidth = rootRect.width * 0.45;
  const minHeight = rootRect.height * 0.45;

  for (const path of root.querySelectorAll<SVGPathElement>("svg path")) {
    const style = getComputedStyle(path);
    if (style.fill !== "rgb(0, 0, 0)") continue;

    let box: DOMRect | SVGRect;
    try {
      box = path.getBBox();
    } catch {
      continue;
    }

    if (box.width >= minWidth && box.height >= minHeight) {
      path.style.setProperty("fill", "transparent", "important");
    }
  }
}

function createKetcherEditorApi(
  instance: Ketcher,
  MolSerializer: KetcherCoreModule["MolSerializer"],
): KetcherEditorApi {
  return {
    addFragment: instance.addFragment.bind(instance),
    getKet: instance.getKet.bind(instance),
    getMolfile: (async (...args: Parameters<Ketcher["getMolfile"]>) => {
      const molfile = await instance.getMolfile(...args);
      return molfile.trim() ? molfile : serializeCurrentMolfile(instance, MolSerializer);
    }) as Ketcher["getMolfile"],
    getSmiles: instance.getSmiles.bind(instance),
    setMolecule: instance.setMolecule.bind(instance),
  };
}

function serializeCurrentMolfile(instance: Ketcher, MolSerializer: KetcherCoreModule["MolSerializer"]) {
  const struct = (instance as KetcherWithEditorStruct).editor.struct();
  if (struct.isBlank?.()) return "";
  return new MolSerializer().serialize(struct);
}

export function KetcherEditor({
  onReady,
  onStatus,
  onLoadError,
}: {
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
  onLoadError?: (error: Error) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [runtime, setRuntime] = useState<{
    Editor: KetcherReactModule["Editor"];
    MolSerializer: KetcherCoreModule["MolSerializer"];
    StandaloneStructServiceProvider: KetcherStandaloneModule["StandaloneStructServiceProvider"];
  } | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    installKetcherBrowserRequire();
    setLoadError(null);
    setRuntime(null);
    import("eve-raphael")
      .then((eveModule) => (
        import("raphael").then((raphaelModule) => {
          installRaphaelBrowserModules(eveModule, raphaelModule);
        })
      ))
      .then(() => {
        return Promise.all([
          import("ketcher-react"),
          import("ketcher-core"),
          import("ketcher-standalone"),
        ]);
      })
      .then(([reactModule, coreModule, standaloneModule]) => {
        if (cancelled) return;
        setRuntime({
          Editor: reactModule.Editor,
          MolSerializer: coreModule.MolSerializer,
          StandaloneStructServiceProvider: standaloneModule.StandaloneStructServiceProvider,
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

  const structServiceProvider = useMemo(() => {
    if (!runtime) return null;
    return new runtime.StandaloneStructServiceProvider();
  }, [runtime]);

  const handleInit = useCallback((instance: Ketcher) => {
    if (!runtime) return;
    onReady(createKetcherEditorApi(instance, runtime.MolSerializer));
    onStatus("Ready");
  }, [onReady, onStatus, runtime]);

  const handleError = useCallback((message: string) => {
    onStatus(message);
  }, [onStatus]);

  useEffect(() => {
    const root = rootRef.current;
    if (!runtime || !root) return;

    const suppress = () => suppressFilledKetcherSelectionPaths(root);
    suppress();

    const observer = new MutationObserver(suppress);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["d", "fill", "style", "stroke", "stroke-dasharray"],
      childList: true,
      subtree: true,
    });

    const resizeObserver = new ResizeObserver(suppress);
    resizeObserver.observe(root);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [runtime]);

  if (loadError) {
    throw loadError;
  }

  if (!runtime || !structServiceProvider) {
    return <div className="ketcher-loading">Loading editor</div>;
  }

  const { Editor } = runtime;

  return (
    <div ref={rootRef} className="ketcher-editor-root">
      <Editor
        disableMacromoleculesEditor
        staticResourcesUrl={import.meta.env.BASE_URL}
        structServiceProvider={structServiceProvider}
        onInit={handleInit}
        errorHandler={handleError}
      />
    </div>
  );
}
