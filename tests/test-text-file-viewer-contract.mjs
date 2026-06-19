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
  maestroOutlineViewer,
  structureTextHighlighting,
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
  viteConfig,
  packageJson,
] = await Promise.all([
  source("apps/desktop/src/App.tsx"),
  source("apps/desktop/src/types.ts"),
  source("apps/desktop/src/hooks/use-tabs.ts"),
  source("apps/desktop/src/stores/molecule-store.ts"),
  source("apps/desktop/src/components/editor-area/page-kinds/index.ts"),
  source("apps/desktop/src/components/editor-area/page-kinds/text-file.tsx"),
  source("apps/desktop/src/components/text-file-viewer.tsx"),
  source("apps/desktop/src/components/text-file-viewer/maestro-outline-viewer.tsx"),
  source("apps/desktop/src/components/text-file-viewer/structure-text-highlighting.ts"),
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
  source("apps/desktop/vite.config.ts"),
  source("package.json"),
]);

assert.match(types, /export type TextFileDocument = \{/);
assert.match(types, /export type OpenTextFilesResult = \{/);

assert.match(pageKinds, /import \{ textFileKind, type TextFileLocation \} from "\.\/text-file";/);
assert.match(pageKinds, /const kinds = \[fileKind, textFileKind,/);
assert.match(pageKinds, /export type Location = FileLocation \| TextFileLocation/);
assert.match(textFileKind, /kind: "text-file"/);
assert.match(textFileKind, /serialize: \(location\) => \(\{ documentId: location\.documentId, path: location\.path \}\)/);
assert.match(textFileKind, /<TextFileViewer document=\{document\} openPaths=\{actions\.openPaths\} onStructureSelection=\{actions\.selectTextStructure\} \/>/);
assert.doesNotMatch(textFileKind, /kind: "file"/);

assert.match(moleculeStore, /textDocuments: TextFileDocument\[\]/);
assert.match(moleculeStore, /addTextDocuments:/);
assert.match(moleculeStore, /openTextDocumentsInActiveTab:/);
assert.match(moleculeStore, /location: \{ kind: "text-file", documentId: document\.id, path: document\.path \}/);
assert.match(tabsHook, /export function useOpenTextDocuments\(/);
assert.match(tabsHook, /export function useAddTextTabs\(/);

assert.match(textViewer, /new EditorView\(/);
assert.match(textViewer, /textStructureSelectionFromRange\(document, range\.from, range\.to\)/);
assert.match(textViewer, /textStructureSelectionFromSelectedText\(document, selection\.toString\(\)\)/);
assert.match(textViewer, /onStructureSelectionRef\.current\?\.\(document, selection\)/);
assert.match(textViewer, /window\.document\.addEventListener\("selectionchange", emitNativeStructureSelection\)/);
assert.match(textViewer, /view\.posAtDOM\(lineElement, 0\)/);
assert.match(textViewer, /range\.intersectsNode\(lineElement\)/);
assert.match(textViewer, /textStructureSelectionFromRange\(document, from, to\)/);
assert.doesNotMatch(textViewer, /textStructureSelectionFromRange\(document, line\.from, line\.to, \{ preferAtom: true \}\)/);
assert.match(textViewer, /lineDragStartRef/);
assert.match(textViewer, /parent\.addEventListener\("pointerdown", onPointerDown\)/);
assert.match(textViewer, /parent\.addEventListener\("pointermove", onPointerMove\)/);
assert.match(textViewer, /parent\.addEventListener\("pointerup", onPointerUp\)/);
assert.match(textViewer, /parent\.addEventListener\("pointercancel", onPointerCancel\)/);
assert.match(textViewer, /parent\.addEventListener\("pointerleave", onPointerLeave\)/);
assert.match(textViewer, /EditorState\.readOnly\.of\(true\)/);
assert.match(textViewer, /EditorView\.editable\.of\(false\)/);
assert.doesNotMatch(textViewer, /EditorView\.lineWrapping/);
assert.match(textViewer, /markdown\(\{ codeLanguages: languages \}\)/);
assert.match(textViewer, /LanguageDescription\.matchFilename\(languages, document\.title\)/);
assert.match(textViewer, /structureTextHighlighting\(document\.extension\)/);
assert.match(textViewer, /hasStructureTextHighlighting\(document\.extension\)/);
assert.match(textViewer, /textNumberHighlighting\(\)/);
assert.match(textViewer, /return \[await description\.load\(\), numberHighlighting\]/);
assert.match(textViewer, /<MarkdownRichViewer document=\{document\} openPaths=\{openPaths\} \/>/);
assert.match(textViewer, /<MaestroOutlineViewer document=\{document\} \/>/);
assert.match(textViewer, /function isMaestroText\(document: TextFileDocument\)/);
assert.match(textViewer, /fontVariantNumeric: "tabular-nums"/);
assert.match(textViewer, /fontFeatureSettings: "\\"tnum\\" 1, \\"kern\\" 0, \\"liga\\" 0, \\"calt\\" 0"/);
assert.match(textViewer, /overflowX: "auto"/);
assert.match(textViewer, /width: "max-content"/);
assert.match(textViewer, /whiteSpace: "pre"/);
assert.match(textViewer, /"\.cm-line span": \{\s*fontFamily: "inherit",\s*fontWeight: "400",\s*\}/);
assert.doesNotMatch(textViewer, /\.cm-structure-record[\s\S]*?fontWeight/s);
assert.match(maestroOutlineViewer, /function parseMaestroOutline\(content: string\)/);
assert.match(maestroOutlineViewer, /MAX_VISIBLE_BLOCK_LINES = 240/);
assert.match(maestroOutlineViewer, /blockHeader = line\.match/);
assert.match(maestroOutlineViewer, /openBlocks\.has\(item\.id\)/);
assert.match(maestroOutlineViewer, /document\.truncated \? <strong>Preview limited<\/strong>/);
assert.match(structureTextHighlighting, /pdbqt/);
assert.match(structureTextHighlighting, /cm-structure-residue/);
assert.match(structureTextHighlighting, /function highlightPdbLine/);
assert.match(structureTextHighlighting, /function highlightCifLine/);
assert.match(structureTextHighlighting, /function highlightGroLine/);
assert.match(structureTextHighlighting, /maegz/);
assert.match(structureTextHighlighting, /function highlightMaestroLine/);
assert.match(structureTextHighlighting, /export function textNumberHighlighting\(\): Extension/);
assert.match(structureTextHighlighting, /export function hasStructureTextHighlighting/);
assert.match(structureTextHighlighting, /function buildNumberDecorations/);
assert.match(structureTextHighlighting, /highlightNumbers\(builder, line\.from, line\.text, 0\)/);

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
assert.match(textFilesCommand, /pub\(crate\) fn read_text_file\(\s*path: String,\s*max_bytes: Option<usize>,\s*\)/);
assert.match(textFilesCommand, /fn read_limit\(max_bytes: Option<usize>\) -> usize/);
assert.match(textFilesCommand, /\.take\(limit as u64\)/);
assert.match(textFilesCommand, /looks_binary/);
assert.match(textFilesCommand, /GzDecoder/);
assert.match(textFilesCommand, /String::from_utf8_lossy/);
assert.match(tauriLib, /commands::text_files::open_text_files/);
assert.match(permissions, /"open_text_files"/);
assert.match(browserDevTextFiles, /\/__burette\/read-text-file\?path=\$\{encodeURIComponent\(path\)\}/);
assert.match(browserDevTextFiles, /export async function openBrowserDevTextFiles/);
for (const extension of ["inpcrd", "rst7", "crd", "rst", "state", "xml"]) {
  assert.match(viteConfig, new RegExp(`"${extension}"`), `${extension} should be allowed by browser-dev read-file`);
}

assert.match(app, /const openTextDocuments = useCallback/);
assert.match(app, /import \{ openBrowserDevTextFiles \} from "\.\/lib\/browser-dev-text-files";/);
assert.match(app, /: await openBrowserDevTextFiles\(cleanPaths\)/);
assert.doesNotMatch(app, /Text file viewer is available in the desktop app only/);
assert.match(app, /const openPaths = useCallback/);
assert.match(app, /"par"[\s\S]*"checkpoint"/);
assert.match(app, /preferredTextExtensions = new Set\(\[[\s\S]*"log"[\s\S]*"out"[\s\S]*"json"[\s\S]*"yaml"[\s\S]*\]\)/);
assert.match(app, /structureAndTextExtensions = new Set\(\[[\s\S]*"nw"[\s\S]*"vasp"[\s\S]*\]\)/);
const structureAndTextBlock = app.match(/structureAndTextExtensions = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
assert.ok(structureAndTextBlock, "structureAndTextExtensions should be declared");
assert.doesNotMatch(structureAndTextBlock, /"log"/);
assert.doesNotMatch(structureAndTextBlock, /"out"/);
for (const extension of ["abi", "cms", "com", "csv", "cub", "cube", "fdf", "graphml", "in", "inp", "inpcrd", "mae", "maegz", "nw", "psi4", "qcin", "crd", "rst", "rst7", "state", "tsv", "vasp", "xml"]) {
  assert.match(app, new RegExp(`"${extension}"`), `${extension} should be a structure-and-text open extension`);
}
assert.match(app, /preferredTextExtensions\.has\(extension\)[\s\S]*extension\.length > 0 && !structureExtensions\.has\(extension\) && !structureAndTextExtensions\.has\(extension\)[\s\S]*textPaths\.push\(path\);/);
assert.match(app, /if \(structureAndTextExtensions\.has\(extension\)\) \{\s*structureAndTextPaths\.push\(path\);/);
assert.match(app, /const openedStructureAndTextPaths = new Set<string>\(\);/);
assert.match(app, /const result = await openDocuments\(structureAndTextPaths\);/);
assert.match(app, /openedStructureAndTextPaths\.add\(document\.path\);/);
assert.match(app, /structureAndTextPaths\.filter\(\(path\) => !openedStructureAndTextPaths\.has\(path\)\)/);
assert.match(app, /let dockOpenPaths = cleanPaths;/);
assert.match(app, /const rightDockTextPaths = cleanPaths\.filter\(\(path\) => \{/);
assert.match(app, /return !isSpectrumExtension\(extension\) && !structureExtensions\.has\(extension\) && !structureAndTextExtensions\.has\(extension\);/);
assert.match(app, /dockOpenPaths = cleanPaths\.filter\(\(path\) => !rightDockTextPaths\.includes\(path\)\);/);
assert.match(app, /open_text_files", \{ paths: rightDockTextPaths \}/);
assert.match(app, /for \(const path of dockOpenPaths\) \{/);
const rightDockTextOpenBlock = app.match(/if \(input\.area === "right" && cleanPaths\.length > 0\) \{[\s\S]*?return;\s*\}/)?.[0] ?? "";
assert.match(rightDockTextOpenBlock, /pathExtension|structureExtensions|structureAndTextExtensions/);
assert.doesNotMatch(rightDockTextOpenBlock, /preferredTextExtensions/);
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
for (const extension of ["par", "prm", "rtf", "str", "key", "chk", "checkpoint"]) {
  assert.equal(textAssociation.ext.includes(extension), true, `${extension} should be a text artifact association`);
}
for (const extension of ["xml", "inpcrd", "rst7", "crd", "rst", "state"]) {
  assert.equal(textAssociation.ext.includes(extension), false, `${extension} should stay in the structure association`);
}
assert.equal(textAssociation.ext.includes("out"), false, "out stays in the structure association for molecular compatibility");
assert.match(textFilesCommand, /OPENMM_BINARY_ARTIFACT_EXTENSIONS: &\[\&str\] = &\["chk", "checkpoint"\]/);
assert.match(textFilesCommand, /MOLECULAR_BINARY_METADATA_EXTENSIONS/);
assert.match(textFilesCommand, /molecular_binary_artifact_summary/);
assert.match(textFilesCommand, /Binary molecular workflow artifact/);

assert.doesNotMatch(app, /autosave/i);
assert.doesNotMatch(textViewer, /writeFile|scheduleSave|updateContent/);
assert.doesNotMatch(markdownRichViewer, /writeFile|scheduleSave|updateContent|saveClipboardImage|updateFrontmatter/);

const pkg = JSON.parse(packageJson);
assert.ok(pkg.dependencies["@prosemark/core"], "Writer ProseMark viewer dependency should be direct");
assert.ok(pkg.dependencies["beautiful-mermaid"], "Writer Mermaid renderer dependency should be direct");
assert.ok(pkg.dependencies["dompurify"], "Writer HTML sanitizer dependency should be direct");

console.log("text file viewer contract tests passed");
