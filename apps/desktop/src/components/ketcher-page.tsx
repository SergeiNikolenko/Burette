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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import ligandProLogo from "../assets/short-logo-ligandpro.svg";
import { collectionExtension, collectionFamily } from "../lib/collection-documents";
import { readStructureText } from "../lib/structure-text";
import { hasStructureDrag, readStructureDragPayload, structureDragRecordsToFragments, writeStructureDragRecords } from "../lib/structure-drag";
import type { StructureDragRecord } from "../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "./drop-action-executor";
import type { KetcherLocation } from "./editor-area/page-kinds";
import type { KetcherEditorApi } from "./ketcher-editor";
import { RadixDropdownMenu } from "./radix-menu";
import type { KetcherImportRequest, KetcherSketchTarget, ShellActions, ShellViewState } from "./types";

type KetcherEditorComponent = ComponentType<{
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
  onLoadError?: (error: Error) => void;
}>;
type KetcherTextFormat =
  | "smiles"
  | "extended-smiles"
  | "molfile-v2000"
  | "molfile-v3000"
  | "rxn-v2000"
  | "rxn-v3000"
  | "ket"
  | "sdf-v2000"
  | "sdf-v3000"
  | "rdf-v2000"
  | "rdf-v3000"
  | "smarts"
  | "cml"
  | "cdxml"
  | "cdx"
  | "inchi"
  | "inchi-aux"
  | "inchi-key"
  | "svg";
type KetcherPanelMode = {
  purpose: "export" | "import";
  format: KetcherTextFormat;
};

const KETCHER_ZOOM_LEVELS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.64, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 2, 2.5, 3, 3.5, 4] as const;
const DEFAULT_KETCHER_ZOOM = 0.64;
const KETCHER_OUTPUT_DEFAULT_HEIGHT = 58;
const KETCHER_OUTPUT_MIN_HEIGHT = 42;
const KETCHER_OUTPUT_MAX_HEIGHT = 360;
const KETCHER_EXPORT_TIMEOUT_MS = 15000;
const KETCHER_IMPORT_INSTANCE_RETRY_DELAYS_MS = [0, 250, 750, 1500, 2500] as const;
const KETCHER_IMPORT_REQUEST_RETRY_MS = 5000;
type KetcherImportResult = "success" | "transient-failure" | "failure";
const KETCHER_FORMAT_LABELS: Record<KetcherTextFormat, string> = {
  smiles: "SMILES",
  "extended-smiles": "Extended SMILES",
  "molfile-v2000": "Molfile V2000",
  "molfile-v3000": "Molfile V3000",
  "rxn-v2000": "RXN V2000",
  "rxn-v3000": "RXN V3000",
  ket: "KET",
  "sdf-v2000": "SDF V2000",
  "sdf-v3000": "SDF V3000",
  "rdf-v2000": "RDF V2000",
  "rdf-v3000": "RDF V3000",
  smarts: "SMARTS",
  cml: "CML",
  cdxml: "CDXML",
  cdx: "CDX",
  inchi: "InChI",
  "inchi-aux": "InChI + AuxInfo",
  "inchi-key": "InChIKey",
  svg: "SVG",
};
const KETCHER_EXPORT_FORMATS: KetcherTextFormat[] = [
  "smiles",
  "extended-smiles",
  "molfile-v2000",
  "molfile-v3000",
  "rxn-v2000",
  "rxn-v3000",
  "ket",
  "sdf-v2000",
  "sdf-v3000",
  "rdf-v2000",
  "rdf-v3000",
  "smarts",
  "cml",
  "cdxml",
  "cdx",
  "inchi",
  "inchi-aux",
  "inchi-key",
  "svg",
];
const KETCHER_IMPORT_FORMATS: KetcherTextFormat[] = [
  "smiles",
  "extended-smiles",
  "molfile-v2000",
  "molfile-v3000",
  "rxn-v2000",
  "rxn-v3000",
  "ket",
  "sdf-v2000",
  "sdf-v3000",
  "rdf-v2000",
  "rdf-v3000",
  "smarts",
  "cml",
  "cdxml",
  "cdx",
  "inchi",
];
const KETCHER_EXPORT_FILE_EXTENSIONS: Record<KetcherTextFormat, string> = {
  smiles: "smi",
  "extended-smiles": "smi",
  "molfile-v2000": "mol",
  "molfile-v3000": "mol",
  "rxn-v2000": "rxn",
  "rxn-v3000": "rxn",
  ket: "ket",
  "sdf-v2000": "sdf",
  "sdf-v3000": "sdf",
  "rdf-v2000": "rdf",
  "rdf-v3000": "rdf",
  smarts: "smarts",
  cml: "cml",
  cdxml: "cdxml",
  cdx: "cdx",
  inchi: "inchi",
  "inchi-aux": "txt",
  "inchi-key": "txt",
  svg: "svg",
};

