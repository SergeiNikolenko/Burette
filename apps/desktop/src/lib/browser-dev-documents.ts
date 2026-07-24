import { collectionExtension, mergeCollectionSources, parseSdfCollectionRecords } from "./collection-documents";
import { runBrowserDevMetalConformer } from "./browser-dev-compute";
import { parseDataWarrior } from "./datawarrior";
import type { DockingDocumentRequest, DockingSceneMode, OpenDocumentsResult, ViewerDocument, ViewerPreferences, ViewerReloadOptions, XyzrenderControls } from "../types";
import previewFormatRegistry from "../../../../config/preview-formats.json";

type FormatInfo = {
  molstarFormat: string;
  binary: boolean;
  externalOnly: boolean;
  canOpenInVesta: boolean;
};

export type GridRecord = {
  index: number;
  name: string;
  smiles?: string;
  molblock?: string;
  idcode?: string;
  idcoordinates?: string;
  props: Record<string, string>;
  descriptors?: Record<string, {
    label: string;
    value: number | string | boolean | null;
    missingKind?: string | null;
    errorText?: string | null;
  }>;
};

type Atom = {
  symbol: string;
  x: number;
  y: number;
  z: number;
};

type ConvertedStructureData = {
  bytes: Uint8Array;
  molstarFormat: string;
  stagedEntries?: Array<Record<string, unknown>>;
};

type BrowserDevTrajectoryPair = {
  label: string;
  byteCount: number;
  sourcePath: string;
  sourceExtension: string;
  topologyPath: string;
  trajectoryPath: string;
  docking: {
    activePose: number | null;
    sceneMode: DockingSceneMode | null;
    receptor: Record<string, unknown>;
    ligands: Array<Record<string, unknown>>;
  };
  payloads: {
    receptor: { dataBase64: string };
    ligands: Array<{ dataBase64: string }>;
  };
};

type PharmacophoreFeature = {
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  vector?: PharmacophoreVector | null;
};

type PharmacophoreVector = {
  x: number;
  y: number;
  z: number;
};

type PharmacophoreSphere = {
  x: number;
  y: number;
  z: number;
  radius: number;
};

type PharmacophorePreview = {
  features: PharmacophoreFeature[];
  connectors: Array<[number, number]>;
  volumeSpheres: PharmacophoreSphere[];
  structurePdb?: string | null;
};

type MaestroAtom = Atom & {
  atomName: string;
  residueName: string;
  residueNumber: number;
  chainName: string;
};

type MaestroPdbBlock = {
  ctType: string;
  atoms: MaestroAtom[];
};

const MAX_STRUCTURE_FILE_SIZE = 75 * 1024 * 1024;
const MAESTRO_PREVIEW_READ_LIMIT = 64 * 1024 * 1024;
const MAESTRO_PREVIEW_ATOM_LIMIT = 3000;
const MAESTRO_PDB_PREVIEW_ATOM_LIMIT = 99999;
const XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT = 1500;
const KETCHER_EDIT_MAX_BYTES = 1024 * 1024;
const KETCHER_EDIT_MAX_ATOMS = 300;
const BOHR_TO_ANGSTROM = 0.529177210903;
const BROWSER_DEV_OPEN_CONCURRENCY = 4;
const GRID_ASSET_VERSION = "grid-ui-v143";
const VIEWER_ASSET_VERSION = "viewer-ui-v67";
const REPO_ROOT = String(import.meta.env.BURRETE_REPO_ROOT || "");
const WEB_ASSETS_BASE = String(
  (typeof window !== "undefined" ? window.__BURRETE_WEB_ASSETS_BASE__ : "")
  || import.meta.env.VITE_BURRETE_WEB_ASSETS_BASE
  || "",
)
  || fsUrl(`${REPO_ROOT}/PreviewExtension/Web/`);
const WEB_DEMO_ENABLED = import.meta.env.VITE_BURRETE_WEB_DEMO === "1";
const RDKIT_WASM_PATH = WEB_DEMO_ENABLED
  ? `${WEB_ASSETS_BASE.replace(/\/$/u, "")}/rdkit/RDKit_minimal.wasm`
  : "/__burette/rdkit-wasm";
const XYZRENDER_ENDPOINT = WEB_DEMO_ENABLED
  ? "/api/xyzrender"
  : "/__burette/xyzrender";
const AMBER_NETCDF_EXTENSIONS = new Set(["nc", "ncdf", "netcdf", "ncrst"]);
const TRAJECTORY_PAIR_EXTENSIONS = new Set([
  "xtc", "trr", "dcd", "nctraj", "nc", "ncdf", "netcdf", "ncrst", "lammpstrj",
  "pdb", "ent", "pdbqt", "pqr", "xpdb", "mmcif", "cif", "mcif", "gro",
  "top", "psf", "prmtop", "tpr",
]);
const browserDevVirtualTextDocuments = new Map<string, string>();

type ResolvedPreviewVisuals = {
  theme: ViewerPreferences["theme"];
  canvasBackground: ViewerPreferences["canvasBackground"];
  transparentBackground: boolean;
};

type PreviewThemeTokenSet = {
  accent: string;
  background: string;
  foreground: string;
  uiFont: string;
  editorFont: string;
  translucent: number;
  contrast: number;
};

type BrowserDevExternalArtifact = {
  inlineSvg?: string;
  inlineSvgBase64?: string;
  outputType: "svg";
  preset: string;
  configArgument: string;
  elapsedMs: number;
  log?: string;
};

type BrowserDevConformerGenerationRequest = {
  title: string;
  extension: string;
  text: string;
  engine?: ViewerPreferences["conformerEngine"];
  operation?: "generate" | "optimize";
  mode?: "single" | "ensemble";
  candidateCount?: number;
  rmsdCutoff?: number;
  source3d?: {
    title: string;
    extension: string;
    text: string;
  } | null;
};

type BrowserDevConformerGenerationResult = {
  title: string;
  extension: "sdf";
  text: string;
  method: string;
  conformerCount?: number;
};

export type BrowserDevMolstarContextDocument = {
  label?: string;
  entries?: BrowserDevMolstarContextEntry[];
  context?: Record<string, unknown>;
};

type BrowserDevMolstarContextEntry = {
  role?: "receptor" | "ligand" | "structure";
  label?: string;
  format?: string;
  data?: string;
};

export function browserDevRuntimeNeedsRefresh(document: ViewerDocument) {
  if (document.renderer === "grid2d") return !document.runtimePath.includes(GRID_ASSET_VERSION);
  if (!document.runtimePath.includes(VIEWER_ASSET_VERSION)) return true;
  return !document.runtimePath.includes("viewer-shell.js")
    || document.runtimePath.includes('<div id="buret-toolbar"')
    || document.runtimePath.includes("function viewerRuntimeCss");
}

function resolvePreviewVisuals(preferences: ViewerPreferences): ResolvedPreviewVisuals {
  return {
    theme: preferences.theme,
    canvasBackground: preferences.canvasBackground,
    transparentBackground: preferences.canvasBackground === "transparent",
  };
}

function previewThemeTokens(preferences: ViewerPreferences): Record<"light" | "dark", PreviewThemeTokenSet> {
  return {
    light: {
      accent: preferences.themeLightAccent,
      background: preferences.themeLightBackground,
      foreground: preferences.themeLightForeground,
      uiFont: preferences.themeLightUiFont,
      editorFont: preferences.themeLightEditorFont,
      translucent: preferences.themeLightTranslucent,
      contrast: preferences.themeLightContrast,
    },
    dark: {
      accent: preferences.themeDarkAccent,
      background: preferences.themeDarkBackground,
      foreground: preferences.themeDarkForeground,
      uiFont: preferences.themeDarkUiFont,
      editorFont: preferences.themeDarkEditorFont,
      translucent: preferences.themeDarkTranslucent,
      contrast: preferences.themeDarkContrast,
    },
  };
}

