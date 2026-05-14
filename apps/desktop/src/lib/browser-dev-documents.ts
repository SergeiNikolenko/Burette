import type { OpenDocumentsResult, ViewerDocument, ViewerPreferences } from "../types";
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
): Promise<OpenDocumentsResult> {
  const documents: ViewerDocument[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    try {
      documents.push(await openBrowserDevDocument(path, preferences));
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
  const { renderer, externalRendererStatus } = browserRendererPlan(format, requestedRenderer);
  const html = viewerHtml(path, format, renderer, bytes, preferences, externalRendererStatus);
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
    uiScale: 1,
    overlayOpacity: 0.9,
    transparentBackground: visuals.transparentBackground,
    sdfGrid: true,
    appViewer: true,
    tauriViewer: false,
    xyzrenderViewer: false,
    molstarAvailable: !format.externalOnly,
    canOpenInVesta: format.canOpenInVesta,
    showPanelControls: true,
    defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
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
    renderer === "xyz-fast"
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

function browserRendererPlan(format: FormatInfo, renderer: string) {
  if (renderer !== "xyzrender-external") return { renderer };
  if (format.externalOnly) {
    throw new Error("External xyzrender previews are unavailable in browser dev mode.");
  }
  if (format.molstarFormat === "xyz" && !format.binary) {
    return {
      renderer: "xyz-fast",
      externalRendererStatus: {
        status: "fallback",
        requested: "xyzrender-external",
        message: "Using Fast XYZ because browser dev mode cannot run external xyzrender.",
      },
    };
  }
  return { renderer: "molstar" };
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
  const wasmResponse = await fetch(`${WEB_ASSETS_BASE}rdkit/RDKit_minimal.wasm`);
  const wasmBase64 = wasmResponse.ok
    ? bytesToBase64(new Uint8Array(await wasmResponse.arrayBuffer()))
    : "";
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
  <script>window.BurreteGridRecords = ${JSON.stringify(records)}; window.BurreteRDKitWasmBase64 = "${wasmBase64}";</script>
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
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage({ source: 'burrete-viewer', body }, window.location.origin); }
      catch (_) { try { window.parent.postMessage({ source: 'burrete-viewer', body }, '*'); } catch (_) {} }
    }
  };
  window.webkit = window.webkit || { messageHandlers: { burrete: { postMessage: postToParent } } };
  window.__mqlPost = (type, message) => postToParent({ type, message: message || '' });
  window.__mqlAction = (name) => window.webkit.messageHandlers.burrete.postMessage({ type: 'action', message: name });
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
