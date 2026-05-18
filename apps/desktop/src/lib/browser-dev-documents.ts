import type { OpenDocumentsResult, ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";
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

const MAX_STRUCTURE_FILE_SIZE = 75 * 1024 * 1024;
const GRID_ASSET_VERSION = "grid-ui-v4";
const REPO_ROOT = String(import.meta.env.BURRETE_REPO_ROOT || "");
const WEB_ASSETS_BASE = fsUrl(`${REPO_ROOT}/PreviewExtension/Web/`);

type ResolvedPreviewVisuals = {
  theme: ViewerPreferences["theme"] | "dark";
  canvasBackground: Exclude<ViewerPreferences["canvasBackground"], "auto">;
  transparentBackground: boolean;
};

type BrowserDevExternalArtifact = {
  inlineSvg: string;
  outputType: "svg";
  preset: string;
  configArgument: string;
  elapsedMs: number;
  log?: string;
};

export function browserDevRuntimeNeedsRefresh(document: ViewerDocument) {
  if (document.renderer === "grid2d") return false;
  return !document.runtimePath.includes("viewer-shell.js")
    || document.runtimePath.includes('<div id="buret-toolbar"')
    || document.runtimePath.includes("function viewerRuntimeCss");
}

function resolvePreviewVisuals(preferences: ViewerPreferences): ResolvedPreviewVisuals {
  const theme = preferences.theme === "auto" ? "dark" : preferences.theme;
  const canvasBackground = preferences.canvasBackground === "auto" ? "black" : preferences.canvasBackground;
  return {
    theme,
    canvasBackground,
    transparentBackground: canvasBackground === "transparent",
  };
}

export async function openBrowserDevDocuments(
  paths: string[],
  preferences: ViewerPreferences,
  reloadOptions?: ViewerReloadOptions,
): Promise<OpenDocumentsResult> {
  const documents: ViewerDocument[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    try {
      documents.push(await openBrowserDevDocument(path, preferences, reloadOptions));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (documents.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return { documents, errors };
}

async function openBrowserDevDocument(
  path: string,
  preferences: ViewerPreferences,
  reloadOptions?: ViewerReloadOptions,
): Promise<ViewerDocument> {
  const response = await fetch(fsUrl(path));
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`${path} is empty`);
  if (bytes.length > MAX_STRUCTURE_FILE_SIZE) {
    throw new Error(`${path} is larger than the 75 MB preview limit`);
  }

  const extension = fileExtension(path);
  const text = decodeUtf8(bytes);
  const grid = gridPayload(path, extension, text);
  if (grid) {
    const html = await gridHtml(path, grid.records, grid.format, preferences, bytes.length);
    return browserDocument(path, extension, "grid2d", html, bytes.length);
  }
  if (gridRequiresPreview(extension)) {
    throw new Error(`${path} does not contain supported molecule grid records`);
  }

  const format = formatForExtension(extension);
  const requestedRenderer = resolveRenderer(format, preferences.rendererMode);
  const { renderer, externalRendererStatus, externalArtifact, xyzrenderPresetOptions } =
    await browserRendererPlan(path, format, requestedRenderer, reloadOptions);
  const html = viewerHtml(path, format, renderer, bytes, preferences, externalRendererStatus, externalArtifact, xyzrenderPresetOptions);
  return browserDocument(path, extension, renderer, html, bytes.length);
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

function viewerHtml(
  path: string,
  format: FormatInfo,
  renderer: string,
  bytes: Uint8Array,
  preferences: ViewerPreferences,
  externalRendererStatus?: Record<string, string>,
  externalArtifact?: BrowserDevExternalArtifact,
  xyzrenderPresetOptions?: Array<{ value: string; label: string }>,
) {
  const label = fileTitle(path);
  const visuals = resolvePreviewVisuals(preferences);
  const config = {
    format: format.molstarFormat,
    molstarFormat: format.molstarFormat,
    binary: format.binary,
    renderer,
    requestedRenderer: normalizeRendererMode(preferences.rendererMode),
    allowMolstarFallback: true,
    label,
    byteCount: bytes.length,
    previewByteCount: bytes.length,
    quickLookBuild: "burrete-browser-dev",
    debug: false,
    theme: visuals.theme,
    canvasBackground: visuals.canvasBackground,
    documentId: stableId(path),
    uiScale: 1,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    sdfGrid: true,
    appViewer: true,
    tauriViewer: false,
    xyzrenderViewer: renderer === "xyzrender-external",
    molstarAvailable: !format.externalOnly,
    canOpenInVesta: format.canOpenInVesta,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
    ...(externalArtifact ? { externalArtifact } : {}),
    ...(xyzrenderPresetOptions ? { xyzrenderPresetOptions } : {}),
    ...(externalRendererStatus ? { externalRendererStatus } : {}),
    ...(renderer === "xyz-fast"
      ? {
          xyzFast: {
            style: preferences.xyzFastStyle,
            firstFrameOnly: true,
            showCell: true,
            sourceByteCount: bytes.length,
            previewByteCount: bytes.length,
          },
        }
      : {}),
  };
  const rendererAssets =
    renderer === "xyz-fast" || renderer === "xyzrender-external"
      ? `<script src="xyz-fast.js"></script>`
      : `<link rel="stylesheet" href="molstar.css" /><script src="molstar.js"></script>`;
  const runtimeAssetVersion = String(Date.now());
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
  <script>window.BurreteDataBase64 = "${bytesToBase64(bytes)}";</script>
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
) {
  if (renderer !== "xyzrender-external") return { renderer };
  try {
    const result = await requestBrowserDevXyzrender(
      path,
      reloadOptions?.xyzrenderPreset ?? "default",
      reloadOptions?.xyzrenderOrientationRef ?? null,
    );
    return {
      renderer: "xyzrender-external",
      externalArtifact: {
        inlineSvg: result.svg,
        outputType: "svg" as const,
        preset: result.preset,
        configArgument: result.configArgument,
        elapsedMs: result.elapsedMs,
        log: result.log,
      },
      xyzrenderPresetOptions: result.xyzrenderPresetOptions,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format.externalOnly) {
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
) {
  const url = new URL("/__burette/xyzrender", window.location.origin);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path,
      preset,
      orientationRef: orientationRef || undefined,
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
    canvasBackground: visuals.canvasBackground,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    recordsTotal: records.length,
    recordsIncluded: records.length,
    recordsTruncated: false,
    pageSize: 96,
    rdkitWasmPath: `${WEB_ASSETS_BASE}rdkit/RDKit_minimal.wasm`,
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
      try { window.parent && window.parent.postMessage({ source: 'burrete-grid', body: { type, message: String(message || ''), ...(payload || {}) } }, '*'); } catch (_) {}
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

function resolveRenderer(format: FormatInfo, requested: ViewerPreferences["rendererMode"]) {
  if (format.externalOnly) return "xyzrender-external";
  const isXyz = format.molstarFormat === "xyz" && !format.binary;
  const normalized = normalizeRendererMode(requested);
  if (normalized === "molstar") return "molstar";
  if (normalized === "xyz-fast") return isXyz ? "xyz-fast" : "molstar";
  if (normalized === "xyzrender-external") return isXyz ? "xyzrender-external" : "molstar";
  return isXyz ? "xyz-fast" : "molstar";
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
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function fileTitle(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "structure";
}

function fsUrl(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/") ? "/@fs" : "/@fs/";
  return prefix + normalized.split("/").map(encodeURIComponent).join("/");
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

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
