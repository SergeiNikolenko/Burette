#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function source(path) {
  return readFile(resolve(path), 'utf8');
}

const [
  app,
  uiStore,
  commandPaletteHook,
  tabsHook,
  sidebarHook,
  moleculeStore,
  settingsStore,
  settingsHook,
  shellStore,
  packageJson,
  appLayout,
  main,
  sidebar,
  sidebarFileBrowser,
  sidebarFileTreeNode,
  sidebarWorkspaceSwitcher,
  nativeContextMenu,
  sidebarProjects,
  structureDrag,
  dockingDocuments,
  commandPalette,
  editorArea,
  editorTabs,
  editorScrollContainer,
  settingsPanel,
  themesSection,
  settingControl,
  pageKinds,
  pageKindTypes,
  fileKind,
  launcherKind,
  settingsKind,
  welcome,
  errorBoundary,
  scrollFade,
  scrollFadeHook,
  shortcuts,
  openDropHook,
  openEventsHook,
  menuEventsHook,
  windowTitle,
  instance,
  browserDevDocuments,
  viteConfig,
  previewRuntimeViewer,
  previewXyzrender,
  previewViewController,
  shortcutDocs,
  styles,
  gridCss,
  gridViewer,
  previewViewer,
  previewShell,
  previewRuntimeCss,
  updateSource,
  readme,
  viewerShell,
  viewer,
] = await Promise.all([
  source('apps/desktop/src/App.tsx'),
  source('apps/desktop/src/stores/ui-store.ts'),
  source('apps/desktop/src/hooks/use-command-palette.ts'),
  source('apps/desktop/src/hooks/use-tabs.ts'),
  source('apps/desktop/src/hooks/use-sidebar.ts'),
  source('apps/desktop/src/stores/molecule-store.ts'),
  source('apps/desktop/src/stores/settings-store.ts'),
  source('apps/desktop/src/hooks/use-settings.ts'),
  source('apps/desktop/src/stores/shell-store.ts'),
  source('package.json'),
  source('apps/desktop/src/components/app-layout.tsx'),
  source('apps/desktop/src/main.tsx'),
  source('apps/desktop/src/components/sidebar/index.tsx'),
  source('apps/desktop/src/components/sidebar/file-browser.tsx'),
  source('apps/desktop/src/components/sidebar/file-tree-node.tsx'),
  source('apps/desktop/src/components/sidebar/workspace-switcher.tsx'),
  source('apps/desktop/src/components/native-context-menu.ts'),
  source('apps/desktop/src/lib/sidebar-projects.ts'),
  source('apps/desktop/src/lib/structure-drag.ts'),
  source('apps/desktop/src/lib/docking-documents.ts'),
  source('apps/desktop/src/components/command-palette/index.tsx'),
  source('apps/desktop/src/components/editor-area/index.tsx'),
  source('apps/desktop/src/components/editor-area/editor-tabs.tsx'),
  source('apps/desktop/src/components/editor-area/editor-scroll-container.tsx'),
  source('apps/desktop/src/components/settings-panel/index.tsx'),
  source('apps/desktop/src/components/settings-panel/themes-section.tsx'),
  source('apps/desktop/src/components/settings-panel/setting-control.tsx'),
  source('apps/desktop/src/components/editor-area/page-kinds/index.ts'),
  source('apps/desktop/src/components/editor-area/page-kinds/types.ts'),
  source('apps/desktop/src/components/editor-area/page-kinds/file.tsx'),
  source('apps/desktop/src/components/editor-area/page-kinds/launcher.tsx'),
  source('apps/desktop/src/components/editor-area/page-kinds/settings.tsx'),
  source('apps/desktop/src/components/welcome/index.tsx'),
  source('apps/desktop/src/components/error-boundary.tsx'),
  source('apps/desktop/src/components/scroll-fade.tsx'),
  source('apps/desktop/src/hooks/use-scroll-fade.ts'),
  source('apps/desktop/src/hooks/use-keyboard-shortcuts.ts'),
  source('apps/desktop/src/hooks/use-open-drop.ts'),
  source('apps/desktop/src/hooks/use-open-events.ts'),
  source('apps/desktop/src/hooks/use-menu-events.ts'),
  source('apps/desktop/src/components/window-title/index.tsx'),
  source('apps/desktop/src/lib/instance.ts'),
  source('apps/desktop/src/lib/browser-dev-documents.ts'),
  source('apps/desktop/vite.config.ts'),
  source('apps/desktop/src-tauri/src/preview/runtime_viewer.rs'),
  source('apps/desktop/src-tauri/src/preview/xyzrender.rs'),
  source('PreviewExtension/Platform/PreviewViewController.swift'),
  source('docs/keyboard-shortcuts.md'),
  source('apps/desktop/src/styles.css'),
  source('PreviewExtension/Web/grid.css'),
  source('PreviewExtension/Web/grid-viewer.js'),
  source('PreviewExtension/Web/viewer.js'),
  source('PreviewExtension/Web/viewer-shell.js'),
  source('PreviewExtension/Web/viewer-runtime.css'),
  source('apps/desktop/src/update.ts'),
  source('README.md'),
  source('PreviewExtension/Web/viewer-shell.js'),
  source('PreviewExtension/Web/viewer.js'),
]);

const sidebarSurface = [sidebar, sidebarFileBrowser, sidebarFileTreeNode, sidebarWorkspaceSwitcher].join('\n');
const editorTabDragStart = editorTabs.match(/onDragStart=\{\(event\) => \{[\s\S]*?\n                \}\}/)?.[0] ?? '';

assert.match(uiStore, /export const useUIStore = create<UIState>/);
assert.match(uiStore, /openCommandPalette:/);
assert.match(uiStore, /closeCommandPalette:/);
assert.match(uiStore, /commandPaletteSearch: ""/);

for (const exportName of [
  'useIsCommandPaletteOpen',
  'useCommandPaletteSearch',
  'useOpenCommandPalette',
  'useCloseCommandPalette',
  'useSetCommandPaletteSearch',
]) {
  assert.match(commandPaletteHook, new RegExp(`export function ${exportName}\\(`));
}

for (const exportName of [
  'useOpenTabs',
  'useOpenDocuments',
  'useTabOrder',
  'useTabCount',
  'useActiveTabId',
  'useActiveTab',
  'useActiveDocument',
  'useSetActiveTab',
  'useSetActiveDocument',
  'useCloseTab',
  'useCloseDocument',
  'useCloseActiveTab',
  'useCloseAllTabs',
  'useOpenNewTab',
  'useOpenSettingsTab',
  'useCanNavigateBack',
  'useCanNavigateForward',
  'useNavigateBack',
  'useNavigateForward',
  'useRestoreSession',
]) {
  assert.match(tabsHook, new RegExp(`export function ${exportName}\\(`));
}