function nearestKetcherZoomIndex(value: number) {
  const normalized = normalizeKetcherZoom(value);
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  KETCHER_ZOOM_LEVELS.forEach((zoom, index) => {
    const distance = Math.abs(zoom - normalized);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function normalizeKetcherZoom(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_KETCHER_ZOOM;
  return Math.max(KETCHER_ZOOM_LEVELS[0], Math.min(KETCHER_ZOOM_LEVELS[KETCHER_ZOOM_LEVELS.length - 1], value));
}

function outputPanelMaxHeight() {
  return Math.max(
    KETCHER_OUTPUT_MIN_HEIGHT,
    Math.min(KETCHER_OUTPUT_MAX_HEIGHT, Math.floor(window.innerHeight * 0.42)),
  );
}

function resizedOutputPanelHeight(startHeight: number, startY: number, clientY: number) {
  return Math.max(KETCHER_OUTPUT_MIN_HEIGHT, Math.min(outputPanelMaxHeight(), startHeight + startY - clientY));
}

export function KetcherPage({
  location,
  state,
  actions,
  isActive,
  acceptImportRequests = true,
}: {
  location: KetcherLocation;
  state: ShellViewState;
  actions: ShellActions;
  isActive: boolean;
  acceptImportRequests?: boolean;
}) {
  const [ketcher, setKetcher] = useState<KetcherEditorApi | null>(null);
  const [status, setStatus] = useState("Loading editor");
  const [output, setOutput] = useState("");
  const [panelMode, setPanelMode] = useState<KetcherPanelMode | null>(null);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [editorHasActivated, setEditorHasActivated] = useState(false);
  const [exportingSketch, setExportingSketch] = useState(false);
  const [hasSketch, setHasSketch] = useState(Boolean(
    location.draftKet?.trim() || location.draftMolfile?.trim() || state.ketcherDraftMolfile.trim(),
  ));
  const [ketcherZoom, setKetcherZoom] = useState(DEFAULT_KETCHER_ZOOM);
  const [outputPanelHeight, setOutputPanelHeight] = useState(KETCHER_OUTPUT_DEFAULT_HEIGHT);
  const [selectedCollectionPath, setSelectedCollectionPath] = useState("");
  const [gridEditSource, setGridEditSource] = useState<NonNullable<NonNullable<KetcherImportRequest["fragments"]>[number]["source"]> | null>(null);
  const handledImportRequestIdRef = useRef<number | null>(null);
  const liveSmilesImportSerialRef = useRef(0);
  const locallySavedDraftRef = useRef("");
  const inFlightImportRequestIdRef = useRef<number | null>(null);
  const nextImportRetryAtRef = useRef(0);
  const sketchDragRecordRef = useRef<StructureDragRecord | null>(null);
  const restoredDraftRef = useRef("");
  const shouldMountEditor = isActive || editorHasActivated;
  const ketcherZoomIndex = nearestKetcherZoomIndex(ketcherZoom);
  const ketcherZoomPercent = Math.round(ketcherZoom * 100);
  const panelFormatLabel = panelMode ? KETCHER_FORMAT_LABELS[panelMode.format] : "";
  const ketcherUIScaleStyle = useMemo(() => ({
    "--ketcher-ui-scale": String(ketcherZoom),
  }) as CSSProperties, [ketcherZoom]);
  const outputPanelStyle = useMemo(() => ({
    "--ketcher-output-height": `${outputPanelHeight}px`,
  }) as CSSProperties, [outputPanelHeight]);

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

  const applyDefaultKetcherZoom = useCallback((instance: KetcherEditorApi) => {
    const applyZoom = () => {
      instance.setZoom(DEFAULT_KETCHER_ZOOM);
      setKetcherZoom(DEFAULT_KETCHER_ZOOM);
    };
    applyZoom();
    window.setTimeout(applyZoom, 180);
  }, []);

  const restoreDraft = useCallback((instance: KetcherEditorApi) => {
    if (location.importRequest) return Promise.resolve(false);
    const draftKet = location.draftKet ?? "";
    const draftMolfile = location.draftMolfile ?? state.ketcherDraftMolfile;
    if (!draftKet.trim() && !draftMolfile.trim()) return Promise.resolve(false);
    if (!draftKet.trim() && draftMolfile.trimEnd() === locallySavedDraftRef.current) return Promise.resolve(false);
    const draftKey = JSON.stringify({ draftKet: draftKet.trim(), draftMolfile: draftMolfile.trimEnd() });
    if (restoredDraftRef.current === draftKey) return Promise.resolve(false);
    restoredDraftRef.current = draftKey;
    return restoreKetcherDraft(instance, { ket: draftKet, molfile: draftMolfile })
      .then(() => {
        setOutput("");
        setPanelMode(null);
        setHasSketch(true);
        setStatus("Ready");
        return true;
      })
      .catch((error) => {
        restoredDraftRef.current = "";
        setStatus("Ketcher restore failed: " + (error instanceof Error ? error.message : String(error)));
        return false;
      });
  }, [location.draftKet, location.draftMolfile, location.importRequest, state.ketcherDraftMolfile]);

  const handleReady = useCallback((instance: KetcherEditorApi) => {
    instance.switchToMoleculesMode();
    setKetcher(instance);
    void restoreDraft(instance).finally(() => applyDefaultKetcherZoom(instance));
  }, [applyDefaultKetcherZoom, restoreDraft]);

  useEffect(() => {
    if (!ketcher) return;
    return ketcher.subscribeZoom((zoom) => setKetcherZoom(normalizeKetcherZoom(zoom)));
  }, [ketcher]);

  useEffect(() => {
    if (!ketcher) return;
    return ketcher.subscribeChange(() => {
      void ketcher.getMolfile("v2000")
        .then((molfile) => {
          const hasCurrentSketch = !isBlankKetcherMolfile(molfile);
          setHasSketch(hasCurrentSketch);
          if (hasCurrentSketch) {
            locallySavedDraftRef.current = molfile.trimEnd();
            actions.saveKetcherDraft(molfile);
          }
        })
        .catch(() => {});
    });
  }, [actions, ketcher]);

  useEffect(() => {
    if (!isActive || !ketcher) return;
    restoreDraft(ketcher);
  }, [isActive, ketcher, restoreDraft]);

  useEffect(() => {
    if (!isActive) return;
    if (location.importRequest || state.ketcherImportRequest || peekQueuedKetcherImportRequest()) return;
    setGridEditSource(null);
  }, [isActive, location.importRequest, location.importRequestId, state.ketcherImportRequest]);

  const retryEditorLoad = useCallback(() => {
    setKetcher(null);
    setHasSketch(Boolean(location.draftKet?.trim() || location.draftMolfile?.trim() || state.ketcherDraftMolfile.trim()));
    setStatus("Loading editor");
    setEditorReloadKey((key) => key + 1);
  }, [location.draftKet, location.draftMolfile, state.ketcherDraftMolfile]);

  const collectionTargets = useMemo(() => (
    state.documents
      .filter(isCollectionAppendTarget)
      .map((document) => ({
        path: document.path,
        title: document.title || fileName(document.path),
      }))
  ), [state.documents]);

  useEffect(() => {
    setSelectedCollectionPath((current) => {
      if (current && collectionTargets.some((target) => target.path === current)) return current;
      return collectionTargets[0]?.path ?? "";
    });
  }, [collectionTargets]);

  const showExport = useCallback(async (format: KetcherTextFormat) => {
    if (!ketcher) return;
    if (panelMode?.purpose === "export" && panelMode.format === format) {
      setOutput("");
      setPanelMode(null);
      return;
    }
    const label = KETCHER_FORMAT_LABELS[format];
    setStatus(`Exporting ${label}`);
    try {
      const text = await withKetcherTimeout(exportKetcherText(ketcher, format), `${label} export`);
      setOutput(text || "");
      setPanelMode({ purpose: "export", format });
      if (!navigator.clipboard?.writeText) {
        setStatus(`Exported ${label}`);
        return;
      }
      try {
        await navigator.clipboard.writeText(text || "");
        setStatus(`Exported ${label} and copied`);
      } catch (copyError) {
        const message = copyError instanceof Error ? copyError.message : String(copyError);
        setStatus(`Exported ${label}. Copy failed: ${message}`);
      }
    } catch (error) {
      setStatus(ketcherExportErrorMessage(error));
    }
  }, [ketcher, panelMode]);

  const startImport = useCallback((format: KetcherTextFormat) => {
    setOutput("");
    setPanelMode({ purpose: "import", format });
    setStatus(`Paste ${KETCHER_FORMAT_LABELS[format]} to import`);
  }, []);

  const applyOutput = useCallback(async () => {
    if (!ketcher || panelMode?.purpose !== "import") return;
    const sketch = output.trim();
    const label = KETCHER_FORMAT_LABELS[panelMode.format];
    if (!sketch) {
      setStatus(`Enter ${label}`);
      return;
    }
    try {
      setStatus(`Loading ${label}`);
      const importText = normalizeKetcherImportText(output, panelMode.format);
      await withKetcherTimeout(ketcher.setMolecule(importText, { needZoom: true }), "Sketch import");
      const molfile = await withKetcherTimeout(ketcher.getMolfile("v2000"), "Sketch import verification");
      if (isBlankKetcherMolfile(molfile)) {
        setHasSketch(false);
        setStatus("Ketcher loaded an empty sketch");
        return;
      }
      actions.saveKetcherDraft(molfile);
      setHasSketch(true);
      setStatus("Ready");
    } catch (error) {
      setStatus("Ketcher import failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [actions, ketcher, output, panelMode]);

  useEffect(() => {
    if (!ketcher || panelMode?.purpose !== "import" || panelMode.format !== "smiles") return;
    const smiles = output.trim();
    const serial = liveSmilesImportSerialRef.current + 1;
    liveSmilesImportSerialRef.current = serial;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setStatus(smiles ? "Loading SMILES" : "Clearing sketch");
          await withKetcherTimeout(ketcher.setMolecule(smiles, { needZoom: true }), "SMILES import");
          if (liveSmilesImportSerialRef.current !== serial) return;
          if (!smiles) {
            actions.saveKetcherDraft("");
            setHasSketch(false);
            setStatus("Ready");
            return;
          }
          const molfile = await withKetcherTimeout(ketcher.getMolfile("v2000"), "SMILES import verification");
          if (liveSmilesImportSerialRef.current !== serial) return;
          if (isBlankKetcherMolfile(molfile)) {
            setHasSketch(false);
            setStatus("SMILES did not produce a sketch");
            return;
          }
          locallySavedDraftRef.current = molfile.trimEnd();
          actions.saveKetcherDraft(molfile);
          setHasSketch(true);
          setStatus("Ready");
        } catch (error) {
          if (liveSmilesImportSerialRef.current !== serial) return;
          setStatus("SMILES import failed: " + (error instanceof Error ? error.message : String(error)));
        }
      })();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [actions, ketcher, output, panelMode]);

  const openSketch = useCallback(async (target: KetcherSketchTarget, collectionTargetPath?: string | null) => {
    if (!ketcher || exportingSketch) return;
    setExportingSketch(true);
    try {
      setStatus("Exporting sketch");
      const molfile = await withKetcherTimeout(ketcher.getMolfile("v2000"), "Sketch export");
      if (isBlankKetcherMolfile(molfile)) {
        setStatus("Draw a molecule first");
        return;
      }
      const draftKet = await withKetcherTimeout(ketcher.getKet(), "Sketch draft export");
      actions.saveKetcherDraft(molfile);
      await actions.openKetcherSketch({
        title: "ketcher-sketch.sdf",
        extension: "sdf",
        text: molfileToSdf(molfile),
        draftKet,
        draftMolfile: molfile,
        target,
        collectionTargetPath,
      });
      if (target === "collection") {
        await withKetcherTimeout(ketcher.setMolecule(""), "Canvas reset");
        setOutput("");
        setPanelMode(null);
        setHasSketch(false);
      }
      setStatus(target === "collection" ? "Sent sketch to collection" : `Opened sketch in ${target === "molstar" ? "Molstar" : target}`);
    } catch (error) {
      setStatus(ketcherExportErrorMessage(error));
    } finally {
      setExportingSketch(false);
    }
  }, [actions, exportingSketch, ketcher]);

  const sketchDragRecord = useCallback(async () => {
    if (!ketcher) return null;
    const [smiles, molfile] = await Promise.all([
      ketcher.getSmiles(),
      ketcher.getMolfile("v2000"),
    ]);
    if (!smiles.trim() || !molfile.trim()) return null;
    return {
      path: "ketcher-sketch.sdf",
      inputExtension: "sdf",
      text: molfileToSdf(molfile, smiles),
    };
  }, [ketcher]);

  const prepareSketchDrag = useCallback(() => {
    if (!ketcher) return;
    void sketchDragRecord()
      .then((record) => {
        sketchDragRecordRef.current = record;
      })
      .catch(() => {
        sketchDragRecordRef.current = null;
      });
  }, [ketcher, sketchDragRecord]);

  const handleSketchDragStart = useCallback((event: DragEvent<HTMLElement>) => {
    const record = sketchDragRecordRef.current;
    if (!record || !writeStructureDragRecords(event.dataTransfer, [record])) {
      event.preventDefault();
      setStatus("Draw a molecule first");
      return;
    }
    actions.setStructureDragActive(true);
    setStatus("Dragging Ketcher sketch");
  }, [actions]);

  const addSketchToCollection = useCallback((collectionPath: string | null) => {
    void openSketch("collection", collectionPath);
  }, [openSketch]);

  const copyExportOutput = useCallback(async () => {
    if (panelMode?.purpose !== "export") return;
    try {
      await navigator.clipboard.writeText(output);
      setStatus(`Copied ${KETCHER_FORMAT_LABELS[panelMode.format]}`);
    } catch (error) {
      setStatus("Copy failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [output, panelMode]);

  const openRawExportOutput = useCallback(() => {
    if (panelMode?.purpose !== "export") return;
    const extension = KETCHER_EXPORT_FILE_EXTENSIONS[panelMode.format];
    actions.openKetcherExportRaw({
      title: `ketcher-export-${panelMode.format}.${extension}`,
      extension,
      text: output,
    });
  }, [actions, output, panelMode]);

  const saveExportOutput = useCallback(() => {
    if (panelMode?.purpose !== "export") return;
    const extension = KETCHER_EXPORT_FILE_EXTENSIONS[panelMode.format];
    void actions.saveKetcherExportFile({
      title: `ketcher-export-${panelMode.format}.${extension}`,
      extension,
      text: output,
    });
  }, [actions, output, panelMode]);

  const importStructures = useCallback(async (paths: string[], fragments: NonNullable<KetcherImportRequest["fragments"]> = []): Promise<KetcherImportResult> => {
    if (!ketcher) {
      setStatus("Ketcher is not ready");
      return "transient-failure";
    }
    await waitForKetcherStructServiceReady();
    const cleanPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    const cleanFragments = fragments.filter((fragment) => fragment.text.trim());
    if (cleanPaths.length === 0 && cleanFragments.length === 0) return "failure";
    const itemCount = cleanPaths.length + cleanFragments.length;
    const label = itemCount === 1
      ? (cleanPaths[0] ? fileName(cleanPaths[0]) : cleanFragments[0]?.title || "structure")
      : `${itemCount} structures`;
    for (const attempt of [0, 1]) {
      try {
        setStatus("Adding " + label);
        const editSource = cleanPaths.length === 0 && cleanFragments.length === 1
          ? cleanFragments[0]?.source ?? null
          : null;
        let hasImportedStructure = false;
        const addStructure = async (text: string) => {
          const candidates = ketcherImportCandidates(text);
          if (candidates.length === 0) return;
          if (hasImportedStructure) {
            await importKetcherStructure(ketcher, candidates, (candidate) => loadAdditionalKetcherImportCandidate(ketcher, candidate));
          } else {
            await importKetcherStructure(ketcher, candidates, (candidate) => loadInitialKetcherImportCandidate(ketcher, candidate));
            hasImportedStructure = true;
          }
        };
        for (const path of cleanPaths) {
          const text = await readStructureText(path);
          await addStructure(text);
        }
        for (const fragment of cleanFragments) {
          await addStructure(fragment.text);
        }
        if (hasImportedStructure) {
          const molfile = await withKetcherTimeout(ketcher.getMolfile("v2000"), "Imported sketch export");
          if (!isBlankKetcherMolfile(molfile)) actions.saveKetcherDraft(molfile);
          setHasSketch(true);
        }
        setPanelMode(null);
        setGridEditSource(editSource);
        setOutput("");
        setStatus("Added " + label);
        return "success";
      } catch (error) {
        if (attempt === 0 && isKetcherInstanceError(error)) {
          setStatus("Waiting for Ketcher editor");
          await waitForMs(2000);
          continue;
        }
        if (isKetcherInstanceError(error)) {
          setStatus("Waiting for Ketcher editor");
          setKetcher(null);
          setEditorReloadKey((key) => key + 1);
          return "transient-failure";
        }
        setStatus("Ketcher import failed: " + (error instanceof Error ? error.message : String(error)));
        return "failure";
      }
    }
    return "failure";
  }, [actions, ketcher]);

  const applyGridEdit = useCallback(async () => {
    if (!ketcher || !gridEditSource || exportingSketch) return;
    setExportingSketch(true);
    try {
      setStatus("Applying grid edit");
      const [smiles, molfile] = await Promise.all([
        withKetcherTimeout(ketcher.getSmiles(), "SMILES export"),
        withKetcherTimeout(ketcher.getMolfile("v2000"), "Molfile export"),
      ]);
      if (isBlankKetcherMolfile(molfile)) {
        setStatus("Draw a molecule first");
        return;
      }
      actions.applyKetcherToGridRow({
        documentId: gridEditSource.documentId,
        rowIndex: gridEditSource.rowIndex,
        title: gridEditSource.title,
        extension: "sdf",
        text: molfileToSdf(molfile, smiles),
      });
      setStatus("Applied edit to grid");
    } catch (error) {
      setStatus(ketcherExportErrorMessage(error));
    } finally {
      setExportingSketch(false);
    }
  }, [actions, exportingSketch, gridEditSource, ketcher]);

  const consumeImportRequest = useCallback((request: KetcherImportRequest | null) => {
    if (!request || handledImportRequestIdRef.current === request.id) return;
    if (inFlightImportRequestIdRef.current === request.id) return;
    if (Date.now() < nextImportRetryAtRef.current) return;
    inFlightImportRequestIdRef.current = request.id;
    setGridEditSource(null);
    void importStructures(request.paths, request.fragments).then((result) => {
      if (result === "transient-failure") {
        setGridEditSource(null);
        nextImportRetryAtRef.current = Date.now() + KETCHER_IMPORT_REQUEST_RETRY_MS;
        return;
      }
      handledImportRequestIdRef.current = request.id;
      nextImportRetryAtRef.current = 0;
      takeQueuedKetcherImportRequest(request.id);
      actions.clearKetcherImportRequest(request.id);
    }).catch((error: unknown) => {
      setGridEditSource(null);
      handledImportRequestIdRef.current = request.id;
      nextImportRetryAtRef.current = 0;
      takeQueuedKetcherImportRequest(request.id);
      actions.clearKetcherImportRequest(request.id);
      setStatus("Ketcher import failed: " + (error instanceof Error ? error.message : String(error)));
    }).finally(() => {
      if (inFlightImportRequestIdRef.current === request.id) {
        inFlightImportRequestIdRef.current = null;
      }
    });
  }, [actions, importStructures]);

  useEffect(() => {
    if (!acceptImportRequests || !isActive || !ketcher) return;
    consumeImportRequest(location.importRequest ?? state.ketcherImportRequest ?? peekQueuedKetcherImportRequest());
  }, [acceptImportRequests, consumeImportRequest, isActive, ketcher, location.importRequest, location.importRequestId, state.ketcherImportRequest]);

  useEffect(() => {
    if (!acceptImportRequests || !isActive || !ketcher) return undefined;
    const handleQueuedImport = (event: Event) => {
      consumeImportRequest((event as CustomEvent<KetcherImportRequest>).detail ?? peekQueuedKetcherImportRequest());
    };
    window.addEventListener("burette:ketcher-import", handleQueuedImport);
    const pollId = window.setInterval(() => {
      consumeImportRequest(location.importRequest ?? peekQueuedKetcherImportRequest());
    }, 250);
    return () => {
      window.removeEventListener("burette:ketcher-import", handleQueuedImport);
      window.clearInterval(pollId);
    };
  }, [acceptImportRequests, consumeImportRequest, isActive, ketcher, location.importRequest, location.importRequestId]);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasStructureDrag(event.dataTransfer)) return;
    const payload = readStructureDragPayload(event.dataTransfer);
    if (shellDropActionChoices(payload, { kind: "ketcher" }, { kind: "ketcher" }).length === 0) return;
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
    const choices = shellDropActionChoices(payload, { kind: "ketcher" }, { kind: "ketcher" });
    if (choices.length === 0) return;
    runShellDropActionChoices(actions, payload, choices.slice(0, 1), { x: event.clientX, y: event.clientY }, {
      importKetcherStructures: (actionPayload) => {
        if (!ketcher) return false;
        void importStructures(actionPayload.paths, structureDragRecordsToFragments(actionPayload.records));
        return true;
      },
    });
  }, [actions, importStructures, ketcher]);

  const decreaseKetcherScale = useCallback(() => {
    if (!ketcher) return;
    const nextZoom = KETCHER_ZOOM_LEVELS[Math.max(0, nearestKetcherZoomIndex(ketcherZoom) - 1)];
    ketcher.setZoom(nextZoom);
    setKetcherZoom(nextZoom);
  }, [ketcher, ketcherZoom]);

  const increaseKetcherScale = useCallback(() => {
    if (!ketcher) return;
    const nextZoom = KETCHER_ZOOM_LEVELS[Math.min(KETCHER_ZOOM_LEVELS.length - 1, nearestKetcherZoomIndex(ketcherZoom) + 1)];
    ketcher.setZoom(nextZoom);
    setKetcherZoom(nextZoom);
  }, [ketcher, ketcherZoom]);

  const resizeOutputPanel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const resizeTarget = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = outputPanelHeight;

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      setOutputPanelHeight(resizedOutputPanelHeight(startHeight, startY, moveEvent.clientY));
    };

    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== pointerId) return;
      resizeTarget.removeEventListener("pointermove", move);
      resizeTarget.removeEventListener("pointerup", stop);
      resizeTarget.removeEventListener("pointercancel", stop);
      resizeTarget.removeEventListener("lostpointercapture", stop);
      if (resizeTarget.hasPointerCapture(pointerId)) {
        resizeTarget.releasePointerCapture(pointerId);
      }
    };

    resizeTarget.setPointerCapture(pointerId);
    resizeTarget.addEventListener("pointermove", move);
    resizeTarget.addEventListener("pointerup", stop);
    resizeTarget.addEventListener("pointercancel", stop);
    resizeTarget.addEventListener("lostpointercapture", stop);
  }, [outputPanelHeight]);

  const resizeOutputPanelWithMouse = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = outputPanelHeight;

    const move = (moveEvent: MouseEvent) => {
      setOutputPanelHeight(resizedOutputPanelHeight(startHeight, startY, moveEvent.clientY));
    };

    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }, [outputPanelHeight]);

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
          <span
            className="ketcher-page-icon"
            aria-hidden="true"
            draggable={Boolean(ketcher)}
            data-ketcher-sketch-drag-source
            onPointerDown={prepareSketchDrag}
            onMouseEnter={prepareSketchDrag}
            onFocus={prepareSketchDrag}
            onDragStart={handleSketchDragStart}
            onDragEnd={() => actions.setStructureDragActive(false)}
          >
            <KetcherLogo />
          </span>
          <div>
            <h1>Ketcher</h1>
            <p>{hasSketch ? "Small molecule sketch" : "New small molecule sketch"}</p>
          </div>
        </div>
        <div className="ketcher-page-actions" aria-label="Sketch actions">
          <button type="button" disabled={!ketcher || exportingSketch} onClick={() => void openSketch("grid")}>Grid</button>
          <button type="button" disabled={!ketcher || exportingSketch} onClick={() => void openSketch("molstar")}>Molstar</button>
          <button type="button" disabled={!ketcher || exportingSketch} onClick={() => void openSketch("xyzrender")}>xyzrender</button>
          <RadixDropdownMenu
            align="end"
            items={[
              ...(collectionTargets.length === 0
                ? [{
                    kind: "item" as const,
                    id: "no-open-collections",
                    text: "No open SDF collections",
                    disabled: true,
                  }]
                : collectionTargets.map((target) => ({
                    kind: "item" as const,
                    id: `collection-${target.path}`,
                    text: target.path === selectedCollectionPath ? `✓ ${target.title}` : target.title,
                    action: () => {
                      setSelectedCollectionPath(target.path);
                      addSketchToCollection(target.path);
                    },
                  }))),
              { kind: "separator" as const },
              {
                kind: "item" as const,
                id: "new-collection",
                text: "New collection...",
                action: () => addSketchToCollection(null),
              },
            ]}
            trigger={(
              <button type="button" disabled={!ketcher || exportingSketch}>
                Add to collection
              </button>
            )}
          />
          <div className="ketcher-scale-control" aria-label="Ketcher scale">
            <button type="button" aria-label="Decrease Ketcher scale" disabled={!ketcher || ketcherZoomIndex === 0} onClick={decreaseKetcherScale}>-</button>
            <span>{ketcherZoomPercent}%</span>
            <button type="button" aria-label="Increase Ketcher scale" disabled={!ketcher || ketcherZoomIndex === KETCHER_ZOOM_LEVELS.length - 1} onClick={increaseKetcherScale}>+</button>
          </div>
        </div>
      </header>
      <div className="ketcher-page-body">
        <div
          className="ketcher-editor-shell"
          data-drop-active={dropActive || undefined}
          style={ketcherUIScaleStyle}
        >
          <div className="ketcher-editor-scale-frame">
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
          </div>
          {!hasSketch ? <img className="ketcher-empty-watermark" src={ligandProLogo} alt="" aria-hidden="true" /> : null}
          {dropActive && (
            <div className="ketcher-drop-overlay">
              <div>Add to Ketcher</div>
            </div>
          )}
        </div>
        {panelMode ? (
          <div className="ketcher-output-panel" style={outputPanelStyle}>
            <button
              type="button"
              className="ketcher-output-resizer"
              aria-label="Resize Ketcher output panel"
              onPointerDown={resizeOutputPanel}
              onMouseDown={resizeOutputPanelWithMouse}
            />
            <textarea
              className="ketcher-output ketcher-output-input"
              aria-label={`${panelMode.purpose === "import" ? "Import" : "Export"} ${panelFormatLabel}`}
              readOnly={panelMode.purpose === "export"}
              spellCheck={false}
              value={output}
              onChange={(event) => setOutput(event.target.value)}
            />
          </div>
        ) : null}
      </div>
      <footer className="ketcher-page-footer">
        <span className="ketcher-page-status">{status}</span>
        <RadixDropdownMenu
          align="end"
          side="top"
          items={KETCHER_EXPORT_FORMATS.map((format) => ({
            kind: "item" as const,
            id: `export-${format}`,
            text: KETCHER_FORMAT_LABELS[format],
            action: () => void showExport(format),
          }))}
          trigger={(
            <button type="button" className={panelMode?.purpose === "export" ? "is-active" : undefined} disabled={!ketcher}>
              Export
            </button>
          )}
        />
        <RadixDropdownMenu
          align="end"
          side="top"
          items={KETCHER_IMPORT_FORMATS.map((format) => ({
            kind: "item" as const,
            id: `import-${format}`,
            text: KETCHER_FORMAT_LABELS[format],
            action: () => startImport(format),
          }))}
          trigger={(
            <button type="button" className={panelMode?.purpose === "import" ? "is-active" : undefined} disabled={!ketcher}>
              Import
            </button>
          )}
        />
        {panelMode?.purpose === "export" ? (
          <>
            <button type="button" disabled={!output} onClick={() => void copyExportOutput()}>
              Copy
            </button>
            <button type="button" disabled={!output} onClick={saveExportOutput}>
              Save
            </button>
            <button type="button" className="ketcher-primary-action" disabled={!output} onClick={openRawExportOutput}>
              Open raw
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ketcher-primary-action"
            disabled={!ketcher || exportingSketch || (gridEditSource ? false : panelMode?.purpose !== "import" || !output.trim())}
            onClick={() => void (gridEditSource ? applyGridEdit() : applyOutput())}
          >
            {gridEditSource ? "Apply" : "Load"}
          </button>
        )}
      </footer>
    </section>
  );
}

