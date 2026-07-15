import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import type { Ketcher, Struct } from "ketcher-core";
import { installKetcherBrowserRequire, installKetcherRaphaelBrowserModules } from "../lib/ketcher-browser-require";
import "ketcher-react/dist/index.css";

export type KetcherEditorApi = {
  addFragment: Ketcher["addFragment"];
  addMolfileFragment: (molfile: string) => Promise<void>;
  containsReaction: Ketcher["containsReaction"];
  getAxoLabs: Ketcher["getAxoLabs"];
  getCDX: Ketcher["getCDX"];
  getCDXml: Ketcher["getCDXml"];
  getCml: Ketcher["getCml"];
  getExtendedSmiles: Ketcher["getExtendedSmiles"];
  getFasta: Ketcher["getFasta"];
  getIdt: Ketcher["getIdt"];
  getInchi: Ketcher["getInchi"];
  getInChIKey: Ketcher["getInChIKey"];
  getZoom: () => number;
  getKet: Ketcher["getKet"];
  getMolfile: Ketcher["getMolfile"];
  getRdf: Ketcher["getRdf"];
  getRxn: Ketcher["getRxn"];
  getSdf: Ketcher["getSdf"];
  getSequence: Ketcher["getSequence"];
  getSmiles: Ketcher["getSmiles"];
  setMolfile: (molfile: string) => Promise<void>;
  getSmarts: Ketcher["getSmarts"];
  getSvg: () => string;
  setHelm: Ketcher["setHelm"];
  setMolecule: Ketcher["setMolecule"];
  setZoom: Ketcher["setZoom"];
  switchToMoleculesMode: Ketcher["switchToMoleculesMode"];
  subscribeChange: (handler: () => void) => () => void;
  subscribeZoom: (handler: (zoom: number) => void) => () => void;
};

type KetcherReactModule = typeof import("ketcher-react");
type KetcherReactInstance = Parameters<NonNullable<ComponentProps<KetcherReactModule["Editor"]>["onInit"]>>[0];
type EveModule = typeof import("eve-raphael");
type RaphaelModule = typeof import("raphael");
type KetcherCoreModule = typeof import("ketcher-core");
type KetcherStandaloneModule = typeof import("ketcher-standalone");
type KetcherStruct = Struct & { isBlank?: () => boolean };
type KetcherSubscription = {
  add: (handler: () => void) => void;
  remove: (handler: () => void) => void;
};
type KetcherZoomTool = {
  getZoomLevel?: () => number;
  subscribeOnZoomEvent?: (handler: (transform?: { k?: number }) => void) => void;
  unsubscribeOnZoomEvent?: (handler: (transform?: { k?: number }) => void) => void;
  zoomTo?: (zoom: number) => void;
};
type KetcherZoomToolConstructor = {
  instance?: KetcherZoomTool;
};
type KetcherDirectEditor = {
  canvas?: SVGSVGElement;
  event?: {
    zoomChanged?: {
      dispatch?: (zoom: number) => void;
    };
  };
  struct: (struct?: Struct, needToCenterStruct?: boolean, x?: number, y?: number) => KetcherStruct;
  structToAddFragment: (struct: Struct, x?: number, y?: number) => KetcherStruct;
  zoom: (value?: number) => number;
  zoomAccordingContent: (struct: Struct) => void;
  zoomTool?: KetcherZoomTool;
  centerStruct: () => void;
};
type KetcherWithEditorStruct = Ketcher & {
  editor: KetcherDirectEditor;
  changeEvent?: KetcherSubscription;
};
const KETCHER_INSTANCE_RETRY_DELAYS_MS = [0, 250, 500, 1000, 1500, 2500, 4000, 6000] as const;
const USE_DIRECT_KETCHER_TEXT_IMPORT = import.meta.env.VITE_BURRETE_WEB_DEMO === "1";