export async function openBrowserDevDocuments(
  paths: string[],
  preferences: ViewerPreferences,
  reloadOptions?: ViewerReloadOptions,
  documentIds: Record<string, string> = {},
): Promise<OpenDocumentsResult> {
  const results: Array<{ document?: ViewerDocument; error?: string } | undefined> = Array.from({ length: paths.length });
  let nextIndex = 0;
  const workerCount = Math.min(BROWSER_DEV_OPEN_CONCURRENCY, paths.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      const path = paths[index];
      if (!path) continue;
      try {
        results[index] = { document: await openBrowserDevDocument(path, preferences, reloadOptions, documentIds[path]) };
      } catch (error) {
        results[index] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  });
  await Promise.all(workers);

  const documents: ViewerDocument[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if (!result) continue;
    if (result.document) {
      documents.push(result.document);
      continue;
    }
    if (result.error) errors.push(result.error);
  }
  if (documents.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return { documents, errors };
}

export async function openBrowserDevTextDocument(
  title: string,
  extension: string,
  text: string,
  preferences: ViewerPreferences,
  reloadOptions?: ViewerReloadOptions,
  documentId?: string,
): Promise<ViewerDocument> {
  const cleanExtension = extension.toLowerCase().replace(/^\./u, "");
  const cleanTitle = fileTitle(title).replace(/[\\/]/gu, "").trim() || `ketcher-sketch.${cleanExtension}`;
  const path = `burrete-ketcher://${stableId(`${cleanTitle}:${text}`)}/${cleanTitle}`;
  const bytes = new TextEncoder().encode(text);
  browserDevVirtualTextDocuments.set(path, text);
  const document = await openBrowserDevDocumentFromBytes(path, cleanExtension, bytes, bytes.length, preferences, reloadOptions, documentId);
  return { ...document, virtual: true };
}

export async function openBrowserDevDockingDocument(
  receptorPath: string,
  ligandPaths: string[],
  preferences: ViewerPreferences,
  options: { activePose?: number | null; sceneMode?: DockingSceneMode | null } = {},
): Promise<ViewerDocument> {
  const receptor = await readBrowserDevDockingPayload(receptorPath);
  const ligands = await Promise.all(Array.from(new Set(ligandPaths)).map(readBrowserDevDockingPayload));
  if (ligands.length === 0) throw new Error("Choose at least one ligand or pose file for docking view");
  const hasCoordinateTrajectory = ligands.some(isCoordinateTrajectoryPayload);
  const effectiveSceneMode = hasCoordinateTrajectory ? null : (options.sceneMode ?? null);
  const dockingLigands = ligands;

  const id = stableId(`docking:${receptor.path}:${ligands.map((ligand) => ligand.path).join("|")}`);
  const label = effectiveSceneMode
    ? `Mol* scene: ${receptor.title} + ${ligands.length} more structure${ligands.length === 1 ? "" : "s"}`
    : `Docking: ${receptor.title} + ${dockingLigands.length} ligand${dockingLigands.length === 1 ? "" : "s"}`;
  const visuals = resolvePreviewVisuals(preferences);
  const sdfGridPath = ligands.find((ligand) => (
    ligand.format.molstarFormat === "sdf"
      && !ligand.format.binary
      && parseSdfCollectionRecords(decodeUtf8(ligand.bytes)).length > 1
  ))?.path ?? null;
  const config = {
    format: receptor.format.molstarFormat,
    molstarFormat: receptor.format.molstarFormat,
    binary: receptor.format.binary,
    renderer: "molstar",
    requestedRenderer: "molstar",
    allowMolstarFallback: false,
    label,
    byteCount: receptor.byteCount + ligands.reduce((total, ligand) => total + ligand.byteCount, 0),
    previewByteCount: receptor.bytes.length + dockingLigands.reduce((total, ligand) => total + ligand.bytes.length, 0),
    quickLookBuild: "burrete-browser-dev-docking",
    debug: false,
    theme: visuals.theme,
    themeTokens: previewThemeTokens(preferences),
    canvasBackground: visuals.canvasBackground,
    documentId: id,
    uiScale: 0.9,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    sdfGrid: false,
    sdfGridPath,
    appViewer: true,
    pubChemSearch: true,
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    waterRepresentation: "line",
    xyzrenderViewer: false,
    xyzrenderAvailable: false,
    molstarAvailable: true,
    canOpenInVesta: false,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
    docking: {
      activePose: options.activePose ?? null,
      sceneMode: effectiveSceneMode,
      receptor: dockingConfigSource(receptor),
      ligands: dockingLigands.map(dockingConfigSource),
    },
  };
  const payloads = {
    receptor: { dataBase64: bytesToBase64(receptor.bytes) },
    ligands: dockingLigands.map((ligand) => ({ dataBase64: bytesToBase64(ligand.bytes) })),
  };
  const html = viewerHtml(
    label,
    receptor.format,
    "molstar",
    new Uint8Array([10]),
    config.byteCount,
    preferences,
    false,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    `<script>window.BurreteDockingPayloads = ${serializeInlineJson(payloads)};</script>`,
    config,
  );
  return {
    id,
    path: `burrete-docking://${id}`,
    title: label,
    extension: "docking",
    renderer: "molstar",
    runtimePath: html,
    byteCount: config.byteCount,
    virtual: true,
    dockingRequest: {
      receptorPath: receptor.path,
      ligandPaths: ligands.map((ligand) => ligand.path),
      activePose: options.activePose ?? null,
      sceneMode: effectiveSceneMode,
      poseMode: effectiveSceneMode === "structureAll" ? "all" : "single",
    } satisfies DockingDocumentRequest,
  };
}

export async function openBrowserDevMolstarContextDocument(
  contextDocument: BrowserDevMolstarContextDocument,
  preferences: ViewerPreferences,
): Promise<ViewerDocument> {
  const hostedMcpWidget = contextDocument.context?.hostedMcpWidget === true;
  const entries = (contextDocument.entries ?? [])
    .filter((entry): entry is Required<Pick<BrowserDevMolstarContextEntry, "data">> & BrowserDevMolstarContextEntry => (
      typeof entry?.data === "string" && entry.data.length > 0
    ))
    .map((entry, index) => browserDevContextPayload(entry, index));
  if (entries.length === 0) throw new Error("No Mol* context structure was provided");
  const label = contextDocument.label?.trim() || entries.map((entry) => entry.title).join(" + ");
  const id = stableId(`molstar-context:${label}:${entries.map((entry) => (
    `${entry.title}:${entry.bytes.length}:${stableId(decodeUtf8(entry.bytes))}`
  )).join("|")}`);
  const contextFocus = browserDevMolstarContextFocus(contextDocument.context);
  if (entries.length === 1) {
    const entry = entries[0];
    if (entry.role === "ligand" && entry.extension === "sdf" && entry.format.molstarFormat === "sdf") {
      const document = await openBrowserDevTextDocument(
        `${label}.sdf`,
        "sdf",
        decodeUtf8(entry.bytes),
        { ...preferences, rendererMode: "molstar" },
        {},
      );
      return { ...document, title: label };
    }
    const config = {
      ...browserDevContextConfig(label, entry.format, entry.bytes.length, preferences, id),
      hostedMcpWidgetBootstrap: hostedMcpWidget,
      hostedMcpActions: hostedMcpWidget && Array.isArray(contextDocument.context?.hostedMcpActions)
        ? contextDocument.context.hostedMcpActions.slice(0, 8)
        : [],
      molstarContextFocus: contextFocus,
    };
    const virtualPath = `burrete-context://${id}`;
    browserDevVirtualTextDocuments.set(virtualPath, decodeUtf8(entry.bytes));
    const html = viewerHtml(
      label,
      entry.format,
      "molstar",
      entry.bytes,
      entry.bytes.length,
      preferences,
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      "",
      config,
    );
    return {
      id,
      path: virtualPath,
      title: label,
      extension: entry.extension,
      renderer: "molstar",
      runtimePath: html,
      byteCount: entry.bytes.length,
      virtual: true,
    };
  }

  const receptor = entries.find((entry) => entry.role === "receptor") ?? entries[0];
  const ligands = entries.filter((entry) => entry !== receptor);
  if (ligands.length === 0) return openBrowserDevMolstarContextDocument({
    label,
    entries: [contextDocument.entries?.[0] ?? {}],
    context: contextDocument.context,
  }, preferences);
  const byteCount = receptor.bytes.length + ligands.reduce((total, ligand) => total + ligand.bytes.length, 0);
  const visuals = resolvePreviewVisuals(preferences);
  const config = {
    format: receptor.format.molstarFormat,
    molstarFormat: receptor.format.molstarFormat,
    binary: false,
    renderer: "molstar",
    requestedRenderer: "molstar",
    allowMolstarFallback: false,
    label,
    byteCount,
    previewByteCount: byteCount,
    quickLookBuild: "burrete-browser-dev-context-docking",
    debug: false,
    theme: visuals.theme,
    themeTokens: previewThemeTokens(preferences),
    canvasBackground: visuals.canvasBackground,
    documentId: id,
    uiScale: 0.9,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    sdfGrid: false,
    sdfPosePager: false,
    appViewer: true,
    pubChemSearch: true,
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    waterRepresentation: "line",
    xyzrenderViewer: false,
    xyzrenderAvailable: false,
    molstarAvailable: true,
    canOpenInVesta: false,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
    dockingContext: contextDocument.context ?? {},
    molstarContextFocus: contextFocus,
    docking: {
      receptor: dockingConfigSource(receptor),
      ligands: ligands.map(dockingConfigSource),
    },
  };
  const payloads = {
    receptor: { dataBase64: bytesToBase64(receptor.bytes) },
    ligands: ligands.map((ligand) => ({ dataBase64: bytesToBase64(ligand.bytes) })),
  };
  const html = viewerHtml(
    label,
    receptor.format,
    "molstar",
    new Uint8Array([10]),
    byteCount,
    preferences,
    false,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    `<script>window.BurreteDockingPayloads = ${serializeInlineJson(payloads)};</script>`,
    config,
  );
  return {
    id,
    path: `burrete-context://${id}`,
    title: label,
    extension: "docking",
    renderer: "molstar",
    runtimePath: html,
    byteCount,
    virtual: true,
  };
}

export async function openBrowserDevMergedCollection(
  paths: string[],
  preferences: ViewerPreferences,
): Promise<ViewerDocument> {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  const sources = await Promise.all(uniquePaths.map(async (path) => {
    const extension = collectionExtension(path);
    return { path, extension, text: await readBrowserDevCollectionText(path) };
  }));
  const merged = mergeCollectionSources(sources);
  const grid = gridPayload(merged.suggestedFileName, merged.extension, merged.text);
  if (!grid) throw new Error("Merged collection does not contain supported molecule grid records.");

  const id = stableId(`merged:${merged.sourcePaths.join("|")}:${merged.text.length}`);
  const path = `burrete-collection://${id}/${merged.suggestedFileName}`;
  browserDevVirtualTextDocuments.set(path, merged.text);
  const html = await gridHtml(path, id, grid.records, grid.format, preferences, new TextEncoder().encode(merged.text).byteLength);
  return {
    id,
    path,
    title: merged.suggestedFileName,
    extension: merged.extension,
    renderer: "grid2d",
    runtimePath: html,
    byteCount: new TextEncoder().encode(merged.text).byteLength,
    virtual: true,
    mergedCollection: {
      sourcePaths: merged.sourcePaths,
      format: merged.extension,
      text: merged.text,
      suggestedFileName: merged.suggestedFileName,
    },
  };
}

// Browser dev cannot append to files on disk the way the native runtime does, so
// a Ketcher sketch is appended into a stable in-memory receiver keyed by the target
// path. Re-opening the receiver (same path) reuses its tab, and reading its own text
// back on the next append lets records accumulate instead of merging fresh each time.
export async function appendToBrowserDevCollection(
  targetPath: string,
  record: { extension: string; text: string },
  preferences: ViewerPreferences,
): Promise<ViewerDocument> {
  const receiverId = stableId(`ketcher-append:${targetPath}`);
  const receiverName = fileTitle(targetPath).replace(/[\\/]/gu, "").trim() || `collection.${record.extension}`;
  const receiverPath = `burrete-collection://${receiverId}/${receiverName}`;
  const baseText = browserDevVirtualTextDocuments.get(receiverPath) ?? await readBrowserDevCollectionText(targetPath);
  const merged = mergeCollectionSources([
    { path: receiverPath, extension: collectionExtension(receiverName) || record.extension, text: baseText },
    { path: `ketcher-sketch.${record.extension}`, extension: record.extension, text: record.text },
  ]);
  const grid = gridPayload(receiverPath, merged.extension, merged.text);
  if (!grid) throw new Error("Ketcher sketch did not produce a supported molecule collection record.");
  browserDevVirtualTextDocuments.set(receiverPath, merged.text);
  const bytes = new TextEncoder().encode(merged.text);
  const html = await gridHtml(receiverPath, receiverId, grid.records, grid.format, preferences, bytes.length);
  return {
    id: receiverId,
    path: receiverPath,
    title: receiverName,
    extension: merged.extension,
    renderer: "grid2d",
    runtimePath: html,
    byteCount: bytes.length,
    virtual: true,
  };
}

export async function readBrowserDevCollectionText(path: string) {
  const virtualText = browserDevVirtualTextDocuments.get(path);
  if (virtualText !== undefined) return virtualText;
  const extension = collectionExtension(path);
  const url = browserDevReadUrl(path, extension);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: failed to fetch collection data from ${url}: ${message}`);
  }
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return await response.text();
}

export function readBrowserDevVirtualTextDocument(path: string) {
  return browserDevVirtualTextDocuments.get(path) ?? null;
}

export function deleteBrowserDevVirtualTextDocument(path: string) {
  browserDevVirtualTextDocuments.delete(path);
}

export function writeBrowserDevVirtualTextDocument(path: string, text: string) {
  browserDevVirtualTextDocuments.set(path, text);
}

export async function generateBrowserDev3DConformer(
  request: BrowserDevConformerGenerationRequest,
): Promise<BrowserDevConformerGenerationResult> {
  const source = request.operation === "optimize" && request.source3d
    ? request.source3d
    : { title: request.title, extension: request.extension, text: request.text };
  return runBrowserDevMetalConformer(source, {
    mode: request.mode,
    optimize: request.operation === "optimize",
  });
}

async function openBrowserDevDocument(
  path: string,
  preferences: ViewerPreferences,
  reloadOptions?: ViewerReloadOptions,
  documentId?: string,
): Promise<ViewerDocument> {
  const extension = fileExtension(path);
  const virtualText = browserDevVirtualTextDocuments.get(path);
  if (virtualText !== undefined) {
    const bytes = new TextEncoder().encode(virtualText);
    if (bytes.length === 0) throw new Error(`${path} is empty`);
    return openBrowserDevDocumentFromBytes(
      path,
      extension,
      bytes,
      bytes.length,
      preferences,
      reloadOptions,
      documentId,
    );
  }
  const amberNcPreview = await requestBrowserDevAmberNcPreview(path, extension);
  if (amberNcPreview) {
    return openBrowserDevDocumentFromBytes(
      `${path}.amber-preview.pdb`,
      "pdb",
      amberNcPreview.bytes,
      amberNcPreview.sourceByteCount,
      preferences,
      reloadOptions,
    );
  }
  const desmondPreview = await requestBrowserDevDesmondPreview(path, extension);
  if (desmondPreview) {
    return openBrowserDevDocumentFromBytes(
      `${path}.desmond-preview.pdb`,
      "pdb",
      desmondPreview.bytes,
      desmondPreview.sourceByteCount,
      preferences,
      reloadOptions,
      documentId,
    );
  }
  const trajectoryPair = await requestBrowserDevTrajectoryPair(path, extension);
  if (trajectoryPair) {
    return openBrowserDevTrajectoryPairDocument(path, trajectoryPair, preferences, documentId);
  }
  const useBoundedMaestroPreview = isMaestroPreviewExtension(extension) && extension !== "maegz";
  const response = await fetch(browserDevReadUrl(path, extension), useBoundedMaestroPreview ? {
    headers: { Range: `bytes=0-${MAESTRO_PREVIEW_READ_LIMIT - 1}` },
  } : undefined);
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`${path} is empty`);
  if (bytes.length > MAX_STRUCTURE_FILE_SIZE && !useBoundedMaestroPreview) {
    throw new Error(`${path} is larger than the 75 MB preview limit`);
  }

  const sourceByteCount = browserDevSourceByteCount(response, bytes.length);
  return openBrowserDevDocumentFromBytes(path, extension, bytes, sourceByteCount, preferences, reloadOptions, documentId);
}

async function requestBrowserDevTrajectoryPair(path: string, extension: string) {
  if (!TRAJECTORY_PAIR_EXTENSIONS.has(extension)) return null;
  const response = await fetch(`/__burette/trajectory-pair?path=${encodeURIComponent(path)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const message = await browserDevJsonError(response).catch(() => response.statusText);
    throw new Error(`${path}: trajectory pair preview failed: ${message || response.statusText}`);
  }
  return await response.json() as BrowserDevTrajectoryPair;
}

function openBrowserDevTrajectoryPairDocument(
  path: string,
  pair: BrowserDevTrajectoryPair,
  preferences: ViewerPreferences,
  documentId?: string,
) {
  const id = documentId ?? stableId(`trajectory:${pair.sourcePath}:${JSON.stringify(pair.docking)}`);
  const visuals = resolvePreviewVisuals(preferences);
  const receptor = pair.docking.receptor;
  const config = {
    format: receptor.format ?? "gro",
    molstarFormat: receptor.format ?? "gro",
    binary: receptor.binary === true,
    renderer: "molstar",
    requestedRenderer: "molstar",
    allowMolstarFallback: false,
    label: pair.label,
    byteCount: pair.byteCount,
    previewByteCount: 1,
    sourcePath: pair.sourcePath,
    sourceExtension: pair.sourceExtension,
    quickLookBuild: "burrete-browser-dev-trajectory-pair",
    debug: false,
    theme: visuals.theme,
    themeTokens: previewThemeTokens(preferences),
    canvasBackground: visuals.canvasBackground,
    documentId: id,
    uiScale: 0.9,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    sdfGrid: false,
    appViewer: true,
    pubChemSearch: true,
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    waterRepresentation: "line",
    xyzrenderViewer: false,
    xyzrenderAvailable: false,
    molstarAvailable: true,
    canOpenInVesta: false,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
    docking: pair.docking,
  };
  const html = viewerHtml(
    pair.label,
    {
      molstarFormat: String(config.format),
      binary: config.binary,
      externalOnly: false,
      canOpenInVesta: false,
    },
    "molstar",
    new Uint8Array([10]),
    pair.byteCount,
    preferences,
    false,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    `<script>window.BurreteDockingPayloads = ${serializeInlineJson(pair.payloads)};</script>`,
    config,
    0,
    null,
    undefined,
    undefined,
    id,
  );
  return {
    ...browserDocument(path, pair.sourceExtension, "molstar", html, pair.byteCount, id),
    dockingRequest: {
      receptorPath: pair.topologyPath,
      ligandPaths: [pair.trajectoryPath],
      activePose: null,
      sceneMode: null,
      poseMode: "single" as const,
    },
  };
}

async function requestBrowserDevAmberNcPreview(path: string, extension: string) {
  if (!AMBER_NETCDF_EXTENSIONS.has(extension)) return null;
  const response = await fetch(`/__burette/trajectory-preview?path=${encodeURIComponent(path)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const message = await browserDevJsonError(response).catch(() => response.statusText);
    throw new Error(`${path}: Amber NetCDF preview failed: ${message || response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) return null;
  return {
    bytes,
    sourceByteCount: browserDevSourceByteCount(response, bytes.length),
  };
}

async function requestBrowserDevDesmondPreview(path: string, extension: string) {
  if (extension !== "cms" && extension !== "dtr") return null;
  const response = await fetch(`/__burette/desmond-preview?path=${encodeURIComponent(path)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`${path}: Desmond preview failed: ${message || response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) return null;
  return { bytes, sourceByteCount: bytes.length };
}

async function openBrowserDevDocumentFromBytes(
  path: string,
  extension: string,
  bytes: Uint8Array,
  sourceByteCount: number,
  preferences: ViewerPreferences,
  reloadOptions?: ViewerReloadOptions,
  documentId?: string,
): Promise<ViewerDocument> {
  const text = await decodeStructureText(bytes, extension);
  const grid = gridPayload(path, extension, text);
  const sdfRecordCount = isSdfExtension(extension) ? parseSdfCollectionRecords(text).length : 0;
  const requestedMode = normalizeRendererMode(preferences.rendererMode);
  const explicitSdfViewer = isSdfExtension(extension)
    && Boolean(reloadOptions)
    && (requestedMode === "molstar" || requestedMode === "xyzrender-external");
  const singleSdfGrid = grid?.format === "sdf" && grid.records.length <= 1;
  const shouldOpenGrid = Boolean(grid) && (
    requestedMode === "grid2d"
    || !(grid?.format === "sdf" && (singleSdfGrid || explicitSdfViewer))
  );
  if (grid && shouldOpenGrid) {
    const id = documentId ?? stableId(path);
    const html = await gridHtml(path, id, grid.records, grid.format, preferences, bytes.length);
    return browserDocument(path, extension, "grid2d", html, bytes.length, id);
  }
  if (gridRequiresPreview(extension)) {
    throw new Error(`${path} does not contain supported molecule grid records`);
  }

  const pharmacophorePreview = isPharmacophorePreviewExtension(extension)
    ? convertedDataFromText(text, extension, fileTitle(path))
    : null;
  const sourceXyzFrameCount = countXyzFrames(text);
  const format = pharmacophorePreview
    ? { molstarFormat: "pdb", binary: false, externalOnly: false, canOpenInVesta: false }
    : sourceXyzFrameCount > 0 && shouldTreatTextAsXyzFrames(extension)
    ? { molstarFormat: "xyz", binary: false, externalOnly: false, canOpenInVesta: false }
    : formatForExtension(extension);
  const maestroPreview = isMaestroPreviewExtension(extension)
    ? convertedDataFromText(text, extension, fileTitle(path))
    : null;
  if (isMaestroPreviewExtension(extension) && !maestroPreview) {
    throw new Error(`${path}: no Maestro atom table could be extracted for preview`);
  }
  const runtimeFormat = pharmacophorePreview
    ? { ...format, molstarFormat: pharmacophorePreview.molstarFormat, binary: false, externalOnly: false }
    : maestroPreview
    ? { ...format, molstarFormat: maestroPreview.molstarFormat, binary: false, externalOnly: false }
    : format;
  const sourceXyzBytes = xyzDataFromText(text, extension, fileTitle(path));
  const convertedMolstarData = pharmacophorePreview ?? maestroPreview ?? convertedDataFromText(text, extension, fileTitle(path));
  const molstarBytes: Uint8Array | null = convertedMolstarData?.bytes && shouldUseConvertedMolstarData(format, convertedMolstarData, extension)
    ? convertedMolstarData.bytes
    : null;
  const runtimeFrameText = maestroPreview?.bytes ? decodeUtf8(maestroPreview.bytes) : text;
  const xyzFrameCount = runtimeFormat.molstarFormat === "xyz" && !runtimeFormat.binary ? Math.max(sourceXyzFrameCount, countXyzFrames(runtimeFrameText)) : 0;
  const pdbModelCount = runtimeFormat.molstarFormat === "pdb" && !runtimeFormat.binary ? countPdbModels(runtimeFrameText) : 0;
  const trajectoryFrameCount = Math.max(xyzFrameCount, pdbModelCount);
  const shouldOpenTrajectoryInMolstar = trajectoryFrameCount > 1 && requestedMode === "auto";
  const xyzrenderAvailable = maestroPreview ? false : xyzrenderAvailableForDocument(format, text);
  const requestedRenderer = resolveRenderer(
    runtimeFormat,
    maestroPreview
      ? "molstar"
      : (shouldOpenTrajectoryInMolstar
        ? "molstar"
        : (xyzrenderAvailable ? defaultRendererModeForDocument(extension, requestedMode, reloadOptions) : "molstar")),
    Boolean(molstarBytes),
  );
  const defaultXyzrender = await defaultXyzrenderPlanForDocument(path, extension, text);
  const xyzrenderFrameSourceBytes = runtimeFormat.molstarFormat === "xyz" && !runtimeFormat.binary
    ? selectedXyzrenderFrameSourceBytes(extension, runtimeFrameText, convertedMolstarData?.bytes ?? null, sourceXyzBytes)
    : sourceXyzBytes;
  const xyzrenderInputBytes = extension === "cub" || extension === "cube"
    ? null
    : selectedXyzFrameBytes(xyzrenderFrameSourceBytes, reloadOptions?.activeModel) ?? sourceXyzBytes;
  const virtualXyzrenderInputBytes = xyzrenderInputBytes ?? (browserDevVirtualTextDocuments.has(path) ? bytes : null);
  const xyzrenderInputExtension = xyzrenderInputBytes ? "xyz" : extension;
  const { renderer, externalRendererStatus, externalArtifact, xyzrenderPresetOptions, xyzrenderControls } =
    await browserRendererPlan(
      defaultXyzrender?.inputPath ?? path,
      runtimeFormat,
      requestedRenderer,
      reloadOptions,
      molstarBytes,
      defaultXyzrender?.controls ?? null,
      virtualXyzrenderInputBytes,
      xyzrenderInputExtension,
    );
  const viewerBytes = renderer === "molstar" && molstarBytes ? molstarBytes : bytes;
  const viewerFormat = renderer === "molstar" && molstarBytes && convertedMolstarData
    ? { ...runtimeFormat, molstarFormat: convertedMolstarData.molstarFormat, binary: false, externalOnly: false }
    : runtimeFormat;
  const html = viewerHtml(
    path,
    viewerFormat,
    renderer,
    viewerBytes,
    sourceByteCount,
    preferences,
    Boolean(molstarBytes),
    xyzrenderAvailable,
    externalRendererStatus,
    externalArtifact,
    xyzrenderPresetOptions,
    xyzrenderControls,
    "",
    undefined,
    Math.max(trajectoryFrameCount, sdfRecordCount),
    ketcherEditConfig(path, extension, text, sourceByteCount, sdfRecordCount),
    convertedMolstarData?.stagedEntries,
    reloadOptions,
    documentId,
  );
  return browserDocument(path, extension, renderer, html, sourceByteCount, documentId, {
    xyzrenderControls,
    xyzrenderPreset: externalArtifact?.preset ?? reloadOptions?.xyzrenderPreset ?? null,
    xyzrenderPresetOptions: xyzrenderPresetOptions ?? null,
  });
}

function browserDocument(
  path: string,
  extension: string,
  renderer: string,
  html: string,
  byteCount: number,
  documentId?: string,
  xyzrender?: {
    xyzrenderControls?: XyzrenderControls | null;
    xyzrenderPreset?: string | null;
    xyzrenderPresetOptions?: Array<{ value: string; label: string }> | null;
  },
): ViewerDocument {
  return {
    id: documentId ?? stableId(path),
    path,
    title: fileTitle(path),
    extension,
    renderer,
    runtimePath: html,
    byteCount,
    xyzrenderControls: xyzrender?.xyzrenderControls ?? null,
    xyzrenderPreset: xyzrender?.xyzrenderPreset ?? null,
    xyzrenderPresetOptions: xyzrender?.xyzrenderPresetOptions ?? null,
  };
}

type BrowserDevDockingPayload = {
  path: string;
  title: string;
  extension: string;
  format: FormatInfo;
  bytes: Uint8Array;
  byteCount: number;
};

type BrowserDevContextPayload = BrowserDevDockingPayload & {
  role?: BrowserDevMolstarContextEntry["role"];
};

function isCoordinateTrajectoryPayload(payload: BrowserDevDockingPayload) {
  return ["xtc", "trr", "dcd", "nctraj", "nc", "ncdf", "netcdf", "ncrst", "lammpstrj"]
    .includes(payload.format.molstarFormat);
}

async function readBrowserDevDockingPayload(path: string): Promise<BrowserDevDockingPayload> {
  const extension = fileExtension(path);
  const virtualText = browserDevVirtualTextDocuments.get(path);
  if (virtualText !== undefined) {
    const bytes = new TextEncoder().encode(virtualText);
    return browserDevDockingPayloadFromBytes(path, extension, bytes, bytes.length);
  }
  const response = await fetch(browserDevReadUrl(path, extension));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  const originalBytes = new Uint8Array(await response.arrayBuffer());
  if (originalBytes.length === 0) throw new Error(`${path} is empty`);
  if (originalBytes.length > MAX_STRUCTURE_FILE_SIZE) {
    throw new Error(`${path} is larger than the 75 MB preview limit`);
  }
  return browserDevDockingPayloadFromBytes(path, extension, originalBytes, originalBytes.length);
}

async function browserDevDockingPayloadFromBytes(
  path: string,
  extension: string,
  originalBytes: Uint8Array,
  byteCount: number,
): Promise<BrowserDevDockingPayload> {
  const title = fileTitle(path);
  const text = await decodeStructureText(originalBytes, extension);
  const sourceXyzFrameCount = countXyzFrames(text);
  const format = sourceXyzFrameCount > 0 && shouldTreatTextAsXyzFrames(extension)
    ? { molstarFormat: "xyz", binary: false, externalOnly: false, canOpenInVesta: false }
    : formatForExtension(extension);
  const converted = convertedDataFromText(text, extension, title);
  if (converted && shouldUseConvertedMolstarData(format, converted, extension)) {
    return {
      path,
      title,
      extension,
      format: { ...format, molstarFormat: converted.molstarFormat, binary: false, externalOnly: false },
      bytes: converted.bytes,
      byteCount,
    };
  }
  if (format.externalOnly) {
    throw new Error(`${path} cannot be added to Mol* docking view because it needs xyzrender conversion`);
  }
  return { path, title, extension, format, bytes: originalBytes, byteCount };
}

function splitXyzFrameTexts(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const frames: string[] = [];
  let index = 0;
  while (index < lines.length && frames.length < 100000) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    const atomCount = Number.parseInt(lines[index]?.trim().split(/\s+/u)[0] ?? "", 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) break;
    if (index + atomCount + 1 >= lines.length) break;
    const frameLines = lines.slice(index, index + atomCount + 2);
    const atomLines = frameLines.slice(2);
    if (atomLines.length !== atomCount || atomLines.some((line) => !line.trim())) break;
    frames.push(`${frameLines.join("\n")}\n`);
    index += atomCount + 2;
  }
  return frames.length > 1 ? frames : [];
}

function selectedXyzrenderFrameSourceBytes(
  extension: string,
  runtimeFrameText: string,
  convertedMolstarBytes: Uint8Array | null,
  sourceXyzBytes: Uint8Array | null,
) {
  if (shouldTreatTextAsXyzFrames(extension)) return new TextEncoder().encode(runtimeFrameText);
  return convertedMolstarBytes ?? sourceXyzBytes;
}

function selectedXyzFrameBytes(bytes: Uint8Array | null, activeModel: number | null | undefined) {
  if (!bytes?.length || activeModel == null) return null;
  const index = Number(activeModel);
  if (!Number.isFinite(index) || index < 0) return null;
  const frames = splitXyzFrameTexts(decodeUtf8(bytes));
  if (frames.length <= 1) return null;
  const frame = frames[Math.max(0, Math.min(frames.length - 1, Math.trunc(index)))];
  return new TextEncoder().encode(frame);
}

function dockingConfigSource(source: BrowserDevDockingPayload) {
  return {
    path: source.path,
    label: source.title,
    extension: source.extension,
    format: source.format.molstarFormat,
    binary: source.format.binary,
    byteCount: source.byteCount,
  };
}

function browserDevContextPayload(entry: BrowserDevMolstarContextEntry, index: number): BrowserDevContextPayload {
  const formatName = normalizeContextMolstarFormat(entry.format);
  const data = entry.data ?? "";
  const bytes = new TextEncoder().encode(data);
  if (bytes.length > MAX_STRUCTURE_FILE_SIZE) {
    throw new Error(`${entry.label || "Mol* context structure"} is larger than the 75 MB preview limit`);
  }
  return {
    path: `burrete-context-entry://${index}`,
    title: entry.label?.trim() || `Context structure ${index + 1}`,
    extension: contextExtensionForFormat(formatName),
    format: {
      molstarFormat: formatName,
      binary: false,
      externalOnly: false,
      canOpenInVesta: false,
    },
    bytes,
    byteCount: bytes.length,
    role: entry.role,
  };
}

function browserDevContextConfig(
  label: string,
  format: FormatInfo,
  byteCount: number,
  preferences: ViewerPreferences,
  id: string,
) {
  const visuals = resolvePreviewVisuals(preferences);
  return {
    format: format.molstarFormat,
    molstarFormat: format.molstarFormat,
    binary: false,
    renderer: "molstar",
    requestedRenderer: "molstar",
    allowMolstarFallback: false,
    label,
    byteCount,
    previewByteCount: byteCount,
    quickLookBuild: "burrete-browser-dev-context",
    debug: false,
    theme: visuals.theme,
    themeTokens: previewThemeTokens(preferences),
    canvasBackground: visuals.canvasBackground,
    documentId: id,
    uiScale: 0.9,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    sdfGrid: false,
    appViewer: true,
    pubChemSearch: true,
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    waterRepresentation: "line",
    xyzrenderViewer: false,
    xyzrenderAvailable: false,
    molstarAvailable: true,
    canOpenInVesta: false,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
  };
}

function browserDevMolstarContextFocus(context: Record<string, unknown> | undefined) {
  const focus = context?.focus;
  return focus && typeof focus === "object" ? focus : undefined;
}

function normalizeContextMolstarFormat(format: string | undefined) {
  const value = String(format || "pdb").toLowerCase();
  if (value === "cif" || value === "mmcif" || value === "mcif") return "mmcif";
  if (value === "sd") return "sdf";
  return value;
}

function contextExtensionForFormat(format: string) {
  if (format === "mmcif") return "cif";
  if (format === "sdf") return "sdf";
  return format || "pdb";
}

function viewerHtml(
  path: string,
  format: FormatInfo,
  renderer: string,
  bytes: Uint8Array,
  sourceByteCount: number,
  preferences: ViewerPreferences,
  externalMolstarAvailable: boolean,
  xyzrenderAvailable: boolean,
  externalRendererStatus?: Record<string, string>,
  externalArtifact?: BrowserDevExternalArtifact,
  xyzrenderPresetOptions?: Array<{ value: string; label: string }>,
  xyzrenderControls?: XyzrenderControls | null,
  extraWindowScript = "",
  configOverride?: Record<string, unknown>,
  trajectoryFrameCount = 0,
  ketcherConfig: Record<string, unknown> | null = null,
  stagedEntries?: Array<Record<string, unknown>>,
  reloadOptions?: ViewerReloadOptions,
  documentId?: string,
) {
  const label = fileTitle(path);
  const extension = fileExtension(path);
  const visuals = resolvePreviewVisuals(preferences);
  const config = configOverride ?? {
    format: format.molstarFormat,
    molstarFormat: format.molstarFormat,
    binary: format.binary,
    renderer,
    requestedRenderer: normalizeRendererMode(preferences.rendererMode),
    allowMolstarFallback: true,
    label,
    byteCount: sourceByteCount,
    previewByteCount: bytes.length,
    dataPath: renderer === "xyzrender-external" ? browserDevReadUrl(path, extension) : undefined,
    sourcePath: path,
    sourceExtension: extension,
    quickLookBuild: "burrete-browser-dev",
    debug: false,
    theme: visuals.theme,
    themeTokens: previewThemeTokens(preferences),
    canvasBackground: visuals.canvasBackground,
    documentId: documentId ?? stableId(path),
    uiScale: 0.9,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    sdfGrid: true,
    sdfPosePager: renderer === "molstar" && format.molstarFormat === "sdf" && !format.binary,
    trajectoryControls: renderer === "molstar" && trajectoryFrameCount > 1,
    trajectoryFrameCount,
    ...(reloadOptions?.activeModel != null ? { activeModel: reloadOptions.activeModel } : {}),
    rdkitWasmPath: RDKIT_WASM_PATH,
    ...(reloadOptions?.sdfPoseControlLabel ? { sdfPoseControlLabel: reloadOptions.sdfPoseControlLabel } : {}),
    ...(stagedEntries?.some((entry) => entry?.representation === "structure-scene-entry") ? { structureSceneMode: "structurePoses" } : {}),
    appViewer: true,
    pubChemSearch: true,
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    waterRepresentation: "line",
    ...(stagedEntries?.length ? { stagedEntries } : {}),
    xyzrenderViewer: renderer === "xyzrender-external",
    xyzrenderAvailable,
    xyzrenderEndpoint: XYZRENDER_ENDPOINT,
    molstarAvailable: !format.externalOnly || externalMolstarAvailable,
    canOpenInVesta: format.canOpenInVesta,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
    ...(ketcherConfig ? { ketcherEditable: true, ...ketcherConfig } : { ketcherEditable: false }),
    ...(externalArtifact ? { externalArtifact } : {}),
    ...(xyzrenderPresetOptions ? { xyzrenderPresetOptions } : {}),
    ...(xyzrenderControls ? { xyzrenderControls } : {}),
    ...((WEB_DEMO_ENABLED || (renderer === "xyzrender-external" && browserDevVirtualTextDocuments.has(path)))
      ? {
          xyzrenderInputDataBase64: bytesToBase64(bytes),
          xyzrenderInputExtension: extension,
        }
      : {}),
    ...(externalRendererStatus ? { externalRendererStatus } : {}),
  };
  const hostedMcpBootstrap = config.hostedMcpWidgetBootstrap === true;
  const viewerAsset = (name: string) => hostedMcpBootstrap
    ? `${WEB_ASSETS_BASE.replace(/\/$/u, "")}/${name}`
    : name;
  const rendererAssets =
    renderer === "xyzrender-external"
      ? `<link rel="stylesheet" href="${viewerAsset("molstar.css")}" />`
      : `<link rel="stylesheet" href="${viewerAsset("molstar.css")}" /><script src="${viewerAsset("molstar.js")}"></script>`;
  const runtimeAssetVersion = `${VIEWER_ASSET_VERSION}-${Date.now()}`;
  const embeddedBytes = renderer === "xyzrender-external" ? new Uint8Array([10]) : bytes;
  const runtimeBootstrap = hostedMcpBootstrap
    ? `<script id="burrete-runtime-config" type="application/json">${serializeInlineJson(config)}</script>
  <script id="burrete-runtime-data" type="application/json">${serializeInlineJson(bytesToBase64(embeddedBytes))}</script>
  <script src="${viewerAsset("viewer-bootstrap.js")}?v=${runtimeAssetVersion}"></script>`
    : `<script>${viewerBridgeJs()}</script>
  <script>
    window.BurreteConfig = ${serializeInlineJson(config)};
  </script>
  <script>window.BurreteDataBase64 = "${bytesToBase64(embeddedBytes)}";</script>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${hostedMcpBootstrap ? "" : `<base href="${WEB_ASSETS_BASE}" />`}
  <title>Burrete - ${escapeHtml(label)}</title>
  <link rel="stylesheet" href="${viewerAsset("viewer-runtime.css")}?v=${runtimeAssetVersion}" />
</head>
<body class="${visuals.transparentBackground ? "burette-transparent-background" : "burette-opaque-background"}">
  <div id="app"></div>
  <script src="${viewerAsset("viewer-shell.js")}?v=${runtimeAssetVersion}"></script>
  <div id="status" class="hidden">Loading ${escapeHtml(label)}...</div>
  ${runtimeBootstrap}
  ${rendererAssets}
  ${extraWindowScript}
  <script src="${viewerAsset("burette-agent.js")}?v=${runtimeAssetVersion}"></script>
  <script src="${viewerAsset("trajectory-smoothing.js")}?v=${runtimeAssetVersion}"></script>
  <script src="${viewerAsset("viewer.js")}?v=${runtimeAssetVersion}"></script>
</body>
</html>`;
}

async function browserRendererPlan(
  path: string,
  format: FormatInfo,
  renderer: string,
  reloadOptions?: ViewerReloadOptions,
  molstarBytes: Uint8Array | null = null,
  defaultControls: XyzrenderControls | null = null,
  xyzrenderInputBytes: Uint8Array | null = molstarBytes,
  xyzrenderInputExtension = "xyz",
) {
  if (renderer !== "xyzrender-external") return { renderer };
  const controls = reloadOptions?.xyzrenderControls ?? defaultControls ?? null;
  try {
    const result = await requestBrowserDevXyzrender(
      path,
      reloadOptions?.xyzrenderPreset ?? "default",
      reloadOptions?.xyzrenderOrientationRef ?? null,
      controls,
      xyzrenderInputBytes,
      xyzrenderInputExtension,
      reloadOptions?.activeModel ?? null,
    );
    return {
      renderer: "xyzrender-external",
      externalArtifact: {
        inlineSvgBase64: bytesToBase64(new TextEncoder().encode(result.svg)),
        outputType: "svg" as const,
        preset: result.preset,
        configArgument: result.configArgument,
        elapsedMs: result.elapsedMs,
        log: result.log,
      },
      xyzrenderPresetOptions: result.xyzrenderPresetOptions,
      xyzrenderControls: result.xyzrenderControls ?? controls,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format.externalOnly) {
      if (molstarBytes) {
        return {
          renderer: "molstar",
          externalRendererStatus: {
            status: "fallback",
            requested: "xyzrender-external",
            message: `Using Mol* because browser dev xyzrender failed: ${message}`,
          },
        };
      }
      throw new Error(message);
    }
    if (format.molstarFormat === "xyz" && !format.binary) {
      return {
        renderer: "molstar",
        externalRendererStatus: {
          status: "fallback",
          requested: "xyzrender-external",
          message: `Using Mol* because browser dev xyzrender failed: ${message}`,
        },
      };
    }
    return {
      renderer: "molstar",
      externalRendererStatus: {
        status: "fallback",
        requested: "xyzrender-external",
        message: `Using Mol* because browser dev xyzrender failed: ${message}`,
      },
    };
  }
}

async function requestBrowserDevXyzrender(
  path: string,
  preset: string,
  orientationRef: string | null,
  controls: XyzrenderControls | null,
  inputBytes: Uint8Array | null,
  inputExtension = "xyz",
  activeModel: number | null = null,
) {
  const url = new URL(XYZRENDER_ENDPOINT, window.location.origin);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path,
      preset,
      orientationRef: orientationRef || undefined,
      controls: controls || undefined,
      activeModel: activeModel ?? undefined,
      inputDataBase64: inputBytes ? bytesToBase64(inputBytes) : undefined,
      inputExtension: inputBytes ? inputExtension : undefined,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `xyzrender request failed with status ${response.status}`);
  }
  if (typeof payload?.svg !== "string" || !payload.svg.trim()) {
    throw new Error("xyzrender endpoint returned no SVG payload");
  }
  return {
    svg: payload.svg,
    preset: typeof payload?.preset === "string" ? payload.preset : "default",
    configArgument: typeof payload?.configArgument === "string" ? payload.configArgument : "default",
    elapsedMs: Number(payload?.elapsedMs) || 0,
    log: typeof payload?.log === "string" ? payload.log : "",
    xyzrenderControls: typeof payload?.xyzrenderControls === "object" && payload?.xyzrenderControls ? payload.xyzrenderControls as XyzrenderControls : undefined,
    xyzrenderPresetOptions: Array.isArray(payload?.xyzrenderPresetOptions) ? payload.xyzrenderPresetOptions : undefined,
  };
}