assert.match(sidebarHook, /export function useSidebar\(/);
assert.match(sidebarHook, /from "\.\.\/stores\/shell-store"/);
assert.match(sidebarHook, /sidebarWidth/);
assert.match(shellStore, /sidebarWidth: 240/);
assert.match(sidebarHook, /projectsOpen/);
assert.match(sidebarHook, /projectRoots/);
assert.match(sidebarHook, /expandedProjectIds/);
assert.match(sidebarHook, /pinnedStructurePaths/);
assert.match(sidebarHook, /sidebarQuery/);
assert.match(sidebarHook, /toggleProjectsOpen/);
assert.match(sidebarHook, /setExpandedProjectIds/);
assert.match(sidebarHook, /addProjectRoot/);
assert.match(sidebarHook, /togglePinnedStructure/);
assert.match(sidebarHook, /setSidebarQuery/);
assert.match(sidebarHook, /toggleProjectExpanded/);
assert.match(viewerShell, /id="buret-open-in-app"/);
assert.match(viewer, /message: 'open-burrete'/);
assert.doesNotMatch(viewerShell, /data-buret-action="open-burrete"/);
assert.doesNotMatch(viewerShell, /data-buret-action="xyzrender-apply"/);
assert.match(viewerShell, /data-buret-action="xyzrender-reset"/);
assert.match(viewerShell, /<div class="buret-xyzrender-popover-title">xyzrender<\/div>/);
assert.match(viewerShell, /data-buret-xyzrender-crystal/);
assert.match(viewerShell, /Transparent/);
assert.match(viewerShell, /Gradients/);
assert.match(viewerShell, /Fog/);
assert.match(viewerShell, /VdW/);
assert.match(viewerShell, /Hide bonds/);
assert.match(viewerShell, /<summary>Appearance<\/summary>/);
assert.match(viewerShell, /data-buret-xyzrender-appearance/);
assert.doesNotMatch(viewerShell, /Custom JSON path/);
assert.doesNotMatch(viewerShell, /Additional CLI flags/);
assert.doesNotMatch(viewerShell, /Auto-applies/);
assert.doesNotMatch(viewerShell, /Main flags/);
assert.doesNotMatch(viewerShell, /Applies live to the current preview/);
assert.match(viewer, /scheduleXyzrenderControlsApply/);
assert.match(viewer, /requestXyzrenderControls\(toolbar\);/);
assert.match(viewer, /updateXyzrenderFormVisibility\(toolbar\);\s*scheduleXyzrenderControlsApply\(toolbar, 0\);/);
assert.match(viewer, /updateXyzrenderFormVisibility\(toolbar\);\s*scheduleXyzrenderControlsApply\(toolbar, 260\);/);
assert.match(viewer, /body\.documentId = String\(window\.BurreteConfig\.documentId\)/);
assert.match(viewer, /function bindXyzrenderControls\(toolbar\)/);
assert.match(viewer, /XYZRENDER_POPOVER_OPEN_KEY_PREFIX/);
assert.match(viewer, /function setXyzrenderPopoverVisibility\(toolbar, open, options = \{\}\)/);
assert.match(viewer, /toolbar\?\.classList\.toggle\('buret-popover-open', open\)/);
assert.match(viewer, /function shouldRestoreXyzrenderPopoverOpen\(\)/);
assert.match(viewer, /function shouldOpenXyzrenderPopoverByDefault\(config\)/);
assert.match(viewer, /function syncXyzrenderSliders\(toolbar\)/);
assert.match(viewer, /function requestBrowserDevXyzrenderUpdate\(options = \{\}\)/);
assert.match(viewer, /fetch\(endpoint, \{/);
assert.match(viewer, /function updateBrowserDevXyzrenderArtifact\(payload, requestedControls, requestedPreset\)/);
assert.match(viewer, /data-buret-xctrl-slider/);
assert.match(viewer, /setXyzrenderPopoverOpenPersisted\(open\)/);
assert.match(viewer, /setXyzrenderPopoverVisibility\(toolbar, hidden, \{ resetScroll: hidden \}\)/);
assert.match(viewer, /setXyzrenderPopoverVisibility\(toolbar, false\)/);
assert.match(viewer, /if \(event\.target\.closest\('\[data-buret-xyzrender-popover\]'\)\) return;/);
assert.match(viewer, /field\.value = value === true \? 'on' : value === false \? 'off' : value == null \? '' : String\(value\);/);
assert.doesNotMatch(viewer, /function syncToolbarViewport/);
assert.match(previewRuntimeCss, /#buret-toolbar\[data-active-renderer="xyzrender-external"\] \[data-buret-toggle="left"\],/);
assert.match(previewRuntimeCss, /#buret-toolbar\[data-active-renderer="xyzrender-external"\] \[data-buret-toggle="log"\] \{\s*display: none;/);
assert.match(previewRuntimeCss, /\.buret-slider-row/);
assert.match(previewRuntimeCss, /\.buret-slider\[data-auto\]/);
assert.match(previewShell, /data-buret-xyzrender-field/);
assert.match(previewShell, /min="0\.01" max="2" step="0\.01" value="0\.3" data-buret-xctrl-slider="fieldIso"/);
assert.match(previewShell, /data-buret-xctrl-slider="fieldIso"/);
assert.match(previewShell, /data-buret-xctrl-slider="fieldOpacity"/);
assert.match(previewShell, /data-buret-xctrl-slider="fieldCmapMin"/);
assert.match(previewShell, /data-buret-xctrl-slider="fieldCmapMax"/);
assert.match(previewShell, /data-buret-xctrl="fieldMode"/);
assert.match(previewShell, /data-buret-xctrl="fieldIso"/);
assert.match(previewShell, /data-buret-xctrl="fieldOpacity"/);
assert.match(previewShell, /data-buret-xctrl="fieldSurfaceStyle"/);
assert.match(previewShell, /data-buret-xctrl="fieldMoPositiveColor"/);
assert.match(previewShell, /data-buret-xctrl="fieldMoNegativeColor"/);
assert.match(previewShell, /data-buret-xctrl="fieldDensityColor"/);
assert.match(previewShell, /data-buret-xctrl="fieldCmapPalette"/);
assert.match(previewShell, /data-buret-xctrl="fieldCmapMin"/);
assert.match(previewShell, /data-buret-xctrl="fieldCmapMax"/);
assert.match(browserDevDocuments, /return normalized === "molstar" && externalMolstarAvailable \? "molstar" : "xyzrender-external";/);
assert.match(browserDevDocuments, /requestedRenderer: normalizeRendererMode\(preferences\.rendererMode\)/);
assert.match(browserDevDocuments, /sourcePath: path/);
assert.match(browserDevDocuments, /xyzrenderEndpoint: "\/__burette\/xyzrender"/);
assert.match(browserDevDocuments, /const shouldOpenXyzTrajectoryInMolstar = xyzFrameCount > 1 && \(requestedMode === "auto" \|\| requestedMode === "xyz-fast"\);/);
assert.match(browserDevDocuments, /function countXyzFrames\(text: string\)/);
assert.match(viteConfig, /return Number\.isFinite\(number\) && number > 0 \? number : null;/);
assert.match(viteConfig, /join\(homedir\(\), "Desktop", "BurettePreviewSamples"\)/);
assert.match(viteConfig, /join\(homedir\(\), "Desktop", "xyzrender-main"\)/);
assert.match(viteConfig, /join\(repoRoot, "samples", "large", "litr_moses_10k\.csv"\)/);
assert.match(viteConfig, /server\.middlewares\.use\("\/__burette\/dev-files"/);
assert.match(viteConfig, /server\.middlewares\.use\("\/__burette\/read-file"/);
assert.match(viteConfig, /function isDevFileReadAllowed\(path: string\)/);
assert.match(viteConfig, /async function collectDefaultDevFiles\(\)/);
assert.match(viteConfig, /if \(path\.endsWith\("\/no-molecule-column\.csv"\)\) return;/);
assert.match(viteConfig, /function normalizeXyzrenderInputExtension\(value: string \| null\)/);
assert.match(viteConfig, /const convertedInputPath = join\(tempDirectory, `xyzrender-input\.\$\{inputExtension\}`\);/);
assert.match(previewViewController, /Set\(\["-o", "--output", "-go", "--gif-output", "--config", "--ref"\]\)/);
assert.match(previewXyzrender, /config_argument: resolved_config_argument/);
assert.match(viewer, /left: 'hidden'/);
assert.match(viewer, /let collapsed = false;/);
assert.match(viewer, /function defaultToolbarTop\(\)/);
assert.match(sidebarHook, /toggleSidebar/);
assert.match(shellStore, /export const useShellStore = create<ShellState>/);
assert.match(shellStore, /name: "burrete\.shell\.ui"/);
assert.match(shellStore, /projectsOpen: true/);
assert.match(shellStore, /projectRoots: \[\]/);
assert.match(shellStore, /expandedProjectIds: \[\]/);
assert.match(shellStore, /pinnedStructurePaths: \[\]/);
assert.match(shellStore, /sidebarQuery: ""/);
assert.match(shellStore, /toggleProjectsOpen:/);
assert.match(shellStore, /setExpandedProjectIds:/);
assert.match(shellStore, /addProjectRoot:/);
assert.match(shellStore, /togglePinnedStructure:/);
assert.match(shellStore, /setSidebarQuery:/);
assert.match(shellStore, /toggleProjectExpanded:/);
assert.match(packageJson, /"@hugeicons\/core-free-icons"/);
assert.match(packageJson, /"@hugeicons\/react"/);

assert.match(moleculeStore, /export const useMoleculeStore = create<MoleculeState>/);
assert.match(moleculeStore, /documents: \[\]/);
assert.match(moleculeStore, /tabs: \[createLauncherTab\(\)\]/);
assert.match(moleculeStore, /export type MoleculeTab/);
assert.match(moleculeStore, /export type SessionTab/);
assert.match(moleculeStore, /createFileTab/);
assert.match(moleculeStore, /createSettingsTab/);
assert.match(moleculeStore, /syncTabSequence/);
assert.match(moleculeStore, /dedupeTabIds/);
assert.match(moleculeStore, /navigateBack:/);
assert.match(moleculeStore, /navigateForward:/);
assert.match(moleculeStore, /restoreSession:/);
assert.match(moleculeStore, /getMoleculeSessionSnapshot/);
assert.match(moleculeStore, /activeDocumentId: null/);
assert.match(moleculeStore, /recentStructures: \[\]/);
assert.match(moleculeStore, /rememberRecentStructures:/);
assert.match(moleculeStore, /clearRecentStructures:/);
assert.match(moleculeStore, /name: "burrete\.molecule\.session"/);
assert.match(moleculeStore, /function shouldIgnorePersistedSession\(\)/);
assert.match(moleculeStore, /window\.location\.hostname === "127\.0\.0\.1" \|\| window\.location\.hostname === "localhost"/);
assert.match(moleculeStore, /function devFilesPersistedSession\(recentStructures: RecentStructure\[\]\): PersistedMoleculeState/);
assert.match(moleculeStore, /partialize: \(state\) => shouldIgnorePersistedSession\(\)\s*\?\s*devFilesPersistedSession\(state\.recentStructures\)/);
assert.match(app, /async function browserDevFilesFromLocation\(\)/);
assert.match(app, /if \(params\.has\("devDocking"\)\) return \[\];/);
assert.match(app, /params\.has\("devFiles"\)/);
assert.match(app, /fetch\("\/__burette\/dev-files", \{ cache: "no-store" \}\)/);
assert.match(app, /function splitDevFiles\(rawFiles: string\)/);
assert.match(app, /function browserDevDockingFromLocation\(\): DockingDocumentRequest \| null/);
assert.match(app, /params\.has\("devDocking"\)/);
assert.match(app, /openDocuments\(paths, undefined, undefined, \{ replace: true \}\)/);
assert.match(tabsHook, /from "\.\.\/stores\/molecule-store"/);
assert.match(tabsHook, /getSessionSnapshot/);
assert.match(tabsHook, /restoreSession/);
assert.match(tabsHook, /export function useRecentStructures\(/);
assert.match(tabsHook, /export function useRememberRecentStructures\(/);
assert.match(tabsHook, /export function useClearRecentStructures\(/);
assert.doesNotMatch(tabsHook, /useAppStore/);

assert.match(settingsStore, /export const useSettingsStore = create<SettingsState>/);
assert.match(settingsStore, /name: "burrete\.shell"/);
assert.match(settingsStore, /preferences: defaultPreferences/);
assert.match(settingsHook, /useViewerPreferences/);
assert.match(settingsHook, /useSetViewerPreference/);
assert.doesNotMatch(shellStore, /preferences:/);
assert.doesNotMatch(shellStore, /setPreference:/);

assert.match(app, /from "\.\/hooks\/use-command-palette"/);
assert.match(app, /from "\.\/hooks\/use-tabs"/);
assert.match(app, /from "\.\/hooks\/use-settings"/);
assert.match(app, /useState<StatusNotice \| null>\(null\)/);
assert.match(app, /const pushStatus = useCallback/);
assert.match(app, /const pushErrorStatus = useCallback/);
assert.doesNotMatch(app, /setCommandPaletteOpen/);
assert.doesNotMatch(app, /useState\(false\).*commandPalette/i);
assert.match(app, /refreshedPersistedSessionRef/);
assert.match(app, /syncingBrowserDevFilesRef/);
assert.match(app, /openedBrowserDevDockingRef/);
assert.match(app, /browserDevRuntimeNeedsRefresh/);
assert.match(app, /buildSidebarProjects/);
assert.match(app, /pinnedStructurePaths,/);
assert.match(app, /sidebarProjects/);
assert.match(app, /isTauriRuntime\(\) \|\| documents\.length === 0/);
assert.match(app, /void openDocuments\(paths\)/);
assert.match(appLayout, /from "\.\/editor-area"/);
assert.match(appLayout, /from "\.\/editor-area\/editor-tabs"/);
assert.match(appLayout, /from "\.\/sidebar"/);
assert.match(appLayout, /SidebarLeftIcon/);
assert.match(appLayout, /HugeiconsIcon/);
assert.match(appLayout, /onDismissStatus: \(\) => void;/);
assert.match(appLayout, /<StatusSurface status=\{state\.status\} onDismiss=\{onDismissStatus\} \/>/);
assert.match(appLayout, /className="status-surface"/);
assert.match(appLayout, /aria-live=\{status\.kind === "error" \? "assertive" : "polite"\}/);
assert.match(appLayout, /compactStatusMessage/);
assert.match(appLayout, /const sidebarLayoutWidth = state\.sidebarOpen \? sidebarWidth : 0/);
assert.match(appLayout, /const tabChromeLeft = state\.sidebarOpen \? sidebarLayoutWidth \+ 12 : 132/);
assert.match(appLayout, /className="sidebar-shell"/);
assert.match(appLayout, /<Sidebar state=\{layoutState\} actions=\{actions\} open=\{state\.sidebarOpen\} \/>/);
assert.doesNotMatch(appLayout, /state\.sidebarOpen && <Sidebar/);
assert.doesNotMatch(appLayout, /state\.sidebarOpen && <div className="splitter"/);
assert.doesNotMatch(appLayout, /instance-badge/);
assert.doesNotMatch(appLayout, /statusbar/);
assert.doesNotMatch(appLayout, /chrome-text-button/);
assert.match(main, /from "\.\/components\/error-boundary"/);
assert.match(main, /<ErrorBoundary>/);
assert.match(editorArea, /from "\.\/page-kinds"/);
assert.match(editorArea, /state\.tabs\.length > 0/);
assert.match(editorArea, /state\.tabs/);
assert.match(editorArea, /state\.activeTabId \?\? state\.activeTab\?\.id/);
assert.match(editorArea, /activeTabIndex/);
assert.match(editorArea, /kind\.keepAlive/);
assert.match(editorArea, /kind\.Component/);
assert.match(editorArea, /className="page-stack"/);
assert.match(editorArea, /className="page-surface"/);
assert.match(editorArea, /data-page-kind=\{kind\.kind\}/);
assert.match(editorArea, /kind: "launcher"/);
assert.doesNotMatch(editorArea, /function WelcomePanel/);
assert.match(editorTabs, /New tab/);
assert.match(editorTabs, /state\.tabs\.map/);
assert.match(editorTabs, /activeTabIndex/);
assert.match(editorTabs, /pageKind\(tab\.location\)/);
assert.match(editorTabs, /actions\.selectTab\(tab\.id\)/);
assert.match(editorTabs, /actions\.closeTab\(tab\.id\)/);
assert.match(editorTabs, /actions\.openNewTab/);
assert.match(editorTabs, /\+/);
assert.match(editorTabs, /×/);
assert.match(appLayout, /className="chrome-leading-controls"/);
assert.match(editorTabs, /actions\.navigateBack/);
assert.match(editorTabs, /actions\.navigateForward/);
assert.match(editorTabs, /actions\.canNavigateBack/);
assert.match(editorTabs, /actions\.canNavigateForward/);
assert.match(editorTabs, /←/);
assert.match(editorTabs, /→/);
assert.doesNotMatch(appLayout, /<header\s+className="topbar"[^>]*data-tauri-drag-region/s);
assert.match(editorTabs, /className="tab-strip" data-tauri-drag-region/);
assert.match(editorTabs, /className="tab-scroll-region" role="tablist" aria-label="Open structures"/);
assert.match(editorTabs, /className="tab-strip-spacer" data-tauri-drag-region/);
assert.match(pageKinds, /const kinds = \[fileKind, launcherKind, settingsKind\] as const/);
assert.match(pageKinds, /export function pageKind/);
assert.match(pageKinds, /export function serializeLocation/);
assert.match(pageKinds, /export function deserializeLocation/);
assert.match(pageKindTypes, /export interface PageKindInput/);
assert.match(pageKindTypes, /export function definePageKind/);
assert.match(fileKind, /export const fileKind = definePageKind/);
assert.match(fileKind, /keepAlive: false/);
assert.match(fileKind, /kind: "file"/);
assert.match(fileKind, /path: location\.path/);
assert.match(fileKind, /className="molecule-stage"/);
assert.match(fileKind, /className="viewer-iframe"/);
assert.match(fileKind, /data-document-id=\{document\.id\}/);
assert.match(fileKind, /const sandbox = tauriRuntime \? "allow-scripts allow-downloads" : "allow-scripts allow-downloads allow-same-origin"/);
assert.match(fileKind, /srcDoc=\{document\.runtimePath\}/);
assert.doesNotMatch(fileKind, /frameDocument\.write\(document\.runtimePath\)/);
assert.doesNotMatch(fileKind, /EditorScrollContainer|editor-progressive-blur/);
assert.match(browserDevDocuments, /window\.parent\.postMessage\(\{ source: 'burrete-viewer', body \}, '\*'\)/);
assert.doesNotMatch(browserDevDocuments, /window\.parent\.postMessage\(\{ source: 'burrete-viewer', body \}, window\.location\.origin\)/);
assert.match(gridViewer, /function resolveTheme\(value\)/);
assert.match(gridViewer, /function normalizeCanvasBackground\(value\)/);
assert.match(gridViewer, /function resolveCanvasBackground\(theme, value\)/);
assert.match(gridViewer, /style\.setProperty\('--buret-grid-canvas-background', canvasBackgroundCSS\(canvasBackground\)\)/);
assert.match(gridViewer, /prefers-color-scheme: light/);
assert.match(gridViewer, /if \(background === 'auto'\) return theme === 'light' \? 'white' : 'graphite';/);
assert.match(gridCss, /--buret-picture-bg: #ffffff;/);
assert.doesNotMatch(gridCss, /--buret-picture-bg: #(f6f5f2|fbfbfb);/);
assert.match(gridCss, /\.buret-molecule-picture \{[^}]*background: var\(--buret-picture-bg\);/s);
assert.match(gridCss, /\.buret-molecule-picture \{[^}]*box-sizing: border-box;/s);
assert.match(gridCss, /\.buret-molecule-picture \{[^}]*min-width: 0;/s);
assert.doesNotMatch(gridCss, /\.buret-molecule-picture \{[^}]*linear-gradient/s);
assert.match(gridCss, /\.buret-grid-toolbar \{[^}]*position: relative;/s);
assert.doesNotMatch(gridCss, /\.buret-grid-toolbar \{[^}]*position: sticky;/s);
assert.doesNotMatch(gridCss, /\.buret-grid-toolbar \{[^}]*backdrop-filter/s);
assert.match(styles, /\.app-shell\[data-runtime="browser"\]\s*\{[^}]*backdrop-filter: none;[^}]*-webkit-backdrop-filter: none;/s);
assert.match(styles, /\.molecule-stage\s*\{[^}]*inset: var\(--chrome-height\) 0 0;[^}]*overflow: hidden;/s);
assert.doesNotMatch(styles, /\.molecule-stage\s*\{[^}]*backdrop-filter/s);
assert.doesNotMatch(styles, /\.viewer-iframe\s*\{[^}]*filter:/s);
assert.match(gridViewer, /function installThemeListener\(cfg\)/);
assert.match(gridViewer, /async function loadWasmBinary\(path\)/);
assert.match(gridViewer, /fetch\(String\(path\)\)/);
assert.match(gridViewer, /new Uint8Array\(await response\.arrayBuffer\(\)\)/);
assert.doesNotMatch(gridViewer, /const theme = cfg\.theme === 'light' \? 'light' : 'dark'/);
assert.match(styles, /\.molecule-stage/);
assert.match(styles, /inset: var\(--chrome-height\) 0 0/);
assert.match(styles, /--accent: #af52de/);
assert.match(styles, /--chrome-drag-height: 72px/);
assert.match(styles, /\.app-shell\[data-theme="light"\] \{[^}]*--bg-base: #ffffff;[^}]*--fg-base: #0d0d0d;[^}]*--surface-card: transparent;/s);
assert.match(styles, /@media \(prefers-color-scheme: light\) \{[\s\S]*\.app-shell\[data-theme="auto"\] \{[^}]*--bg-base: #ffffff;[^}]*--surface-card: transparent;/);
assert.match(styles, /\*\[data-tauri-drag-region\] \{[^}]*app-region: drag;[^}]*-webkit-app-region: drag;[^}]*\}/s);
assert.match(styles, /button, select, input, textarea, \.tab, \.new-tab, \.chrome-button, \.tab-history-button, \.sidebar-search-row, \.sidebar-section-title-button, \.sidebar-section-menu-button, \.project-group-row, \.project, \.pin-hit, \.splitter \{[^}]*app-region: no-drag;[^}]*-webkit-app-region: no-drag;[^}]*\}/s);
assert.match(styles, /\.drag-region \{[^}]*height: var\(--chrome-drag-height\);[^}]*z-index: 2/s);
assert.match(styles, /\.main-stage \{[^}]*overflow: hidden/s);
assert.match(styles, /\.app-shell\[data-theme="auto"\] \{[^}]*color-scheme: light dark/s);
assert.match(styles, /@media \(prefers-color-scheme: light\) \{[\s\S]*\.app-shell\[data-theme="auto"\]/);
assert.match(styles, /@media \(prefers-color-scheme: dark\) \{[\s\S]*\.app-shell\[data-theme="auto"\]/);
assert.match(styles, /\.status-surface \{/);
assert.match(styles, /\.status-surface\[data-kind="error"\] \{/);
assert.match(styles, /\.status-surface-copy p \{[^}]*max-height: calc\(1\.35em \* 2\)/s);
assert.match(styles, /\.status-surface-dismiss \{/);
assert.match(styles, /\.sidebar-product:hover/);
assert.match(styles, /\.sidebar-section-title-button/);
assert.match(styles, /\.sidebar-section-menu-button/);
assert.match(styles, /\.pinned-structures/);
assert.match(styles, /\.project-actions/);
assert.match(styles, /\.pin-hit/);
assert.match(styles, /\.tab-scroll-region \{[^}]*width: max-content;[^}]*flex: 0 1 auto/s);
assert.match(styles, /\.tab-strip-spacer \{[^}]*min-width: 0;[^}]*flex: 1 1 28px/s);
assert.match(styles, /\.tab-shell \{[^}]*position: relative/s);
assert.match(styles, /\.tab:hover \{[^}]*backdrop-filter: blur\(40px\)/);
assert.match(styles, /\.tab\.active \{[^}]*backdrop-filter: blur\(40px\)/);
assert.match(styles, /\.tab-close \{[^}]*transform: translate\(100%, -50%\);/s);
assert.match(styles, /\.tab-shell:hover \.tab-close/);
assert.match(styles, /\.tab-shell:focus-within \.tab-close \{[^}]*transform: translate\(0, -50%\);/s);
assert.match(styles, /\.tab-close:hover \{ color: var\(--text-secondary\); \}/);
assert.match(styles, /\.topbar, \.chrome-leading-controls, \.sidebar-toggle-root, \.tab-strip/);
assert.match(styles, /\.chrome-leading-controls \{/);
assert.doesNotMatch(styles, /instance-badge/);
assert.doesNotMatch(styles, /sidebar-link/);
assert.match(launcherKind, /export const launcherKind = definePageKind/);
assert.match(launcherKind, /<WelcomeScreen actions=\{actions\} \/>/);
assert.match(settingsKind, /export const settingsKind = definePageKind/);
assert.match(settingsKind, /<SettingsPanel state=\{state\} actions=\{actions\} \/>/);
assert.match(welcome, /export function WelcomeScreen/);
assert.match(welcome, /new-tab-copy/);
assert.match(welcome, /Burrete Desktop/);
assert.match(welcome, /Open a molecular structure/);
assert.match(welcome, /Open Structure/);
assert.match(welcome, /Command Palette/);
assert.match(welcome, /Settings/);
assert.doesNotMatch(welcome, /Open molecular structures/);
assert.match(errorBoundary, /export class ErrorBoundary/);
assert.match(errorBoundary, /\[ErrorBoundary\]/);
assert.match(errorBoundary, /handleRetry/);
assert.match(scrollFade, /export function ScrollFade/);
assert.match(scrollFade, /useScrollFade/);
assert.match(scrollFadeHook, /export function useScrollFade/);
assert.match(sidebar, /from "\.\/file-browser"/);
assert.match(sidebar, /from "\.\/workspace-switcher"/);
assert.match(sidebarSurface, /from "\.\.\/scroll-fade"/);
assert.match(sidebarSurface, /filterSidebarProjects/);
assert.match(sidebarSurface, /<ScrollFade className="sidebar-scroll">/);
assert.match(sidebarSurface, /Projects/);
assert.match(sidebarSurface, /Pinned/);
assert.match(sidebarSurface, /pinnedItems/);
assert.match(sidebarSurface, /state\.projectsOpen/);
assert.match(sidebarSurface, /actions\.toggleProjectsOpen/);
assert.match(sidebarSurface, /actions\.setExpandedProjectIds/);
assert.match(sidebarSurface, /actions\.openRecentStructure/);
assert.match(sidebarSurface, /Search01Icon/);
assert.match(sidebarSurface, /actions\.openCommandPalette/);
assert.match(sidebarSurface, /File02Icon/);
assert.doesNotMatch(sidebarSurface, /Cancel01Icon/);
assert.match(sidebarSurface, /Search projects and structures/);
assert.doesNotMatch(sidebarSurface, /sidebar-search-input/);
assert.doesNotMatch(sidebarSurface, /type="text"/);
assert.match(sidebarSurface, /ProjectGroup/);
assert.match(sidebarSurface, /ProjectItem/);
assert.match(sidebarSurface, /project-group-row/);
assert.match(sidebarSurface, /state\.expandedProjectIds\.includes\(project\.id\)/);
assert.match(sidebarSurface, /actions\.togglePinnedStructure\(item\.path\)/);
assert.match(sidebarSurface, /Pin structure/);
assert.match(sidebarSurface, /Unpin structure/);
assert.doesNotMatch(sidebarSurface, /projectCount/);
assert.doesNotMatch(sidebarSurface, /\|\| project\.isActive/);
assert.match(sidebarProjects, /function compareProjectItems\(left: SidebarProjectItem, right: SidebarProjectItem\) \{\s*if \(left\.isPinned !== right\.isPinned\) return left\.isPinned \? -1 : 1;\s*return left\.relativePath\.localeCompare\(right\.relativePath\);\s*\}/);
assert.match(sidebarProjects, /function compareProjects\(left: SidebarProject, right: SidebarProject\) \{\s*return left\.title\.localeCompare\(right\.title\);\s*\}/);
assert.doesNotMatch(sidebarProjects, /left\.isActive !== right\.isActive/);
assert.doesNotMatch(sidebarProjects, /left\.isOpen !== right\.isOpen/);
assert.doesNotMatch(sidebarProjects, /left\.openedAt !== right\.openedAt/);
assert.match(sidebarSurface, /onContextMenu=\{handleContextMenu\}/);
assert.match(sidebarSurface, /id: "open-project-folder"/);
assert.match(sidebarSurface, /Open Project Folder/);
assert.match(sidebarSurface, /actions\.openProjectFolder\(project\.rootPath\)/);
assert.match(sidebarSurface, /project-children/);
assert.doesNotMatch(sidebarSurface, /project-source-badge/);
assert.doesNotMatch(sidebarSurface, /project-open-folder/);
assert.doesNotMatch(sidebarSurface, /project-group-count/);
assert.match(sidebarSurface, /Open Active Project Folder/);
assert.match(sidebarSurface, /fillRule="evenodd"/);
assert.match(sidebarSurface, /from "\.\.\/\.\.\/lib\/instance"/);
assert.match(sidebarSurface, /appInstanceLabel/);
assert.match(sidebarSurface, /className="sidebar-product"/);
assert.match(sidebarSurface, /showNativeContextMenu/);
assert.match(sidebarSurface, /Project options/);
assert.match(sidebarSurface, /Expand All Project Folders/);
assert.match(sidebarSurface, /Collapse All Project Folders/);
assert.match(nativeContextMenu, /export async function showNativeContextMenu/);
assert.match(nativeContextMenu, /showWebContextMenu\(spec, at\)/);
assert.match(nativeContextMenu, /\.native-context-menu/);
assert.match(nativeContextMenu, /@tauri-apps\/api\/menu\/menu/);
assert.match(nativeContextMenu, /@tauri-apps\/api\/menu\/menuItem/);
assert.match(nativeContextMenu, /@tauri-apps\/api\/menu\/predefinedMenuItem/);
assert.match(styles, /\.native-context-menu \{/);
assert.match(styles, /\.native-context-menu-item/);
assert.match(styles, /\.native-context-menu-separator/);
assert.doesNotMatch(sidebarSurface, /sidebar-workspace-menu/);
assert.match(sidebarSurface, /workspaceButtonRef/);
assert.doesNotMatch(sidebarSurface, /workspaceMenuPosition/);
assert.match(sidebar, /data-open=\{open \? "true" : "false"\}/);
assert.match(sidebar, /inert=\{!open\}/);
assert.doesNotMatch(styles, /\.sidebar-workspace-menu/);
assert.doesNotMatch(styles, /--workspace-menu-left/);
assert.doesNotMatch(styles, /--workspace-menu-top/);
assert.doesNotMatch(styles, /--workspace-menu-max-height/);
assert.match(styles, /\.topbar \{[^}]*transition: left 140ms ease-out/s);
assert.match(styles, /\.sidebar-shell \{[^}]*transition: width 140ms ease-out/s);
assert.match(styles, /\.sidebar \{[^}]*transition: transform 140ms ease-out, opacity 140ms ease-out/s);
assert.match(styles, /\.sidebar\[data-open="false"\] \{[^}]*transform: translateX\(-18px\);[^}]*opacity: 0;[^}]*pointer-events: none;/s);
assert.match(styles, /\.splitter\[data-open="false"\] \{ pointer-events: none; \}/);
assert.match(sidebarSurface, /Add Project Folder\.\.\./);
assert.match(sidebarSurface, /Open Active Project Folder/);
assert.doesNotMatch(sidebarSurface, /actions\.openSettings/);
assert.doesNotMatch(sidebarSurface, /Open preferences/);
assert.match(app, /openPath/);
assert.match(app, /chooseWorkspace/);
assert.match(app, /openWorkspaceFolder/);
assert.match(app, /openProjectFolder/);
assert.match(app, /setSidebarQuery/);
assert.match(app, /toggleProjectExpanded/);
assert.doesNotMatch(sidebarSurface, /SidebarUtility/);
assert.doesNotMatch(sidebarSurface, /Quick Look/);
assert.doesNotMatch(sidebarSurface, /actions\.resetQuickLook\(\)/);
assert.doesNotMatch(sidebarSurface, /sidebar-title/);
assert.doesNotMatch(sidebarSurface, /Open Structures/);
assert.doesNotMatch(appLayout + sidebar + editorTabs, /◧|◨/);
assert.match(settingsPanel, /<h1>Preferences<\/h1>/);
assert.match(settingsPanel, /className="settings-panel"/);
assert.match(settingsPanel, /className="settings-panel-scroll"/);
assert.doesNotMatch(settingsPanel, /EditorScrollContainer/);
assert.match(editorScrollContainer, /WebkitMaskComposite:\s*"source-over"/);
assert.match(editorScrollContainer, /maskComposite:\s*"add"/);
assert.match(styles, /\.settings-panel \{[^}]*padding-top: calc\(var\(--chrome-height\) \+ 20px\)/s);
assert.match(styles, /\.settings-panel-scroll \{[^}]*overflow-y: auto/s);
assert.match(settingsPanel, /title="Display"/);
assert.match(settingsPanel, /title="Structure Rendering"/);
assert.match(settingsPanel, /title="System"/);
assert.match(settingsPanel, /from "\.\/setting-control"/);
assert.match(settingsPanel, /SettingsSection/);
assert.match(settingsPanel, /ToggleControl/);
assert.match(settingsPanel, /from "\.\/themes-section"/);
assert.match(settingsPanel, /<ThemesSection preferences=\{preferences\} actions=\{actions\} \/>/);
assert.doesNotMatch(settingsPanel, /function ThemeCard/);
assert.match(themesSection, /export function ThemesSection/);
assert.match(themesSection, /<ThemeCard mode="light" preferences=\{preferences\} actions=\{actions\} \/>/);
assert.match(themesSection, /<ThemeCard mode="dark" preferences=\{preferences\} actions=\{actions\} \/>/);
assert.match(themesSection, /SettingsSection/);
assert.match(themesSection, /title=\{title\}/);
assert.match(themesSection, /Primary action and selection color\./);
assert.match(themesSection, /Window opacity mapping used by Writer-style glass\./);
assert.match(settingsPanel, /const defaultRendererModeOptions: Array<ViewerPreferences\["rendererMode"\]> = \["auto", "molstar", "xyzrender-external"\]/);
assert.doesNotMatch(settingsPanel, /function visibleRendererModeOptions\(current: ViewerPreferences\["rendererMode"\]\)/);
assert.match(settingsPanel, /preferenceRow<"molstarStyle">\("Mol\* style", "Default appearance preset for the Mol\* renderer\.", preferences\.molstarStyle, \["default", "illustrative"\], defaultPreferences\.molstarStyle, \(molstarStyle\) => actions\.setPreference\("molstarStyle", molstarStyle\)\)/);
assert.match(settingControl, /export function SettingsSection/);
assert.match(settingControl, /export function ToggleControl/);
assert.match(settingControl, /role="switch"/);
assert.match(settingControl, /aria-label=\{label\}/);
assert.match(settingControl, /export function SettingsActionButton/);
assert.match(styles, /\.settings-toggle/);
assert.match(styles, /\.settings-select/);
assert.match(styles, /\.settings-panel-content \{[^}]*margin: 0 auto[^}]*padding: 32px 32px 96px/s);
assert.match(styles, /\.page-surface\[data-page-kind="settings"\] \{[^}]*overflow: hidden/s);
assert.match(styles, /\.page-surface:not\(\[data-active\]\) \{[^}]*display: none/s);
assert.match(styles, /\.editor-progressive-blur/);
assert.match(commandPalette, /group: "Projects"/);
assert.match(commandPalette, /Clear Recent Structures/);
assert.match(commandPalette, /group: "Suggested"/);
assert.doesNotMatch(commandPalette, /renderer-xyz-fast/);
assert.match(commandPalette, /group: "Renderer"/);
assert.match(commandPalette, /className="command-palette-group"/);
assert.match(commandPalette, /command-palette-group-heading/);
assert.match(commandPalette, /ArrowDown/);
assert.match(commandPalette, /ArrowUp/);
assert.match(commandPalette, /aria-selected=\{index === selectedIndex\}/);
assert.match(app, /useOpenDrop\(openDocuments, pushStatus, \{/);
assert.match(app, /activeDocumentPath: activeDocument\?\.path \?\? null/);
assert.match(app, /openDockingDocument,/);
assert.match(app, /existingDockingRequest = documents\.find/);
assert.match(app, /dockingRequestForDrop\(targetPath, droppedPaths, existingDockingRequest\)/);
assert.match(app, /useOpenEvents\(openDocuments, pushErrorStatus\)/);
assert.match(app, /useMenuEvents\(\{ chooseFiles, openSettings, checkForUpdates \}\)/);
assert.match(app, /invoke\("sync_viewer_preferences", \{ preferences \}\)/);
assert.match(app, /await invoke<string\[]>\("pick_open_targets"\)/);
assert.match(app, /<WindowTitle activeDocument=\{activeDocument\} \/>/);
assert.match(app, /const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions \| null>\(null\)/);
assert.match(app, /const pendingViewerReloadDocumentIdRef = useRef<string \| null>\(null\)/);
assert.match(app, /const xyzrenderOrientationRefRef = useRef<string \| null>\(null\)/);
assert.match(app, /const skipNextPreferenceRefreshRef = useRef\(false\)/);
assert.match(app, /body\?\.type === "error"/);
assert.match(app, /summarizeErrors\(result\.errors\)/);
assert.match(app, /if \(body\?\.type === "setXyzrenderOrientation"\)/);
assert.match(app, /if \(body\?\.type === "setXyzrenderPreset"\)/);
assert.match(app, /pendingViewerReloadDocumentIdRef\.current = body\.documentId \?\? null/);
assert.match(app, /xyzrenderPreset: body\.value \?\? null/);
assert.match(app, /const reloadOptions = renderer === "xyzrender-external"\s*\?\s*\{\s*xyzrenderOrientationRef: body\.orientationRef \?\? xyzrenderOrientationRefRef\.current,\s*xyzrenderPreset: body\.preset \?\? pendingViewerReloadOptionsRef\.current\?\.xyzrenderPreset \?\? null,\s*xyzrenderControls: body\.controls \?\? pendingViewerReloadOptionsRef\.current\?\.xyzrenderControls \?\? null,/s);
assert.match(app, /const targetDocument = \(body\.documentId/);
assert.match(app, /pendingViewerReloadDocumentIdRef\.current = renderer === "xyzrender-external"/);
assert.match(app, /skipNextPreferenceRefreshRef\.current = true/);
assert.match(app, /setPreference\("rendererMode", renderer\)/);
assert.match(app, /void openDocuments\(\[targetDocument\.path\], reloadOptions, \{ rendererMode: renderer \}\)/);
assert.match(app, /body\?\.type === "openSdfPoseDocument"/);
assert.match(app, /isProteinLikeDockingSource\(document\.path\)/);
assert.match(app, /pushStatus\("Opening SDF poses in Mol\* docking view\.\.\."\)/);
assert.match(app, /void openDockingDocument\(receptorDocument\.path, \[targetDocument\.path\]\)/);
assert.match(app, /pushStatus\("Opening SDF poses in Mol\*\.\.\."\)/);
assert.match(app, /void openDocuments\(\[targetDocument\.path\], \{\}, \{ rendererMode: "molstar" \}\)/);
assert.match(app, /body\?\.type === "openSdfGridDocument"/);
assert.match(app, /const targetPath = typeof body\.path === "string" && body\.path\.trim\(\)\.length > 0/);
assert.match(app, /pushStatus\("Opening SDF grid\.\.\."\)/);
assert.match(app, /void openDocuments\(\[targetPath\], undefined, \{ rendererMode: "auto" \}\)/);
assert.match(app, /const targetDocument = \(pendingViewerReloadDocumentIdRef\.current/);
assert.match(app, /const reloadOptions = pendingViewerReloadOptionsRef\.current \?\? undefined/);
assert.match(app, /await openDocuments\(\[targetDocument\.path\], reloadOptions\)/);
assert.match(openDropHook, /export function useOpenDrop/);
assert.match(openDropHook, /from "\.\.\/lib\/docking-documents"/);
assert.match(openDropHook, /from "\.\.\/lib\/structure-drag"/);
assert.match(openDropHook, /activeDocumentPath\?: string \| null/);
assert.match(openDropHook, /openDockingDocument\?: OpenDockingDocument/);
assert.match(openDropHook, /const openAsDocking = useCallback/);
assert.match(openDropHook, /const ligandPaths = ligandDropPathsForTarget\(activeDocumentPath, paths\)/);
assert.match(openDropHook, /document\.elementFromPoint\(position\.x \/ window\.devicePixelRatio, position\.y \/ window\.devicePixelRatio\)/);
assert.match(openDropHook, /element\?\.closest\("\.molecule-stage, \.main-stage"\)/);
assert.match(openDropHook, /isOverActiveViewer\(event\.position\) && openAsDocking\(event\.paths\)/);
assert.match(openDropHook, /const structureDrop = hasStructureDrag\(event\.dataTransfer\)/);
assert.match(openDropHook, /readStructureDrag\(event\.dataTransfer\)/);
assert.match(openDropHook, /target\?\.closest\("\.molecule-stage, \.main-stage"\) && openAsDocking\(paths\)/);
assert.match(openEventsHook, /export function useOpenEvents/);
assert.match(menuEventsHook, /export function useMenuEvents/);
assert.match(windowTitle, /useWindowTitle/);
assert.match(windowTitle, /appInstanceLabel/);
assert.match(instance, /VITE_BURETTE_DEV_INSTANCE/);
assert.match(instance, /Burette Dev \$\{devInstanceSuffix\}/);
assert.match(instance, /"8a18"/);
assert.match(browserDevDocuments, /function browserRendererPlan/);
assert.match(browserDevDocuments, /export function browserDevRuntimeNeedsRefresh/);
assert.match(browserDevDocuments, /const GRID_ASSET_VERSION = "grid-ui-v51"/);
assert.match(browserDevDocuments, /const VIEWER_ASSET_VERSION = "viewer-ui-v10"/);
assert.match(browserDevDocuments, /const XYZRENDER_LARGE_STRUCTURE_ATOM_LIMIT = 1500/);
assert.match(browserDevDocuments, /if \(document\.renderer === "grid2d"\) return !document\.runtimePath\.includes\(GRID_ASSET_VERSION\);/);
assert.match(browserDevDocuments, /if \(!document\.runtimePath\.includes\(VIEWER_ASSET_VERSION\)\) return true;/);
assert.match(browserDevDocuments, /function resolvePreviewVisuals/);
assert.match(browserDevDocuments, /theme: ViewerPreferences\["theme"\]/);
assert.match(browserDevDocuments, /canvasBackground: ViewerPreferences\["canvasBackground"\]/);
assert.match(browserDevDocuments, /theme: preferences\.theme,/);
assert.match(browserDevDocuments, /canvasBackground: preferences\.canvasBackground,/);
assert.doesNotMatch(browserDevDocuments, /preferences\.theme === "auto" \? "dark" : preferences\.theme/);
assert.doesNotMatch(browserDevDocuments, /preferences\.canvasBackground === "auto" \? "black" : preferences\.canvasBackground/);
assert.match(browserDevDocuments, /requestBrowserDevXyzrender/);
assert.match(browserDevDocuments, /method: "POST"/);
assert.match(browserDevDocuments, /reloadOptions\?\.xyzrenderPreset \?\? "default"/);
assert.match(browserDevDocuments, /async function defaultXyzrenderPlanForDocument\(path: string, extension: string, text: string\): Promise<DefaultXyzrenderPlan \| null>/);
assert.match(browserDevDocuments, /defaultXyzrender\?\.inputPath \?\? path/);
assert.match(browserDevDocuments, /xyzrenderEndpoint: "\/__burette\/xyzrender"/);
assert.match(browserDevDocuments, /xyzrenderPreset: "default"/);
assert.doesNotMatch(browserDevDocuments, /xyzrenderPreset: "skeletal"/);
assert.match(browserDevDocuments, /xyzrenderCards: true/);
assert.match(browserDevDocuments, /function defaultCubeXyzrenderControls\(path: string, text: string, hasPairedDensityCube = false\): XyzrenderControls/);
assert.match(browserDevDocuments, /return \{ fieldMode: "esp", fieldOpacity: 0\.5, fieldSurfaceStyle: "solid" \};/);
assert.match(browserDevDocuments, /return \{ fieldMode: "mo", fieldOpacity: 0\.62, fieldSurfaceStyle: "solid" \};/);
assert.match(browserDevDocuments, /return \{ fieldMode: "density", fieldIso: 0\.3, fieldOpacity: 0\.45, fieldSurfaceStyle: "solid" \};/);
assert.match(browserDevDocuments, /return \{ fieldMode: "density", fieldOpacity: 0\.45, fieldSurfaceStyle: "solid" \};/);
assert.match(browserDevDocuments, /function pairedGradientCubeSurfaceArguments\(gradientPath: string\)/);
assert.match(browserDevDocuments, /\["--nci-surf", quoteCommandToken\(gradientPath\), "--iso", "0\.3", "--opacity", "0\.45", "--surface-style", "solid"\]/);
assert.match(viteConfig, /fieldMode: readFieldMode\(source\.fieldMode\)/);
assert.match(viteConfig, /fieldIso: readOptionalNumber\(source\.fieldIso\)/);
assert.match(viteConfig, /if \(controls\.fieldMode && controls\.fieldMode !== "auto"\)/);
assert.match(viteConfig, /if \(controls\.fieldIso != null && controls\.fieldIso > 0\) args\.push\("--iso", String\(controls\.fieldIso\)\)/);
assert.match(viteConfig, /if \(controls\.fieldOpacity != null\) args\.push\("--opacity", String\(controls\.fieldOpacity\)\)/);
assert.match(viteConfig, /if \(controls\.fieldSurfaceStyle\) args\.push\("--surface-style", controls\.fieldSurfaceStyle\)/);
assert.match(viteConfig, /if \(controls\.fieldMoPositiveColor && controls\.fieldMoNegativeColor\) args\.push\("--mo-colors", controls\.fieldMoPositiveColor, controls\.fieldMoNegativeColor\)/);
assert.match(viteConfig, /if \(controls\.fieldDensityColor\) args\.push\("--dens-color", controls\.fieldDensityColor\)/);
assert.match(viteConfig, /if \(controls\.fieldCmapPalette\) args\.push\("--cmap-palette", controls\.fieldCmapPalette\)/);
assert.match(viteConfig, /if \(controls\.fieldCmapMin != null && controls\.fieldCmapMax != null\) args\.push\("--cmap-range", String\(controls\.fieldCmapMin\), String\(controls\.fieldCmapMax\)\)/);
assert.match(browserDevDocuments, /export async function openBrowserDevDockingDocument\(/);
assert.match(browserDevDocuments, /const label = `Docking: \$\{receptor\.title\} \+ \$\{ligands\.length\} ligand/);
assert.match(browserDevDocuments, /path: `burrete-docking:\/\/\$\{id\}`/);
assert.match(browserDevDocuments, /virtual: true/);
assert.match(browserDevDocuments, /dockingRequest: \{/);
assert.match(browserDevDocuments, /receptorPath: receptor\.path/);
assert.match(browserDevDocuments, /ligandPaths: ligands\.map\(\(ligand\) => ligand\.path\)/);
assert.match(browserDevDocuments, /window\.BurreteDockingPayloads =/);
assert.match(browserDevDocuments, /sdfGrid: false/);
assert.match(browserDevDocuments, /xyzrenderAvailable: false/);
assert.match(browserDevDocuments, /function readBrowserDevDockingPayload/);
assert.match(browserDevDocuments, /cannot be added to Mol\* docking view because it needs xyzrender conversion/);
assert.match(browserDevDocuments, /const explicitSdfViewer = isSdfExtension\(extension\)\s*&& Boolean\(reloadOptions\)\s*&& \(requestedMode === "molstar" \|\| requestedMode === "xyzrender-external"\);/);
assert.match(browserDevDocuments, /if \(grid && !\(grid\.format === "sdf" && explicitSdfViewer\)\)/);
assert.match(browserDevDocuments, /sdfPosePager: renderer === "molstar" && format\.molstarFormat === "sdf" && !format\.binary/);
assert.match(browserDevDocuments, /const sdfGridPath = ligands\.find/);
assert.match(browserDevDocuments, /sdfGridPath,/);
assert.match(previewRuntimeViewer, /let sdf_grid_path = ligands/);
assert.match(previewRuntimeViewer, /"sdfGridPath": sdf_grid_path/);
assert.match(previewRuntimeViewer, /fn sdf_record_count\(data: &\[u8\]\) -> usize/);
assert.match(browserDevDocuments, /function canUseExternalXyzrender\(format: FormatInfo\)/);
assert.match(browserDevDocuments, /\["sdf", "pdb", "pdbqt", "mmcif", "cifCore"\]\.includes\(format\.molstarFormat\)/);
assert.match(browserDevDocuments, /function xyzrenderAvailableForDocument\(format: FormatInfo, text: string\)/);
assert.match(browserDevDocuments, /function proteinLikeAtomRecordCount\(text: string\)/);
assert.match(browserDevDocuments, /shouldOpenXyzTrajectoryInMolstar[\s\S]*\? "molstar"[\s\S]*xyzrenderAvailable \? defaultRendererModeForDocument\(extension, requestedMode, reloadOptions\) : "molstar"/);
assert.match(browserDevDocuments, /trajectoryControls: renderer === "molstar" && trajectoryFrameCount > 1/);
assert.match(browserDevDocuments, /xyzrenderAvailable,/);
assert.match(browserDevDocuments, /inputDataBase64: inputBytes \? bytesToBase64\(inputBytes\) : undefined/);
assert.match(browserDevDocuments, /function parseCifCoreAtoms\(lines: string\[\]\)/);
assert.match(browserDevDocuments, /function xyzDataFromText\(text: string, extension: string, label: string\)/);
assert.match(browserDevDocuments, /function convertedDataFromText\(text: string, extension: string, label: string\)/);
assert.match(browserDevDocuments, /return bytes \? \{ bytes, molstarFormat: "pdb" \} : null/);
assert.match(browserDevDocuments, /function pdbDataFromText\(text: string, extension: string, label: string\)/);
assert.match(browserDevDocuments, /function inferPdbBonds\(atoms: Atom\[\]\)/);
assert.match(browserDevDocuments, /const BOHR_TO_ANGSTROM = 0\.529177210903/);
assert.match(browserDevDocuments, /CONECT/);
assert.match(browserDevDocuments, /const xyzrenderInputBytes = extension === "cub" \|\| extension === "cube" \? null : sourceXyzBytes/);
assert.match(browserDevDocuments, /function maestroPdbDataFromText\(text: string\)/);
assert.match(browserDevDocuments, /const score = maestroCtScore\(currentCtType\)/);
assert.match(browserDevDocuments, /if \(ctType === "solute"\) return 4/);
assert.match(browserDevDocuments, /function parseOrcaAtoms\(lines: string\[\]\)/);
assert.match(browserDevDocuments, /if \(name\.toLowerCase\(\)\.endsWith\("\.mae\.gz"\)\) return "maegz";/);
assert.match(browserDevDocuments, /isMaestroPreviewExtension\(extension\) && extension !== "maegz"/);
assert.match(browserDevDocuments, /function browserDevReadUrl\(path: string, extension: string\)/);
assert.match(browserDevDocuments, /extension === "maegz"/);
assert.match(browserDevDocuments, /hasImplicitAtomIndex \|\|= headerLine\.toLowerCase\(\)\.includes\("first column is atom index"\)/);
assert.match(browserDevDocuments, /const rowOffset = hasImplicitAtomIndex \? 1 : 0/);
assert.match(browserDevDocuments, /\/__burette\/read-file\?path=\$\{encodeURIComponent\(path\)\}/);
assert.match(browserDevDocuments, /new DecompressionStream\("gzip"\)/);
assert.match(browserDevDocuments, /molstarAvailable: !format\.externalOnly \|\| externalMolstarAvailable/);
assert.match(browserDevDocuments, /\{ value: "flat", label: "Flat" \}/);
assert.match(browserDevDocuments, /preset,/);
assert.match(browserDevDocuments, /orientationRef: orientationRef \|\| undefined/);
assert.match(browserDevDocuments, /Using Mol\* because browser dev xyzrender failed:/);
assert.match(browserDevDocuments, /externalRendererStatus/);
assert.match(browserDevDocuments, /xyzrenderViewer: renderer === "xyzrender-external"/);
assert.match(browserDevDocuments, /xyzrenderAvailable,/);
assert.match(browserDevDocuments, /molstarStyle: preferences\.molstarStyle/);
assert.match(browserDevDocuments, /uiScale: 0\.9/);
assert.match(browserDevDocuments, /inlineSvgBase64: bytesToBase64\(new TextEncoder\(\)\.encode\(result\.svg\)\)/);
assert.match(browserDevDocuments, /defaultLayoutState: \{ left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" \}/);
assert.match(browserDevDocuments, /const runtimeAssetVersion = `\$\{VIEWER_ASSET_VERSION\}-\$\{Date\.now\(\)\}`/);
assert.match(browserDevDocuments, /<link rel="stylesheet" href="viewer-runtime\.css\?v=\$\{runtimeAssetVersion\}" \/>/);
assert.match(browserDevDocuments, /<script src="viewer-shell\.js\?v=\$\{runtimeAssetVersion\}"><\/script>/);
assert.match(browserDevDocuments, /<script src="viewer\.js\?v=\$\{runtimeAssetVersion\}"><\/script>/);
assert.match(browserDevDocuments, /const webkit = window\.webkit \|\| \{\};/);
assert.match(browserDevDocuments, /const messageHandlers = webkit\.messageHandlers \|\| \{\};/);
assert.match(browserDevDocuments, /if \(!messageHandlers\.burrete\) \{/);
assert.match(browserDevDocuments, /window\.__mqlAction = \(name\) => messageHandlers\.burrete\.postMessage/);
assert.match(previewShell, /data-buret-toolbar-content/);
assert.doesNotMatch(previewShell, /data-buret-renderer="xyz-fast"/);
assert.match(previewShell, /id="buret-open-in-app"/);
assert.doesNotMatch(previewShell, /data-buret-action="open-burrete"/);
assert.match(previewRuntimeCss, /\.buret-xyzrender-preset-slot \{ display: none; align-items: center; \}/);
assert.match(previewRuntimeCss, /\.buret-xyzrender-preset-slot\.visible \{ display: flex; \}/);
assert.match(previewRuntimeCss, /\.buret-corner-button \{/);
assert.match(previewRuntimeCss, /body\.burette-quicklook-host \{\s*--buret-toolbar-safe-top: 56px;/s);
assert.match(previewRuntimeCss, /body\.burette-quicklook-host \.buret-corner-button \{/);
assert.match(previewRuntimeCss, /transition: background 180ms ease, box-shadow 180ms ease;/);
assert.doesNotMatch(previewRuntimeCss, /left 180ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
assert.match(previewRuntimeCss, /#buret-toolbar\.buret-dragging \{ transition: none; \}/);
assert.match(previewRuntimeCss, /#buret-toolbar\.buret-toolbar-docked \{/);
assert.match(previewRuntimeCss, /width: auto/);
assert.match(previewRuntimeCss, /max-width: calc\(100vw - 24px\)/);
assert.match(previewRuntimeCss, /#buret-toolbar \{[\s\S]*flex-wrap: nowrap;[\s\S]*max-width: calc\(100vw - 24px\)/);
assert.match(previewRuntimeCss, /#buret-toolbar \.buret-toolbar-content \{/);
assert.match(previewRuntimeCss, /flex: 0 1 auto/);
assert.match(previewRuntimeCss, /max-width: calc\(100vw - 72px\)/);
assert.match(previewRuntimeCss, /#buret-toolbar\.buret-toolbar-docked \.buret-toolbar-content \{/);
assert.match(previewRuntimeCss, /overflow-x: auto/);
assert.match(previewRuntimeCss, /#buret-toolbar\.buret-popover-open \.buret-toolbar-content \{[\s\S]*overflow: visible;[\s\S]*\}/);
assert.match(previewRuntimeCss, /#buret-toolbar\.collapsed \.buret-toolbar-content,\s*#buret-toolbar\.buret-suppressed-by-molstar-panel \.buret-toolbar-content \{/s);
assert.match(previewRuntimeCss, /width: 0/);
assert.match(previewRuntimeCss, /flex-basis: 0/);
assert.match(previewRuntimeCss, /#buret-toolbar > \* \{ flex: 0 0 auto; \}/);
assert.doesNotMatch(browserDevDocuments, /app\.insertAdjacentHTML\('afterend'/);
assert.doesNotMatch(browserDevDocuments, /aria-label="Expand controls"/);
assert.doesNotMatch(browserDevDocuments, /<style>\$\{viewerRuntimeCss\(\)\}<\/style>/);
assert.doesNotMatch(browserDevDocuments, /buret-panel-toggle active" type="button" data-buret-toggle="left"/);
assert.match(previewRuntimeViewer, /"uiScale": 0\.9/);
assert.match(previewViewController, /currentViewerPageZoom: CGFloat = 0\.9/);
assert.match(previewViewController, /defaultViewerPageZoom: CGFloat = 0\.9/);
assert.match(previewViewController, /minViewerPageZoom: CGFloat = 0\.9/);
assert.match(previewViewController, /maxViewerPageZoom: CGFloat = 0\.9/);
assert.match(previewViewController, /"uiScale": 0\.9/);
assert.match(previewRuntimeCss, /--buret-viewer-ui-scale: 0\.9;/);
assert.match(previewViewer, /const DEFAULT_VIEWER_UI_SCALE = 0\.9;/);
assert.match(previewViewer, /const MIN_VIEWER_UI_SCALE = 0\.9;/);
assert.match(previewViewer, /const MAX_VIEWER_UI_SCALE = 0\.9;/);
assert.match(previewViewer, /postHostMessage\(\{ type: 'viewerZoom', value: viewerUIScale \}\)/);
assert.doesNotMatch(previewViewer, /postHostMessage\(\{ type: 'viewerZoom', value: DEFAULT_VIEWER_UI_SCALE \}\)/);
assert.match(previewViewController, /"left": "hidden"/);
assert.match(previewViewController, /var runtimeViewerTheme: String/);
assert.match(previewViewController, /var runtimeCanvasBackground: String/);
assert.match(previewViewController, /transparentBackground \|\| runtimeCanvasBackground == "transparent"/);
assert.match(previewViewController, /var resolvedMolstarStyle: String/);
assert.doesNotMatch(previewViewController, /viewerTheme == "auto" \? "dark" : viewerTheme/);
assert.doesNotMatch(previewViewController, /canvasBackground == "auto" \? "black" : canvasBackground/);
assert.match(gridViewer, /cfg\.transparentBackground === true \|\| canvasBackground === 'transparent'/);
assert.match(gridViewer, /if \(background === 'graphite'\) return '#111317';/);
assert.match(gridViewer, /if \(background === 'white'\) return '#f7f7f2';/);
assert.match(previewRuntimeCss, /--buret-canvas-background:/);
assert.match(gridCss, /background: var\(--buret-grid-canvas-background, var\(--buret-bg\)\);/);
assert.match(previewRuntimeViewer, /"defaultLayoutState": \{ "left": "hidden", "right": "hidden", "top": "hidden", "bottom": "hidden" \}/);
assert.match(previewRuntimeViewer, /preferences\.theme_for_runtime\(\)/);
assert.match(previewRuntimeViewer, /preferences\.canvas_background_for_runtime\(\)/);
assert.match(previewRuntimeViewer, /"molstarStyle": preferences\.resolved_molstar_style\(\)/);
assert.match(previewViewer, /const layoutState = \{\s*left: 'hidden',\s*right: 'hidden',\s*top: 'hidden',\s*bottom: 'hidden'\s*\}/);
assert.match(previewViewer, /const DEFAULT_MOLSTAR_STYLE = 'illustrative'/);
assert.match(previewViewer, /function normalizeMolstarStyle\(value\)/);
assert.match(previewViewer, /function configuredMolstarStyle\(config\)/);
assert.match(previewViewer, /if \(canvasBackground === 'auto'\) return resolveViewerTheme\(\) === 'light' \? 'white' : 'graphite';/);
assert.match(previewViewer, /\.buret-external-artifact-inline > svg \{[^}]*border-radius: 8px;[^}]*box-shadow: 0 18px 54px rgba\(0,0,0,0\.28\);/);
assert.match(previewViewer, /if \(region === 'left'\) layoutState\.left = layoutState\.left === 'full' \? 'hidden' : 'full'/);
assert.match(previewViewer, /await plugin\.builders\.structure\.hierarchy\.applyPreset\(trajectory, 'default'\)/);
assert.match(previewViewer, /await applyMolstarStyle\(viewer, configuredMolstarStyle\(activeConfig\)\)/);
assert.match(previewViewer, /plugin\.managers\.structure\.component\.setOptions\(\{\s*\.\.\.plugin\.managers\.structure\.component\.state\.options,\s*ignoreLight: true\s*\}\)/s);
assert.match(previewViewer, /postprocessing:\s*\{\s*outline:/s);
assert.match(previewViewer, /loadPreparedStructure\(viewer, prepared\)[\s\S]*?applyLayoutState\(viewer\);[\s\S]*?notifyStructureLoaded/);
assert.match(previewViewer, /function scheduleLayoutStateReapply\(viewer\)/);
assert.match(previewViewer, /\[250, 1000, 3000, 6000\]\.forEach/);
assert.match(previewViewer, /function reapplyLayoutStateAfterMolstarPass\(viewer\)/);
assert.match(previewViewer, /regionState: \{ \.\.\.layoutState, left: 'full' \}/);
assert.match(previewViewer, /function syncLeftPanelVisibility\(\)/);
assert.match(previewViewer, /\.msp-layout-region\.msp-layout-left/);
assert.match(previewViewer, /function installLeftPanelVisibilityGuard\(\)/);
assert.match(previewViewer, /applyStaticRendererTheme\(\);/);
assert.match(previewViewer, /function applyStaticRendererTheme\(\)/);
assert.match(previewViewer, /function resolveExternalArtifactBackgroundFill\(rect\)/);
assert.match(previewViewer, /artifactRoot\.style\.background = artifactBackgroundFill \|\| background/);
assert.match(previewViewer, /rect\.dataset\.buretOriginalFill = originalFill/);
assert.match(previewViewer, /function bindThemeButton\(toolbar, viewer\)/);
assert.match(previewViewer, /bindThemeButton\(toolbar, null\);/);
assert.match(previewViewer, /const toolbar = document\.getElementById\('buret-toolbar'\)/);
assert.match(previewViewer, /installToolbarAutoLayoutTracking\(toolbar\);/);
assert.match(previewViewer, /function installToolbarAutoLayoutTracking\(toolbar\)/);
assert.match(previewViewer, /const observer = new ResizeObserver\(handleSizeChange\);/);
assert.match(previewViewer, /if \(toolbar\.dataset\.defaultPosition === '1'\) \{\s*applyDefaultToolbarPosition\(toolbar\);\s*\} else \{\s*fitToolbarToViewport\(toolbar\);\s*updateFloatingLayoutOffsets\(\);\s*\}/s);
assert.match(previewViewer, /const presetSlot = toolbar\.querySelector\('\[data-buret-xyzrender-preset-slot\]'\)/);
assert.match(previewViewer, /presetSlot\?\.classList\.toggle\('visible', renderer === 'xyzrender-external'\)/);
assert.match(previewViewer, /toolbar\.classList\.add\('buret-dragging'\)/);
assert.match(previewViewer, /toolbar\.classList\.remove\('buret-dragging'\)/);
assert.match(previewViewer, /function dockToolbar\(toolbar\)/);
assert.match(previewViewer, /toolbar\.classList\.add\('buret-toolbar-docked'\)/);
assert.match(previewViewer, /function undockToolbar\(toolbar\)/);
assert.match(previewViewer, /toolbar\.classList\.remove\('buret-toolbar-docked'\)/);
assert.match(previewViewer, /function fitToolbarToViewport\(toolbar\)/);
assert.match(previewViewer, /const availableWidth = window\.innerWidth;/);
assert.match(previewViewer, /toolbar\.style\.maxWidth = Math\.max\(180, availableWidth - TOOLBAR_MARGIN \* 2\) \+ 'px'/);
assert.match(previewViewer, /const content = toolbar\.querySelector\('\[data-buret-toolbar-content\]'\)/);
assert.match(previewViewer, /content\.style\.maxWidth = Math\.max\(0, availableWidth - TOOLBAR_MARGIN \* 2 - 36\) \+ 'px'/);
assert.match(previewViewer, /dockToolbar\(toolbar\);\s*fitToolbarToViewport\(toolbar\);\s*const top = defaultToolbarTop\(\);\s*const width = toolbar\.offsetWidth \|\| toolbar\.getBoundingClientRect\(\)\.width \|\| 320;\s*const rightEdge = window\.innerWidth;\s*const left = Math\.max\(TOOLBAR_MARGIN, Math\.round\(rightEdge - width - TOOLBAR_MARGIN\)\);\s*toolbar\.dataset\.defaultPosition = '1';\s*toolbar\.style\.left = left \+ 'px';\s*toolbar\.style\.right = 'auto';\s*toolbar\.style\.top = top \+ 'px';\s*updateFloatingLayoutOffsets\(\)/s);
assert.doesNotMatch(previewViewer, /function toolbarAnchorRect/);
assert.match(previewViewer, /function defaultToolbarTop\(\)/);
assert.match(previewViewer, /fitToolbarToViewport\(toolbar\);\s*const margin = TOOLBAR_MARGIN/s);
assert.match(previewViewer, /if \(saved\.mode === 'custom' && Number\.isFinite\(saved\.left\) && Number\.isFinite\(saved\.top\)\) \{\s*undockToolbar\(toolbar\);/s);
assert.match(previewViewer, /if \(toolbar\.dataset\.defaultPosition === '1'\) \{\s*toolbar\.dataset\.defaultPosition = '0';\s*undockToolbar\(toolbar\);/s);
assert.match(previewViewer, /\.buret-external-artifact-inline > svg > rect/);
assert.match(previewViewer, /function installExternalArtifactInteractions\(root\)/);
assert.match(previewViewer, /const clampScale = value => Math\.min\(8, Math\.max\(0\.05, value\)\)/);
assert.match(previewViewer, /const xyzrenderAvailable = config\.xyzrenderAvailable !== false;/);
assert.match(previewViewer, /const canSwitchRenderer = xyzrenderAvailable && \(/);
assert.match(previewViewer, /toolbar\.dataset\.activeRenderer = renderer;/);
assert.match(previewViewer, /button\.disabled = unavailable;/);
assert.match(previewViewer, /button\.setAttribute\('aria-disabled', unavailable \? 'true' : 'false'\)/);
assert.match(previewViewer, /if \(button\.disabled\) return;\s*applyPendingRendererSelection\(toolbar, value\);/);
assert.match(previewViewer, /function rendererChoiceUnavailable\(value, format, config, xyzrenderAvailable\)/);
assert.match(previewViewer, /if \(value === 'xyz-fast'\) return format !== 'xyz';/);
assert.match(previewViewer, /if \(value === 'xyzrender-external'\) return !xyzrenderAvailable \|\| !canUseExternalXyzrender\(format\);/);
assert.match(previewViewer, /function prepareDockingStructure\(config\)/);
assert.match(previewViewer, /if \(config\.docking\) \{\s*return prepareDockingStructure\(config\);/);
assert.match(previewViewer, /records\.length > 1 && config\.sdfPosePager === true/);
assert.match(previewViewer, /nativeTrajectoryControls: true/);
assert.match(previewViewer, /kind: 'docking'/);
assert.match(previewViewer, /function loadDockingPreparedStructure\(viewer, prepared\)/);
assert.match(previewViewer, /function installDockingPoseControls\(viewer, prepared\)/);
assert.match(previewViewer, /className = 'buret-docking-poses'/);
assert.match(previewViewer, /function readNativeTrajectoryPosition\(expectedCount\)/);
assert.match(previewViewer, /function nativeTrajectoryStepButton\(direction\)/);
assert.match(previewViewer, /async function setNativeTrajectoryPose\(index, poseCount\)/);
assert.match(previewViewer, /if \(prepared\.nativeTrajectoryControls\) \{/);
assert.match(previewViewer, /const switched = await setNativeTrajectoryPose\(nextIndex, prepared\.poseCount\)/);
assert.match(previewViewer, /function installNativeTrajectoryPoseSync\(poseCount, onPoseChange\)/);
assert.match(previewViewer, /const DOCKING_POSE_POSITION_VERSION = '1'/);
assert.match(previewViewer, /function initDockingPoseControlsDrag\(root\)/);
assert.match(previewViewer, /window\.localStorage && window\.localStorage\.setItem\('buret\.dockingPoseControls\.position'/);
assert.match(previewViewer, /root\.classList\.add\('buret-docking-poses-dragging'\)/);
assert.match(previewViewer, /root\.dataset\.defaultPosition = '0';\s*moveDockingPoseControls\(root, event\.clientX - drag\.dx, event\.clientY - drag\.dy\);/);
assert.match(previewViewer, /window\.addEventListener\('pointermove', onPointerMove, true\)/);
assert.match(previewViewer, /window\.addEventListener\('pointerup', finishDrag, true\)/);
assert.match(previewViewer, /function stableTextHash\(value\)/);
assert.match(previewViewer, /sessionStorage\.setItem\(dockingPoseStorageKey\(activeConfig\), String\(nextIndex\)\)/);
assert.match(previewViewer, /sessionStorage\.setItem\(dockingPoseStorageKey\(activeConfig\), String\(previousIndex\)\)/);
assert.match(previewViewer, /Could not switch docking pose/);
assert.match(previewRuntimeCss, /\.buret-docking-poses \{/);
assert.match(previewRuntimeCss, /\.buret-docking-poses \{[\s\S]*cursor: grab;[\s\S]*touch-action: none;[\s\S]*user-select: none;/);
assert.match(previewRuntimeCss, /\.buret-docking-poses\.buret-docking-poses-dragging \{[\s\S]*cursor: grabbing;[\s\S]*transition: none;/);
assert.match(previewViewer, /root\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
assert.match(previewViewer, /root\.addEventListener\('gesturechange', onGestureChange, \{ passive: false \}\)/);
assert.match(previewViewer, /\.buret-external-artifact-stage \{ position: absolute; inset: 0; transform:/);

assert.match(shortcuts, /actions\.openCommandPalette\(\)/);
assert.match(shortcuts, /key === "\/" && !isEditableTarget\(event\.target\)/);
assert.match(shortcuts, /if \(!enabled\) return undefined/);
assert.match(app, /isKnownViewerMessageSource\(event\.source, body\?\.documentId\)/);
assert.match(app, /data\?\.source !== "burrete-grid"/);
assert.match(app, /if \(body\?\.type === "gridFetchPage"\) \{\s*if \(!body\.requestId \|\| !body\.documentId\) return;/s);
assert.match(app, /invoke\("grid_fetch_page"/);
assert.match(app, /source: "burrete-grid-host"/);
assert.match(browserDevDocuments, /if \(window\.BurreteConfig && window\.BurreteConfig\.documentId\) body\.documentId = String\(window\.BurreteConfig\.documentId\);/);
assert.match(app, /querySelectorAll<HTMLIFrameElement>\("\.viewer-iframe\[data-document-id\]"\)/);
assert.match(app, /Preferences refresh all open runtimes/);
assert.match(app, /if \(skipNextPreferenceRefreshRef\.current\) \{\s*skipNextPreferenceRefreshRef\.current = false;\s*return;\s*\}/s);
assert.doesNotMatch(app, /Preferences intentionally refresh only the active runtime/);
assert.match(app, /Quick Look reset completed/);
assert.match(app, /Quick Look reset reported issues/);
assert.doesNotMatch(app, /Quick Look reset requested/);

assert.match(shortcutDocs, /\| Cmd\+P or \/ \| Open command palette \|/);
assert.match(shortcutDocs, /Search Projects and Structures/);
assert.match(shortcutDocs, /Clear Recent Structures/);
assert.match(shortcutDocs, /<project>: <title>/);
assert.doesNotMatch(readme, /executable path, built-in preset\/custom JSON config, and extra CLI flags/);
assert.doesNotMatch(readme, /Finder file association registration/);
assert.match(packageJson, /"packageManager": "bun@1\.3\.8"/);
assert.match(packageJson, /"workspaces": \[/);
assert.match(packageJson, /"packages\/\*"/);
assert.match(updateSource, /const installExtensions = \["\.zip"\]/);
assert.doesNotMatch(updateSource, /"\.dmg"|"\.pkg"/);
assert.match(updateSource, /sha256AssetFor\(assets, asset\.name!\)/);
assert.match(updateSource, /sha256AssetName: selected\.digest\.name!/);
assert.match(app, /sha256BrowserDownloadUrl: release\.installAsset\.sha256BrowserDownloadUrl/);
assert.match(updateSource, /manifestAssetFor\(assets, asset\.name!\)/);
assert.match(updateSource, /manifestSignatureAssetFor\(assets, asset\.name!\)/);
assert.match(app, /manifestSignatureBrowserDownloadUrl: release\.installAsset\.manifestSignatureBrowserDownloadUrl/);
assert.match(browserDevDocuments, /documentId: stableId\(path\)/);
assert.match(browserDevDocuments, /body\.documentId = String\(window\.BurreteConfig\.documentId\)/);
assert.match(browserDevDocuments, /window\.BurreteGridRecords =/);
assert.match(browserDevDocuments, /rdkitWasmPath: `\$\{WEB_ASSETS_BASE\}rdkit\/RDKit_minimal\.wasm`/);
assert.doesNotMatch(browserDevDocuments, /BurreteRDKitWasmBase64/);
assert.match(gridViewer, /cfg\.appViewer === true && cfg\.gridDataMode === 'bridge'/);
assert.match(gridViewer, /data\.source !== 'burrete-grid-host'/);
assert.match(gridViewer, /body\.documentId = String\(window\.BurreteConfig\.documentId\)/);
assert.match(gridViewer, /window\.parent\?\.postMessage\(\{ source: 'burrete-grid', body \}, '\*'\)/);
assert.match(gridViewer, /hostRequest\('gridFetchPage'/);
assert.match(gridViewer, /data-buret-grid-xyzrender-tune/);
assert.match(gridCss, /\.buret-grid-renderer-controls\s*\{[^}]*display: grid;/);
assert.match(gridCss, /\.buret-grid-xyzrender-popover\s*\{[^}]*grid-column: 1 \/ -1;/);
assert.doesNotMatch(gridCss, /\.buret-grid-xyzrender-popover\s*\{[^}]*position: absolute;/);
assert.doesNotMatch(gridCss, /\.buret-grid-xyzrender-popover\s*\{[^}]*backdrop-filter:/);
assert.doesNotMatch(gridViewer, /CARD_RENDERER_STORAGE_KEY/);
assert.doesNotMatch(gridViewer, /SHOW_PROPERTIES_STORAGE_KEY/);
assert.match(gridViewer, /showProperties: false/);
assert.match(gridViewer, /cardRenderer: 'rdkit'/);
assert.doesNotMatch(gridViewer, /buret-load-control/);
assert.doesNotMatch(gridViewer, /id="load-batch"/);
assert.doesNotMatch(gridViewer, /loadBatchChoice/);
assert.doesNotMatch(gridViewer, /LOAD_BATCH_OPTIONS/);
assert.match(gridViewer, /const CARD_MIN_STORAGE_KEY = 'buret\.grid\.cardMin'/);
assert.match(gridViewer, /const RDKIT_SVG_SIZE = 260;/);
assert.match(gridViewer, /cardMin: storedOptionalInteger\(CARD_MIN_STORAGE_KEY, MIN_CARD_MIN, MAX_CARD_MIN\)/);
assert.match(gridViewer, /function startCardResize\(event, card, axis\)/);
assert.match(gridViewer, /function cardWidthLimits\(card\)/);
assert.match(gridViewer, /data-buret-card-resize/);
assert.match(gridViewer, /data-buret-card-resize="x"/);
assert.match(gridViewer, /data-buret-card-resize="y"/);
assert.match(gridViewer, /data-buret-card-resize="xy"/);
assert.match(gridViewer, /removeStored\(CARD_MIN_STORAGE_KEY\)/);
assert.match(gridViewer, /document\.body\.classList\.remove\('buret-grid-manual-size'\)/);
assert.match(gridViewer, /document\.body\.classList\.add\('buret-grid-manual-size'\)/);
assert.match(gridViewer, /style\.removeProperty\('--buret-card-effective-min'\)/);
assert.match(gridViewer, /style\.setProperty\('--buret-card-effective-min', `\$\{state\.cardMin\}px`\)/);
assert.doesNotMatch(gridViewer, /CARD_HEIGHT_STORAGE_KEY/);
assert.doesNotMatch(gridViewer, /cardHeight/);
assert.doesNotMatch(gridCss, /buret-grid-manual-height/);
assert.doesNotMatch(gridViewer, /type="range"/);
assert.doesNotMatch(gridViewer, /id="grid-columns"/);
assert.doesNotMatch(gridViewer, /id="grid-card-size"/);
assert.doesNotMatch(gridCss, /--buret-grid-columns:/);
assert.doesNotMatch(gridCss, /--buret-card-size:/);
assert.match(gridCss, /--buret-card-effective-min: var\(--buret-card-auto-min\);/);
assert.match(gridCss, /--buret-card-gap: clamp\(5px, calc\(var\(--buret-card-effective-min\) \* 0\.06\), 12px\);/);
assert.match(gridCss, /--buret-card-min: clamp\(calc\(\(100% - \(var\(--buret-card-gap\) \* 29\)\) \/ 30\), var\(--buret-card-auto-min\), calc\(\(100% - \(var\(--buret-card-gap\) \* 2\)\) \/ 3\)\);/);
assert.match(gridCss, /--buret-card-max: min\(clamp\(188px, 23vw, 236px\), calc\(\(100% - \(var\(--buret-card-gap\) \* 2\)\) \/ 3\)\);/);
assert.match(gridCss, /grid-template-columns: repeat\(auto-fill, minmax\(var\(--buret-card-min\), max\(var\(--buret-card-min\), var\(--buret-card-max\)\)\)\);/);
assert.match(gridCss, /justify-content: start;/);
assert.match(gridCss, /\.buret-card-resize-handle\s*\{/);
assert.match(gridCss, /\.buret-card-resize-handle-x\s*\{/);
assert.match(gridCss, /\.buret-card-resize-handle-y\s*\{/);
assert.match(gridCss, /\.buret-card-resize-handle-xy\s*\{/);
assert.match(gridCss, /\.buret-card\.selected \.buret-selected-indicator\s*\{[^}]*opacity: 1;/s);
assert.match(gridCss, /\.buret-selected-indicator::after\s*\{[^}]*border-width: 0 2px 2px 0;/s);
assert.match(gridCss, /\.buret-card:hover\s*\{[^}]*box-shadow:\s*[\s\S]*inset 0 0 0 1px[\s\S]*0 0 0 3px/s);
assert.match(gridCss, /\.buret-card::after\s*\{[^}]*content: attr\(data-buret-card-tooltip\);[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/s);
assert.match(gridCss, /\.buret-card::after\s*\{[^}]*color: #ffffff;[\s\S]*background: rgba\(22, 24, 29, 0\.92\);/s);
assert.match(gridCss, /\.buret-card\.buret-card-hovering-molecule::after,\s*\.buret-card:focus-visible::after\s*\{[^}]*opacity: 1;/s);
assert.match(gridCss, /\.buret-card-resize-handle-x\s*\{[^}]*width: 16px;/s);
assert.match(gridCss, /\.buret-card-resize-handle-y\s*\{[^}]*height: 16px;/s);
assert.match(gridCss, /\.buret-card-resize-handle-xy\s*\{[^}]*width: 24px;[^}]*height: 24px;/s);
assert.match(gridCss, /color-mix\(in srgb, var\(--buret-accent\) 28%, transparent\)/);
assert.doesNotMatch(gridCss, /body\.buret-grid-resizing \.buret-card-resize-handle/);
assert.match(gridCss, /\.buret-card\.buret-card-resizing \.buret-card-resize-handle\s*\{[^}]*opacity: 1;/s);
assert.match(gridViewer, /<span class="buret-selected-indicator" aria-hidden="true"><\/span>/);
assert.match(gridViewer, /selectionAnchorIndex: null/);
assert.match(gridViewer, /selectionKeydownHandler: null/);
assert.match(gridViewer, /id="select-all"/);
assert.match(gridViewer, /id="clear-selection"/);
assert.match(gridViewer, /function selectAllRows\(cfg\)/);
assert.match(gridViewer, /function clearSelection\(cfg\)/);
assert.match(gridViewer, /function selectableRowIndexes\(\)/);
assert.match(gridViewer, /function syncRenderedSelection\(\)/);
assert.match(gridViewer, /function selectRangeTo\(index, cfg\)/);
assert.match(gridViewer, /function handleCardSelection\(event, row, cfg, cardElement\)/);
assert.match(gridViewer, /event\.shiftKey/);
assert.match(gridViewer, /aria-selected/);
assert.match(gridViewer, /event\.key\.toLowerCase\(\) === 'a'/);
assert.match(gridViewer, /state\.selected\.clear\(\)/);
assert.match(gridCss, /\.buret-selection-actions\s*\{[^}]*display: inline-flex;/s);
assert.match(gridCss, /\.buret-toolbar-row-view\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/s);
assert.doesNotMatch(gridCss, /\.buret-toolbar-row-main,\s*\.buret-toolbar-row-view\s*\{\s*grid-template-columns: 1fr;/);
assert.match(gridViewer, /card\.classList\.add\('buret-card-resizing'\)/);
assert.match(gridViewer, /card\.classList\.remove\('buret-card-resizing'\)/);
assert.match(gridCss, /body\.buret-grid-resizing\s*\{/);
assert.match(gridCss, /body\.buret-grid-resizing\[data-buret-grid-resize-axis="y"\]/);
assert.match(gridCss, /aspect-ratio: 1 \/ 1;/);
assert.match(gridCss, /object-fit: contain;/);
assert.match(gridCss, /\.buret-molecule-error \{[^}]*container-type: inline-size;[^}]*overflow: hidden;/s);
assert.match(gridCss, /\.buret-molecule-error strong \{[^}]*max-height: 9\.6em;[^}]*font-size: clamp\(7px, 8cqi, 11px\);/s);
assert.match(gridCss, /\.buret-molecule-error-dense strong \{[^}]*font-size: clamp\(6px, 6cqi, 9px\);/s);
assert.match(gridViewer, /buret-molecule-error-dense/);
assert.match(gridViewer, /mol\.set_new_coords\?\.\(\)/);
assert.match(gridViewer, /mol\.get_svg\(RDKIT_SVG_SIZE, RDKIT_SVG_SIZE\)/);
assert.match(gridViewer, /const SVG_FIT_MIN_PADDING = 12;/);
assert.match(gridViewer, /const SVG_FIT_PADDING_FRACTION = 0\.08;/);
assert.match(gridViewer, /const SVG_FIT_BOTTOM_PADDING_MULTIPLIER = 1\.7;/);
assert.match(gridViewer, /const SVG_FIT_VERTICAL_BIAS_FRACTION = 0\.08;/);
assert.match(gridViewer, /function stripSVGClipping\(svg\)/);
assert.match(gridViewer, /querySelectorAll\('clipPath, mask'\)/);
assert.match(gridViewer, /function padSVGViewBox\(svg, padding\)/);
assert.match(gridViewer, /requestAnimationFrame\(fitRenderedGridSVGs\)/);
assert.match(gridViewer, /function fitRenderedGridSVGs\(\)/);
assert.match(gridViewer, /function fitSVGToContent\(svg\)/);
assert.match(gridViewer, /function svgBounds\(svg\)/);
assert.match(gridViewer, /svg\.getBBox\(\)/);
assert.match(gridViewer, /function contentBounds\(svg\)/);
assert.match(gridViewer, /function transformedNodeBounds\(node, svg\)/);
assert.match(gridViewer, /node\.getCTM\(\)/);
assert.match(gridViewer, /svg\.getCTM\(\)/);
assert.match(gridViewer, /svgMatrix\.inverse\(\)\.multiply\(nodeMatrix\)/);
assert.match(gridViewer, /const padding = Math\.max\(SVG_FIT_MIN_PADDING, size \* SVG_FIT_PADDING_FRACTION\);/);
assert.match(gridViewer, /new DOMPoint\(box\.x, box\.y\)/);
assert.match(gridViewer, /fitCardSVGs\(nextCard\)/);
assert.match(gridViewer, /preserveAspectRatio="xMidYMid meet"/);
assert.match(gridCss, /body\.buret-hide-properties \.buret-card-body\s*\{[^}]*display: none;/);
assert.match(gridViewer, /const XYZRENDER_CARD_CONCURRENCY = 4/);
assert.match(gridViewer, /data-buret-grid-card-renderer="rdkit"/);
assert.match(gridViewer, /data-buret-grid-card-renderer="xyzrender"/);
assert.match(gridViewer, /data-buret-grid-renderer="molstar" data-buret-grid-sdf-poses data-buret-grid-docking>Poses/);
assert.match(gridViewer, /function requestSdfPoseDocument\(cfg\)/);
assert.match(gridViewer, /post\('openSdfPoseDocument', '\[grid\] Open SDF poses in Mol\*.', \{/);
assert.match(gridViewer, /documentId: cfg\?\.documentId \|\| null/);
assert.match(gridViewer, /if \(value === 'molstar'\) \{\s*requestSdfPoseDocument\(cfg\);\s*return;\s*\}/s);
assert.match(gridViewer, /async function requestXyzrenderCard\(row, cfg\)/);
assert.match(gridViewer, /function pumpXyzrenderCardQueue\(\)/);
assert.match(gridViewer, /function drawRdkit\(row\)/);
assert.match(gridViewer, /el\.dataset\.buretCardTooltip = cardTooltip\(row\)/);
assert.match(gridViewer, /function cardTooltip\(row\)/);
assert.match(gridViewer, /function installCardHover\(card\)/);
assert.match(gridViewer, /pointerenter', \(\) => card\.classList\.add\('buret-card-hovering-molecule'\)/);
assert.match(gridViewer, /pointermove', \(\) => card\.classList\.add\('buret-card-hovering-molecule'\)/);
assert.match(gridViewer, /function drawXyzrenderFallback\(row, error\)/);
assert.match(gridViewer, /\.catch\(error => drawXyzrenderFallback\(row, error\)\)/);
assert.match(gridViewer, /inputExtension: input\.extension/);
assert.match(gridViewer, /function molblockForRow\(row\)/);
assert.match(gridViewer, /mol\.get_molblock/);
assert.match(gridViewer, /return \{ extension: 'sdf', text: text\.endsWith\('\$\$\$\$'\) \? `\$\{text\}\\n` : `\$\{text\}\\n\$\$\$\$\\n` \};/);
assert.doesNotMatch(gridViewer, /return \{ extension: 'smi'/);
assert.match(gridViewer, /fetch\(String\(cfg\.xyzrenderEndpoint \|\| '\/__burette\/xyzrender'\)/);
assert.match(gridViewer, /data-buret-grid-xctrl="transparentBackground"/);
assert.match(gridViewer, /data-buret-grid-xctrl="supercell"/);
assert.match(gridViewer, /if \(value === null \|\| value === undefined \|\| String\(value\)\.trim\(\) === ''\) return null;/);
assert.match(gridViewer, /\{ value: 'flat', label: 'Flat' \}/);
assert.match(gridViewer, /function knownXyzrenderPresetValues\(\)/);
assert.match(gridViewer, /requestRendererSwitch\(button\.getAttribute\('data-buret-grid-renderer'\), cfg\)/);
assert.match(gridViewer, /post\('setRenderer', `\[grid\] Switch renderer to \$\{value\}\.`, payload\)/);
assert.match(gridViewer, /async function scanRemoteBySMARTS\(cfg, token\)/);
assert.match(gridViewer, /function shouldCollectAllRemoteRows\(\)/);
assert.match(gridViewer, /async function collectAllRemoteRows\(cfg\)/);
assert.match(gridViewer, /state\.remoteMode && state\.selected\.size === 0 && !state\.smarts\.trim\(\)/);
assert.match(gridViewer, /if \(kind === 'error' && status && !window\.BurreteDebug && cfg\.appViewer === true\) status\.classList\.add\('hidden'\);/);
assert.doesNotMatch(gridViewer, /post\('error', message\);/);
assert.match(structureDrag, /export const STRUCTURE_DRAG_MIME = "application\/x-burrete-structure-paths"/);
assert.match(structureDrag, /export function writeStructureDrag/);
assert.match(structureDrag, /export function readStructureDrag/);
assert.match(structureDrag, /export function hasStructureDrag/);
assert.match(dockingDocuments, /export function ligandDropPathsForTarget/);
assert.match(dockingDocuments, /export function dockingRequestForDrop/);
assert.match(dockingDocuments, /function uniqueDockingPaths\(paths: string\[\]\)/);
assert.match(dockingDocuments, /existingDockingRequest/);
assert.match(dockingDocuments, /receptorPath: existingDockingRequest\.receptorPath/);
assert.match(editorTabs, /from "\.\.\/\.\.\/lib\/structure-drag"/);
assert.match(editorTabs, /draggable=\{Boolean\(tabPath\)\}/);
assert.match(editorTabs, /writeStructureDrag\(event\.dataTransfer, \[tabPath\]\)/);
assert.match(editorTabs, /actions\.setStructureDragActive\(true\)/);
assert.doesNotMatch(editorTabDragStart, /actions\.selectTab\(tab\.id\)/);
assert.match(sidebarFileTreeNode, /from "\.\.\/\.\.\/lib\/structure-drag"/);
assert.match(sidebarFileTreeNode, /draggable/);
assert.match(sidebarFileTreeNode, /writeStructureDrag\(event\.dataTransfer, \[item\.path\]\)/);
assert.match(sidebarFileTreeNode, /actions\.setStructureDragActive\(true\)/);
assert.match(fileKind, /from "\.\.\/\.\.\/\.\.\/lib\/structure-drag"/);
assert.match(fileKind, /from "\.\.\/\.\.\/\.\.\/lib\/docking-documents"/);
assert.match(fileKind, /const paths = ligandDropPathsForTarget\(document\.path, readStructureDrag\(event\.dataTransfer\)\)/);
assert.match(fileKind, /actions\.openDockingDocument\(document\.path, paths\)/);
assert.match(fileKind, /Add to Mol\* docking view/);
assert.match(app, /openBrowserDevDockingDocument/);
assert.match(app, /const openDockingDocument = useCallback/);
assert.match(app, /browserDevDockingFromLocation\(\)/);
assert.match(app, /void openDockingDocument\(request\.receptorPath, request\.ligandPaths\)/);
assert.match(app, /invoke<ViewerDocument>\("open_docking_document"/);
assert.match(app, /rememberRecentStructures\(\[document\]\)/);
assert.match(app, /setStructureDragActive/);
assert.match(previewViewer, /let dockingPoseKeydownDisposer = null/);
assert.match(previewViewer, /const showTrajectoryControls = activeConfig\?\.trajectoryControls === true/);
assert.match(previewViewer, /viewportShowTrajectoryControls: showTrajectoryControls/);
assert.match(viewerShell, /data-buret-action="sdf-grid"/);
assert.match(viewerShell, /Show SDF grid[\s\S]*>Grid<\/button>/);
assert.match(previewViewer, /function canOpenSdfGridFromConfig\(config\)/);
assert.match(previewViewer, /function sdfGridPathForConfig\(config\)/);
assert.match(previewViewer, /Array\.isArray\(config\?\.docking\?\.ligands\)/);
assert.match(previewViewer, /normalizeFormat\(ligand\?\.format \|\| ligand\?\.extension\) === 'sdf'/);
assert.match(previewViewer, /config\?\.sdfPosePager === true && config\?\.sdfGrid !== false && format === 'sdf'/);
assert.match(previewViewer, /sdfGridButton\.addEventListener\('click', requestSdfGridDocument\)/);
assert.match(previewViewer, /payload\.path = gridPath/);
assert.match(previewViewer, /postHostMessage\(payload\)/);
assert.match(previewViewer, /aria-label', 'Previous pose'/);
assert.match(previewViewer, /aria-label', 'Next pose'/);
assert.match(previewViewer, /event\.key === 'ArrowLeft'/);
assert.match(previewViewer, /event\.key === 'ArrowRight'/);
assert.match(moleculeStore, /function persistedDocuments\(documents: ViewerDocument\[\]\)/);
assert.match(moleculeStore, /return documents\.filter\(\(document\) => !document\.virtual\)/);
assert.match(moleculeStore, /if \(!document\.virtual\) byPath\.set\(document\.path, toRecentStructure\(document\)\)/);

console.log('ui shell contract tests passed');
