import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path) => readFileSync(join(repoRoot, path), 'utf8');

const documentKind = source('apps/desktop/src/components/editor-area/page-kinds/document.tsx');
const documentPage = source('apps/desktop/src/components/document-page.tsx');
const fileRouting = source('apps/desktop/src/lib/file-routing.ts');
const fileOpen = source('apps/desktop/src/hooks/use-app-file-open.ts');
const dockOpen = source('apps/desktop/src/hooks/use-app-dock-payload-open.ts');
const store = source('apps/desktop/src/stores/molecule-store.ts');
const viteConfig = source('apps/desktop/vite.config.ts');
const components = JSON.parse(source('apps/desktop/components.json'));

// Office documents render through the vendored Retab viewer, never through the
// structure or text readers: neither of them can make sense of these bytes.
for (const extension of ['pdf', 'docx', 'xlsx', 'pptx', 'eml']) {
  assert.match(fileRouting, new RegExp(`documentViewerExtensions = new Set\\(\\[[\\s\\S]*"${extension}"`));
}
assert.match(fileRouting, /export function isDocumentViewerPath/);

// The viewer fetches the file itself, so both runtimes must hand it a readable URL.
assert.match(documentKind, /export const documentKind = definePageKind/);
assert.match(documentKind, /keepAlive: true/);
// The surface itself lives in document-page.tsx behind the page kind's lazy
// boundary (see test-lazy-boundaries-contract.mjs).
assert.match(documentPage, /export function DocumentSurface/);
// The canonical Retab composition: header (title, meta, controls) above the
// document, matching the upstream demo one to one.
for (const piece of ['FileViewerProvider', 'FileViewerHeader', 'FileViewerTitle', 'FileViewerMeta', 'FileViewerControls', 'FileViewerContent', 'FileViewerInset', 'FileViewerViewport', 'FileViewerDocument']) {
  assert.match(documentPage, new RegExp(`<${piece}[ />]`));
}
const styles = source('apps/desktop/src/styles.css');
// The stage must clear Burette's floating tab strip like every other page kind.
assert.match(styles, /\.document-stage \{\n  position: absolute;\n  inset: var\(--chrome-height\) 0 0;/);
assert.match(documentPage, /className="document-stage"/);
assert.match(documentPage, /`\/__burette\/read-file\?path=\$\{encodeURIComponent\(path\)\}`/);
assert.match(documentPage, /invoke<ArrayBuffer>\("read_document_file", \{ path \}\)/);
assert.match(documentPage, /kind: "blob"/);

// The desktop path must not lean on the asset protocol: its scope covers generated
// runtime files only, so arbitrary user documents would be refused.
assert.doesNotMatch(documentPage, /convertFileSrc/);
const permissions = source('apps/desktop/src-tauri/permissions/burette.toml');
const rustCommands = source('apps/desktop/src-tauri/src/commands/text_files.rs');
const rustRegistry = source('apps/desktop/src-tauri/src/lib.rs');
assert.match(permissions, /"read_document_file"/);
// The read stays off the IPC pool: async command + spawn_blocking.
assert.match(rustCommands, /pub\(crate\) async fn read_document_file/);
assert.match(rustCommands, /spawn_blocking/);
assert.match(rustRegistry, /commands::text_files::read_document_file/);

// Both open paths classify documents before the text fallback swallows them.
assert.match(fileOpen, /} else if \(isDocumentViewerPath\(path, extension\)\) \{/);
// Oversized text keeps the legacy CodeMirror preview: the Retab text viewer
// hard-errors past its byte bound.
assert.match(fileOpen, /fitsRetabTextViewer\(path\)/);
assert.match(fileOpen, /RETAB_TEXT_VIEWER_MAX_BYTES/);
// The dock keeps its editable CodeMirror surface for text and code, so only
// media formats leave the dock for a document tab.
assert.match(dockOpen, /} else if \(isDocumentMediaPath\(path, extension\)\) \{\s*documentPaths\.push\(path\);/);
assert.match(dockOpen, /&& !isDocumentMediaPath\(path, extension\)/);
assert.doesNotMatch(dockOpen, /isDocumentViewerPath/);

// Read-only text, code and log viewing routes to the Retab viewer in the main area.
for (const extension of ['txt', 'log', 'json', 'py', 'yaml']) {
  assert.match(fileRouting, new RegExp(`documentTextViewerExtensions = new Set\\(\\[[\\s\\S]*"${extension}"`));
}
assert.match(fileRouting, /documentViewerExtensions\.has\(extension\) \|\| documentTextViewerExtensions\.has\(extension\)/);

// Grid-rejected delimited files fall back to the Retab table viewer, not plain text.
assert.match(fileRouting, /documentFallbackExtensions = new Set\(\["csv", "tsv"\]\)/);
assert.match(fileOpen, /documentFallbackExtensions\.has\(pathExtension\(path\)\)/);
// The grid's rejection must stay silent when the caller will fall back; the
// option is only honored if both status pushes actually check it.
assert.match(fileOpen, /if \(!options\.deferErrorStatus\) pushStatus/);
assert.match(fileOpen, /if \(!options\.deferErrorStatus\) pushErrorStatus\(error\);/);
assert.match(store, /openDocumentTab: \(path\) =>/);
assert.match(store, /tab\.location\.kind === "document" && tab\.location\.path === path/);

// Browser dev serves the same files over its read-file bridge.
for (const extension of ['pdf', 'docx', 'xlsx', 'pptx']) {
  assert.match(viteConfig, new RegExp(`DEV_FILE_EXTENSIONS = new Set\\(\\[[\\s\\S]*"${extension}"`));
}

// Vendored registry components are only reproducible while the registry stays declared.
assert.equal(components.registries['@retab'], 'https://ui.retab.com/r/{name}.json');

// Pixel parity: vendored Retab files use Retab's own primitives, and the document
// stage pins the stock neutral palette the upstream site renders with.
const viewerControls = source('apps/desktop/src/components/ui/viewer-controls.tsx');
assert.match(viewerControls, /from "@\/components\/ui\/retab-button"/);
assert.match(viewerControls, /size="iconSm"/);
for (const name of ['retab-button', 'retab-dropdown-menu', 'retab-skeleton', 'retab-spinner']) {
  source(`apps/desktop/src/components/ui/${name}.tsx`);
}
assert.match(styles, /\.document-stage \{\n  --shadcn-background: #ffffff;/);
// The hairline look comes from alpha-blended borders, harvested from ui.retab.com.
assert.match(styles, /--shadcn-border: color-mix\(in oklab, #000 8%, transparent\);/);
assert.match(styles, /\.document-stage \*,[\s\S]{0,120}:host \*/);
assert.match(documentPage, /PdfViewerThumbnails \/>/);
// The generic branch has no FileViewerHeader: each viewer draws its own chrome
// row (sheet name for XLSX, row meta for CSV, word count and zoom for Markdown),
// which is the reference composition. Only the PDF branch keeps a header, for
// the sidebar trigger and the file name.
assert.match(documentPage, /<FileViewerDocument controls \/>/);
assert.match(documentPage, /import "katex\/dist\/katex\.min\.css";/);
assert.match(documentPage, /PdfViewerPages bare className="h-full" defaultScale=\{1\}/);
const fileViewerRoute = source('apps/desktop/src/components/ui/file-viewer-route.tsx');
assert.match(fileViewerRoute, /image[\s\S]{0,300}defaultScale=\{1\}/);

// Plain delimited files open in the Retab table; molecular ones keep the grid.
assert.match(fileOpen, /isMolecularDelimitedFile\(path\)/);
const sniffer = source('apps/desktop/src/lib/delimited-molecules.ts');
assert.match(sniffer, /STRUCTURE_COLUMN_NAME/);

console.log('retab document viewer contract ok');
