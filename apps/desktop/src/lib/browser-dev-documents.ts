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

const MAX_STRUCTURE_FILE_SIZE = 75 * 1024 * 1024;
const MAESTRO_PREVIEW_READ_LIMIT = 32 * 1024 * 1024;
const MAESTRO_PREVIEW_ATOM_LIMIT = 3000;
const XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT = 1500;
const BROWSER_DEV_OPEN_CONCURRENCY = 4;
const GRID_ASSET_VERSION = "grid-ui-v35";
const VIEWER_ASSET_VERSION = "viewer-ui-v9";
const REPO_ROOT = String(import.meta.env.BURRETE_REPO_ROOT || "");
const WEB_ASSETS_BASE = fsUrl(`${REPO_ROOT}/PreviewExtension/Web/`);

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
  const text = await decodeStructureText(bytes, extension);
  const grid = gridPayload(path, extension, text);
  const requestedMode = normalizeRendererMode(preferences.rendererMode);
  const explicitSdfViewer = isSdfExtension(extension)
    && (requestedMode === "molstar" || (requestedMode === "xyzrender-external" && Boolean(reloadOptions)));
  if (grid && !(grid.format === "sdf" && explicitSdfViewer)) {
    const html = await gridHtml(path, grid.records, grid.format, preferences, bytes.length);
    return browserDocument(path, extension, "grid2d", html, bytes.length);
  }
  if (gridRequiresPreview(extension)) {
    throw new Error(`${path} does not contain supported molecule grid records`);
  }

  const format = formatForExtension(extension);
  const maestroPreviewBytes = isMaestroPreviewExtension(extension)
    ? xyzDataFromText(text, extension, fileTitle(path))
    : null;
  if (isMaestroPreviewExtension(extension) && !maestroPreviewBytes) {
    throw new Error(`${path}: no Maestro atom table could be extracted for preview`);
  }
  const runtimeFormat = maestroPreviewBytes
    ? { ...format, molstarFormat: "xyz", binary: false, externalOnly: false }
    : format;
  const sourceXyzBytes = maestroPreviewBytes ?? xyzDataFromText(text, extension, fileTitle(path));
  const molstarBytes: Uint8Array | null = sourceXyzBytes && (format.externalOnly || shouldUseConvertedMolstarData(format, sourceXyzBytes))
    ? sourceXyzBytes
    : null;
  const xyzrenderAvailable = maestroPreviewBytes ? false : xyzrenderAvailableForDocument(format, text);
  const requestedRenderer = resolveRenderer(
    runtimeFormat,
    maestroPreviewBytes ? "molstar" : (xyzrenderAvailable ? defaultRendererModeForDocument(extension, requestedMode, reloadOptions) : "molstar"),
    Boolean(molstarBytes),
  );
  const defaultXyzrender = await defaultXyzrenderPlanForDocument(path, extension, text);
  const xyzrenderInputBytes = extension === "cub" || extension === "cube" ? null : molstarBytes;
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
  const viewerFormat = renderer === "molstar" && molstarBytes && (!format.externalOnly || maestroPreviewBytes)
    ? { ...runtimeFormat, molstarFormat: "xyz", binary: false, externalOnly: false }
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
  const converted = xyzDataFromText(text, extension, title);
  if (converted && (format.externalOnly || shouldUseConvertedMolstarData(format, converted))) {
    return {
      path,
      title,
      extension,
      format: { ...format, molstarFormat: "xyz", binary: false, externalOnly: false },
      bytes: converted,
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
    appViewer: true,
    tauriViewer: false,
    molstarStyle: preferences.molstarStyle,
    xyzrenderViewer: renderer === "xyzrender-external",
    xyzrenderAvailable,
    molstarAvailable: !format.externalOnly || externalMolstarAvailable,
    canOpenInVesta: format.canOpenInVesta,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
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
        renderer: "xyz-fast",
        externalRendererStatus: {
          status: "fallback",
          requested: "xyzrender-external",
          message: `Using Fast XYZ because browser dev xyzrender failed: ${message}`,
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
    rdkitWasmPath: `${WEB_ASSETS_BASE}rdkit/RDKit_minimal.wasm`,
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
      xyzrenderCards: true,
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
    return records.length > 1 ? { format: "sdf", records } : null;
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
  if (normalized === "xyz-fast") return isXyz ? "xyz-fast" : "molstar";
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

function xyzDataFromText(text: string, extension: string, label: string) {
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
  if (!atoms?.length) return null;
  const xyz = [
    String(atoms.length),
    `Converted from ${label}`,
    ...atoms.map((atom) => `${atom.symbol} ${formatCoordinate(atom.x)} ${formatCoordinate(atom.y)} ${formatCoordinate(atom.z)}`),
    "",
  ].join("\n");
  return new TextEncoder().encode(xyz);
}

function parseMaestroAtoms(lines: string[], atomLimit: number) {
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
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

    const atoms: Atom[] = [];
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
      atoms.push({ symbol, x, y, z });
      if (atoms.length >= atomLimit) break;
    }
    if (atoms.length) return atoms;
  }
  return null;
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
  const atoms: Atom[] = [];
  for (let index = 0; index < count; index += 1) {
    const parts = fields(lines[6 + index]);
    const number = Number.parseInt(parts[0] || "", 10);
    const x = Number(parts[2]);
    const y = Number(parts[3]);
    const z = Number(parts[4]);
    if (!Number.isFinite(number) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    atoms.push({ symbol: symbolForAtomicNumber(number), x, y, z });
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
