import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ketcher, Struct } from "ketcher-core";
import { installKetcherBrowserRequire, installKetcherRaphaelBrowserModules } from "../lib/ketcher-browser-require";
import "ketcher-react/dist/index.css";

export type KetcherEditorApi = {
  addFragment: Ketcher["addFragment"];
  addMolfileFragment: (molfile: string) => Promise<void>;
  getKet: Ketcher["getKet"];
  getMolfile: Ketcher["getMolfile"];
  getSmiles: Ketcher["getSmiles"];
  setMolfile: (molfile: string) => Promise<void>;
  setMolecule: Ketcher["setMolecule"];
  switchToMoleculesMode: Ketcher["switchToMoleculesMode"];
};

type KetcherReactModule = typeof import("ketcher-react");
type EveModule = typeof import("eve-raphael");
type RaphaelModule = typeof import("raphael");
type KetcherCoreModule = typeof import("ketcher-core");
type KetcherStandaloneModule = typeof import("ketcher-standalone");
type KetcherStruct = Struct & { isBlank?: () => boolean };
type KetcherDirectEditor = {
  struct: (struct?: Struct, needToCenterStruct?: boolean, x?: number, y?: number) => KetcherStruct;
  structToAddFragment: (struct: Struct, x?: number, y?: number) => KetcherStruct;
  zoomAccordingContent: (struct: Struct) => void;
  centerStruct: () => void;
};
type KetcherWithEditorStruct = Ketcher & { editor: KetcherDirectEditor };
const KETCHER_INSTANCE_RETRY_DELAYS_MS = [0, 250, 500, 1000, 1500, 2500, 4000, 6000] as const;

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
  const api = {
    addFragment: ((...args: Parameters<Ketcher["addFragment"]>) => (
      callKetcherWhenReady(() => instance.addFragment(...args))
    )) as Ketcher["addFragment"],
    addMolfileFragment: async (molfile: string) => {
      addMolfileFragmentDirectly(instance, MolSerializer, molfile);
    },
    getKet: ((...args: Parameters<Ketcher["getKet"]>) => (
      callKetcherWhenReady(() => instance.getKet(...args))
    )) as Ketcher["getKet"],
    getMolfile: (async (...args: Parameters<Ketcher["getMolfile"]>) => {
      const molfile = await callKetcherWhenReady(() => instance.getMolfile(...args));
      return molfile.trim() ? molfile : serializeCurrentMolfile(instance, MolSerializer);
    }) as Ketcher["getMolfile"],
    getSmiles: ((...args: Parameters<Ketcher["getSmiles"]>) => (
      callKetcherWhenReady(() => instance.getSmiles(...args))
    )) as Ketcher["getSmiles"],
    setMolfile: async (molfile: string) => {
      setMolfileDirectly(instance, MolSerializer, molfile);
    },
    setMolecule: ((...args: Parameters<Ketcher["setMolecule"]>) => (
      callKetcherWhenReady(() => instance.setMolecule(...args))
    )) as Ketcher["setMolecule"],
    switchToMoleculesMode: ((...args: Parameters<Ketcher["switchToMoleculesMode"]>) => (
      instance.switchToMoleculesMode(...args)
    )) as Ketcher["switchToMoleculesMode"],
  };
  return api;
}

async function callKetcherWhenReady<T>(operation: () => Promise<T>) {
  let lastError: unknown = null;
  for (const delayMs of KETCHER_INSTANCE_RETRY_DELAYS_MS) {
    if (delayMs > 0) await waitForMs(delayMs);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isKetcherInstanceError(error)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Ketcher operation failed"));
}

function isKetcherInstanceError(error: unknown) {
  return /(?:ketcher instance|find ketcher)/i.test(error instanceof Error ? error.message : String(error));
}

function waitForMs(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function serializeCurrentMolfile(instance: Ketcher, MolSerializer: KetcherCoreModule["MolSerializer"]) {
  const struct = (instance as KetcherWithEditorStruct).editor.struct();
  if (struct.isBlank?.()) return "";
  return new MolSerializer().serialize(struct);
}

function deserializeMolfile(MolSerializer: KetcherCoreModule["MolSerializer"], molfile: string) {
  const struct = new MolSerializer().deserialize(molfile);
  struct.rescale();
  return struct;
}

function setMolfileDirectly(
  instance: Ketcher,
  MolSerializer: KetcherCoreModule["MolSerializer"],
  molfile: string,
) {
  const struct = deserializeMolfile(MolSerializer, molfile);
  const editor = (instance as KetcherWithEditorStruct).editor;
  editor.struct(struct);
  editor.zoomAccordingContent(struct);
  editor.centerStruct();
}

function addMolfileFragmentDirectly(
  instance: Ketcher,
  MolSerializer: KetcherCoreModule["MolSerializer"],
  molfile: string,
) {
  const struct = deserializeMolfile(MolSerializer, molfile);
  const editor = (instance as KetcherWithEditorStruct).editor;
  editor.structToAddFragment(struct);
  editor.zoomAccordingContent(editor.struct());
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
    const api = createKetcherEditorApi(instance, runtime.MolSerializer);
    onReady(api);
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