async function gridHtml(
  path: string,
  documentId: string,
  records: GridRecord[],
  format: string,
  preferences: ViewerPreferences,
  byteCount: number,
) {
  const label = fileTitle(path);
  const visuals = resolvePreviewVisuals(preferences);
  const hasMoleculeRecords = records.some((record) => Boolean(record.smiles?.trim() || record.molblock?.trim() || record.idcode?.trim()));
  const config = {
    mode: "grid2d",
    format,
    renderer: "grid2d",
    documentId,
    sourcePath: path,
    label,
    byteCount,
    host: "browser-dev",
    quickLookBuild: "burrete-browser-dev-grid2d",
    debug: false,
    appViewer: true,
    pubChemSearch: true,
    tauriViewer: false,
    theme: visuals.theme,
    themeTokens: previewThemeTokens(preferences),
    canvasBackground: visuals.canvasBackground,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    xyzrenderEndpoint: XYZRENDER_ENDPOINT,
    recordsTotal: records.length,
    recordsIncluded: records.length,
    recordsTruncated: false,
    pageSize: 720,
    rdkitWasmPath: RDKIT_WASM_PATH,
    xyzrenderPreset: "default",
    xyzrenderPresetOptions: [
      { value: "default", label: "Default" },
      { value: "flat", label: "Flat" },
      { value: "paton", label: "Paton" },
      { value: "pmol", label: "PMol" },
      { value: "skeletal", label: "Skeletal" },
      { value: "bubble", label: "Bubble" },
      { value: "tube", label: "Tube" },
      { value: "btube", label: "BTube" },
      { value: "mtube", label: "MTube" },
      { value: "wire", label: "Wire" },
      { value: "graph", label: "Graph" },
      { value: "custom", label: "Custom JSON" },
    ],
    xyzrenderControls: {
      transparentBackground: visuals.transparentBackground,
      gradients: null,
      fog: null,
      showVdw: null,
      vdwAtoms: null,
      hullMode: null,
      hullAtoms: null,
      hideBonds: null,
      atomScale: null,
      bondWidth: null,
      molColor: "",
      showCell: null,
      showGhosts: null,
      showAxes: null,
      supercell: null,
    },
    capabilities: {
      selection: true,
      export: true,
      substructureSearch: hasMoleculeRecords,
      rendererSwitch: hasMoleculeRecords,
    },
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${WEB_ASSETS_BASE}" />
  <title>Burrete Grid - ${escapeHtml(label)}</title>
  <link rel="stylesheet" href="grid.css?v=${GRID_ASSET_VERSION}" />
  <script>
    window.__mqlPost = function (type, message, payload) {
      try {
        const body = { type, message: String(message || ''), ...(payload || {}) };
        if (window.BurreteConfig && window.BurreteConfig.documentId) body.documentId = String(window.BurreteConfig.documentId);
        window.parent && window.parent.postMessage({ source: 'burrete-grid', body }, '*');
      } catch (_) {}
    };
    window.BurreteInlineMode = true;
    window.BurreteGridMode = true;
    window.BurreteDebug = false;
  </script>
</head>
<body class="${visuals.transparentBackground ? "burette-transparent-background" : "burette-opaque-background"}">
  <div id="app"></div>
  <div id="status">Loading molecule grid...</div>
  <script>
    window.BurreteConfig = ${serializeInlineJson(config)};
  </script>
  <script>window.BurreteGridRecords = ${serializeInlineJson(records)};</script>
  ${format === "dwar" ? `<script src="openchemlib/openchemlib.js?v=${GRID_ASSET_VERSION}"></script>` : ""}
  <script src="rdkit/RDKit_minimal.js?v=${GRID_ASSET_VERSION}"></script>
  <script src="grid-ui.js?v=${GRID_ASSET_VERSION}"></script>
  <script src="grid-viewer.js?v=${GRID_ASSET_VERSION}"></script>
</body>
</html>`;
}

function gridPayload(path: string, extension: string, text: string) {
  if (extension === "sdf" || extension === "sd") {
    const records = parseSdfCollectionRecords(text);
    return records.length >= 1 ? { format: "sdf", records } : null;
  }
  if (extension === "smi" || extension === "smiles") {
    const records = parseSmiles(text);
    return records.length > 0 ? { format: "smiles", records } : null;
  }
  if (extension === "csv" || extension === "tsv") {
    const records = parseDelimited(text, extension === "csv" ? "," : "\t");
    return records.length > 0 ? { format: extension, records } : null;
  }
  if (extension === "dwar") {
    const records = parseDataWarrior(text);
    return records.length > 0 ? { format: "dwar", records } : null;
  }
  return null;
}

export function parseBrowserDevDelimitedGridRecords(text: string, extension: "csv" | "tsv") {
  return parseDelimited(text, extension === "csv" ? "," : "\t");
}

function parseSmiles(text: string): GridRecord[] {
  const records: GridRecord[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [smiles, ...nameParts] = line.split(/\s+/);
    if (!looksLikeSmiles(smiles)) continue;
    records.push({
      index: records.length,
      name: nameParts.join(" ") || `Molecule ${records.length + 1}`,
      smiles,
      props: {},
    });
  }
  return records;
}

function parseDelimited(text: string, delimiter: "," | "\t"): GridRecord[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => parseDelimitedLine(line, delimiter))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map((cell) => cell.trim());
  const namedSmilesIndexes = headers
    .map((header, index) => (isDelimitedSmilesHeader(header) ? index : -1))
    .filter((index) => index >= 0);
  const inferredSmilesIndexes = rows[0].some((cell) => looksLikeSmiles(cell))
    ? []
    : inferDelimitedSmilesColumns(rows.slice(1), headers.length);
  const smilesIndexes = [...new Set([...namedSmilesIndexes, ...inferredSmilesIndexes])].sort((left, right) => left - right);
  if (!smilesIndexes.length) return parseDelimitedTableRows(rows, headers);
  const smilesIndexSet = new Set(smilesIndexes);
  const hasMultipleSmilesColumns = smilesIndexes.length > 1;
  const nameIndex = headers.findIndex((header, index) => !smilesIndexSet.has(index) && isDelimitedNameHeader(header));
  const descriptorColumns = new Map<number, { id: string; label: string }>();
  headers.forEach((header, index) => {
    const descriptor = descriptorColumnFromHeader(header);
    if (descriptor) descriptorColumns.set(index, descriptor);
  });
  let recordIndex = 0;
  return rows.slice(1).flatMap((row, rowIndex) => {
    const records: GridRecord[] = [];
    for (const smilesIndex of smilesIndexes) {
      const smiles = row[smilesIndex]?.trim();
      if (!looksLikeSmiles(smiles)) continue;
      const columnName = headers[smilesIndex] || `Column ${smilesIndex + 1}`;
      const props: Record<string, string> = {
        "CSV row": String(rowIndex + 1),
        "SMILES column": columnName,
      };
      const descriptors: GridRecord["descriptors"] = {};
      headers.forEach((header, index) => {
        if (smilesIndexSet.has(index) || index === nameIndex) return;
        const value = row[index]?.trim();
        const descriptor = descriptorColumns.get(index);
        if (descriptor) {
          descriptors[descriptor.id] = descriptorCellFromText(descriptor.label, value || "");
        } else if (value) {
          props[header || `Column ${index + 1}`] = value;
        }
      });
      const baseName = nameIndex >= 0 ? row[nameIndex]?.trim() || `Molecule ${rowIndex + 1}` : `Molecule ${rowIndex + 1}`;
      const name = hasMultipleSmilesColumns ? `${baseName} ${columnName}` : baseName;
      records.push({
        index: recordIndex,
        name,
        smiles,
        props,
        ...(Object.keys(descriptors).length ? { descriptors } : {}),
      });
      recordIndex += 1;
    }
    return records;
  });
}

function parseDelimitedTableRows(rows: string[][], headers: string[]): GridRecord[] {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase().replace(/\s+/gu, "_"));
  const nameIndex = normalizedHeaders.findIndex((header) =>
    ["compound_id", "id", "name", "title", "compound"].includes(header)
  );
  return rows.slice(1).flatMap((row, rowIndex) => {
    if (!row.some((cell) => cell.trim())) return [];
    const rawName = nameIndex >= 0 ? row[nameIndex]?.trim() || "" : "";
    const props: Record<string, string> = {};
    headers.forEach((header, index) => {
      const value = row[index]?.trim();
      if (value) props[header || `Column ${index + 1}`] = value;
    });
    return [{
      index: rowIndex,
      name: rawName || `Row ${rowIndex + 1}`,
      props,
    }];
  });
}

function isDelimitedSmilesHeader(header: string) {
  const normalized = header.trim().toLowerCase().replace(/\s+/gu, "_");
  return normalized === "smile" || normalized === "smiels" || normalized.includes("smiles");
}

function isDelimitedNameHeader(header: string) {
  return ["compound_id", "id", "name", "title", "compound"].includes(header.trim().toLowerCase().replace(/\s+/gu, "_"));
}

function inferDelimitedSmilesColumns(rows: string[][], columnCount: number) {
  const indexes: number[] = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    let nonEmpty = 0;
    let valid = 0;
    for (const row of rows) {
      const value = row[columnIndex]?.trim();
      if (!value) continue;
      nonEmpty += 1;
      if (looksLikeSmiles(value)) valid += 1;
    }
    if (isLikelySmilesColumn(nonEmpty, valid)) indexes.push(columnIndex);
  }
  return indexes;
}

function isLikelySmilesColumn(nonEmpty: number, valid: number) {
  if (!nonEmpty || !valid) return false;
  if (valid < 2 && nonEmpty > 2) return false;
  return valid / nonEmpty >= 0.8;
}

function descriptorColumnFromHeader(header: string) {
  const match = /^(?:descriptor|mordred):(.+)$/iu.exec(header.trim());
  if (!match) return null;
  const id = match[1].trim();
  if (!id) return null;
  return { id, label: id };
}

function descriptorCellFromText(label: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return { label, value: null, missingKind: "missing", errorText: null };
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return { label, value: numeric, missingKind: null, errorText: null };
  if (/^(true|false)$/iu.test(trimmed)) {
    return { label, value: trimmed.toLowerCase() === "true", missingKind: null, errorText: null };
  }
  return { label, value: trimmed, missingKind: null, errorText: null };
}

function parseDelimitedLine(line: string, delimiter: "," | "\t") {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function viewerBridgeJs() {
  return `(() => {
  const postToParent = (body) => {
    if (window.BurreteConfig && window.BurreteConfig.documentId) {
      body.documentId = String(window.BurreteConfig.documentId);
    }
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage({ source: 'burrete-viewer', body }, '*'); } catch (_) {}
    }
  };
  const webkit = window.webkit || {};
  const messageHandlers = webkit.messageHandlers || {};
  if (!messageHandlers.burrete) {
    messageHandlers.burrete = { postMessage: postToParent };
  }
  webkit.messageHandlers = messageHandlers;
  window.webkit = webkit;
  window.__mqlPost = (type, message, payload) => postToParent({ type, message: message || '', ...(payload || {}) });
  window.__mqlAction = (name) => messageHandlers.burrete.postMessage({ type: 'action', message: name });
  window.__mqlDebug = () => {};
  window.BurreteInlineMode = true;
  window.BurreteDebug = false;
  window.BurretePanelControlsVisible = false;
  window.BurreteCacheBuster = String(Date.now());
})();`;
}

function formatForExtension(extension: string): FormatInfo {
  const mdFormat = molstarFormatForExtension(extension);
  if (mdFormat) return mdFormat;
  const format = previewFormatRegistry.formats.find((candidate) =>
    candidate.extensions.includes(extension),
  );
  if (format?.viewer) {
    return {
      molstarFormat: format.viewer.molstarFormat,
      binary: format.viewer.binary,
      externalOnly: format.viewer.externalOnly,
      canOpenInVesta: Boolean(format.canOpenInVesta),
    };
  }
  throw new Error(`Unsupported structure extension: ${extension}`);
}

function shouldTreatTextAsXyzFrames(extension: string) {
  return ["log", "out", "trj", "arc", "xyz"].includes(extension);
}

function molstarFormatForExtension(extension: string): FormatInfo | null {
  const trajectory = previewFormatRegistry.formats.find((candidate) =>
    candidate.preview?.strategy === "trajectory" && candidate.extensions.includes(extension),
  );
  const formats = trajectory?.preview?.formats;
  if (formats) {
    const isBinary = formats.coordinatesBinary?.includes(extension) ?? false;
    const isText = (formats.coordinatesText?.includes(extension) ?? false)
      || (formats.topologyText?.includes(extension) ?? false);
    if (isBinary || isText) {
      return {
        molstarFormat: extension,
        binary: isBinary,
        externalOnly: false,
        canOpenInVesta: Boolean(trajectory.canOpenInVesta),
      };
    }
  }
  return null;
}

function resolveRenderer(format: FormatInfo, requested: string, externalMolstarAvailable = false) {
  const normalized = normalizeRendererMode(requested);
  if (format.externalOnly) {
    if (normalized === "molstar" && externalMolstarAvailable) return "molstar";
    return "xyzrender-external";
  }
  const canUseXyzrender = (format.molstarFormat === "xyz" && !format.binary) || canUseExternalXyzrender(format);
  if (normalized === "molstar") return "molstar";
  if (normalized === "xyzrender-external") return canUseXyzrender ? "xyzrender-external" : "molstar";
  return "molstar";
}

function canUseExternalXyzrender(format: FormatInfo) {
  return !format.binary && ["sdf", "pdb", "pdbqt", "mmcif", "cifCore"].includes(format.molstarFormat);
}

function xyzrenderAvailableForDocument(format: FormatInfo, text: string) {
  if (format.externalOnly || !canUseExternalXyzrender(format)) return true;
  if (!["pdb", "pdbqt", "mmcif", "cifCore"].includes(format.molstarFormat)) return true;
  const atomCount = proteinLikeAtomRecordCount(text);
  return atomCount === 0 || atomCount <= XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT;
}

function proteinLikeAtomRecordCount(text: string) {
  let count = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      count += 1;
      if (count > XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT) return count;
    }
  }
  return count;
}

function shouldUseConvertedMolstarData(format: FormatInfo, converted: ConvertedStructureData | null, extension: string) {
  if (!converted?.bytes) return false;
  if (isPharmacophorePreviewExtension(extension)) return true;
  if ((extension === "lammpstrj" || extension === "dump" || extension === "pos") && converted.molstarFormat === "xyz") return true;
  if (extension === "cfg" && converted.molstarFormat === "pdb") return true;
  if ((extension === "data" || extension === "lammps" || extension === "lmp") && converted.molstarFormat === "pdb") return true;
  if (format.externalOnly) return true;
  if (format.binary) return false;
  if (["gro", "mmcif", "cifCore"].includes(format.molstarFormat)) return true;
  const plan = previewFormatRegistry.formats.find((candidate) => candidate.extensions.includes(extension))?.preview;
  return plan?.strategy === "convert" || plan?.converter?.id === "text-coordinates-to-pdb";
}

function defaultRendererModeForDocument(extension: string, requestedMode: string, reloadOptions?: ViewerReloadOptions) {
  if (isSdfExtension(extension) && requestedMode === "xyzrender-external" && !reloadOptions) {
    return "molstar";
  }
  return requestedMode;
}

function ketcherEditConfig(
  path: string,
  extension: string,
  text: string,
  sourceByteCount: number,
  sdfRecordCount: number,
): Record<string, unknown> | null {
  if (sourceByteCount > KETCHER_EDIT_MAX_BYTES) return null;
  const normalized = extension.toLowerCase();
  let atomCount = 0;
  if (normalized === "mol") {
    atomCount = molfileAtomCount(text);
  } else if (isSdfExtension(normalized)) {
    if (sdfRecordCount !== 1) return null;
    const record = parseSdfCollectionRecords(text)[0]?.molblock ?? text;
    atomCount = molfileAtomCount(record);
  } else {
    return null;
  }
  if (atomCount <= 0 || atomCount > KETCHER_EDIT_MAX_ATOMS) return null;
  const virtualText = browserDevVirtualTextDocuments.get(path);
  return {
    ketcherSourcePath: path,
    ketcherSourceExtension: normalized,
    ketcherSourceTitle: fileTitle(path),
    ketcherAtomCount: atomCount,
    ketcherMaxAtoms: KETCHER_EDIT_MAX_ATOMS,
    ketcherMaxBytes: KETCHER_EDIT_MAX_BYTES,
    ...(virtualText !== undefined ? { ketcherSourceTextBase64: bytesToBase64(new TextEncoder().encode(virtualText)) } : {}),
  };
}

function molfileAtomCount(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const countsLine = lines[3] ?? "";
  const count = Number.parseInt(countsLine.slice(0, 3).trim(), 10);
  return Number.isFinite(count) ? count : 0;
}

function countXyzFrames(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let index = 0;
  let frames = 0;
  while (index < lines.length && frames < 100000) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    const atomCount = Number.parseInt(lines[index]?.trim().split(/\s+/u)[0] ?? "", 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) break;
    if (index + atomCount + 1 >= lines.length) break;
    const atomLines = lines.slice(index + 2, index + 2 + atomCount);
    if (atomLines.length !== atomCount || atomLines.some((line) => !line.trim())) break;
    frames += 1;
    index += atomCount + 2;
  }
  return frames;
}

function countPdbModels(text: string) {
  const matches = text.match(/^MODEL\b/gmu);
  return matches?.length ?? 0;
}

type DefaultXyzrenderPlan = {
  controls: XyzrenderControls;
  inputPath?: string;
};

async function defaultXyzrenderPlanForDocument(path: string, extension: string, text: string): Promise<DefaultXyzrenderPlan | null> {
  if (extension !== "cub" && extension !== "cube") return null;
  const descriptor = cubeDescriptor(path, text);
  const pairedDensityPath = await pairedDensityCubePath(path, descriptor);
  return {
    controls: defaultCubeXyzrenderControls(path, text, Boolean(pairedDensityPath)),
    ...(pairedDensityPath ? { inputPath: pairedDensityPath } : {}),
  };
}

function defaultCubeXyzrenderControls(path: string, text: string, hasPairedDensityCube = false): XyzrenderControls {
  const descriptor = cubeDescriptor(path, text);
  if (descriptor.includes("electrostatic potential") || descriptor.includes("_esp")) {
    return { fieldMode: "esp", fieldOpacity: 0.5, fieldSurfaceStyle: "solid" };
  }
  if (
    descriptor.includes("molecular orbital")
    || descriptor.includes("_homo")
    || descriptor.includes("_lumo")
  ) {
    return { fieldMode: "mo", fieldOpacity: 0.62, fieldSurfaceStyle: "solid" };
  }
  if (isGradientCube(descriptor)) {
    if (hasPairedDensityCube) {
      return { extraArguments: pairedGradientCubeSurfaceArguments(path).join(" ") };
    }
    return { fieldMode: "density", fieldIso: 0.3, fieldOpacity: 0.45, fieldSurfaceStyle: "solid" };
  }
  return { fieldMode: "density", fieldOpacity: 0.45, fieldSurfaceStyle: "solid" };
}

function pairedGradientCubeSurfaceArguments(gradientPath: string) {
  return ["--nci-surf", quoteCommandToken(gradientPath), "--iso", "0.3", "--opacity", "0.45", "--surface-style", "solid"];
}

function cubeDescriptor(path: string, text: string) {
  return [
    fileTitle(path),
    ...text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").slice(0, 2),
  ].join("\n").toLowerCase();
}

function quoteCommandToken(value: string) {
  if (/^[A-Za-z0-9/._\-+=:]+$/u.test(value)) return value;
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"")}"`;
}

