#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [
  app,
  types,
  tabsHook,
  moleculeStore,
  pageKinds,
  textFileKind,
  textViewer,
  markdownRichViewer,
  markdownTableDecorations,
  markdownHtmlDecorations,
  markdownMermaidDecorations,
  markdownMermaidCanvas,
  markdownMermaidRenderer,
  markdownImageResolver,
  markdownLinkNavigation,
  browserDevTextFiles,
  tauriLib,
  textFilesCommand,
  permissions,
  tauriConfig,
  packageJson,
] = await Promise.all([
  source("apps/desktop/src/App.tsx"),
  source("apps/desktop/src/types.ts"),
  source("apps/desktop/src/hooks/use-tabs.ts"),
  source("apps/desktop/src/stores/molecule-store.ts"),
  source("apps/desktop/src/components/editor-area/page-kinds/index.ts"),
  source("apps/desktop/src/components/editor-area/page-kinds/text-file.tsx"),
  source("apps/desktop/src/components/text-file-viewer.tsx"),
  source("apps/desktop/src/components/text-file-viewer/markdown-rich-viewer.tsx"),
  source("apps/desktop/src/components/text-file-viewer/markdown-table-decorations.ts"),
  source("apps/desktop/src/components/text-file-viewer/markdown-html-block-decorations.ts"),
  source("apps/desktop/src/components/text-file-viewer/markdown-mermaid-decorations.ts"),
  source("apps/desktop/src/components/text-file-viewer/markdown-mermaid-canvas.ts"),
  source("apps/desktop/src/components/text-file-viewer/markdown-mermaid-renderer.ts"),
  source("apps/desktop/src/components/text-file-viewer/markdown-image-src-resolver.ts"),
  source("apps/desktop/src/components/text-file-viewer/markdown-link-navigation.ts"),
  source("apps/desktop/src/lib/browser-dev-text-files.ts"),
  source("apps/desktop/src-tauri/src/lib.rs"),
  source("apps/desktop/src-tauri/src/commands/text_files.rs"),
  source("apps/desktop/src-tauri/permissions/burrete.toml"),
  source("apps/desktop/src-tauri/tauri.conf.json"),
  source("package.json"),
]);