declare global {
  interface Window {
    isPolymerEditorTurnedOn?: boolean;
  }
}

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

    let box: DOMRect  ;
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
  ChemicalMimeType: KetcherCoreModule["ChemicalMimeType"],
  MolSerializer: KetcherCoreModule["MolSerializer"],
  getSvgFromDrawnStructures: KetcherCoreModule["getSvgFromDrawnStructures"],
  ZoomTool: KetcherZoomToolConstructor,
): KetcherEditorApi {
  const editorInstance = instance as KetcherWithEditorStruct;
  const currentZoomTool = () => editorInstance.editor.zoomTool ?? ZoomTool.instance;
  const api: KetcherEditorApi = {
    addFragment: ((...args: Parameters<Ketcher["addFragment"]>) => (
      callKetcherWhenReady(() => instance.addFragment(...args))
    )) as Ketcher["addFragment"],
    addMolfileFragment: async (molfile: string) => {
      addMolfileFragmentDirectly(instance, MolSerializer, molfile);
    },
    containsReaction: instance.containsReaction.bind(instance),
    getAxoLabs: ((...args: Parameters<Ketcher["getAxoLabs"]>) => (
      callKetcherWhenReady(() => instance.getAxoLabs(...args))
    )) as Ketcher["getAxoLabs"],
    getCDX: ((...args: Parameters<Ketcher["getCDX"]>) => (
      callKetcherWhenReady(() => instance.getCDX(...args))
    )) as Ketcher["getCDX"],
    getCDXml: ((...args: Parameters<Ketcher["getCDXml"]>) => (
      callKetcherWhenReady(() => instance.getCDXml(...args))
    )) as Ketcher["getCDXml"],
    getCml: ((...args: Parameters<Ketcher["getCml"]>) => (
      callKetcherWhenReady(() => instance.getCml(...args))
    )) as Ketcher["getCml"],
    getExtendedSmiles: ((...args: Parameters<Ketcher["getExtendedSmiles"]>) => (
      callKetcherWhenReady(() => instance.getExtendedSmiles(...args))
    )) as Ketcher["getExtendedSmiles"],
    getFasta: ((...args: Parameters<Ketcher["getFasta"]>) => (
      callKetcherWhenReady(() => instance.getFasta(...args))
    )) as Ketcher["getFasta"],
    getIdt: ((...args: Parameters<Ketcher["getIdt"]>) => (
      callKetcherWhenReady(() => instance.getIdt(...args))
    )) as Ketcher["getIdt"],
    getInchi: ((...args: Parameters<Ketcher["getInchi"]>) => (
      callKetcherWhenReady(() => instance.getInchi(...args))
    )) as Ketcher["getInchi"],
    getInChIKey: ((...args: Parameters<Ketcher["getInChIKey"]>) => (
      callKetcherWhenReady(() => instance.getInChIKey(...args))
    )) as Ketcher["getInChIKey"],
    getZoom: () => currentKetcherZoom(editorInstance, currentZoomTool()),
    getKet: ((...args: Parameters<Ketcher["getKet"]>) => (
      callKetcherWhenReady(() => instance.getKet(...args))
    )) as Ketcher["getKet"],
    getMolfile: (async (...args: Parameters<Ketcher["getMolfile"]>) => {
      const molfile = await callKetcherWhenReady(() => instance.getMolfile(...args));
      return molfile.trim() ? molfile : serializeCurrentMolfile(instance, MolSerializer);
    }) as Ketcher["getMolfile"],
    getRdf: ((...args: Parameters<Ketcher["getRdf"]>) => (
      callKetcherWhenReady(() => instance.getRdf(...args))
    )) as Ketcher["getRdf"],
    getRxn: ((...args: Parameters<Ketcher["getRxn"]>) => (
      callKetcherWhenReady(() => instance.getRxn(...args))
    )) as Ketcher["getRxn"],
    getSdf: ((...args: Parameters<Ketcher["getSdf"]>) => (
      callKetcherWhenReady(() => instance.getSdf(...args))
    )) as Ketcher["getSdf"],
    getSequence: ((...args: Parameters<Ketcher["getSequence"]>) => (
      callKetcherWhenReady(() => instance.getSequence(...args))
    )) as Ketcher["getSequence"],
    getSmiles: ((...args: Parameters<Ketcher["getSmiles"]>) => (
      callKetcherWhenReady(() => instance.getSmiles(...args))
    )) as Ketcher["getSmiles"],
    getSmarts: ((...args: Parameters<Ketcher["getSmarts"]>) => (
      callKetcherWhenReady(() => instance.getSmarts(...args))
    )) as Ketcher["getSmarts"],
    getSvg: () => {
      const svg = editorInstance.editor.canvas
        ? getSvgFromDrawnStructures(editorInstance.editor.canvas, "file", 20)
        : undefined;
      if (!svg) throw new Error("Cannot export SVG");
      return svg;
    },
    setHelm: ((...args: Parameters<Ketcher["setHelm"]>) => (
      callKetcherWhenReady(() => instance.setHelm(...args))
    )) as Ketcher["setHelm"],
    setMolfile: async (molfile: string) => {
      setMolfileDirectly(instance, MolSerializer, molfile);
    },
    setMolecule: (async (structure, options) => {
      if (!USE_DIRECT_KETCHER_TEXT_IMPORT || !structure.trim()) {
        await callKetcherWhenReady(() => instance.setMolecule(structure, options));
        return;
      }
      const converted = await callKetcherWhenReady(() => instance.structService.convert({
        struct: structure,
        output_format: ChemicalMimeType.Mol,
      }));
      setMolfileDirectly(instance, MolSerializer, converted.struct);
    }) as Ketcher["setMolecule"],
    setZoom: ((value: number) => {
      editorInstance.editor.zoomTool?.zoomTo?.(value);
      editorInstance.editor.zoom(value);
      editorInstance.editor.event?.zoomChanged?.dispatch?.(value);
      instance.setZoom(value);
    }) as Ketcher["setZoom"],
    switchToMoleculesMode: ((...args: Parameters<Ketcher["switchToMoleculesMode"]>) => (
      instance.switchToMoleculesMode(...args)
    )) as Ketcher["switchToMoleculesMode"],
    subscribeChange: (handler: () => void) => {
      editorInstance.changeEvent?.add(handler);
      return () => editorInstance.changeEvent?.remove(handler);
    },
    subscribeZoom: (handler: (zoom: number) => void) => {
      const zoomTool = currentZoomTool();
      const zoomHandler = (transform?: { k?: number }) => handler(normalizeZoom(transform?.k ?? currentKetcherZoom(editorInstance, zoomTool)));
      zoomTool?.subscribeOnZoomEvent?.(zoomHandler);
      return () => zoomTool?.unsubscribeOnZoomEvent?.(zoomHandler);
    },
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

function currentKetcherZoom(instance: KetcherWithEditorStruct, zoomTool?: KetcherZoomTool) {
  return normalizeZoom(zoomTool?.getZoomLevel?.() ?? instance.editor.zoomTool?.getZoomLevel?.() ?? instance.editor.zoom());
}

function normalizeZoom(value: unknown) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1;
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
    getSvgFromDrawnStructures: KetcherCoreModule["getSvgFromDrawnStructures"];
    ChemicalMimeType: KetcherCoreModule["ChemicalMimeType"];
    MolSerializer: KetcherCoreModule["MolSerializer"];
    StandaloneStructServiceProvider: KetcherStandaloneModule["StandaloneStructServiceProvider"];
    ZoomTool: KetcherZoomToolConstructor;
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
          import("ketcher-standalone/dist/binaryWasm"),
        ]);
      })
      .then(([reactModule, coreModule, standaloneModule]) => {
        if (cancelled) return;
        setRuntime({
          Editor: reactModule.Editor,
          getSvgFromDrawnStructures: coreModule.getSvgFromDrawnStructures,
          ChemicalMimeType: coreModule.ChemicalMimeType,
          MolSerializer: coreModule.MolSerializer,
          StandaloneStructServiceProvider: standaloneModule.StandaloneStructServiceProvider,
          ZoomTool: coreModule.ZoomTool,
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

  const handleInit = useCallback((instance: KetcherReactInstance) => {
    if (!runtime) return;
    // ketcher-react can resolve its own ketcher-core copy; both expose the same runtime API.
    const compatibleInstance = instance as unknown as Ketcher;
    onReady(createKetcherEditorApi(compatibleInstance, runtime.ChemicalMimeType, runtime.MolSerializer, runtime.getSvgFromDrawnStructures, runtime.ZoomTool));
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
        staticResourcesUrl={import.meta.env.BASE_URL}
        structServiceProvider={structServiceProvider}
        onInit={handleInit}
        errorHandler={handleError}
      />
    </div>
  );
}