async function pairedDensityCubePath(path: string, descriptor: string) {
  if (!isGradientCube(descriptor)) return null;
  for (const candidate of pairedDensityCubeCandidates(path)) {
    if (await browserFileExists(candidate)) return candidate;
  }
  return null;
}

function isGradientCube(descriptor: string) {
  return descriptor.includes("reduced density gradient")
    || descriptor.includes("rdg")
    || descriptor.includes("_grad")
    || descriptor.includes("-grad");
}

function pairedDensityCubeCandidates(path: string) {
  const candidates = new Set<string>();
  for (const [pattern, replacement] of [
    [/_esp(\.cub(?:e)?)$/iu, "_dens$1"],
    [/_esp(\.cub(?:e)?)$/iu, "_density$1"],
    [/-esp(\.cub(?:e)?)$/iu, "-dens$1"],
    [/-esp(\.cub(?:e)?)$/iu, "-density$1"],
    [/_grad(\.cub(?:e)?)$/iu, "_dens$1"],
    [/_grad(\.cub(?:e)?)$/iu, "_density$1"],
    [/-grad(\.cub(?:e)?)$/iu, "-dens$1"],
    [/-grad(\.cub(?:e)?)$/iu, "-density$1"],
  ] as Array<[RegExp, string]>) {
    if (pattern.test(path)) candidates.add(path.replace(pattern, replacement));
  }
  return Array.from(candidates).filter((candidate) => candidate !== path);
}