function molfileToSdf(molfile: string, smiles?: string) {
  const normalizedMolfile = normalizeKetcherMolfileTitle(molfile.trimEnd());
  const fields = smiles?.trim()
    ? ["> <SMILES>", smiles.trim(), ""]
    : [];
  return [
    normalizedMolfile,
    ...fields,
    "$$$$",
    "",
  ].join("\n");
}

function exportKetcherText(ketcher: KetcherEditorApi, format: KetcherTextFormat) {
  switch (format) {
    case "smiles":
      return ketcher.getSmiles();
    case "extended-smiles":
      return ketcher.getExtendedSmiles();
    case "molfile-v2000":
      return ketcher.getMolfile("v2000");
    case "molfile-v3000":
      return ketcher.getMolfile("v3000");
    case "rxn-v2000":
      return ketcher.getRxn("v2000");
    case "rxn-v3000":
      return ketcher.getRxn("v3000");
    case "ket":
      return ketcher.getKet();
    case "sdf-v2000":
      return ketcher.getSdf("v2000");
    case "sdf-v3000":
      return ketcher.getSdf("v3000");
    case "rdf-v2000":
      return ketcher.getRdf("v2000");
    case "rdf-v3000":
      return ketcher.getRdf("v3000");
    case "smarts":
      return ketcher.getSmarts();
    case "cml":
      return ketcher.getCml();
    case "cdxml":
      return ketcher.getCDXml();
    case "cdx":
      return ketcher.getCDX();
    case "inchi":
      return ketcher.getInchi();
    case "inchi-aux":
      return ketcher.getInchi(true);
    case "inchi-key":
      return ketcher.getInChIKey();
    case "svg":
      return Promise.resolve(ketcher.getSvg());
  }
}

