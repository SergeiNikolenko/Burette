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
  getSelectedAtomIndexes: () => number[];
  subscribeSelection: (handler: () => void) => () => void;
  setAgentHighlightedAtomIndexes: (indexes: number[]) => void;
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
type KetcherButtonsConfig = NonNullable<ComponentProps<KetcherReactModule["Editor"]>["buttons"]>;
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
    selectionChange?: KetcherSubscription;
  };
  selectionChange?: KetcherSubscription;
  selection?: unknown;
  selectionState?: unknown;
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
const BURETTE_KETCHER_BUTTONS = {
  // Ketcher 3.15 supports this runtime key, but omits it from ButtonName.
  images: { hidden: true },
} as unknown as KetcherButtonsConfig;

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
  MolSerializer: KetcherCoreModule["MolSerializer"],
  getSvgFromDrawnStructures: KetcherCoreModule["getSvgFromDrawnStructures"],
  ZoomTool: KetcherZoomToolConstructor,
  root: HTMLElement | null,
): KetcherEditorApi {
  const editorInstance = instance as KetcherWithEditorStruct;
  const currentZoomTool = () => editorInstance.editor.zoomTool ?? ZoomTool.instance;
  const selectionSource = editorInstance.editor.selectionChange ?? editorInstance.editor.event?.selectionChange;
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
    getSelectedAtomIndexes: () => readSelectedAtomIndexes(editorInstance.editor),
    subscribeSelection: (handler) => subscribeKetcherEvent(selectionSource, handler),
    setAgentHighlightedAtomIndexes: (indexes) => applyAgentHighlights(root, indexes),
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
    setMolecule: ((...args: Parameters<Ketcher["setMolecule"]>) => (
      callKetcherWhenReady(() => instance.setMolecule(...args))
    )) as Ketcher["setMolecule"],
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

function subscribeKetcherEvent(source: KetcherSubscription | undefined, handler: () => void) {
  if (!source?.add || !source.remove) return () => undefined;
  source.add(handler);
  return () => source.remove(handler);
}

function readSelectedAtomIndexes(editor: KetcherDirectEditor) {
  const directSelection = readSelectionIndexes(editor.selection ?? editor.selectionState);
  if (directSelection) return directSelection;

  const struct = editor.struct();
  const atoms = (struct as unknown as { atoms?: unknown }).atoms;
  if (!atoms) return [];
  const selected: number[] = [];
  const collect = (atom: unknown, key?: unknown, fallbackIndex?: number) => {
    if (!isSelectedAtom(atom)) return;
    const candidate = toAtomIndex(key) ?? toAtomIndex((atom as Record<string, unknown> | null)?.index) ?? toAtomIndex((atom as Record<string, unknown> | null)?.id) ?? fallbackIndex;
    if (candidate !== undefined) selected.push(candidate);
  };

  if (Array.isArray(atoms)) {
    atoms.forEach((atom, index) => collect(atom, undefined, index));
  } else if (isRecord(atoms) && typeof atoms.each === "function") {
    (atoms.each as (callback: (atom: unknown, key?: unknown) => void) => void)((atom, key) => collect(atom, key));
  } else if (isRecord(atoms) && typeof atoms.values === "function") {
    const values = (atoms.values as () => Iterable<unknown>)();
    let index = 0;
    for (const atom of values) collect(atom, undefined, index++);
  } else if (isRecord(atoms)) {
    Object.entries(atoms).forEach(([key, atom]) => collect(atom, key));
  }
  return uniqueIndexes(selected);
}

function readSelectionIndexes(selection: unknown): number[] | null {
  if (Array.isArray(selection)) {
    const indexes = selection.flatMap((value) => {
      if (typeof value === "number") return [value];
      if (!isRecord(value)) return [];
      return [value.atomIndex, value.atomId, value.index].map(toAtomIndex).filter((value): value is number => value !== undefined);
    });
    return uniqueIndexes(indexes);
  }
  if (selection instanceof Set) return uniqueIndexes(Array.from(selection).map(toAtomIndex).filter((value): value is number => value !== undefined));
  if (!isRecord(selection)) return null;
  const nested = selection.atoms ?? selection.selectedAtoms ?? selection.atomIndexes ?? selection.indexes;
  if (nested === selection) return null;
  return nested === undefined ? null : readSelectionIndexes(nested);
}

function isSelectedAtom(atom: unknown) {
  if (!isRecord(atom)) return false;
  return atom.selected === true || atom.isSelected === true || atom.highlighted === true;
}

function toAtomIndex(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return undefined;
}

function uniqueIndexes(indexes: number[]) {
  return Array.from(new Set(indexes.filter((index) => Number.isSafeInteger(index) && index >= 0))).sort((left, right) => left - right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function applyAgentHighlights(root: HTMLElement | null, indexes: number[]) {
  if (!root) return;
  const normalized = uniqueIndexes(indexes);
  root.dataset.buretteAgentHighlightedAtoms = normalized.join(",");
  const elements = root.querySelectorAll<SVGElement>("[data-atom-index], [data-atom-id], [data-atom], [id^='atom-'], [id^='atom']");
  for (const element of elements) {
    const candidates = [
      element.getAttribute("data-atom-index"),
      element.getAttribute("data-atom-id"),
      element.getAttribute("data-atom"),
      element.id.replace(/^atom[-_:]?/u, ""),
    ].map(toAtomIndex).filter((value): value is number => value !== undefined);
    const active = candidates.some((candidate) => normalized.includes(candidate) || normalized.includes(candidate - 1));
    element.toggleAttribute("data-burette-agent-highlighted", active);
  }
}

export function KetcherEditor({
  onReady,
  onStatus,
  onOpenFile,
  onLoadError,
}: {
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
  onOpenFile: () => void;
  onLoadError?: (error: Error) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [runtime, setRuntime] = useState<{
    Editor: KetcherReactModule["Editor"];
    getSvgFromDrawnStructures: KetcherCoreModule["getSvgFromDrawnStructures"];
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
    // Keep the React editor API typed against the shared, version-aligned Ketcher core contract.
    const compatibleInstance = instance as unknown as Ketcher;
    onReady(createKetcherEditorApi(compatibleInstance, runtime.MolSerializer, runtime.getSvgFromDrawnStructures, runtime.ZoomTool, rootRef.current));
    onStatus("Ready");
  }, [onReady, onStatus, runtime]);

  const handleError = useCallback((message: string) => {
    onStatus(message);
  }, [onStatus]);

  useEffect(() => {
    const root = rootRef.current;
    if (!runtime || !root) return;

    const interceptFileOpen = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("[data-testid='open-file-button']") : null;
      if (!target || !root.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenFile();
    };
    const suppress = () => suppressFilledKetcherSelectionPaths(root);
    suppress();
    root.addEventListener("click", interceptFileOpen, true);

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
      root.removeEventListener("click", interceptFileOpen, true);
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [onOpenFile, runtime]);

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
        buttons={BURETTE_KETCHER_BUTTONS}
        onInit={handleInit}
        errorHandler={handleError}
      />
    </div>
  );
}
