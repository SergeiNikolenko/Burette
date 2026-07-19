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
import { createPortal } from "react-dom";

import ligandProLogo from "../assets/short-logo-ligandpro.svg";
import { collectionExtension, collectionFamily as collectionFamilyForExtension, type CollectionFamily } from "../lib/collection-documents";
import { detectKetcherImportFormat, normalizeKetcherSmilesImport } from "../lib/ketcher-import-format";
import { readStructureText } from "../lib/structure-text";
import { isTauriRuntime } from "../lib/tauri";
import { hasStructureDrag, readStructureDragPayload, structureDragRecordsToFragments, writeStructureDragRecords } from "../lib/structure-drag";
import { resolveThemeMode, useSystemThemeMode } from "../lib/theme";
import type { StructureDragRecord } from "../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "./drop-action-executor";
import type { KetcherLocation } from "./editor-area/page-kinds";
import type { KetcherEditorApi } from "./ketcher-editor";
import { RadixDropdownMenu, showRadixContextMenu } from "./radix-menu";
import { ShortcutTooltip } from "./shortcut-tooltip";
import type { KetcherImportRequest, KetcherSketchTarget, KetcherSource3D, ShellActions, ShellViewState } from "./types";

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
type KetcherPanelMode =
  | { purpose: "export"; format: KetcherTextFormat }
  | { purpose: "import"; format: KetcherTextFormat | "auto" };