async function browserFileExists(path: string) {
  try {
    const response = await fetch(fsUrl(path), { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

function isSdfExtension(extension: string) {
  return extension === "sdf" || extension === "sd";
}

function normalizeRendererMode(raw: string) {
  const value = raw.trim().toLowerCase();
  if (["grid2d", "grid", "grid-2d"].includes(value)) return "grid2d";
  if (["molstar", "mol*", "interactive"].includes(value)) return "molstar";
  if (["xyzrender-external", "external-xyzrender", "xyzrender"].includes(value)) {
    return "xyzrender-external";
  }
  return "auto";
}

function gridRequiresPreview(extension: string) {
  return previewFormatRegistry.formats.some((format) =>
    format.extensions.includes(extension) && Boolean(format.grid?.requiresPreview),
  );
}

function fileExtension(path: string) {
  const name = fileTitle(path);
  if (name.toLowerCase().endsWith(".mae.gz")) return "maegz";
  const index = name.lastIndexOf(".");
  if (index >= 0) return name.slice(index + 1).toLowerCase();
  return /^in(?:_|$)/iu.test(name) ? "in" : "";
}

function isMaestroPreviewExtension(extension: string) {
  return extension === "cms" || extension === "mae" || extension === "maegz";
}

function fileTitle(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "structure";
}

function fsUrl(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/") ? "/@fs" : "/@fs/";
  return prefix + normalized.split("/").map(encodeURIComponent).join("/");
}

function browserDevReadUrl(path: string, extension: string) {
  const virtualText = browserDevVirtualTextDocuments.get(path);
  if (virtualText !== undefined) {
    return `data:text/plain;charset=utf-8,${encodeURIComponent(virtualText)}`;
  }
  if (extension === "maegz") {
    return `/__burette/read-file?path=${encodeURIComponent(path)}`;
  }
  return fsUrl(path);
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function decodeStructureText(bytes: Uint8Array, extension: string) {
  if (extension !== "maegz") return decodeUtf8(bytes);
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decompress Maestro gzip files");
  }
  const gzipBytes = new Uint8Array(bytes);
  const stream = new Blob([gzipBytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function browserDevSourceByteCount(response: Response, fallback: number) {
  const sourceByteCount = Number(response.headers.get("x-burrete-source-byte-count"));
  if (Number.isFinite(sourceByteCount) && sourceByteCount > 0) return sourceByteCount;
  const contentRange = response.headers.get("content-range");
  const total = contentRange?.match(/\/(\d+)$/u)?.[1];
  if (total) {
    const value = Number(total);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const contentLength = Number(response.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : fallback;
}

async function browserDevJsonError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : response.statusText;
}

function convertedDataFromText(text: string, extension: string, label: string): ConvertedStructureData | null {
  if (isPharmacophorePreviewExtension(extension)) {
    const bytes = pharmacophorePdbDataFromText(text, extension, label);
    return bytes ? { bytes, molstarFormat: "pdb" } : null;
  }
  if (isMaestroPreviewExtension(extension)) {
    const converted = maestroPdbDataFromText(text);
    return converted ? { molstarFormat: "pdb", ...converted } : null;
  }
  if (extension === "gro") {
    const converted = groPdbDataFromText(text, label);
    return converted ? { molstarFormat: "pdb", ...converted } : null;
  }
  if (extension === "lammpstrj" || extension === "dump" || extension === "pos") {
    const bytes = lammpsDumpXyzDataFromText(text, label);
    return bytes ? { bytes, molstarFormat: "xyz" } : null;
  }
  const bytes = pdbDataFromText(text, extension, label);
  return bytes ? { bytes, molstarFormat: "pdb" } : null;
}

function isPharmacophorePreviewExtension(extension: string) {
  return extension === "ph4" || extension === "json";
}

function pharmacophorePdbDataFromText(text: string, extension: string, label: string) {
  const preview = extension === "ph4"
    ? parseMoePh4Preview(text)
    : extension === "json"
      ? parsePharmitJsonPreview(text)
      : null;
  if (!preview?.features.length) return null;
  const lines: string[] = [
    `REMARK Pharmacophore preview converted from ${label}`,
    "REMARK Feature centers are pseudo-atoms; Pharmit vectors and MOE constraints are rendered as CONECT sticks.",
  ];
  if (preview.volumeSpheres.length) {
    lines.push("REMARK MOE volume spheres are rendered as low-occupancy pseudo-atoms.");
  }
  if (preview.structurePdb) {
    lines.push(...preview.structurePdb.trimEnd().split(/\n/u));
  }
  let serial = maxPdbSerial(preview.structurePdb) + 1;
  const featureSerials: number[] = [];
  const conectLines: Array<[number, number]> = [];
  preview.features.forEach((feature, index) => {
    if (serial > 99999) return;
    const featureSerial = serial;
    featureSerials.push(featureSerial);
    lines.push(pharmacophorePdbAtomLine(featureSerial, feature));
    serial += 1;
    if (feature.vector && serial <= 99999) {
      const length = Math.max(feature.radius * 2, 1.25);
      lines.push(pharmacophorePdbAtomLine(serial, {
        name: "vector",
        x: feature.x + feature.vector.x * length,
        y: feature.y + feature.vector.y * length,
        z: feature.z + feature.vector.z * length,
        radius: 0.2,
      }, { atomName: "VEC", residueName: "VEC", chainName: "V", residueNumber: index + 1, element: "C" }));
      conectLines.push([featureSerial, serial]);
      serial += 1;
    }
  });
  preview.connectors.forEach(([left, right]) => {
    const leftSerial = featureSerials[left];
    const rightSerial = featureSerials[right];
    if (leftSerial && rightSerial) conectLines.push([leftSerial, rightSerial]);
  });
  preview.volumeSpheres.forEach((sphere, index) => {
    if (serial > 99999) return;
    lines.push(pharmacophorePdbAtomLine(serial, {
      name: "volume",
      x: sphere.x,
      y: sphere.y,
      z: sphere.z,
      radius: sphere.radius,
    }, { atomName: "VOL", residueName: "VOL", chainName: "Q", residueNumber: index + 1, occupancy: 0.2, element: "C" }));
    serial += 1;
  });
  conectLines.forEach(([left, right]) => {
    lines.push(`CONECT${String(left).padStart(5, " ")}${String(right).padStart(5, " ")}`);
  });
  lines.push("END", "");
  return new TextEncoder().encode(lines.join("\n"));
}

function parsePharmitJsonPreview(text: string): PharmacophorePreview | null {
  let session: unknown;
  try {
    session = JSON.parse(text);
  } catch {
    return null;
  }
  if (!session || typeof session !== "object" || !Array.isArray((session as { points?: unknown }).points)) return null;
  const features = ((session as { points: unknown[] }).points).flatMap((point): PharmacophoreFeature[] => {
    if (!point || typeof point !== "object") return [];
    const record = point as Record<string, unknown>;
    if (record.enabled === false) return [];
    if (typeof record.name !== "string") return [];
    if (typeof record.x !== "number" || typeof record.y !== "number" || typeof record.z !== "number") return [];
    return [{
      name: record.name,
      x: record.x,
      y: record.y,
      z: record.z,
      radius: typeof record.radius === "number" ? record.radius : 1,
      vector: record.hasvec === true ? normalizedPharmacophoreVector(record.svector) : null,
    }];
  });
  return features.length ? {
    features,
    connectors: [],
    volumeSpheres: [],
    structurePdb: joinedPdbBlocks((session as Record<string, unknown>).receptor, (session as Record<string, unknown>).ligand),
  } : null;
}

function parseMoePh4Preview(text: string): PharmacophorePreview | null {
  if (!text.trimStart().startsWith("#moe:ph4que")) return null;
  const tokens = text.split(/\s+/u).filter(Boolean);
  const featureIndex = tokens.indexOf("#feature");
  if (featureIndex < 0) return null;
  const featureCount = Number(tokens[featureIndex + 1]);
  if (!Number.isInteger(featureCount) || featureCount <= 0) return null;
  let index = featureIndex + 2;
  while (index + 1 < tokens.length) {
    if (tokens[index] === "m" && tokens[index + 1] === "ix") {
      index += 2;
      break;
    }
    index += 1;
  }
  const features: PharmacophoreFeature[] = [];
  for (let i = 0; i < featureCount; i += 1) {
    if (index + 8 >= tokens.length || tokens[index].startsWith("#")) break;
    const x = Number(tokens[index + 2]);
    const y = Number(tokens[index + 3]);
    const z = Number(tokens[index + 4]);
    const radius = Number(tokens[index + 5]);
    if (![x, y, z].every(Number.isFinite)) return null;
    features.push({
      name: tokens[index],
      x,
      y,
      z,
      radius: Number.isFinite(radius) ? radius : 1,
      vector: null,
    });
    index += 9;
  }
  return features.length ? {
    features,
    connectors: parseMoePh4Constraints(tokens, features.length),
    volumeSpheres: parseMoePh4VolumeSpheres(tokens),
    structurePdb: null,
  } : null;
}

function pharmacophorePdbAtomLine(
  serial: number,
  feature: PharmacophoreFeature,
  options: {
    atomName?: string;
    residueName?: string;
    chainName?: string;
    residueNumber?: number;
    occupancy?: number;
    element?: string;
  } = {},
) {
  const symbol = options.element ?? pharmacophoreFeatureSymbol(feature.name);
  const atomName = formatPdbAtomName(options.atomName ?? pharmacophoreAtomName(feature.name), symbol);
  return [
    "HETATM",
    String(Math.min(serial, 99999)).padStart(5, " "),
    " ",
    atomName.padEnd(4, " ").slice(0, 4),
    " ",
    options.residueName ?? pharmacophoreResidueName(feature.name),
    " ",
    options.chainName ?? "P",
    String(Math.min(options.residueNumber ?? serial, 9999)).padStart(4, " "),
    "    ",
    formatPdbCoordinate(feature.x),
    formatPdbCoordinate(feature.y),
    formatPdbCoordinate(feature.z),
    (options.occupancy ?? 1).toFixed(2).padStart(6, " "),
    feature.radius.toFixed(2).padStart(6, " "),
    "          ",
    symbol.padStart(2, " "),
  ].join("");
}

function normalizedPharmacophoreVector(value: unknown): PharmacophoreVector | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = typeof record.x === "number" ? record.x : NaN;
  const y = typeof record.y === "number" ? record.y : NaN;
  const z = typeof record.z === "number" ? record.z : NaN;
  const length = Math.hypot(x, y, z);
  return length > 0.000001 ? { x: x / length, y: y / length, z: z / length } : null;
}

function joinedPdbBlocks(...blocks: unknown[]) {
  const lines: string[] = [];
  blocks.forEach((block) => {
    if (typeof block !== "string") return;
    block.split(/\r?\n/u).forEach((line) => {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed === "END" || trimmed === "ENDMDL") return;
      if (/^(ATOM|HETATM|TER|CONECT)/u.test(trimmed)) lines.push(trimmed);
    });
  });
  if (!lines.length) return null;
  lines.push("TER");
  return `${lines.join("\n")}\n`;
}

function maxPdbSerial(pdb?: string | null) {
  if (!pdb) return 0;
  let maxSerial = 0;
  pdb.split(/\n/u).forEach((line) => {
    if (!/^(ATOM|HETATM)/u.test(line)) return;
    const serial = Number.parseInt(line.slice(6, 11).trim(), 10);
    if (Number.isFinite(serial)) maxSerial = Math.max(maxSerial, serial);
  });
  return maxSerial;
}

function parseMoePh4Constraints(tokens: string[], featureCount: number): Array<[number, number]> {
  let index = tokens.indexOf("#constraint");
  if (index < 0) return [];
  const count = Number(tokens[index + 1]);
  if (!Number.isInteger(count) || count <= 0) return [];
  index += 2;
  while (index < tokens.length && tokens[index] !== "ids") index += 1;
  if (index >= tokens.length) return [];
  index += 2;
  const connectors: Array<[number, number]> = [];
  for (let row = 0; row < count; row += 1) {
    if (index + 4 >= tokens.length || tokens[index].startsWith("#")) break;
    const idCount = Number(tokens[index + 2]);
    if (Number.isInteger(idCount) && idCount >= 2) {
      const left = Number(tokens[index + 3]);
      const right = Number(tokens[index + 4]);
      if (Number.isInteger(left) && Number.isInteger(right) && left >= 1 && right >= 1 && left <= featureCount && right <= featureCount) {
        connectors.push([left - 1, right - 1]);
      }
      index += 3 + idCount;
    } else {
      break;
    }
  }
  return connectors;
}

function parseMoePh4VolumeSpheres(tokens: string[]): PharmacophoreSphere[] {
  let index = tokens.indexOf("#volumesphere");
  if (index < 0) return [];
  const count = Number(tokens[index + 1]);
  if (!Number.isInteger(count) || count <= 0) return [];
  index += 2;
  while (index + 7 < tokens.length) {
    if (tokens[index] === "x" && tokens[index + 1] === "r" && tokens[index + 2] === "y" && tokens[index + 3] === "r" && tokens[index + 4] === "z" && tokens[index + 5] === "r" && tokens[index + 6] === "r" && tokens[index + 7] === "r") {
      index += 8;
      break;
    }
    index += 1;
  }
  const spheres: PharmacophoreSphere[] = [];
  for (let row = 0; row < count; row += 1) {
    if (index + 3 >= tokens.length || tokens[index].startsWith("#")) break;
    const x = Number(tokens[index]);
    const y = Number(tokens[index + 1]);
    const z = Number(tokens[index + 2]);
    const radius = Number(tokens[index + 3]);
    if (![x, y, z, radius].every(Number.isFinite)) break;
    spheres.push({ x, y, z, radius });
    index += 4;
  }
  return spheres;
}

function pharmacophoreFeatureSymbol(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("acceptor") || lower.startsWith("acc")) return "O";
  if (lower.includes("donor") || lower.startsWith("don")) return "N";
  if (lower.includes("positive") || lower.includes("pos")) return "P";
  if (lower.includes("negative") || lower.includes("neg")) return "S";
  return "C";
}

function pharmacophoreAtomName(name: string) {
  return name.replace(/[^a-z0-9]/giu, "").slice(0, 4);
}

function pharmacophoreResidueName(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("acceptor") || lower.startsWith("acc")) return "ACC";
  if (lower.includes("donor") || lower.startsWith("don")) return "DON";
  if (lower.includes("aromatic") || lower.startsWith("aro")) return "ARO";
  if (lower.includes("hydrophobic") || lower.startsWith("hyd")) return "HYD";
  if (lower.includes("positive") || lower.includes("pos")) return "POS";
  if (lower.includes("negative") || lower.includes("neg")) return "NEG";
  return "PH4";
}

function xyzDataFromText(text: string, extension: string, label: string) {
  const atoms = atomsFromText(text, extension);
  if (!atoms?.length) return null;
  const xyz = [
    String(atoms.length),
    `Converted from ${label}`,
    ...atoms.map((atom) => `${atom.symbol} ${formatCoordinate(atom.x)} ${formatCoordinate(atom.y)} ${formatCoordinate(atom.z)}`),
    "",
  ].join("\n");
  return new TextEncoder().encode(xyz);
}

function pdbDataFromText(text: string, extension: string, label: string) {
  const atoms = atomsFromText(text, extension);
  if (!atoms?.length) return null;
  const pdb = [
    `REMARK Converted from ${label}`,
    ...atoms.slice(0, 99999).map((atom, index) => genericPdbAtomLine(index + 1, atom)),
    ...pdbConectLines(atoms),
    "END",
    "",
  ].join("\n");
  return new TextEncoder().encode(pdb);
}

function lammpsDumpXyzDataFromText(text: string, label: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const frames = parseLammpsDumpFrames(lines);
  if (!frames.length) return null;
  const xyz = frames.flatMap((atoms, index) => [
    String(atoms.length),
    `Converted from ${label} frame ${index + 1}`,
    ...atoms.map((atom) => `${atom.symbol} ${formatCoordinate(atom.x)} ${formatCoordinate(atom.y)} ${formatCoordinate(atom.z)}`),
  ]).join("\n") + "\n";
  return new TextEncoder().encode(xyz);
}

function atomsFromText(text: string, extension: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let atoms: Atom[] | null = null;
  if (extension === "cub" || extension === "cube") {
    atoms = parseCubeAtoms(lines);
  } else if (extension === "vasp") {
    atoms = parseVaspAtoms(lines);
  } else if (extension === "in" || extension === "inp") {
    atoms = parseQuantumEspressoAtoms(lines);
  } else if (extension === "out") {
    atoms = parseOrcaAtoms(lines);
  } else if (extension === "abi") {
    atoms = parseAbinitAtoms(lines);
  } else if (extension === "fdf") {
    atoms = parseFdfAtoms(lines);
  } else if (extension === "cif" || extension === "mmcif" || extension === "mcif") {
    atoms = parseCifCoreAtoms(lines);
  } else if (extension === "inpcrd" || extension === "rst7" || extension === "restrt") {
    atoms = parseAmberRestartAtoms(lines);
  } else if (extension === "lammpstrj" || extension === "dump" || extension === "pos") {
    atoms = parseLammpsDumpAtoms(lines);
  } else if (extension === "cfg") {
    atoms = parseAtomeyeCfgAtoms(lines) ?? parseMlipCfgAtoms(lines);
  } else if (extension === "data" || extension === "lammps" || extension === "lmp") {
    atoms = parseLammpsDataAtoms(lines);
  } else if (extension === "crd") {
    atoms = parseCharmmCoordinateAtoms(lines);
  } else if (extension === "rst") {
    atoms = parseCharmmCoordinateAtoms(lines) ?? parseAmberRestartAtoms(lines);
  } else if (extension === "state" || extension === "xml") {
    atoms = parseXmlPositionAtoms(text) ?? parseHoomdXmlAtoms(text);
  } else if (isMaestroPreviewExtension(extension)) {
    atoms = parseMaestroAtoms(lines, MAESTRO_PREVIEW_ATOM_LIMIT);
  }
  atoms ??= parseBestCoordinateBlock(lines);
  return atoms;
}

export function maestroPdbDataFromText(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks = parseMaestroPdbBlocks(lines, MAESTRO_PDB_PREVIEW_ATOM_LIMIT);
  if (!blocks?.length) return null;
  const bestScore = Math.max(...blocks.map((block) => maestroCtScore(block.ctType)));
  let models = blocks
    .filter((block) => maestroCtScore(block.ctType) === bestScore)
    .map((block) => block.atoms.filter((atom) => !isMaestroWaterAtom(atom)))
    .filter((atoms) => atoms.length);
  const hasNonSolventPrimary = models.length > 0;
  if (!models.length) {
    models = blocks
      .filter((block) => maestroCtScore(block.ctType) === bestScore)
      .map((block) => block.atoms)
      .filter((atoms) => atoms.length);
  }
  if (!models.length) return null;

  const independentEntries = models.length > 1 && !maestroModelsShareTopology(models);
  const pdb = independentEntries
    ? maestroIndependentEntriesToPdb(models)
    : models.length === 1
    ? [
        ...models[0].map((atom, index) => maestroPdbAtomLine(index + 1, atom)),
        ...pdbConectLines(models[0]),
        "END",
        "",
      ].join("\n")
    : maestroModelsToPdb(models);
  const bytes = new TextEncoder().encode(pdb);
  const stagedEntries: Array<Record<string, unknown>> = [];
  if (independentEntries) {
    models.forEach((atoms, index) => {
      stagedEntries.push({
        label: `Structure ${index + 1}`,
        format: "pdb",
        binary: false,
        representation: "structure-scene-entry",
        dataBase64: bytesToBase64(new TextEncoder().encode(maestroSingleEntryToPdb(atoms, `Structure ${index + 1}`))),
      });
    });
  }
  if (hasNonSolventPrimary) {
    const solventAtoms = maestroStagedSolventAtoms(blocks);
    if (solventAtoms.length) {
      const solventPdb = [
        ...solventAtoms.map((atom, index) => maestroPdbAtomLine(index + 1, atom)),
        ...pdbConectLines(solventAtoms),
        "END",
        "",
      ].join("\n");
      stagedEntries.push({
        label: "Solvent",
        format: "pdb",
        binary: false,
        representation: "solvent-lines",
        dataBase64: bytesToBase64(new TextEncoder().encode(solventPdb)),
      });
    }
  }
  if (!stagedEntries.length) return { bytes };
  return { bytes, stagedEntries };
}

function maestroIndependentEntriesToPdb(models: MaestroAtom[][]) {
  const lines = ["REMARK Combined independent Maestro CT entries"];
  let serial = 1;
  models.forEach((atoms, modelIndex) => {
    if (serial > 99999) return;
    const cappedAtoms = atoms.slice(0, 100000 - serial).map((atom) => ({
      ...atom,
      chainName: maestroEntryChainName(modelIndex),
    }));
    lines.push(...cappedAtoms.map((atom, atomIndex) => maestroPdbAtomLine(serial + atomIndex, atom)));
    lines.push(...pdbConectLines(cappedAtoms, serial - 1));
    lines.push("TER");
    serial += cappedAtoms.length;
  });
  lines.push("END", "");
  return lines.join("\n");
}

function maestroSingleEntryToPdb(atoms: MaestroAtom[], label: string) {
  return [
    `REMARK ${label}`,
    ...atoms.slice(0, 99999).map((atom, index) => maestroPdbAtomLine(index + 1, atom)),
    ...pdbConectLines(atoms.slice(0, 99999)),
    "END",
    "",
  ].join("\n");
}

function groPdbDataFromText(text: string, label: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const atoms = parseGroPdbAtoms(lines);
  if (!atoms?.length) return null;
  const mainAtoms = atoms.filter((atom) => atom.residueName !== "HOH");
  const waterAtoms = atoms.filter((atom) => atom.residueName === "HOH");
  const pdb = [
    `REMARK Converted from ${label}`,
    ...mainAtoms.slice(0, 99999).map((atom, index) => maestroPdbAtomLine(index + 1, atom)),
    "END",
    "",
  ].join("\n");
  const bytes = new TextEncoder().encode(pdb);
  const stagedEntries: Array<Record<string, unknown>> = [];
  if (waterAtoms.length) {
    const waterPdb = [
      `REMARK Water split from ${label}`,
      ...waterAtoms.slice(0, 99999).map((atom, index) => maestroPdbAtomLine(index + 1, atom)),
      "END",
      "",
    ].join("\n");
    stagedEntries.push({
      label: "Water",
      format: "pdb",
      binary: false,
      representation: "solvent-lines",
      dataBase64: bytesToBase64(new TextEncoder().encode(waterPdb)),
    });
  }
  if (!stagedEntries.length) return { bytes };
  return {
    bytes,
    stagedEntries,
  };
}

function parseGroPdbAtoms(lines: string[]) {
  if (lines.length < 3) return null;
  const atomCount = Number.parseInt(lines[1].trim(), 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0 || lines.length < atomCount + 2) return null;
  const atoms: MaestroAtom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const line = lines[index + 2] || "";
    const fixed = parseGroFixedAtomLine(line);
    const parsed = fixed ?? parseGroLooseAtomLine(line);
    if (!parsed) continue;
    const residueName = isGroWaterResidue(parsed.residueName) ? "HOH" : normalizePdbResidueName(parsed.residueName);
    const atomName = normalizePdbAtomName(parsed.atomName) || parsed.symbol;
    atoms.push({
      symbol: parsed.symbol,
      atomName,
      residueName: residueName || "MOL",
      residueNumber: parsed.residueNumber,
      chainName: "A",
      x: parsed.x * 10,
      y: parsed.y * 10,
      z: parsed.z * 10,
    });
  }
  return atoms.length ? atoms : null;
}

function parseGroFixedAtomLine(line: string) {
  if (line.length < 44) return null;
  const residueNumber = Number.parseInt(line.slice(0, 5).trim(), 10);
  const residueName = line.slice(5, 10).trim();
  const atomName = line.slice(10, 15).trim();
  const x = Number.parseFloat(line.slice(20, 28).trim());
  const y = Number.parseFloat(line.slice(28, 36).trim());
  const z = Number.parseFloat(line.slice(36, 44).trim());
  const symbol = groElementSymbol(atomName, residueName);
  if (!Number.isFinite(residueNumber) || !residueName || !atomName || !symbol || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { residueNumber, residueName, atomName, symbol, x, y, z };
}

function parseGroLooseAtomLine(line: string) {
  const parts = fields(line);
  if (parts.length < 6) return null;
  const residueToken = parts[0];
  const residueMatch = residueToken.match(/^(\d+)([A-Za-z0-9]+)$/u);
  const residueNumber = Number.parseInt(residueMatch?.[1] ?? residueToken, 10);
  const residueName = residueMatch?.[2] ?? parts[1];
  const atomName = residueMatch ? parts[1] : parts[2];
  const offset = residueMatch ? 3 : 4;
  const x = Number.parseFloat(parts[offset] || "");
  const y = Number.parseFloat(parts[offset + 1] || "");
  const z = Number.parseFloat(parts[offset + 2] || "");
  const symbol = groElementSymbol(atomName, residueName);
  if (!Number.isFinite(residueNumber) || !residueName || !atomName || !symbol || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { residueNumber, residueName, atomName, symbol, x, y, z };
}

function isGroWaterResidue(residueName: string) {
  return ["SOL", "WAT", "HOH", "H2O", "TIP", "TIP3", "TIP3P", "TIP4", "TIP4P", "TP3", "TP4", "SPC", "SPCE"].includes(residueName.trim().toUpperCase());
}

function maestroStagedSolventAtoms(blocks: MaestroPdbBlock[]) {
  const explicitSolventAtoms = blocks
    .filter((block) => ["solvent", "ion"].includes(block.ctType.trim().toLowerCase()))
    .flatMap((block) => block.atoms)
    .map(normalizeMaestroStagedSolventAtom);
  if (explicitSolventAtoms.length) return explicitSolventAtoms;

  const fullSystemWaterAtoms = blocks
    .filter((block) => block.ctType.trim().toLowerCase() === "full_system")
    .flatMap((block) => block.atoms)
    .filter(isMaestroWaterAtom)
    .map(normalizeMaestroStagedSolventAtom);
  if (fullSystemWaterAtoms.length) return fullSystemWaterAtoms;

  return blocks
    .flatMap((block) => block.atoms)
    .filter(isMaestroWaterAtom)
    .map(normalizeMaestroStagedSolventAtom);
}

function normalizeMaestroStagedSolventAtom(atom: MaestroAtom): MaestroAtom {
  return isMaestroWaterAtom(atom) ? { ...atom, residueName: "HOH" } : atom;
}

function isMaestroWaterAtom(atom: MaestroAtom) {
  return isMaestroWaterResidue(atom.residueName);
}

function isMaestroWaterResidue(residueName: string) {
  return ["SOL", "WAT", "HOH", "H2O", "TIP", "TP3", "TP4", "SPC", "DOD"].includes(residueName.trim().toUpperCase());
}

function groElementSymbol(atomName: string, residueName: string) {
  const cleaned = atomName.replace(/^[0-9]+/u, "").replace(/[^A-Za-z]/gu, "").toUpperCase();
  if (!cleaned) return null;
  if (isGroWaterResidue(residueName)) return cleaned.startsWith("H") ? "H" : "O";
  if (cleaned.startsWith("CL")) return "Cl";
  if (cleaned.startsWith("BR")) return "Br";
  if (cleaned.startsWith("NA")) return "Na";
  if (cleaned.startsWith("MG")) return "Mg";
  if (cleaned.startsWith("ZN")) return "Zn";
  if (cleaned.startsWith("FE")) return "Fe";
  if (cleaned.startsWith("CA") && residueName.trim().toUpperCase() === "CA") return "Ca";
  return normalizeElementSymbol(cleaned[0]);
}

function parseMaestroAtoms(lines: string[], atomLimit: number) {
  return parseMaestroPdbAtoms(lines, atomLimit)?.map(({ symbol, x, y, z }) => ({ symbol, x, y, z })) ?? null;
}

function parseMaestroPdbAtoms(lines: string[], atomLimit: number) {
  return parseMaestroPdbModels(lines, atomLimit)?.[0] ?? null;
}

function parseMaestroPdbModels(lines: string[], atomLimit: number) {
  const blocks = parseMaestroPdbBlocks(lines, atomLimit);
  if (!blocks?.length) return null;
  const bestScore = Math.max(...blocks.map((block) => maestroCtScore(block.ctType)));
  const models = blocks
    .filter((block) => maestroCtScore(block.ctType) === bestScore)
    .map((block) => block.atoms)
    .filter((atoms) => atoms.length);
  return models.length ? models : null;
}

function parseMaestroPdbBlocks(lines: string[], atomLimit: number) {
  let currentCtType = "";
  const blocks: MaestroPdbBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === "f_m_ct {") {
      const result = parseMaestroCtType(lines, index + 1);
      currentCtType = result.ctType;
      index = result.nextIndex - 1;
      continue;
    }
    if (!trimmed.startsWith("m_atom[") || !trimmed.endsWith("{")) continue;

    const headers: string[] = [];
    let hasImplicitAtomIndex = false;
    index += 1;
    while (index < lines.length) {
      const headerLine = lines[index].trim();
      index += 1;
      if (headerLine === ":::") break;
      if (headerLine.startsWith("#")) {
        hasImplicitAtomIndex ||= headerLine.toLowerCase().includes("first column is atom index");
        continue;
      }
      if (headerLine === "}") {
        headers.length = 0;
        break;
      }
      headers.push(...fields(headerLine));
    }
    if (!headers.length) continue;

    const xIndex = maestroHeaderIndex(headers, "r_m_x_coord");
    const yIndex = maestroHeaderIndex(headers, "r_m_y_coord");
    const zIndex = maestroHeaderIndex(headers, "r_m_z_coord");
    if (xIndex < 0 || yIndex < 0 || zIndex < 0) continue;
    const atomicNumberIndex = maestroHeaderIndex(headers, "i_m_atomic_number");
    const elementIndex = firstPresentHeaderIndex(headers, ["s_m_element", "s_m_pdb_element"]);
    const atomNameIndex = firstPresentHeaderIndex(headers, ["s_m_atom_name", "s_m_pdb_atom_name"]);
    const pdbAtomNameIndex = firstPresentHeaderIndex(headers, ["s_m_pdb_atom_name", "s_m_atom_name"]);
    const residueNameIndex = firstPresentHeaderIndex(headers, ["s_m_pdb_residue_name", "s_m_mmod_res"]);
    const residueNumberIndex = maestroHeaderIndex(headers, "i_m_residue_number");
    const chainNameIndex = maestroHeaderIndex(headers, "s_m_chain_name");

    const atoms: MaestroAtom[] = [];
    while (index < lines.length) {
      const rowLine = lines[index].trim();
      index += 1;
      if (rowLine === ":::" || rowLine === "}") break;
      if (!rowLine) continue;
      const row = cifTokens(rowLine);
      const rowOffset = hasImplicitAtomIndex ? 1 : 0;
      const x = Number(row[xIndex + rowOffset]);
      const y = Number(row[yIndex + rowOffset]);
      const z = Number(row[zIndex + rowOffset]);
      const symbol = maestroAtomSymbol(row, rowOffset, atomicNumberIndex, elementIndex, atomNameIndex);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !symbol) continue;
      const atomName = normalizePdbAtomName((pdbAtomNameIndex >= 0 ? row[pdbAtomNameIndex + rowOffset] : symbol) || symbol);
      const residueName = normalizePdbResidueName((residueNameIndex >= 0 ? row[residueNameIndex + rowOffset] : "MOL") || "MOL") || "MOL";
      const residueNumber = Number.parseInt((residueNumberIndex >= 0 ? row[residueNumberIndex + rowOffset] : "1") || "1", 10);
      const chainName = normalizePdbChainName((chainNameIndex >= 0 ? row[chainNameIndex + rowOffset] : "A") || "A");
      atoms.push({
        symbol,
        atomName: atomName || symbol,
        residueName,
        residueNumber: Number.isFinite(residueNumber) ? residueNumber : 1,
        chainName,
        x,
        y,
        z,
      });
      if (atoms.length >= atomLimit) break;
    }
    if (atoms.length) {
      blocks.push({ ctType: currentCtType, atoms });
    }
  }
  return blocks.length ? blocks : null;
}

function parseMaestroCtType(lines: string[], startIndex: number) {
  let index = startIndex;
  const headers: string[] = [];
  while (index < lines.length) {
    const line = lines[index].trim();
    index += 1;
    if (line === ":::") break;
    if (line.startsWith("m_atom[") || line === "}") return { ctType: "", nextIndex: index - 1 };
    headers.push(...fields(line));
  }
  const ctTypeIndex = maestroHeaderIndex(headers, "s_ffio_ct_type");
  const values: string[] = [];
  while (index < lines.length) {
    const line = lines[index].trim();
    if (line.startsWith("m_atom[") || line === "}") break;
    values.push(...cifTokens(line));
    index += 1;
  }
  return { ctType: (values[ctTypeIndex] || "").trim().toLowerCase(), nextIndex: index };
}

function maestroCtScore(ctType: string) {
  if (ctType === "full_system") return 4;
  if (ctType === "solute") return 3;
  if (ctType === "ion") return 1;
  if (ctType === "solvent") return 0;
  return 2;
}

function maestroModelsShareTopology(models: MaestroAtom[][]) {
  const [firstModel, ...otherModels] = models;
  if (!firstModel || !otherModels.length) return true;
  const firstKeys = firstModel.map(maestroAtomTopologyKey);
  return otherModels.every((model) => (
    model.length === firstKeys.length
    && model.every((atom, index) => maestroAtomTopologyKey(atom) === firstKeys[index])
  ));
}

function maestroAtomTopologyKey(atom: MaestroAtom) {
  return [
    atom.symbol,
    atom.atomName,
    atom.residueName,
    String(atom.residueNumber),
    atom.chainName,
  ].join("|");
}

function maestroModelsToPdb(models: MaestroAtom[][]) {
  const lines: string[] = [];
  models.forEach((atoms, modelIndex) => {
    lines.push(`MODEL${String(modelIndex + 1).padStart(9, " ")}`);
    atoms.forEach((atom, atomIndex) => {
      lines.push(maestroPdbAtomLine(atomIndex + 1, atom));
    });
    lines.push(...pdbConectLines(atoms));
    lines.push("ENDMDL");
  });
  lines.push("END", "");
  return lines.join("\n");
}

function maestroPdbAtomLine(serial: number, atom: MaestroAtom) {
  const residueName = truncateAscii(atom.residueName, 3) || "MOL";
  const atomName = formatPdbAtomName(atom.atomName, atom.symbol);
  const chainName = truncateAscii(atom.chainName, 1) || "A";
  const record = isStandardPolymerResidue(residueName) ? "ATOM" : "HETATM";
  return [
    record.padEnd(6, " "),
    String(Math.min(serial, 99999)).padStart(5, " "),
    " ",
    atomName.padEnd(4, " ").slice(0, 4),
    " ",
    residueName.padStart(3, " "),
    " ",
    chainName,
    String(clamp(atom.residueNumber, -999, 9999)).padStart(4, " "),
    "    ",
    formatPdbCoordinate(atom.x),
    formatPdbCoordinate(atom.y),
    formatPdbCoordinate(atom.z),
    "  1.00 10.00          ",
    truncateAscii(atom.symbol, 2).padStart(2, " "),
  ].join("");
}

function genericPdbAtomLine(serial: number, atom: Atom) {
  const symbol = normalizeElementSymbol(atom.symbol);
  const atomName = formatPdbAtomName(symbol, symbol);
  return [
    "HETATM",
    String(Math.min(serial, 99999)).padStart(5, " "),
    " ",
    atomName.padEnd(4, " ").slice(0, 4),
    " ",
    "MOL",
    " ",
    "A",
    String(1).padStart(4, " "),
    "    ",
    formatPdbCoordinate(atom.x),
    formatPdbCoordinate(atom.y),
    formatPdbCoordinate(atom.z),
    "  1.00 10.00          ",
    truncateAscii(symbol, 2).padStart(2, " "),
  ].join("");
}

function pdbConectLines(atoms: Atom[], serialOffset = 0) {
  const bonds = inferPdbBonds(atoms);
  if (!bonds.length) return [];
  const adjacency = Array.from({ length: Math.min(atoms.length, 99999) }, () => [] as number[]);
  for (const [left, right] of bonds) {
    adjacency[left].push(serialOffset + right + 1);
    adjacency[right].push(serialOffset + left + 1);
  }
  const lines: string[] = [];
  adjacency.forEach((neighbors, index) => {
    for (let offset = 0; offset < neighbors.length; offset += 4) {
      lines.push(`CONECT${String(serialOffset + index + 1).padStart(5, " ")}${neighbors.slice(offset, offset + 4).map((serial) => String(serial).padStart(5, " ")).join("")}`);
    }
  });
  return lines;
}

function maestroEntryChainName(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return alphabet[index % alphabet.length] || "A";
}

function inferPdbBonds(atoms: Atom[]) {
  const cappedAtoms = atoms.slice(0, 99999);
  if (cappedAtoms.length > 2000) return [];
  const bonds: Array<[number, number]> = [];
  for (let left = 0; left < cappedAtoms.length; left += 1) {
    const leftRadius = covalentRadius(cappedAtoms[left].symbol);
    if (!leftRadius) continue;
    for (let right = left + 1; right < cappedAtoms.length; right += 1) {
      const rightRadius = covalentRadius(cappedAtoms[right].symbol);
      if (!rightRadius) continue;
      const dx = cappedAtoms[left].x - cappedAtoms[right].x;
      const dy = cappedAtoms[left].y - cappedAtoms[right].y;
      const dz = cappedAtoms[left].z - cappedAtoms[right].z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const maxDistance = Math.min(leftRadius + rightRadius + 0.45, 2.25);
      if (distance >= 0.35 && distance <= maxDistance) bonds.push([left, right]);
    }
  }
  return bonds;
}

function covalentRadius(symbol: string) {
  const radii: Record<string, number> = {
    H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
    Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76,
    Fe: 1.24, Co: 1.18, Ni: 1.17, Cu: 1.22, Zn: 1.22, Br: 1.20, I: 1.39,
  };
  return radii[normalizeElementSymbol(symbol)] ?? 0;
}

function formatPdbAtomName(atomName: string, symbol: string) {
  return truncateAscii(atomName, 4) || truncateAscii(symbol, 2) || "X";
}

function formatPdbCoordinate(value: number) {
  return value.toFixed(3).padStart(8, " ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function truncateAscii(value: string, maxLength: number) {
  return String(value || "").replace(/[^A-Za-z0-9]/gu, "").slice(0, maxLength);
}

function normalizePdbAtomName(value: string) {
  return String(value || "").trim().replace(/^['"]|['"]$/gu, "").trim();
}

function normalizePdbResidueName(value: string) {
  return truncateAscii(String(value || "").trim().replace(/^['"]|['"]$/gu, "").trim(), 3).toUpperCase();
}

function normalizePdbChainName(value: string) {
  return truncateAscii(String(value || "").trim().replace(/^['"]|['"]$/gu, "").trim(), 1) || "A";
}

function isStandardPolymerResidue(residueName: string) {
  return new Set([
    "ALA", "ARG", "ASN", "ASP", "CYS", "CYX", "GLN", "GLU", "GLY", "HIS", "HID", "HIE", "HIP",
    "ILE", "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
  ]).has(residueName);
}

function maestroHeaderIndex(headers: string[], name: string) {
  return headers.findIndex((header) => header.toLowerCase() === name);
}

function firstPresentHeaderIndex(headers: string[], names: string[]) {
  for (const name of names) {
    const index = maestroHeaderIndex(headers, name);
    if (index >= 0) return index;
  }
  return -1;
}

function maestroAtomSymbol(
  row: string[],
  rowOffset: number,
  atomicNumberIndex: number,
  elementIndex: number,
  atomNameIndex: number,
) {
  const atomicNumber = Number.parseInt(row[atomicNumberIndex + rowOffset] || "", 10);
  if (Number.isFinite(atomicNumber) && atomicNumber > 0) {
    const symbol = symbolForAtomicNumber(atomicNumber);
    if (symbol !== "X") return symbol;
  }
  const element = elementIndex >= 0 ? elementSymbolFromCif(row[elementIndex + rowOffset] || "") : null;
  if (element) return element;
  return atomNameIndex >= 0 ? elementSymbolFromCif(row[atomNameIndex + rowOffset] || "") : null;
}

function parseCifCoreAtoms(lines: string[]) {
  const cell = parseCifCell(lines);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase() !== "loop_") continue;
    const headers: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim().startsWith("_")) {
      headers.push(lines[index].trim().toLowerCase());
      index += 1;
    }
    const fractXIndex = headers.indexOf("_atom_site_fract_x");
    const fractYIndex = headers.indexOf("_atom_site_fract_y");
    const fractZIndex = headers.indexOf("_atom_site_fract_z");
    if (fractXIndex < 0 || fractYIndex < 0 || fractZIndex < 0) continue;
    const typeIndex = headers.indexOf("_atom_site_type_symbol");
    const labelIndex = headers.indexOf("_atom_site_label");
    const atoms: Atom[] = [];
    while (index < lines.length) {
      const trimmed = lines[index].trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.toLowerCase() === "loop_" || trimmed.startsWith("_") || trimmed.toLowerCase().startsWith("data_")) break;
      const parts = cifTokens(trimmed);
      index += 1;
      if (parts.length < headers.length) continue;
      const rawSymbol = (typeIndex >= 0 ? parts[typeIndex] : parts[labelIndex]) || "";
      const symbol = elementSymbolFromCif(rawSymbol);
      const fx = parseCifNumber(parts[fractXIndex]);
      const fy = parseCifNumber(parts[fractYIndex]);
      const fz = parseCifNumber(parts[fractZIndex]);
      if (!symbol || fx == null || fy == null || fz == null) continue;
      const [x, y, z] = cell ? fractionalToCartesian(fx, fy, fz, cell) : [fx, fy, fz];
      atoms.push({ symbol, x, y, z });
    }
    if (atoms.length) return atoms;
  }
  return null;
}

function parseCifCell(lines: string[]) {
  const values = new Map<string, number>();
  for (const line of lines) {
    const parts = cifTokens(line.trim());
    if (parts.length < 2) continue;
    const key = parts[0].toLowerCase();
    if (!key.startsWith("_cell_")) continue;
    const value = parseCifNumber(parts[1]);
    if (value != null) values.set(key, value);
  }
  const a = values.get("_cell_length_a");
  const b = values.get("_cell_length_b");
  const c = values.get("_cell_length_c");
  const alpha = values.get("_cell_angle_alpha");
  const beta = values.get("_cell_angle_beta");
  const gamma = values.get("_cell_angle_gamma");
  return a && b && c && alpha && beta && gamma
    ? { a, b, c, alpha, beta, gamma }
    : null;
}

function fractionalToCartesian(fx: number, fy: number, fz: number, cell: NonNullable<ReturnType<typeof parseCifCell>>) {
  const alpha = degreesToRadians(cell.alpha);
  const beta = degreesToRadians(cell.beta);
  const gamma = degreesToRadians(cell.gamma);
  const cosAlpha = Math.cos(alpha);
  const cosBeta = Math.cos(beta);
  const cosGamma = Math.cos(gamma);
  const sinGamma = Math.sin(gamma) || 1;
  const ax = [cell.a, 0, 0];
  const by = [cell.b * cosGamma, cell.b * sinGamma, 0];
  const cx = cell.c * cosBeta;
  const cy = cell.c * (cosAlpha - cosBeta * cosGamma) / sinGamma;
  const cz = Math.sqrt(Math.max(0, cell.c * cell.c - cx * cx - cy * cy));
  return combineVectors(fx, ax, fy, by, fz, [cx, cy, cz]);
}

function cifTokens(line: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseCifNumber(value: string | undefined) {
  const match = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/u.exec(value || "");
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function elementSymbolFromCif(value: string) {
  const match = /^[A-Za-z]{1,2}/u.exec(value.replace(/[^A-Za-z0-9]/gu, ""));
  if (!match) return null;
  const symbol = normalizeElementSymbol(match[0]);
  return isElementSymbol(symbol) ? symbol : null;
}

function degreesToRadians(value: number) {
  return value * Math.PI / 180;
}

function parseAbinitAtoms(lines: string[]) {
  let atomCount: number | null = null;
  const atomicNumbers: number[] = [];
  const typeIndices: number[] = [];
  let coordinateStart: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const parts = fields(stripInlineComment(lines[index] || ""));
    const key = parts[0]?.toLowerCase();
    if (key === "natom") {
      const value = Number.parseInt(parts[1] || "", 10);
      if (Number.isFinite(value)) atomCount = value;
    } else if (key === "znucl") {
      atomicNumbers.push(...parts.slice(1).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite));
    } else if (key === "typat") {
      typeIndices.push(...parts.slice(1).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite));
    } else if (key === "xangst") {
      coordinateStart = index + 1;
    }
  }

  if (!atomCount || atomCount <= 0 || atomicNumbers.length === 0 || typeIndices.length < atomCount || coordinateStart === null) {
    return null;
  }
  if (coordinateStart + atomCount > lines.length) return null;

  const atoms: Atom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const parts = fields(stripInlineComment(lines[coordinateStart + index] || ""));
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    const typeIndex = (typeIndices[index] ?? 0) - 1;
    const atomicNumber = atomicNumbers[typeIndex];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !atomicNumber) continue;
    atoms.push({ symbol: symbolForAtomicNumber(atomicNumber), x, y, z });
  }

  return atoms.length === atomCount ? atoms : null;
}

function parseFdfAtoms(lines: string[]) {
  const speciesById = new Map<number, string>();
  for (const row of fdfBlockRows("ChemicalSpeciesLabel", lines)) {
    const parts = fields(row);
    const speciesId = Number.parseInt(parts[0] || "", 10);
    const atomicNumber = Number.parseInt(parts[1] || "", 10);
    const explicitSymbol = parts.length >= 3 ? normalizeElementSymbol(parts[2] || "") : "";
    const symbol = isElementSymbol(explicitSymbol) ? explicitSymbol : symbolForAtomicNumber(atomicNumber);
    if (Number.isFinite(speciesId) && Number.isFinite(atomicNumber) && isElementSymbol(symbol)) {
      speciesById.set(speciesId, symbol);
    }
  }
  if (speciesById.size === 0) return null;

  const coordinateScale = fdfCoordinateScale(lines);
  const atoms = fdfBlockRows("AtomicCoordinatesAndAtomicSpecies", lines).flatMap((row): Atom[] => {
    const parts = fields(row);
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    const speciesId = Number.parseInt(parts[3] || "", 10);
    const symbol = speciesById.get(speciesId);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !symbol) return [];
    return [{ symbol, x: x * coordinateScale, y: y * coordinateScale, z: z * coordinateScale }];
  });
  return atoms.length ? atoms : null;
}

function fdfBlockRows(blockName: string, lines: string[]) {
  const rows: string[] = [];
  const normalizedBlockName = blockName.toLowerCase();
  let inside = false;
  for (const line of lines) {
    const trimmed = stripInlineComment(line).trim();
    const parts = fields(trimmed);
    const marker = parts[0]?.toLowerCase();
    const name = parts[1]?.toLowerCase();
    if (marker === "%block" && name === normalizedBlockName) {
      inside = true;
      continue;
    }
    if (marker === "%endblock" && name === normalizedBlockName) break;
    if (inside && trimmed) rows.push(trimmed);
  }
  return rows;
}

function fdfCoordinateScale(lines: string[]) {
  for (const line of lines) {
    const parts = fields(stripInlineComment(line));
    if (parts.length >= 2 && parts[0]?.toLowerCase() === "atomiccoordinatesformat") {
      return parts[1]?.toLowerCase().includes("bohr") ? BOHR_TO_ANGSTROM : 1;
    }
  }
  return 1;
}

function parseCubeAtoms(lines: string[]) {
  if (lines.length < 6) return null;
  const count = Math.abs(Number.parseInt(fields(lines[2])[0] || "", 10));
  if (!Number.isFinite(count) || count <= 0 || lines.length < 6 + count) return null;
  const axisCounts = [fields(lines[3])[0], fields(lines[4])[0], fields(lines[5])[0]]
    .map((value) => Number.parseInt(value || "", 10));
  const coordinateScale = axisCounts.every((value) => Number.isFinite(value) && value > 0) ? BOHR_TO_ANGSTROM : 1;
  const atoms: Atom[] = [];
  for (let index = 0; index < count; index += 1) {
    const parts = fields(lines[6 + index]);
    const number = Number.parseInt(parts[0] || "", 10);
    const x = Number(parts[2]);
    const y = Number(parts[3]);
    const z = Number(parts[4]);
    if (!Number.isFinite(number) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    atoms.push({ symbol: symbolForAtomicNumber(number), x: x * coordinateScale, y: y * coordinateScale, z: z * coordinateScale });
  }
  return atoms;
}

function parseVaspAtoms(lines: string[]) {
  if (lines.length < 8) return null;
  const scale = Number(lines[1].trim());
  const a = parseVector(lines[2], scale);
  const b = parseVector(lines[3], scale);
  const c = parseVector(lines[4], scale);
  if (!Number.isFinite(scale) || !a || !b || !c) return null;
  const symbols = fields(lines[5]);
  const counts = fields(lines[6]).map((value) => Number.parseInt(value, 10));
  if (!symbols.length || symbols.length !== counts.length || counts.some((value) => !Number.isFinite(value))) return null;
  let index = 7;
  if (lines[index]?.trim().toLowerCase().startsWith("s")) index += 1;
  const direct = lines[index]?.trim().toLowerCase().startsWith("d") ?? false;
  index += 1;
  const atoms: Atom[] = [];
  for (let symbolIndex = 0; symbolIndex < symbols.length; symbolIndex += 1) {
    for (let countIndex = 0; countIndex < counts[symbolIndex]; countIndex += 1) {
      const parts = fields(lines[index]);
      index += 1;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const position = direct ? combineVectors(x, a, y, b, z, c) : [x * scale, y * scale, z * scale];
      atoms.push({ symbol: symbols[symbolIndex], x: position[0], y: position[1], z: position[2] });
    }
  }
  return atoms.length ? atoms : null;
}

function parseQuantumEspressoAtoms(lines: string[]) {
  let atomStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase().startsWith("atomic_positions")) {
      atomStart = index + 1;
      break;
    }
  }
  if (atomStart < 0) return null;
  const atoms: Atom[] = [];
  for (const line of lines.slice(atomStart)) {
    const parts = fields(line);
    if (parts.length < 4) break;
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const z = Number(parts[3]);
    if (!isElementSymbol(parts[0]) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) break;
    atoms.push({ symbol: normalizeElementSymbol(parts[0]), x, y, z });
  }
  return atoms.length ? atoms : null;
}

function parseOrcaAtoms(lines: string[]) {
  let best: Atom[] | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("CARTESIAN COORDINATES (ANGSTROEM)")) continue;
    const atoms: Atom[] = [];
    index += 1;
    while (index < lines.length && !parseElementCoordinateLine(lines[index])) index += 1;
    while (index < lines.length) {
      const atom = parseElementCoordinateLine(lines[index]);
      if (!atom) break;
      atoms.push(atom);
      index += 1;
    }
    if (atoms.length) best = atoms;
  }
  return best;
}