function normalizeKetcherMolfileTitle(molfile: string) {
  const lines = molfile.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex >= 0 && /^Ketcher\b/u.test(lines[titleIndex].trim())) {
    lines[titleIndex] = "Ketcher sketch";
  }
  normalizeKetcherMolfileHeader(lines);
  return lines.join("\n");
}

function normalizeKetcherMolfileHeader(lines: string[]) {
  const countsIndex = lines.findIndex(isMolfileCountsLine);
  if (countsIndex < 0 || countsIndex >= 3) return;
  while (lines.findIndex(isMolfileCountsLine) < 3) {
    const nextCountsIndex = lines.findIndex(isMolfileCountsLine);
    lines.splice(nextCountsIndex, 0, "");
  }
}

function isMolfileCountsLine(line: string) {
  return /^\s*\d+\s+\d+(?:\s+\d+){4,}\s+V(?:2000|3000)\s*$/u.test(line);
}

function isBlankKetcherMolfile(molfile: string) {
  if (!molfile.trim()) return true;
  const normalized = molfile.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const v3000Counts = /\nM\s+V30\s+COUNTS\s+(\d+)\s+(\d+)\b/u.exec(normalized);
  if (v3000Counts) return v3000Counts[1] === "0" && v3000Counts[2] === "0";
  const countsLine = normalized.split("\n").find(isMolfileCountsLine);
  if (!countsLine) return false;
  const counts = countsLine.trim().split(/\s+/u);
  return counts[0] === "0" && counts[1] === "0";
}