const KETCHER_ZOOM_LEVELS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 2, 2.5, 3, 3.5, 4] as const;
const DEFAULT_KETCHER_ZOOM = 1;
const KETCHER_OUTPUT_DEFAULT_HEIGHT = 58;
const KETCHER_OUTPUT_MIN_HEIGHT = 42;
const KETCHER_OUTPUT_MAX_HEIGHT = 360;
const KETCHER_EXPORT_TIMEOUT_MS = 15000;
const KETCHER_IMPORT_INSTANCE_RETRY_DELAYS_MS = [0, 250, 750, 1500, 2500] as const;
const KETCHER_IMPORT_REQUEST_RETRY_MS = 5000;
type KetcherImportResult = "success" | "transient-failure" | "failure";
const IS_KETCHER_WEB_DEMO = import.meta.env.VITE_BURRETE_WEB_DEMO === "1";
let ketcherStructServiceReady = false;
if (typeof window !== "undefined") {
  window.addEventListener("struct-service-initialized", () => {
    ketcherStructServiceReady = true;
  }, { once: true });
}
const KETCHER_TOOLTIP_ATTRIBUTE = "data-burette-ketcher-tooltip";
const KETCHER_TOOLTIP_SELECTOR = [
  '[data-testid="top-toolbar"] button',
  '[data-testid="top-toolbar"] [role="button"]',
  '[data-testid="bottom-toolbar"] button',
  '[data-testid="bottom-toolbar"] [role="button"]',
  '[data-testid="left-toolbar"] button',
  '[data-testid="left-toolbar"] [role="button"]',
  '[data-testid="right-toolbar"] button',
  '[data-testid="right-toolbar"] [role="button"]',
  '[data-testid="polymer-toggler"]',
  '[data-testid="molecules_mode"]',
  '[data-testid="macromolecules_mode"]',
  '[data-testid="zoom-selector"]',
  '[data-testid="zoom-out"]',
  '[data-testid="zoom-in"]',
  '[data-testid="zoom-default"]',
  '[data-testid="monomer-library"] button',
  '[data-testid="monomer-library"] [role="button"]',
].join(", ");
const KETCHER_TOOLTIP_LABELS: Record<string, string> = {
  "clear-canvas": "Clear the drawing canvas",
  "open-file-button": "Open a molecule file",
  "save-file-button": "Save the current structure",
  "copy-button": "Copy the selection",
  "copy-mol-button": "Copy as MOL",
  "copy-ket-button": "Copy as KET",
  "copy-image-button": "Copy as image",
  "copy-button-dropdown-triangle": "Choose copy format",
  "paste-button": "Paste a structure",
  "cut-button": "Cut the selection",
  undo: "Undo the last action",
  redo: "Redo the last action",
  "Aromatize button": "Aromatize the structure",
  "Dearomatize button": "Dearomatize the structure",
  "Layout button": "Arrange the structure layout",
  "Clean Up button": "Clean up the structure drawing",
  "Calculate CIP button": "Calculate CIP stereochemistry",
  "Check Structure button": "Check the structure",
  "Calculated Values button": "Calculate molecular values",
  "Add/Remove explicit hydrogens button": "Add or remove explicit hydrogens",
  "3D Viewer button": "Open the 3D viewer",
  "polymer-toggler": "Switch between molecule and macromolecule modes",
  "molecules_mode": "Use molecule drawing mode",
  "macromolecules_mode": "Use macromolecule editor mode",
  "settings-button": "Open Ketcher settings",
  "help-button": "Open Ketcher help",
  "about-button": "Show Ketcher information",
  "fullscreen-mode-button": "Toggle fullscreen mode",
  "zoom-selector": "Open Ketcher zoom controls",
  "zoom-out": "Zoom out",
  "zoom-in": "Zoom in",
  "zoom-default": "Reset zoom to 100%",
  "H-button": "Hydrogen atom tool",
  "C-button": "Carbon atom tool",
  "N-button": "Nitrogen atom tool",
  "O-button": "Oxygen atom tool",
  "S-button": "Sulfur atom tool",
  "P-button": "Phosphorus atom tool",
  "F-button": "Fluorine atom tool",
  "Cl-button": "Chlorine atom tool",
  "Br-button": "Bromine atom tool",
  "I-button": "Iodine atom tool",
  "PT-button": "Open periodic table",
  "ET-button": "Open extended atom table",
  hand: "Pan the canvas",
  "select-rectangle": "Select with a rectangle",
  "select-lasso": "Select with lasso",
  "select-fragment": "Select a fragment",
  erase: "Erase atoms or bonds",
  bonds: "Choose a bond tool",
  "bond-single": "Single bond tool",
  "bond-double": "Double bond tool",
  "bond-triple": "Triple bond tool",
  "bond-up": "Stereo up bond tool",
  "bond-down": "Stereo down bond tool",
  "bond-updown": "Wavy stereo bond tool",
  "bond-crossed": "Crossed double bond tool",
  chain: "Draw a carbon chain",
  "enhanced-stereo": "Enhanced stereochemistry tool",
  "charge-plus": "Add positive charge",
  "charge-minus": "Add negative charge",
  sgroup: "S-group tool",
  rgroup: "R-group tools",
  "reaction-plus": "Add reaction plus sign",
  arrows: "Choose a reaction arrow",
  "reaction-mapping-tools": "Reaction mapping tools",
  shapes: "Choose a shape tool",
  text: "Add text annotation",
  image: "Add image",
  "template-lib": "Open template library",
};
const KETCHER_FORMAT_LABELS: Record<KetcherTextFormat | "auto", string> = {
  auto: "Auto",
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
const KETCHER_FORMAT_DETAILS: Record<KetcherTextFormat | "auto", string> = {
  auto: "Detect the structure format from its contents.",
  smiles: "Compact one-line molecule notation.",
  "extended-smiles": "SMILES with Ketcher extended annotations.",
  "molfile-v2000": "Legacy MDL MOL structure format.",
  "molfile-v3000": "MDL MOL format for larger or richer structures.",
  "rxn-v2000": "Legacy MDL reaction format.",
  "rxn-v3000": "Reaction format for larger or richer reactions.",
  ket: "Native Ketcher JSON format.",
  "sdf-v2000": "SDF collection record using V2000 molfile blocks.",
  "sdf-v3000": "SDF collection record using V3000 molfile blocks.",
  "rdf-v2000": "Reaction data file using V2000 blocks.",
  "rdf-v3000": "Reaction data file using V3000 blocks.",
  smarts: "Substructure query pattern.",
  cml: "Chemical Markup Language XML.",
  cdxml: "ChemDraw XML document.",
  cdx: "ChemDraw binary document.",
  inchi: "IUPAC identifier string.",
  "inchi-aux": "InChI plus auxiliary atom mapping data.",
  "inchi-key": "Hashed InChIKey identifier.",
  svg: "Vector image of the current sketch.",
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
const KETCHER_IMPORT_FORMATS: Array<KetcherTextFormat | "auto"> = [
  "auto",
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
const DEFAULT_KETCHER_EXPORT_FORMAT: KetcherTextFormat = "sdf-v2000";
const DEFAULT_KETCHER_IMPORT_FORMAT = "auto" as const;
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

function readableKetcherTooltip(value: string) {
  const normalized = value
    .replace(/\b(button|dropdown|selector)\b/gi, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function ketcherTooltipLabel(target: HTMLElement) {
  const existingLabel = target.getAttribute("aria-label")?.trim();
  if (existingLabel) return existingLabel;

  const testId = target.getAttribute("data-testid") || target.querySelector<HTMLElement>("[data-testid]")?.getAttribute("data-testid") || "";
  if (testId && KETCHER_TOOLTIP_LABELS[testId]) return KETCHER_TOOLTIP_LABELS[testId];

  const title = target.getAttribute("title")?.trim();
  if (title) return title;

  const text = target.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (text === "Molecules") return KETCHER_TOOLTIP_LABELS["molecules_mode"];
  if (text === "Macromolecules") return KETCHER_TOOLTIP_LABELS["macromolecules_mode"];
  if (/^\d+%$/.test(text)) return KETCHER_TOOLTIP_LABELS["zoom-selector"];
  if (text.length > 0 && text.length <= 32) return text;

  return testId ? readableKetcherTooltip(testId) : "";
}

function applyKetcherTooltips(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(KETCHER_TOOLTIP_SELECTOR).forEach((target) => {
    const label = ketcherTooltipLabel(target);
    if (!label) return;
    if (!target.getAttribute("title")) {
      target.setAttribute("title", label);
    }
    if (!target.getAttribute("aria-label")) {
      target.setAttribute("aria-label", label);
    }
    target.setAttribute(KETCHER_TOOLTIP_ATTRIBUTE, "true");
  });
}

function installKetcherTooltips(root: HTMLElement) {
  applyKetcherTooltips(root);
  const observer = new MutationObserver(() => applyKetcherTooltips(root));
  observer.observe(root, {
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
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
  const [dockPortalElement, setDockPortalElement] = useState<HTMLElement | null>(null);
  const [liveImportDirty, setLiveImportDirty] = useState(false);
  const [selectedCollectionPath, setSelectedCollectionPath] = useState("");
  const [gridEditSource, setGridEditSource] = useState<NonNullable<NonNullable<KetcherImportRequest["fragments"]>[number]["source"]> | null>(null);
  const [preserved3dSource, setPreserved3dSource] = useState<KetcherSource3D | null>(null);
  const handledImportRequestIdRef = useRef<number | null>(null);
  const liveImportSerialRef = useRef(0);
  const locallySavedDraftRef = useRef("");
  const inFlightImportRequestIdRef = useRef<number | null>(null);
  const nextImportRetryAtRef = useRef(0);
  const sketchDragRecordRef = useRef<StructureDragRecord | null>(null);
  const restoredDraftRef = useRef("");
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const shouldMountEditor = isActive || editorHasActivated;
  const systemThemeMode = useSystemThemeMode();
  const ketcherThemeMode = resolveThemeMode(state.preferences.theme, systemThemeMode);
  const nextKetcherTheme = ketcherThemeMode === "dark" ? "light" : "dark";
  const ketcherThemeLabel = nextKetcherTheme === "light" ? "Light" : "Dark";
  const ketcherThemeTitle = `Switch to ${nextKetcherTheme} theme`;
  const ketcherZoomIndex = nearestKetcherZoomIndex(ketcherZoom);
  const ketcherZoomPercent = Math.round(ketcherZoom * 100);
  const detectedImportFormat = useMemo(() => detectKetcherImportFormat(output), [output]);
  const panelFormatLabel = panelMode
    ? panelMode.purpose === "import" && panelMode.format === "auto" && output.trim()
      ? `Auto · ${KETCHER_FORMAT_LABELS[detectedImportFormat]}`
      : KETCHER_FORMAT_LABELS[panelMode.format]
    : "";
  const ketcherUIScaleStyle = useMemo(() => ({
    "--ketcher-ui-scale": String(ketcherZoom),
  }) as CSSProperties, [ketcherZoom]);
  const outputPanelStyle = useMemo(() => ({
    "--ketcher-output-height": `${outputPanelHeight}px`,
  }) as CSSProperties, [outputPanelHeight]);

  useEffect(() => {
    if (!panelMode) {
      setDockPortalElement(null);
      return undefined;
    }
    const syncPortalElement = () => {
      setDockPortalElement(document.querySelector<HTMLElement>('[data-ketcher-dock-portal="bottom"]'));
    };
    syncPortalElement();
    const frameId = window.requestAnimationFrame(syncPortalElement);
    return () => window.cancelAnimationFrame(frameId);
  }, [panelMode, state.bottomDockOpen, state.bottomDockTool]);

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
    if (panelMode?.purpose === "import" && liveImportDirty) return Promise.resolve(false);
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
        setPreserved3dSource(null);
        setStatus("Ready");
        return true;
      })
      .catch((error) => {
        restoredDraftRef.current = "";
        setStatus("Ketcher restore failed: " + (error instanceof Error ? error.message : String(error)));
        return false;
      });
  }, [liveImportDirty, location.draftKet, location.draftMolfile, location.importRequest, panelMode, state.ketcherDraftMolfile]);

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
    if (!shouldMountEditor || !editorShellRef.current) return undefined;
    return installKetcherTooltips(editorShellRef.current);
  }, [editorReloadKey, shouldMountEditor]);

  useEffect(() => {
    if (!ketcher) return;
    return ketcher.subscribeChange(() => {
      void ketcher.getMolfile("v2000")
        .then((molfile) => {
          const hasCurrentSketch = !isBlankKetcherMolfile(molfile);
          setHasSketch(hasCurrentSketch);
          if (!hasCurrentSketch) setPreserved3dSource(null);
          if (hasCurrentSketch) {
            locallySavedDraftRef.current = molfile.trimEnd();
            actions.saveKetcherDraft(molfile);
          } else {
            locallySavedDraftRef.current = "";
            actions.saveKetcherDraft("");
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

  const showExport = useCallback((format: KetcherTextFormat) => {
    if (!ketcher) return;
    const label = KETCHER_FORMAT_LABELS[format];
    setStatus(`Exporting ${label}`);
    setOutput("");
    setPanelMode({ purpose: "export", format });
  }, [ketcher]);

  useEffect(() => {
    if (!ketcher || panelMode?.purpose !== "export") return undefined;
    let cancelled = false;
    let exportSerial = 0;
    let timerId: number | null = null;
    const format = panelMode.format;
    const label = KETCHER_FORMAT_LABELS[format];
    const refreshExport = () => {
      const serial = exportSerial + 1;
      exportSerial = serial;
      void withKetcherTimeout(exportKetcherText(ketcher, format), `${label} export`)
        .then((text) => {
          if (cancelled || serial !== exportSerial) return;
          setOutput(text || "");
          setStatus(`Exported ${label}`);
        })
        .catch((error) => {
          if (cancelled || serial !== exportSerial) return;
          setStatus(ketcherExportErrorMessage(error));
        });
    };
    const scheduleRefresh = () => {
      if (timerId !== null) window.clearTimeout(timerId);
      timerId = window.setTimeout(refreshExport, 180);
    };
    refreshExport();
    const unsubscribe = ketcher.subscribeChange(scheduleRefresh);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      unsubscribe();
    };
  }, [ketcher, panelMode]);

  const startImport = useCallback((format: KetcherTextFormat | "auto") => {
    setLiveImportDirty(false);
    setOutput((current) => (panelMode?.purpose === "import" && panelMode.format === format ? current : ""));
    setPanelMode({ purpose: "import", format });
    setStatus(`Paste ${KETCHER_FORMAT_LABELS[format]} to import`);
  }, [panelMode]);

  const selectExportFormat = useCallback((format: KetcherTextFormat) => {
    actions.setDockTool("bottom", "ketcher");
    showExport(format);
  }, [actions, showExport]);

  const selectImportFormat = useCallback((format: KetcherTextFormat | "auto") => {
    actions.setDockTool("bottom", "ketcher");
    startImport(format);
  }, [actions, startImport]);

  const exportFormatItems = useMemo(() => KETCHER_EXPORT_FORMATS.map((format) => ({
    kind: "item" as const,
    id: `export-${format}`,
    text: KETCHER_FORMAT_LABELS[format],
    detail: `Export ${KETCHER_FORMAT_DETAILS[format]}`,
    action: () => selectExportFormat(format),
  })), [selectExportFormat]);

  const importFormatItems = useMemo(() => KETCHER_IMPORT_FORMATS.map((format) => ({
    kind: "item" as const,
    id: `import-${format}`,
    text: KETCHER_FORMAT_LABELS[format],
    detail: `Import ${KETCHER_FORMAT_DETAILS[format]}`,
    action: () => selectImportFormat(format),
  })), [selectImportFormat]);

  const openDefaultExportPanel = useCallback(() => {
    if (!ketcher) return;
    selectExportFormat(panelMode?.purpose === "export" ? panelMode.format : DEFAULT_KETCHER_EXPORT_FORMAT);
  }, [ketcher, panelMode, selectExportFormat]);

  const openDefaultImportPanel = useCallback(() => {
    if (!ketcher) return;
    selectImportFormat(panelMode?.purpose === "import" ? panelMode.format : DEFAULT_KETCHER_IMPORT_FORMAT);
  }, [ketcher, panelMode, selectImportFormat]);

  const showExportFormatMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!ketcher) return;
    event.preventDefault();
    showRadixContextMenu(exportFormatItems, { x: event.clientX, y: event.clientY });
  }, [exportFormatItems, ketcher]);

  const showImportFormatMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!ketcher) return;
    event.preventDefault();
    showRadixContextMenu(importFormatItems, { x: event.clientX, y: event.clientY });
  }, [importFormatItems, ketcher]);

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
      const format = panelMode.format === "auto" ? detectKetcherImportFormat(output) : panelMode.format;
      const importText = normalizeKetcherImportText(output, format);
      if (IS_KETCHER_WEB_DEMO && ketcherImportUsesStructService(format)) await waitForKetcherStructServiceReady();
      await withKetcherTimeout(loadInteractiveKetcherImport(ketcher, importText, format), "Sketch import");
      await waitForKetcherCanvasUpdate();
      const molfile = await withKetcherTimeout(ketcher.getMolfile("v2000"), "Sketch import verification");
      if (isBlankKetcherMolfile(molfile)) {
        setHasSketch(false);
        setStatus("Ketcher loaded an empty sketch");
        return;
      }
      actions.saveKetcherDraft(molfile);
      setPreserved3dSource(null);
      setHasSketch(true);
      setStatus("Ready");
    } catch (error) {
      setStatus("Ketcher import failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [actions, ketcher, output, panelMode]);

  useEffect(() => {
    if (!ketcher || panelMode?.purpose !== "import" || !liveImportDirty) return;
    const format = panelMode.format === "auto" ? detectedImportFormat : panelMode.format;
    const importText = normalizeKetcherImportText(output, format);
    const label = KETCHER_FORMAT_LABELS[format];
    const serial = liveImportSerialRef.current + 1;
    liveImportSerialRef.current = serial;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (liveImportSerialRef.current !== serial) return;
        try {
          setStatus(importText ? `Loading ${label}` : "Clearing sketch");
          if (IS_KETCHER_WEB_DEMO && importText && ketcherImportUsesStructService(format)) {
            await waitForKetcherStructServiceReady();
          }
          await withKetcherTimeout(loadInteractiveKetcherImport(ketcher, importText, format), `${label} import`);
          await waitForKetcherCanvasUpdate();
          if (liveImportSerialRef.current !== serial) return;
          if (!importText) {
            actions.saveKetcherDraft("");
            setPreserved3dSource(null);
            setHasSketch(false);
            setStatus("Ready");
            return;
          }
          const molfile = await withKetcherTimeout(ketcher.getMolfile("v2000"), `${label} import verification`);
          if (liveImportSerialRef.current !== serial) return;
          if (isBlankKetcherMolfile(molfile)) {
            setHasSketch(false);
            setStatus(`${label} did not produce a sketch`);
            return;
          }
          locallySavedDraftRef.current = molfile.trimEnd();
          actions.saveKetcherDraft(molfile);
          setPreserved3dSource(null);
          setHasSketch(true);
          setStatus("Ready");
        } catch (error) {
          if (liveImportSerialRef.current !== serial) return;
          setStatus(`${label} import failed: ` + (error instanceof Error ? error.message : String(error)));
        }
      })();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [actions, detectedImportFormat, ketcher, liveImportDirty, output, panelMode]);

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
      const collectionFamily = target === "collection"
        ? collectionFamilyForExtension(collectionExtension(collectionTargetPath ?? "")) ?? "sdf"
        : "sdf";
      const collectionRecord = target === "collection"
        ? await ketcherCollectionRecord(ketcher, molfile, collectionFamily)
        : null;
      actions.saveKetcherDraft(molfile);
      await actions.openKetcherSketch({
        title: collectionRecord?.title ?? "ketcher-sketch.sdf",
        extension: collectionRecord?.extension ?? "sdf",
        text: collectionRecord?.text ?? molfileToSdf(molfile),
        draftKet,
        draftMolfile: molfile,
        source3d: ["generate3d", "generateEnsemble", "optimizeGeometry", "semiempiricalRm1"].includes(target)
          ? preserved3dSource ?? undefined
          : undefined,
        target,
        collectionTargetPath,
      });
      if (target === "collection") {
        await withKetcherTimeout(ketcher.setMolecule(""), "Canvas reset");
        setOutput("");
        setPanelMode(null);
        setHasSketch(false);
        setPreserved3dSource(null);
      }
      setStatus(target === "collection"
        ? "Sent sketch to collection"
        : target === "generate3d"
          ? "Generated 3D conformer"
          : `Opened sketch in ${target === "molstar" ? "Molstar" : target}`);
    } catch (error) {
      setStatus(target === "generate3d"
        ? "3D generation failed: " + (error instanceof Error ? error.message : String(error))
        : ketcherExportErrorMessage(error));
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
        let source3d: KetcherSource3D | null = null;
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
          if (itemCount === 1) {
            source3d = { title: fileName(path), extension: fileExtension(path) || "sdf", text };
          }
          await addStructure(text);
        }
        for (const fragment of cleanFragments) {
          if (itemCount === 1) {
            source3d = fragment.source3d ?? {
              title: fragment.title || "structure",
              extension: fileExtension(fragment.title) || "sdf",
              text: fragment.text,
            };
          }
          await addStructure(fragment.text);
        }
        if (hasImportedStructure) {
          const molfile = await withKetcherTimeout(ketcher.getMolfile("v2000"), "Imported sketch export");
          if (!isBlankKetcherMolfile(molfile)) actions.saveKetcherDraft(molfile);
          setHasSketch(true);
          setPreserved3dSource(source3d);
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
    const payload = readStructureDragPayload(event.dataTransfer);
    const choices = shellDropActionChoices(payload, { kind: "ketcher" }, { kind: "ketcher" });
    if (choices.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    actions.setStructureDragActive(false);
    setDropActive(false);
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
            <p>{hasSketch ? "Ketcher sketch" : "New Ketcher sketch"}</p>
          </div>
        </div>
        <div className="ketcher-page-actions" aria-label="Sketch actions">
          <button type="button" aria-label="Open sketch as 2D grid" disabled={!ketcher || exportingSketch} onClick={() => void openSketch("grid")}>
            Grid
            <ShortcutTooltip label="Open sketch as 2D grid" />
          </button>
          <button type="button" aria-label="Open sketch in Molstar" disabled={!ketcher || exportingSketch} onClick={() => void openSketch("molstar")}>
            Molstar
            <ShortcutTooltip label="Open sketch in Molstar" />
          </button>
          <button type="button" aria-label="Open sketch in xyzrender" disabled={!ketcher || exportingSketch} onClick={() => void openSketch("xyzrender")}>
            xyzrender
            <ShortcutTooltip label="Open sketch in xyzrender" />
          </button>
          <RadixDropdownMenu
            align="end"
            sideOffset={4}
            contentClassName="compute-command-menu"
            items={[
              {
                kind: "item",
                id: "compute-generate-3d",
                text: "Generate 3D",
                detail: "ETKDGv3",
                disabled: !isTauriRuntime(),
                action: () => void openSketch("generate3d"),
              },
              {
                kind: "item",
                id: "compute-generate-ensemble",
                text: "Generate Ensemble",
                detail: "16 conformers",
                disabled: !isTauriRuntime(),
                action: () => void openSketch("generateEnsemble"),
              },
              { kind: "separator" },
              {
                kind: "item",
                id: "compute-optimize",
                text: "Optimize geometry",
                detail: preserved3dSource ? "MMFF94s" : "Needs 3D",
                disabled: !isTauriRuntime() || !preserved3dSource,
                action: () => void openSketch("optimizeGeometry"),
              },
              {
                kind: "item",
                id: "compute-rm1",
                text: "RM1 energy & charges",
                detail: preserved3dSource ? "RM1" : "Needs 3D",
                disabled: !isTauriRuntime() || !preserved3dSource,
                action: () => void openSketch("semiempiricalRm1"),
              },
              ...(!isTauriRuntime() ? [
                { kind: "separator" as const },
                {
                  kind: "item" as const,
                  id: "compute-desktop-only",
                  text: "Desktop app required",
                  disabled: true,
                },
              ] : []),
            ]}
            trigger={(
              <button className="ketcher-compute-trigger" type="button" disabled={!ketcher || exportingSketch} aria-label="Open molecular compute menu">
                <span>Compute</span>
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <ShortcutTooltip label="Native molecular compute" />
              </button>
            )}
          />
          <RadixDropdownMenu
            align="end"
            items={[
              ...(collectionTargets.length === 0
                ? [{
                    kind: "item" as const,
                    id: "no-open-collections",
                    text: "No open molecule collections",
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
              <button type="button" aria-label="Add sketch to SDF collection" disabled={!ketcher || exportingSketch}>
                Add to collection
                <ShortcutTooltip label="Add sketch to SDF collection" />
              </button>
            )}
          />
          <div className="ketcher-scale-control" aria-label="Ketcher scale">
            <button type="button" aria-label="Decrease Ketcher scale" disabled={!ketcher || ketcherZoomIndex === 0} onClick={decreaseKetcherScale}>
              -
              <ShortcutTooltip label="Decrease Ketcher scale" />
            </button>
            <span>{ketcherZoomPercent}%</span>
            <button type="button" aria-label="Increase Ketcher scale" disabled={!ketcher || ketcherZoomIndex === KETCHER_ZOOM_LEVELS.length - 1} onClick={increaseKetcherScale}>
              +
              <ShortcutTooltip label="Increase Ketcher scale" />
            </button>
          </div>
          <button
            type="button"
            className="ketcher-theme-control"
            aria-label={ketcherThemeTitle}
            onClick={() => actions.setPreference("theme", nextKetcherTheme)}
          >
            {ketcherThemeLabel}
            <ShortcutTooltip label={ketcherThemeTitle} />
          </button>
        </div>
      </header>
      <div className="ketcher-page-body">
        <div
          ref={editorShellRef}
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
          {dropActive && (
            <div className="ketcher-drop-overlay">
              <div>Add to Ketcher</div>
            </div>
          )}
        </div>
      </div>
      <footer className="ketcher-page-footer">
        <span className="ketcher-page-status">{status}</span>
        <button
          type="button"
          className={panelMode?.purpose === "export" ? "is-active" : undefined}
          disabled={!ketcher}
          onClick={openDefaultExportPanel}
          onContextMenu={showExportFormatMenu}
        >
          Export
          <ShortcutTooltip label="Export sketch to a text or image format" side="top" />
        </button>
        <button
          type="button"
          className={panelMode?.purpose === "import" ? "is-active" : undefined}
          disabled={!ketcher}
          onClick={openDefaultImportPanel}
          onContextMenu={showImportFormatMenu}
        >
          Import
          <ShortcutTooltip label="Import structure text into Ketcher" side="top" />
        </button>
      </footer>
      {panelMode && dockPortalElement ? createPortal((
        <section className="ketcher-dock-workflow" data-mode={panelMode.purpose} aria-label={`${panelMode.purpose === "import" ? "Import" : "Export"} panel`}>
          <div className="ketcher-dock-toolbar">
            <div className="ketcher-dock-title">
              <strong>{panelMode.purpose === "import" ? "Import" : "Export"}</strong>
              <span>{status}</span>
            </div>
            <span className="ketcher-dock-format">{panelFormatLabel}</span>
          </div>
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
              onChange={(event) => {
                setOutput(event.target.value);
                if (panelMode.purpose === "import") setLiveImportDirty(true);
              }}
            />
          </div>
          <div className="ketcher-dock-actions">
            {panelMode.purpose === "export" ? (
              <>
                <button type="button" disabled={!output} onClick={() => void copyExportOutput()}>
                  Copy
                  <ShortcutTooltip label="Copy exported text" side="top" />
                </button>
                <button type="button" disabled={!output} onClick={saveExportOutput}>
                  Save
                  <ShortcutTooltip label="Save exported output to a file" side="top" />
                </button>
                <button type="button" className="ketcher-primary-action" disabled={!output} onClick={openRawExportOutput}>
                  Open raw
                  <ShortcutTooltip label="Open exported text in a raw document tab" side="top" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ketcher-primary-action"
                disabled={!ketcher || exportingSketch || (gridEditSource ? false : !output.trim())}
                onClick={() => void (gridEditSource ? applyGridEdit() : applyOutput())}
              >
                {gridEditSource ? "Apply" : "Load"}
                <ShortcutTooltip label={gridEditSource ? "Apply Ketcher edits to the grid row" : "Load imported text into Ketcher"} side="top" />
              </button>
            )}
          </div>
        </section>
      ), dockPortalElement) : null}
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
      return exportKetcherSdf(ketcher, "v2000");
    case "sdf-v3000":
      return exportKetcherSdf(ketcher, "v3000");
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

function exportKetcherSdf(ketcher: KetcherEditorApi, version: "v2000" | "v3000") {
  return ketcher.getMolfile(version).then((molfile) => molfileToSdf(molfile));
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
  if (!collectionFamilyForExtension(collectionExtension(document.path))) return false;
  if (document.virtual || document.mergedCollection) return false;
  const normalizedPath = document.path.replace(/\\/g, "/");
  if (/^burrete-(ketcher|collection):\/\//u.test(normalizedPath)) return false;
  if (/\/viewer\/(ketcher|merged)\//u.test(normalizedPath)) return false;
  return true;
}

async function ketcherCollectionRecord(ketcher: KetcherEditorApi, molfile: string, family: CollectionFamily) {
  if (family === "sdf") {
    return {
      title: "ketcher-sketch.sdf",
      extension: "sdf" as const,
      text: molfileToSdf(molfile),
    };
  }

  const smiles = (await withKetcherTimeout(ketcher.getSmiles(), "Sketch SMILES export")).trim();
  if (!smiles) throw new Error("Ketcher did not return SMILES for this sketch.");
  if (family === "smiles") {
    return {
      title: "ketcher-sketch.smi",
      extension: "smi" as const,
      text: `${smiles} Ketcher sketch\n`,
    };
  }

  const separator = family === "tsv" ? "\t" : ",";
  const extension = family === "tsv" ? ("tsv" as const) : ("csv" as const);
  return {
    title: `ketcher-sketch.${extension}`,
    extension,
    text: `smiles${separator}name\n${escapeDelimitedCell(smiles, separator)}${separator}Ketcher sketch\n`,
  };
}

function escapeDelimitedCell(value: string, separator: string) {
  const needsQuotes = value.includes(separator) || value.includes('"') || /[\r\n]/u.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
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
    normalizeKetcherImportText(text, detectKetcherImportFormat(text)),
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

function loadInteractiveKetcherImport(instance: KetcherEditorApi, text: string, format: KetcherTextFormat) {
  return ketcherImportUsesStructService(format)
    ? instance.setMolecule(text, { needZoom: true })
    : instance.setMolfile(firstMolBlock(text));
}

function ketcherImportUsesStructService(format: KetcherTextFormat) {
  return !format.startsWith("molfile-") && !format.startsWith("sdf-");
}

function firstMolBlock(text: string) {
  return /[\s\S]*?\nM\s+END(?:\n|$)/u.exec(text)?.[0] ?? text;
}

function waitForKetcherCanvasUpdate() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function waitForKetcherStructServiceReady() {
  if (ketcherStructServiceReady) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    let fallbackId = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("struct-service-initialized", markReady);
      window.clearTimeout(fallbackId);
      resolve();
    };
    const markReady = () => {
      ketcherStructServiceReady = true;
      finish();
    };
    window.addEventListener("struct-service-initialized", markReady, { once: true });
    if (!IS_KETCHER_WEB_DEMO) fallbackId = window.setTimeout(finish, 750);
  });
}

function waitForMs(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function normalizeKetcherImportText(text: string, format?: KetcherTextFormat) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (format === "smiles") return normalizeKetcherSmilesImport(normalized);
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

function fileExtension(path: string) {
  const name = fileName(path);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
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