function parseBestCoordinateBlock(lines: string[]) {
  let best: Atom[] = [];
  let current: Atom[] = [];
  const finishBlock = () => {
    if (current.length > best.length) best = current;
    current = [];
  };
  for (const line of lines) {
    const atom = parseElementCoordinateLine(line);
    if (atom) {
      current.push(atom);
    } else {
      finishBlock();
    }
  }
  finishBlock();
  return best.length >= 2 ? best : null;
}

function parseAmberRestartAtoms(lines: string[]) {
  if (lines.length < 2) return null;
  const header = fields(lines[1]);
  const atomCount = Number.parseInt(header[0] ?? "", 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) return null;
  const values: number[] = [];
  for (const line of lines.slice(2)) {
    for (const token of fields(line)) {
      const value = Number(token);
      if (Number.isFinite(value)) values.push(value);
      if (values.length >= atomCount * 3) break;
    }
    if (values.length >= atomCount * 3) break;
  }
  if (values.length < atomCount * 3) return null;
  const atoms: Atom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    atoms.push({
      symbol: "C",
      x: values[index * 3],
      y: values[index * 3 + 1],
      z: values[index * 3 + 2],
    });
  }
  return atoms;
}

function parseCharmmCoordinateAtoms(lines: string[]) {
  const atoms: Atom[] = [];
  for (const line of lines) {
    const parts = fields(line);
    if (parts.length < 7) continue;
    const residueName = parts[2] ?? "";
    const atomName = parts[3] ?? "";
    const x = Number(parts[4]);
    const y = Number(parts[5]);
    const z = Number(parts[6]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    atoms.push({
      symbol: elementSymbolFromAtomName(atomName) ?? elementSymbolFromAtomName(residueName) ?? "C",
      x,
      y,
      z,
    });
  }
  return atoms.length ? atoms : null;
}

function parseLammpsDumpAtoms(lines: string[]) {
  return parseLammpsDumpFrames(lines)[0] ?? null;
}

function parseAtomeyeCfgAtoms(lines: string[]) {
  const atomCount = parseAtomeyeCfgAtomCount(lines);
  const scale = parseAtomeyeCfgScale(lines) ?? 1;
  const h0 = parseAtomeyeCfgH0(lines);
  const entryCount = parseAtomeyeCfgEntryCount(lines);
  const entryStart = lines.findIndex((line) => line.trim().startsWith("entry_count")) + 1;
  if (!atomCount || !h0 || !entryCount || entryStart <= 0) return null;
  const atoms: Atom[] = [];
  for (let index = entryStart; atoms.length < atomCount && index + entryCount <= lines.length; index += entryCount) {
    const entry = lines.slice(index, index + entryCount);
    const symbol = entry.map((line) => elementSymbolFromAtomName(line)).find(Boolean) ?? "C";
    const fractional = entry
      .slice()
      .reverse()
      .map((line) => numericTokens(line))
      .find((values) => values.length >= 3);
    if (!fractional) return null;
    atoms.push({
      symbol,
      x: scale * (h0[0][0] * fractional[0] + h0[0][1] * fractional[1] + h0[0][2] * fractional[2]),
      y: scale * (h0[1][0] * fractional[0] + h0[1][1] * fractional[1] + h0[1][2] * fractional[2]),
      z: scale * (h0[2][0] * fractional[0] + h0[2][1] * fractional[1] + h0[2][2] * fractional[2]),
    });
  }
  return atoms.length === atomCount ? atoms : null;
}

function parseMlipCfgAtoms(lines: string[]) {
  const begin = lines.findIndex((line) => line.trim().toLowerCase() === "begin_cfg");
  if (begin < 0) return null;
  const relativeEnd = lines.slice(begin + 1).findIndex((line) => line.trim().toLowerCase() === "end_cfg");
  const end = relativeEnd >= 0 ? begin + 1 + relativeEnd : lines.length;
  const block = lines.slice(begin + 1, end);
  const atomCount = parseMlipCfgSize(block);
  const atomDataIndex = block.findIndex((line) => line.trimStart().startsWith("AtomData:"));
  if (!atomCount || atomDataIndex < 0) return null;
  const header = fields(block[atomDataIndex]);
  const column = (name: string) => {
    const index = header.findIndex((value) => value.toLowerCase() === name.toLowerCase());
    return index > 0 ? index - 1 : -1;
  };
  const typeIndex = column("type");
  const xIndex = column("cartes_x");
  const yIndex = column("cartes_y");
  const zIndex = column("cartes_z");
  if (xIndex < 0 || yIndex < 0 || zIndex < 0) return null;
  const atoms: Atom[] = [];
  for (const line of block.slice(atomDataIndex + 1)) {
    const parts = fields(line);
    if (parts.length <= Math.max(xIndex, yIndex, zIndex)) {
      if (atoms.length) break;
      continue;
    }
    const x = Number(parts[xIndex]);
    const y = Number(parts[yIndex]);
    const z = Number(parts[zIndex]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      if (atoms.length) break;
      continue;
    }
    atoms.push({
      symbol: typeIndex >= 0 ? mlipCfgSymbolForType(parts[typeIndex] ?? "") : "C",
      x,
      y,
      z,
    });
    if (atoms.length === atomCount) break;
  }
  return atoms.length === atomCount ? atoms : null;
}

function parseMlipCfgSize(lines: string[]) {
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase() !== "size") continue;
    const value = Number.parseInt(fields(lines[index + 1])[0] ?? "", 10);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function mlipCfgSymbolForType(value: string) {
  const normalized = normalizeElementSymbol(value);
  if (isElementSymbol(normalized)) return normalized;
  if (value.trim() === "1") return "H";
  return "C";
}

function parseAtomeyeCfgAtomCount(lines: string[]) {
  for (const line of lines) {
    const match = /^Number of particles\s*=\s*(\d+)/u.exec(line.trim());
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseAtomeyeCfgScale(lines: string[]) {
  for (const line of lines) {
    const match = /^A\s*=\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/u.exec(line.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

function parseAtomeyeCfgEntryCount(lines: string[]) {
  for (const line of lines) {
    const match = /^entry_count\s*=\s*(\d+)/u.exec(line.trim());
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseAtomeyeCfgH0(lines: string[]): [[number, number, number], [number, number, number], [number, number, number]] | null {
  const h0: [[number, number, number], [number, number, number], [number, number, number]] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let seen = 0;
  for (const line of lines) {
    const match = /^H0\((\d),(\d)\)\s*=\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/u.exec(line.trim());
    if (!match) continue;
    const row = Number.parseInt(match[1], 10) - 1;
    const column = Number.parseInt(match[2], 10) - 1;
    if (row < 0 || row >= 3 || column < 0 || column >= 3) continue;
    h0[row][column] = Number(match[3]);
    seen += 1;
  }
  return seen === 9 ? h0 : null;
}

function parseLammpsDataAtoms(lines: string[]) {
  const masses = parseLammpsMasses(lines);
  let inAtoms = false;
  const atoms: Atom[] = [];
  for (const line of lines) {
    const parts = fields(stripInlineComment(line));
    const first = parts[0] ?? "";
    if (!first) continue;
    if (first.toLowerCase() === "atoms") {
      inAtoms = true;
      continue;
    }
    if (inAtoms && /^[A-Za-z]/u.test(first)) break;
    if (!inAtoms || parts.length < 5) continue;
    const coordinates = lammpsDataCoordinates(parts, masses);
    if (!coordinates) continue;
    const [x, y, z] = coordinates;
    atoms.push({ symbol: lammpsDataAtomSymbol(parts, masses), x, y, z });
  }
  return atoms.length ? atoms : null;
}

function parseLammpsMasses(lines: string[]) {
  const masses = new Map<string, string>();
  let inMasses = false;
  for (const line of lines) {
    const parts = fields(stripInlineComment(line));
    const first = parts[0] ?? "";
    if (!first) continue;
    if (first.toLowerCase() === "masses") {
      inMasses = true;
      continue;
    }
    if (inMasses && /^[A-Za-z]/u.test(first)) break;
    if (!inMasses || parts.length < 2) continue;
    const symbol = elementSymbolFromAtomName(parts[2] ?? "") ?? lammpsSymbolFromMass(parts[1] ?? "");
    if (symbol) masses.set(parts[0], symbol);
  }
  return masses;
}

function lammpsDataAtomSymbol(parts: string[], masses: Map<string, string>) {
  return masses.get(parts[1] ?? "")
    ?? masses.get(parts[2] ?? "")
    ?? elementSymbolFromAtomName(parts[1] ?? "")
    ?? elementSymbolFromAtomName(parts[2] ?? "")
    ?? "C";
}

function lammpsDataCoordinates(parts: string[], masses: Map<string, string>): [number, number, number] | null {
  const starts: number[] = [];
  if (masses.has(parts[2] ?? "")) starts.push(4);
  if (masses.has(parts[1] ?? "")) starts.push(3, 2);
  starts.push(3, 4, 2);
  for (const start of starts) {
    const x = Number(parts[start]);
    const y = Number(parts[start + 1]);
    const z = Number(parts[start + 2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
  }
  return null;
}

function lammpsSymbolFromMass(value: string) {
  const mass = Number(value);
  if (!Number.isFinite(mass)) return null;
  const match = [
    [1.008, "H"],
    [12.011, "C"],
    [14.007, "N"],
    [15.999, "O"],
    [18.998, "F"],
    [22.990, "Na"],
    [24.305, "Mg"],
    [30.974, "P"],
    [32.06, "S"],
    [35.45, "Cl"],
    [39.098, "K"],
    [40.078, "Ca"],
    [55.845, "Fe"],
    [63.546, "Cu"],
    [65.38, "Zn"],
    [79.904, "Br"],
    [126.904, "I"],
  ].find(([reference]) => Math.abs(mass - Number(reference)) <= 0.35);
  return typeof match?.[1] === "string" ? match[1] : null;
}

function parseLammpsDumpFrames(lines: string[]) {
  const frames: Atom[][] = [];
  const atoms: Atom[] = [];
  let inAtoms = false;
  let columns: string[] = [];
  let xIndex = -1;
  let yIndex = -1;
  let zIndex = -1;
  let symbolIndex = -1;
  let typeIndex = -1;
  for (const line of lines) {
    if (line.startsWith("ITEM: ")) {
      if (inAtoms && atoms.length > 0) {
        frames.push(atoms.splice(0, atoms.length));
      }
      inAtoms = false;
      if (line.startsWith("ITEM: ATOMS")) {
        columns = line.slice("ITEM: ATOMS".length).trim().split(/\s+/u).filter(Boolean);
        xIndex = coordinateColumnIndex(columns, ["x", "xu", "xs", "xsu"]);
        yIndex = coordinateColumnIndex(columns, ["y", "yu", "ys", "ysu"]);
        zIndex = coordinateColumnIndex(columns, ["z", "zu", "zs", "zsu"]);
        symbolIndex = coordinateColumnIndex(columns, ["element", "symbol", "name"]);
        typeIndex = coordinateColumnIndex(columns, ["type"]);
        inAtoms = xIndex >= 0 && yIndex >= 0 && zIndex >= 0;
      }
      continue;
    }
    if (!inAtoms) continue;
    const parts = fields(line);
    const x = Number.parseFloat(parts[xIndex] ?? "");
    const y = Number.parseFloat(parts[yIndex] ?? "");
    const z = Number.parseFloat(parts[zIndex] ?? "");
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const symbol = elementSymbolFromAtomName(parts[symbolIndex] ?? "")
      ?? elementSymbolFromAtomName(parts[typeIndex] ?? "")
      ?? "C";
    atoms.push({ symbol, x, y, z });
  }
  if (inAtoms && atoms.length > 0) {
    frames.push(atoms);
  }
  return frames;
}

function coordinateColumnIndex(columns: string[], names: string[]) {
  return columns.findIndex((column) => names.includes(column.toLowerCase()));
}

function parseXmlPositionAtoms(text: string) {
  const atoms: Atom[] = [];
  const matcher = /<Position\b([^>]*)\/?>/giu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text))) {
    const attributes = match[1] ?? "";
    const x = xmlNumberAttribute(attributes, "x");
    const y = xmlNumberAttribute(attributes, "y");
    const z = xmlNumberAttribute(attributes, "z");
    if (x === null || y === null || z === null) continue;
    atoms.push({ symbol: "C", x, y, z });
  }
  return atoms.length ? atoms : null;
}

function parseHoomdXmlAtoms(text: string) {
  if (!/<hoomd_xml\b/iu.test(text) && !/<configuration\b/iu.test(text)) return null;
  const positionMatch = /<position\b[^>]*>([\s\S]*?)<\/position>/iu.exec(text);
  if (!positionMatch) return null;
  const values = numericTokens(positionMatch[1] ?? "");
  if (values.length < 3) return null;
  const typeMatch = /<type\b[^>]*>([\s\S]*?)<\/type>/iu.exec(text);
  const symbols = typeMatch
    ? fields(typeMatch[1] ?? "").map((value) => elementSymbolFromAtomName(value) ?? "C")
    : [];
  const atoms: Atom[] = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    const atomIndex = index / 3;
    atoms.push({
      symbol: symbols[atomIndex] || "C",
      x: values[index],
      y: values[index + 1],
      z: values[index + 2],
    });
  }
  return atoms.length ? atoms : null;
}

function numericTokens(text: string) {
  return Array.from(text.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/gu), (match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));
}

function xmlNumberAttribute(attributes: string, name: string) {
  const match = new RegExp(`\\b${name}=["']([^"']+)["']`, "iu").exec(attributes);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function elementSymbolFromAtomName(value: string) {
  const clean = value.replace(/^[0-9]+/u, "").replace(/[^A-Za-z]/gu, "");
  if (!clean) return null;
  const two = normalizeElementSymbol(clean.slice(0, 2));
  if (isElementSymbol(two)) return two;
  const one = normalizeElementSymbol(clean.slice(0, 1));
  return isElementSymbol(one) ? one : null;
}

function parseElementCoordinateLine(line: string): Atom | null {
  const parts = fields(line);
  if (parts.length < 4 || !isElementSymbol(parts[0])) return null;
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  const z = Number(parts[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { symbol: normalizeElementSymbol(parts[0]), x, y, z };
}

function fields(line: string) {
  return line.trim().split(/\s+/).filter(Boolean);
}

function stripInlineComment(line: string) {
  return line.replace(/#.*/u, "").trim();
}

function parseVector(line: string, scale: number): [number, number, number] | null {
  const parts = fields(line);
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? [x * scale, y * scale, z * scale]
    : null;
}

function combineVectors(x: number, a: number[], y: number, b: number[], z: number, c: number[]) {
  return [
    x * a[0] + y * b[0] + z * c[0],
    x * a[1] + y * b[1] + z * c[1],
    x * a[2] + y * b[2] + z * c[2],
  ];
}

function isElementSymbol(value: string) {
  return ELEMENT_SYMBOLS.has(normalizeElementSymbol(value));
}

function normalizeElementSymbol(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value;
}

function symbolForAtomicNumber(number: number) {
  return ATOMIC_SYMBOLS[number - 1] || "X";
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

const ATOMIC_SYMBOLS = [
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
  "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
  "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
  "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
  "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
  "Tl", "Pb", "Bi", "Po", "At", "Rn",
];

const ELEMENT_SYMBOLS = new Set(ATOMIC_SYMBOLS);

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function looksLikeSmiles(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("#") || /\s/u.test(trimmed)) return false;
  const lowered = trimmed.toLowerCase();
  if (["smiles", "smile", "id", "name", "title", "compound", "molecule", "structure", "inchi"].includes(lowered)) {
    return false;
  }
  if (/^inchi=/iu.test(trimmed) || /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/u.test(trimmed)) return false;
  if (!/^(?=.{1,2048}$)(?=.*(?:Br|Cl|\[[^\]]+\]|[BCNOFPSIKHbcnops]))[A-Za-z0-9@+\-[\]()=#$:/\\.,%]+$/u.test(trimmed)) {
    return false;
  }
  let hasAtom = false;
  let hasAromaticAtom = false;
  let hasStructuralMarker = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    const next = trimmed[index + 1];
    if (char === "[") {
      const end = trimmed.indexOf("]", index + 1);
      if (end < 0 || !/[A-Za-z]/u.test(trimmed.slice(index + 1, end))) return false;
      hasAtom = true;
      hasStructuralMarker = true;
      index = end;
    } else if (/\d/u.test(char) || "[]=#@+-/\\().,:$%".includes(char)) {
      hasStructuralMarker = true;
    } else if ((char === "B" && next === "r") || (char === "C" && next === "l")) {
      hasAtom = true;
      index += 1;
    } else if ("BCNOFPSIKH".includes(char)) {
      hasAtom = true;
    } else if ("bcnops".includes(char)) {
      hasAtom = true;
      hasAromaticAtom = true;
    } else {
      return false;
    }
  }
  return hasAtom && (!hasAromaticAtom || hasStructuralMarker);
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `browser-${(hash >>> 0).toString(36)}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function serializeInlineJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
