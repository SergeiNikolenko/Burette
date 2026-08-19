import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path) => readFileSync(join(repoRoot, path), 'utf8');

const documentKind = source('apps/desktop/src/components/editor-area/page-kinds/document.tsx');
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
assert.match(documentKind, /FileViewerPreview/);
assert.match(documentKind, /`\/__burette\/read-file\?path=\$\{encodeURIComponent\(path\)\}`/);
assert.match(documentKind, /invoke<ArrayBuffer>\("read_document_file", \{ path \}\)/);
assert.match(documentKind, /kind: "blob"/);

// The desktop path must not lean on the asset protocol: its scope covers generated
// runtime files only, so arbitrary user documents would be refused.
assert.doesNotMatch(documentKind, /convertFileSrc/);
const permissions = source('apps/desktop/src-tauri/permissions/burette.toml');
const rustCommands = source('apps/desktop/src-tauri/src/commands/text_files.rs');
const rustRegistry = source('apps/desktop/src-tauri/src/lib.rs');
assert.match(permissions, /"read_document_file"/);
assert.match(rustCommands, /pub\(crate\) fn read_document_file/);
assert.match(rustRegistry, /commands::text_files::read_document_file/);

// Both open paths classify documents before the text fallback swallows them.
assert.match(fileOpen, /} else if \(isDocumentViewerPath\(path, extension\)\) \{\s*documentPaths\.push\(path\);/);
assert.match(dockOpen, /} else if \(isDocumentViewerPath\(path, extension\)\) \{\s*documentPaths\.push\(path\);/);
assert.match(dockOpen, /&& !isDocumentViewerPath\(path, extension\)/);
assert.match(store, /openDocumentTab: \(path\) =>/);
assert.match(store, /tab\.location\.kind === "document" && tab\.location\.path === path/);

// Browser dev serves the same files over its read-file bridge.
for (const extension of ['pdf', 'docx', 'xlsx', 'pptx']) {
  assert.match(viteConfig, new RegExp(`DEV_FILE_EXTENSIONS = new Set\\(\\[[\\s\\S]*"${extension}"`));
}

// Vendored registry components are only reproducible while the registry stays declared.
assert.equal(components.registries['@retab'], 'https://ui.retab.com/r/{name}.json');

console.log('retab document viewer contract ok');
