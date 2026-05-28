import { collectionExtension, mergeCollectionSources } from "./collection-documents";
import type { DockingDocumentRequest, OpenDocumentsResult, ViewerDocument, ViewerPreferences, ViewerReloadOptions, XyzrenderControls } from "../types";
import previewFormatRegistry from "../../../../config/preview-formats.json";

type FormatInfo = {
  molstarFormat: string;
  binary: boolean;
  externalOnly: boolean;
  canOpenInVesta: boolean;
};

type GridRecord = {
  index: number;
  name: string;
  smiles?: string;
  molblock?: string;
  props: Record<string, string>;
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
};

type MaestroAtom = Atom & {
  atomName: string;
  residueName: string;
  residueNumber: number;
  chainName: string;
};

const MAX_STRUCTURE_FILE_SIZE = 75 * 1024 * 1024;
const MAESTRO_PREVIEW_READ_LIMIT = 64 * 1024 * 1024;
const MAESTRO_PREVIEW_ATOM_LIMIT = 3000;
const MAESTRO_PDB_PREVIEW_ATOM_LIMIT = 30000;
const XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT = 1500;
const KETCHER_EDIT_MAX_BYTES = 1024 * 1024;
const KETCHER_EDIT_MAX_ATOMS = 300;
const BOHR_TO_ANGSTROM = 0.529177210903;
const BROWSER_DEV_OPEN_CONCURRENCY = 4;
const GRID_ASSET_VERSION = "grid-ui-v71";
const VIEWER_ASSET_VERSION = "viewer-ui-v17";
const REPO_ROOT = String(import.meta.env.BURRETE_REPO_ROOT || "");
const WEB_ASSETS_BASE = fsUrl(`${REPO_ROOT}/PreviewExtension/Web/`);
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
        results[index] = { document: await openBrowserDevDocument(path, preferences, reloadOptions) };
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
): Promise<ViewerDocument> {
  const cleanExtension = extension.toLowerCase().replace(/^\./u, "");
  const cleanTitle = fileTitle(title).replace(/[\\/]/gu, "").trim() || `ketcher-sketch.${cleanExtension}`;
  const path = `burrete-ketcher://${stableId(`${cleanTitle}:${text}`)}/${cleanTitle}`;
  const bytes = new TextEncoder().encode(text);
  browserDevVirtualTextDocuments.set(path, text);
  const document = await openBrowserDevDocumentFromBytes(path, cleanExtension, bytes, bytes.length, preferences, reloadOptions);
  return { ...document, virtual: true };
}

export async function openBrowserDevDockingDocument(
  receptorPath: string,
  ligandPaths: string[],
  preferences: ViewerPreferences,
): Promise<ViewerDocument> {
  const receptor = await readBrowserDevDockingPayload(receptorPath);
  const ligands = await Promise.all(Array.from(new Set(ligandPaths)).map(readBrowserDevDockingPayload));
  if (ligands.length === 0) throw new Error("Choose at least one ligand or pose file for docking view");

  const id = stableId(`docking:${receptor.path}:${ligands.map((ligand) => ligand.path).join("|")}`);
  const label = `Docking: ${receptor.title} + ${ligands.length} ligand${ligands.length === 1 ? "" : "s"}`;
  const visuals = resolvePreviewVisuals(preferences);
  const sdfGridPath = ligands.find((ligand) => (
    ligand.format.molstarFormat === "sdf"
      && !ligand.format.binary
      && parseSdf(decodeUtf8(ligand.bytes)).length > 1
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
    previewByteCount: receptor.bytes.length + ligands.reduce((total, ligand) => total + ligand.bytes.length, 0),
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
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    xyzrenderViewer: false,
    xyzrenderAvailable: false,
    molstarAvailable: true,
    canOpenInVesta: false,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
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
    config.byteCount,
    preferences,
    false,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    `<script>window.BurreteDockingPayloads = ${JSON.stringify(payloads)};</script>`,
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
    } satisfies DockingDocumentRequest,
  };
}