async function restoreKetcherDraft(instance: KetcherEditorApi, draft: { ket?: string; molfile?: string }) {
  const candidates = Array.from(new Set([
    draft.ket?.trim(),
    draft.molfile?.trimEnd(),
    draft.molfile ? normalizeKetcherImportText(molfileToSdf(draft.molfile)) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()))));

  await importKetcherStructure(instance, candidates, (candidate) => loadInitialKetcherImportCandidate(instance, candidate));
}

function isCollectionAppendTarget(document: ShellViewState["documents"][number]) {
  if (collectionFamily(collectionExtension(document.path)) !== "sdf") return false;
  if (document.virtual || document.mergedCollection) return false;
  const normalizedPath = document.path.replace(/\\/g, "/");
  if (/^burrete-(ketcher|collection):\/\//u.test(normalizedPath)) return false;
  if (/\/viewer\/(ketcher|merged)\//u.test(normalizedPath)) return false;
  return true;
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

function isKetcherInstanceError(error: unknown) {
  return /(?:ketcher instance|find ketcher)/i.test(error instanceof Error ? error.message : String(error));
}

function takeQueuedKetcherImportRequest(id?: number) {
  const targetWindow = window as Window & { __buretteKetcherImportRequest?: KetcherImportRequest | null };
  const request = targetWindow.__buretteKetcherImportRequest ?? null;
  if (request && (id == null || request.id === id)) {
    targetWindow.__buretteKetcherImportRequest = null;
  }
  return request;
}

function peekQueuedKetcherImportRequest() {
  const targetWindow = window as Window & { __buretteKetcherImportRequest?: KetcherImportRequest | null };
  return targetWindow.__buretteKetcherImportRequest ?? null;
}

function ketcherImportCandidates(text: string) {
  return Array.from(new Set([
    normalizeKetcherImportText(text),
    text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd(),
  ].map((candidate) => candidate.trimEnd()).filter(Boolean)));
}

async function importKetcherStructure(
  instance: KetcherEditorApi,
  candidates: string[],
  loadCandidate: (candidate: string) => Promise<void>,
) {
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      await loadKetcherImportCandidate(candidate, loadCandidate);
      await waitForKetcherCanvasUpdate();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Ketcher import failed"));
}

async function loadKetcherImportCandidate(candidate: string, loadCandidate: (candidate: string) => Promise<void>) {
  let lastError: unknown = null;
  for (const delayMs of KETCHER_IMPORT_INSTANCE_RETRY_DELAYS_MS) {
    if (delayMs > 0) await waitForMs(delayMs);
    try {
      await withKetcherTimeout(loadCandidate(candidate), "Ketcher import");
      return;
    } catch (error) {
      lastError = error;
      if (!isKetcherInstanceError(error)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Ketcher import failed"));
}

function loadInitialKetcherImportCandidate(instance: KetcherEditorApi, candidate: string) {
  return looksLikeMolBlock(candidate)
    ? instance.setMolfile(candidate)
    : instance.setMolecule(candidate, { needZoom: true });
}

function loadAdditionalKetcherImportCandidate(instance: KetcherEditorApi, candidate: string) {
  return looksLikeMolBlock(candidate)
    ? instance.addMolfileFragment(candidate)
    : instance.addFragment(candidate, { needZoom: true });
}

function waitForKetcherCanvasUpdate() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function waitForKetcherStructServiceReady() {
  return new Promise<void>((resolve) => {
    let settled = false;
    let fallbackId = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("struct-service-initialized", finish);
      window.clearTimeout(fallbackId);
      resolve();
    };
    window.addEventListener("struct-service-initialized", finish, { once: true });
    fallbackId = window.setTimeout(finish, 750);
  });
}

function waitForMs(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function normalizeKetcherImportText(text: string, format?: KetcherTextFormat) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (
    looksLikeMolBlock(normalized) ||
    looksLikeSdfRecord(normalized) ||
    format === "ket" ||
    format?.startsWith("rxn-") ||
    format?.startsWith("rdf-") ||
    format === "cml" ||
    format === "cdxml" ||
    format === "cdx"
  ) {
    return normalized;
  }
  return normalized.trim();
}

function looksLikeMolBlock(text: string) {
  return /\nM\s+END(?:\n|$)/u.test(text);
}

function looksLikeSdfRecord(text: string) {
  return looksLikeMolBlock(text) && /\n?\$\$\$\$\s*$/u.test(text);
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