assert.match(types, /export type TextFileDocument = \{/);
assert.match(types, /export type OpenTextFilesResult = \{/);

assert.match(pageKinds, /import \{ textFileKind, type TextFileLocation \} from "\.\/text-file";/);
assert.match(pageKinds, /const kinds = \[fileKind, textFileKind,/);
assert.match(pageKinds, /export type Location = FileLocation \| TextFileLocation/);
assert.match(textFileKind, /kind: "text-file"/);
assert.match(textFileKind, /serialize: \(location\) => \(\{ documentId: location\.documentId, path: location\.path \}\)/);
assert.match(textFileKind, /<TextFileViewer document=\{document\} openPaths=\{actions\.openPaths\} \/>/);
assert.doesNotMatch(textFileKind, /kind: "file"/);

assert.match(moleculeStore, /textDocuments: TextFileDocument\[\]/);
assert.match(moleculeStore, /addTextDocuments:/);
assert.match(moleculeStore, /openTextDocumentsInActiveTab:/);
assert.match(moleculeStore, /location: \{ kind: "text-file", documentId: document\.id, path: document\.path \}/);
assert.match(tabsHook, /export function useOpenTextDocuments\(/);
assert.match(tabsHook, /export function useAddTextTabs\(/);

assert.match(textViewer, /new EditorView\(/);
assert.match(textViewer, /EditorState\.readOnly\.of\(true\)/);
assert.match(textViewer, /EditorView\.editable\.of\(false\)/);
assert.match(textViewer, /markdown\(\{ codeLanguages: languages \}\)/);
assert.match(textViewer, /LanguageDescription\.matchFilename\(languages, document\.title\)/);
assert.match(textViewer, /<MarkdownRichViewer document=\{document\} openPaths=\{openPaths\} \/>/);

assert.match(markdownRichViewer, /prosemarkBasicSetup\(\)/);
assert.match(markdownRichViewer, /prosemarkBaseThemeSetup\(\)/);
assert.match(markdownRichViewer, /prosemarkMarkdownSyntaxExtensions/);
assert.match(markdownRichViewer, /extensions: \[GFM, prosemarkMarkdownSyntaxExtensions, htmlBlockParserExtension\]/);
assert.match(markdownRichViewer, /markdownTableDecorations\(\)/);
assert.match(markdownRichViewer, /markdownHtmlBlockDecorations\(\)/);
assert.match(markdownRichViewer, /markdownMermaidDecorations\(\)/);
assert.match(markdownRichViewer, /markdownImageSrcResolver\(\(\) => document\.path\)/);
assert.match(markdownRichViewer, /markdownLinkNavigation\(\(\) => document\.path, \(\) => disposedRef\.current, openPaths\)/);
assert.match(markdownRichViewer, /EditorState\.readOnly\.of\(true\)/);
assert.match(markdownRichViewer, /EditorView\.editable\.of\(false\)/);

assert.match(markdownTableDecorations, /nodePath: "Table"/);
assert.match(markdownTableDecorations, /class TableWidget extends WidgetType/);
assert.match(markdownHtmlDecorations, /DOMPurify\.sanitize/);
assert.match(markdownHtmlDecorations, /htmlBlockParserExtension/);
assert.match(markdownHtmlDecorations, /nodePath: "HTMLBlock"/);
assert.match(markdownMermaidDecorations, /nodePath: "FencedCode"/);
assert.match(markdownMermaidDecorations, /keepDecorationOnUnfold: true/);
assert.match(markdownMermaidDecorations, /mountMermaidCanvas/);
assert.match(markdownMermaidCanvas, /MERMAID_CANVAS_HEIGHT = 480/);
assert.match(markdownMermaidCanvas, /Zoom in/);
assert.match(markdownMermaidCanvas, /Edit code/);
assert.match(markdownMermaidRenderer, /renderMermaidSVG/);
assert.match(markdownMermaidRenderer, /sanitizeSvg/);
assert.match(markdownImageResolver, /convertFileSrc/);
assert.match(markdownLinkNavigation, /openPaths\(\[localPath\]\)/);
assert.match(markdownLinkNavigation, /openUrl\(href\)/);

assert.match(textFilesCommand, /const TEXT_FILE_READ_LIMIT: usize = 12 \* 1024 \* 1024;/);
assert.match(textFilesCommand, /pub\(crate\) fn open_text_files/);
assert.match(textFilesCommand, /pub\(crate\) fn read_text_file/);
assert.match(textFilesCommand, /looks_binary/);
assert.match(textFilesCommand, /String::from_utf8_lossy/);
assert.match(tauriLib, /commands::text_files::open_text_files/);
assert.match(permissions, /"open_text_files"/);
assert.match(browserDevTextFiles, /\/__burette\/read-text-file\?path=\$\{encodeURIComponent\(path\)\}/);
assert.match(browserDevTextFiles, /export async function openBrowserDevTextFiles/);

assert.match(app, /const openTextDocuments = useCallback/);
assert.match(app, /import \{ openBrowserDevTextFiles \} from "\.\/lib\/browser-dev-text-files";/);
assert.match(app, /: await openBrowserDevTextFiles\(cleanPaths\)/);
assert.doesNotMatch(app, /Text file viewer is available in the desktop app only/);
assert.match(app, /const openPaths = useCallback/);
assert.match(app, /structureFirstTextExtensions = new Set\(\["out"\]\)/);
assert.match(app, /useOpenEvents\(openPaths, pushErrorStatus\)/);
assert.match(app, /useOpenDrop\(openPaths, pushStatus/);
assert.match(app, /showTextFileMetadata/);
assert.match(app, /activeTextDocument/);

const config = JSON.parse(tauriConfig);
const textAssociation = config.bundle.fileAssociations.find((association) => (
  association.ext.includes("md") && association.ext.includes("log") && association.ext.includes("sh")
));
assert.ok(textAssociation, "text file associations should include md/log/sh");
assert.equal(textAssociation.role, "Viewer");
assert.equal(textAssociation.ext.includes("out"), false, "out stays in the structure association for molecular compatibility");

assert.doesNotMatch(app, /autosave/i);
assert.doesNotMatch(textViewer, /writeFile|scheduleSave|updateContent/);
assert.doesNotMatch(markdownRichViewer, /writeFile|scheduleSave|updateContent|saveClipboardImage|updateFrontmatter/);

const pkg = JSON.parse(packageJson);
assert.ok(pkg.dependencies["@prosemark/core"], "Writer ProseMark viewer dependency should be direct");
assert.ok(pkg.dependencies["beautiful-mermaid"], "Writer Mermaid renderer dependency should be direct");
assert.ok(pkg.dependencies["dompurify"], "Writer HTML sanitizer dependency should be direct");

console.log("text file viewer contract tests passed");