export async function openBrowserDevMolstarContextDocument(
  contextDocument: BrowserDevMolstarContextDocument,
  preferences: ViewerPreferences,
): Promise<ViewerDocument> {
  const entries = (contextDocument.entries ?? [])
    .filter((entry): entry is Required<Pick<BrowserDevMolstarContextEntry, "data">> & BrowserDevMolstarContextEntry => (
      typeof entry?.data === "string" && entry.data.length > 0
    ))
    .map((entry, index) => browserDevContextPayload(entry, index));
  if (entries.length === 0) throw new Error("No Mol* context structure was provided");
  const label = contextDocument.label?.trim() || entries.map((entry) => entry.title).join(" + ");
  const id = stableId(`molstar-context:${label}:${entries.map((entry) => `${entry.title}:${entry.bytes.length}`).join("|")}`);
  if (entries.length === 1) {
    const entry = entries[0];
    const config = browserDevContextConfig(label, entry.format, entry.bytes.length, preferences, id);
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
      path: `burrete-context://${id}`,
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
  if (ligands.length === 0) return openBrowserDevMolstarContextDocument({ label, entries: [contextDocument.entries?.[0] ?? {}] }, preferences);
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
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    xyzrenderViewer: false,
    xyzrenderAvailable: false,
    molstarAvailable: true,
    canOpenInVesta: false,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
    dockingContext: contextDocument.context ?? {},
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
    `<script>window.BurreteDockingPayloads = ${JSON.stringify(payloads)};</script>`,
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
  const html = await gridHtml(path, grid.records, grid.format, preferences, new TextEncoder().encode(merged.text).byteLength);
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

async function openBrowserDevDocument(
  path: string,
  preferences: ViewerPreferences,
  reloadOptions?: ViewerReloadOptions,
): Promise<ViewerDocument> {
  const extension = fileExtension(path);
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
  return openBrowserDevDocumentFromBytes(path, extension, bytes, sourceByteCount, preferences, reloadOptions);
}

async function openBrowserDevDocumentFromBytes(
  path: string,
  extension: string,
  bytes: Uint8Array,
  sourceByteCount: number,
  preferences: ViewerPreferences,
  reloadOptions?: ViewerReloadOptions,
): Promise<ViewerDocument> {
  const text = await decodeStructureText(bytes, extension);
  const grid = gridPayload(path, extension, text);
  const sdfRecordCount = grid?.format === "sdf" ? grid.records.length : 0;
  const requestedMode = normalizeRendererMode(preferences.rendererMode);
  const explicitSdfViewer = isSdfExtension(extension)
    && Boolean(reloadOptions)
    && (requestedMode === "molstar" || requestedMode === "xyzrender-external");
  if (grid && !(grid.format === "sdf" && explicitSdfViewer)) {
    const html = await gridHtml(path, grid.records, grid.format, preferences, bytes.length);
    return browserDocument(path, extension, "grid2d", html, bytes.length);
  }
  if (gridRequiresPreview(extension)) {
    throw new Error(`${path} does not contain supported molecule grid records`);
  }

  const format = formatForExtension(extension);
  const maestroPreview = isMaestroPreviewExtension(extension)
    ? convertedDataFromText(text, extension, fileTitle(path))
    : null;
  if (isMaestroPreviewExtension(extension) && !maestroPreview) {
    throw new Error(`${path}: no Maestro atom table could be extracted for preview`);
  }
  const runtimeFormat = maestroPreview
    ? { ...format, molstarFormat: maestroPreview.molstarFormat, binary: false, externalOnly: false }
    : format;
  const sourceXyzBytes = xyzDataFromText(text, extension, fileTitle(path));
  const convertedMolstarData = maestroPreview ?? convertedDataFromText(text, extension, fileTitle(path));
  const molstarBytes: Uint8Array | null = convertedMolstarData?.bytes && (format.externalOnly || shouldUseConvertedMolstarData(format, convertedMolstarData.bytes))
    ? convertedMolstarData.bytes
    : null;
  const xyzFrameCount = runtimeFormat.molstarFormat === "xyz" && !runtimeFormat.binary ? countXyzFrames(text) : 0;
  const shouldOpenXyzTrajectoryInMolstar = xyzFrameCount > 1 && (requestedMode === "auto" || requestedMode === "xyz-fast");
  const xyzrenderAvailable = maestroPreview ? false : xyzrenderAvailableForDocument(format, text);
  const requestedRenderer = resolveRenderer(
    runtimeFormat,
    maestroPreview
      ? "molstar"
      : (shouldOpenXyzTrajectoryInMolstar
        ? "molstar"
        : (xyzrenderAvailable ? defaultRendererModeForDocument(extension, requestedMode, reloadOptions) : "molstar")),
    Boolean(molstarBytes),
  );
  const defaultXyzrender = await defaultXyzrenderPlanForDocument(path, extension, text);
  const xyzrenderInputBytes = extension === "cub" || extension === "cube" ? null : sourceXyzBytes;
  const { renderer, externalRendererStatus, externalArtifact, xyzrenderPresetOptions, xyzrenderControls } =
    await browserRendererPlan(
      defaultXyzrender?.inputPath ?? path,
      runtimeFormat,
      requestedRenderer,
      reloadOptions,
      molstarBytes,
      defaultXyzrender?.controls ?? null,
      xyzrenderInputBytes,
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
    Math.max(xyzFrameCount, sdfRecordCount),
    ketcherEditConfig(path, extension, text, sourceByteCount, sdfRecordCount),
  );
  return browserDocument(path, extension, renderer, html, sourceByteCount);
}

function browserDocument(
  path: string,
  extension: string,
  renderer: string,
  html: string,
  byteCount: number,
): ViewerDocument {
  return {
    id: stableId(path),
    path,
    title: fileTitle(path),
    extension,
    renderer,
    runtimePath: html,
    byteCount,
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

async function readBrowserDevDockingPayload(path: string): Promise<BrowserDevDockingPayload> {
  const response = await fetch(fsUrl(path));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  const originalBytes = new Uint8Array(await response.arrayBuffer());
  if (originalBytes.length === 0) throw new Error(`${path} is empty`);
  if (originalBytes.length > MAX_STRUCTURE_FILE_SIZE) {
    throw new Error(`${path} is larger than the 75 MB preview limit`);
  }
  const extension = fileExtension(path);
  const format = formatForExtension(extension);
  const title = fileTitle(path);
  const text = decodeUtf8(originalBytes);
  const converted = convertedDataFromText(text, extension, title);
  if (converted && (format.externalOnly || shouldUseConvertedMolstarData(format, converted.bytes))) {
    return {
      path,
      title,
      extension,
      format: { ...format, molstarFormat: converted.molstarFormat, binary: false, externalOnly: false },
      bytes: converted.bytes,
      byteCount: originalBytes.length,
    };
  }
  if (format.externalOnly) {
    throw new Error(`${path} cannot be added to Mol* docking view because it needs xyzrender conversion`);
  }
  return { path, title, extension, format, bytes: originalBytes, byteCount: originalBytes.length };
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
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    xyzrenderViewer: false,
    xyzrenderAvailable: false,
    molstarAvailable: true,
    canOpenInVesta: false,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
  };
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
) {
  const label = fileTitle(path);
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
    dataPath: renderer === "xyzrender-external" ? browserDevReadUrl(path, fileExtension(path)) : undefined,
    sourcePath: path,
    quickLookBuild: "burrete-browser-dev",
    debug: false,
    theme: visuals.theme,
    themeTokens: previewThemeTokens(preferences),
    canvasBackground: visuals.canvasBackground,
    documentId: stableId(path),
    uiScale: 0.9,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    sdfGrid: true,
    sdfPosePager: renderer === "molstar" && format.molstarFormat === "sdf" && !format.binary,
    trajectoryControls: renderer === "molstar" && trajectoryFrameCount > 1,
    trajectoryFrameCount,
    appViewer: true,
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    xyzrenderViewer: renderer === "xyzrender-external",
    xyzrenderAvailable,
    xyzrenderEndpoint: "/__burette/xyzrender",
    molstarAvailable: !format.externalOnly || externalMolstarAvailable,
    canOpenInVesta: format.canOpenInVesta,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
    ...(ketcherConfig ? { ketcherEditable: true, ...ketcherConfig } : { ketcherEditable: false }),
    ...(externalArtifact ? { externalArtifact } : {}),
    ...(xyzrenderPresetOptions ? { xyzrenderPresetOptions } : {}),
    ...(xyzrenderControls ? { xyzrenderControls } : {}),
    ...(externalRendererStatus ? { externalRendererStatus } : {}),
    ...(renderer === "xyz-fast"
      ? {
          xyzFast: {
            style: preferences.xyzFastStyle,
            firstFrameOnly: true,
            showCell: true,
            sourceByteCount,
            previewByteCount: bytes.length,
          },
        }
      : {}),
  };
  const rendererAssets =
    renderer === "xyz-fast" || renderer === "xyzrender-external"
      ? `<script src="xyz-fast.js"></script>`
      : `<link rel="stylesheet" href="molstar.css" /><script src="molstar.js"></script>`;
  const runtimeAssetVersion = `${VIEWER_ASSET_VERSION}-${Date.now()}`;
  const embeddedBytes = renderer === "xyzrender-external" ? new Uint8Array([10]) : bytes;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${WEB_ASSETS_BASE}" />
  <title>Burrete - ${escapeHtml(label)}</title>
  <link rel="stylesheet" href="viewer-runtime.css?v=${runtimeAssetVersion}" />
</head>
<body class="${visuals.transparentBackground ? "burette-transparent-background" : "burette-opaque-background"}">
  <div id="app"></div>
  <script src="viewer-shell.js?v=${runtimeAssetVersion}"></script>
  <div id="status" class="hidden">Loading ${escapeHtml(label)}...</div>
  <script>${viewerBridgeJs()}</script>
  ${rendererAssets}
  <script>window.BurreteConfig = ${JSON.stringify(config)};</script>
  <script>window.BurreteDataBase64 = "${bytesToBase64(embeddedBytes)}";</script>
  ${extraWindowScript}
  <script src="burette-agent.js?v=${runtimeAssetVersion}"></script>
  <script src="viewer.js?v=${runtimeAssetVersion}"></script>
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
) {
  const url = new URL("/__burette/xyzrender", window.location.origin);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path,
      preset,
      orientationRef: orientationRef || undefined,
      controls: controls || undefined,
      inputDataBase64: inputBytes ? bytesToBase64(inputBytes) : undefined,
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
  records: GridRecord[],
  format: string,
  preferences: ViewerPreferences,
  byteCount: number,
) {
  const label = fileTitle(path);
  const visuals = resolvePreviewVisuals(preferences);
  const config = {
    mode: "grid2d",
    format,
    renderer: "grid2d",
    label,
    byteCount,
    host: "browser-dev",
    quickLookBuild: "burrete-browser-dev-grid2d",
    debug: false,
    appViewer: true,
    tauriViewer: false,
    theme: visuals.theme,
    themeTokens: previewThemeTokens(preferences),
    canvasBackground: visuals.canvasBackground,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    xyzrenderEndpoint: "/__burette/xyzrender",
    recordsTotal: records.length,
    recordsIncluded: records.length,
    recordsTruncated: false,
    pageSize: 96,
    rdkitWasmPath: "/__burette/rdkit-wasm",
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
      substructureSearch: true,
      rendererSwitch: format === "sdf",
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
  <script>window.BurreteConfig = ${JSON.stringify(config)};</script>
  <script>window.BurreteGridRecords = ${JSON.stringify(records)};</script>
  <script src="rdkit/RDKit_minimal.js?v=${GRID_ASSET_VERSION}"></script>
  <script src="grid-viewer.js?v=${GRID_ASSET_VERSION}"></script>
</body>
</html>`;
}

function gridPayload(path: string, extension: string, text: string) {
  if (extension === "sdf" || extension === "sd") {
    const records = parseSdf(text);
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
  return null;
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

function parseSdf(text: string): GridRecord[] {
  return text
    .split(/\$\$\$\$/)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record, index) => {
      const lines = record.split(/\r?\n/);
      return {
        index,
        name: lines[0]?.trim() || `Molecule ${index + 1}`,
        molblock: `${record}\n$$$$\n`,
        props: parseSdfProps(lines),
      };
    });
}

function parseSdfProps(lines: string[]) {
  const props: Record<string, string> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^>\s*<([^>]+)>/.exec(lines[index] || "");
    if (!match) continue;
    const values: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== "") {
      values.push(lines[index]);
      index += 1;
    }
    props[match[1]] = values.join("\n");
  }
  return props;
}

function parseDelimited(text: string, delimiter: "," | "\t"): GridRecord[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => parseDelimitedLine(line, delimiter))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map((cell) => cell.trim());
  const smilesIndex = headers.findIndex((header) =>
    ["smiles", "smile", "canonical_smiles", "cxsmiles"].includes(header.toLowerCase()),
  );
  if (smilesIndex < 0) return [];
  return rows.slice(1).flatMap((row, rowIndex) => {
    const smiles = row[smilesIndex]?.trim();
    if (!looksLikeSmiles(smiles)) return [];
    const props: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (index !== smilesIndex && row[index]?.trim()) props[header || `Column ${index + 1}`] = row[index].trim();
    });
    const name = props.name || props.Name || props.title || props.Title || `Molecule ${rowIndex + 1}`;
    return [{ index: rowIndex, name, smiles, props }];
  });
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
  window.__mqlPost = (type, message) => postToParent({ type, message: message || '' });
  window.__mqlAction = (name) => messageHandlers.burrete.postMessage({ type: 'action', message: name });
  window.__mqlDebug = () => {};
  window.BurreteInlineMode = true;
  window.BurreteDebug = false;
  window.BurretePanelControlsVisible = false;
  window.BurreteCacheBuster = String(Date.now());
})();`;
}

function formatForExtension(extension: string): FormatInfo {
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

function resolveRenderer(format: FormatInfo, requested: string, externalMolstarAvailable = false) {
  const normalized = normalizeRendererMode(requested);
  if (format.externalOnly) {
    return normalized === "molstar" && externalMolstarAvailable ? "molstar" : "xyzrender-external";
  }
  const isXyz = format.molstarFormat === "xyz" && !format.binary;
  const canUseXyzrender = isXyz || canUseExternalXyzrender(format);
  if (normalized === "molstar") return "molstar";
  if (normalized === "xyz-fast") return "molstar";
  if (normalized === "xyzrender-external") return canUseXyzrender ? "xyzrender-external" : "molstar";
  return isXyz ? "xyzrender-external" : "molstar";
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

function shouldUseConvertedMolstarData(format: FormatInfo, xyzBytes: Uint8Array | null) {
  return Boolean(xyzBytes) && !format.binary && ["mmcif", "cifCore"].includes(format.molstarFormat);
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
    const record = parseSdf(text)[0]?.molblock ?? text;
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
  if (["xyz-fast", "fast-xyz", "xyzfast"].includes(value)) return "xyz-fast";
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
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
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
  const contentRange = response.headers.get("content-range");
  const total = contentRange?.match(/\/(\d+)$/u)?.[1];
  if (total) {
    const value = Number(total);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const contentLength = Number(response.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : fallback;
}

function convertedDataFromText(text: string, extension: string, label: string): ConvertedStructureData | null {
  if (isMaestroPreviewExtension(extension)) {
    const bytes = maestroPdbDataFromText(text);
    return bytes ? { bytes, molstarFormat: "pdb" } : null;
  }
  const bytes = pdbDataFromText(text, extension, label);
  return bytes ? { bytes, molstarFormat: "pdb" } : null;
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

function atomsFromText(text: string, extension: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let atoms: Atom[] | null = null;
  if (extension === "cub" || extension === "cube") {
    atoms = parseCubeAtoms(lines);
  } else if (extension === "vasp") {
    atoms = parseVaspAtoms(lines);
  } else if (extension === "in") {
    atoms = parseQuantumEspressoAtoms(lines);
  } else if (extension === "out") {
    atoms = parseOrcaAtoms(lines);
  } else if (extension === "cif" || extension === "mmcif" || extension === "mcif") {
    atoms = parseCifCoreAtoms(lines);
  } else if (isMaestroPreviewExtension(extension)) {
    atoms = parseMaestroAtoms(lines, MAESTRO_PREVIEW_ATOM_LIMIT);
  }
  atoms ??= parseBestCoordinateBlock(lines);
  return atoms;
}

function maestroPdbDataFromText(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const atoms = parseMaestroPdbAtoms(lines, MAESTRO_PDB_PREVIEW_ATOM_LIMIT);
  if (!atoms?.length) return null;
  const pdb = [
    ...atoms.map((atom, index) => maestroPdbAtomLine(index + 1, atom)),
    ...pdbConectLines(atoms),
    "END",
    "",
  ].join("\n");
  return new TextEncoder().encode(pdb);
}

function parseMaestroAtoms(lines: string[], atomLimit: number) {
  return parseMaestroPdbAtoms(lines, atomLimit)?.map(({ symbol, x, y, z }) => ({ symbol, x, y, z })) ?? null;
}

function parseMaestroPdbAtoms(lines: string[], atomLimit: number) {
  let currentCtType = "";
  let bestScore = -1;
  let bestAtoms: MaestroAtom[] | null = null;
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
      const score = maestroCtScore(currentCtType);
      if (score > bestScore) {
        bestScore = score;
        bestAtoms = atoms;
      }
    }
  }
  return bestAtoms;
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
  if (ctType === "solute") return 4;
  if (ctType === "full_system") return 3;
  if (ctType === "ion") return 1;
  if (ctType === "solvent") return 0;
  return 2;
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

function pdbConectLines(atoms: Atom[]) {
  const bonds = inferPdbBonds(atoms);
  if (!bonds.length) return [];
  const adjacency = Array.from({ length: Math.min(atoms.length, 99999) }, () => [] as number[]);
  for (const [left, right] of bonds) {
    adjacency[left].push(right + 1);
    adjacency[right].push(left + 1);
  }
  const lines: string[] = [];
  adjacency.forEach((neighbors, index) => {
    for (let offset = 0; offset < neighbors.length; offset += 4) {
      lines.push(`CONECT${String(index + 1).padStart(5, " ")}${neighbors.slice(offset, offset + 4).map((serial) => String(serial).padStart(5, " ")).join("")}`);
    }
  });
  return lines;
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
  if (!cell) return null;
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
      const [x, y, z] = fractionalToCartesian(fx, fy, fz, cell);
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
  return !!value && /[A-Za-z0-9@+\-[\]()=#\\/]/.test(value) && !/\s/.test(value);
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
