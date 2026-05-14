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
  commandPalette,
  editorArea,
  editorTabs,
  editorScrollContainer,
  settingsPanel,
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
  shortcutDocs,
  styles,
  gridViewer,
  updateSource,
  browserDevDocuments,
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
  source('apps/desktop/src/components/command-palette/index.tsx'),
  source('apps/desktop/src/components/editor-area/index.tsx'),
  source('apps/desktop/src/components/editor-area/editor-tabs.tsx'),
  source('apps/desktop/src/components/editor-area/editor-scroll-container.tsx'),
  source('apps/desktop/src/components/settings-panel/index.tsx'),
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
  source('docs/keyboard-shortcuts.md'),
  source('apps/desktop/src/styles.css'),
  source('PreviewExtension/Web/grid-viewer.js'),
  source('apps/desktop/src/update.ts'),
  source('apps/desktop/src/lib/browser-dev-documents.ts'),
  source('README.md'),
  source('PreviewExtension/Web/viewer-shell.js'),
  source('PreviewExtension/Web/viewer.js'),
]);

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
assert.match(viewerShell, /data-buret-action="open-burrete"/);
assert.match(viewer, /message: 'open-burrete'/);
assert.match(viewer, /left: 'hidden'/);
assert.match(sidebarHook, /toggleSidebar/);
assert.match(shellStore, /export const useShellStore = create<ShellState>/);
assert.match(shellStore, /name: "burrete\.shell\.ui"/);
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
assert.doesNotMatch(app, /setCommandPaletteOpen/);
assert.doesNotMatch(app, /useState\(false\).*commandPalette/i);
assert.match(app, /refreshedPersistedSessionRef/);
assert.match(app, /isTauriRuntime\(\) \|\| documents\.length === 0/);
assert.match(app, /void openDocuments\(paths\)/);
assert.match(appLayout, /from "\.\/editor-area"/);
assert.match(appLayout, /from "\.\/editor-area\/editor-tabs"/);
assert.match(appLayout, /from "\.\/sidebar"/);
assert.match(appLayout, /SidebarLeftIcon/);
assert.match(appLayout, /HugeiconsIcon/);
assert.match(appLayout, /const collapsedChromeLeft = 132/);
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
assert.match(editorTabs, /←/);
assert.match(editorTabs, /→/);
assert.match(editorTabs, /actions\.navigateBack/);
assert.match(editorTabs, /actions\.canNavigateForward/);
assert.match(editorTabs, /\+/);
assert.match(editorTabs, /×/);
assert.match(appLayout, /<header\s+className="topbar"[^>]*data-tauri-drag-region/s);
assert.match(editorTabs, /className="tab-strip"[^>]*data-tauri-drag-region/);
assert.match(editorTabs, /className="tab-strip-spacer" data-tauri-drag-region/);
assert.match(pageKinds, /const kinds = \[fileKind, launcherKind, settingsKind\] as const/);
assert.match(pageKinds, /export function pageKind/);
assert.match(pageKinds, /export function serializeLocation/);
assert.match(pageKinds, /export function deserializeLocation/);
assert.match(pageKindTypes, /export interface PageKindInput/);
assert.match(pageKindTypes, /export function definePageKind/);
assert.match(fileKind, /export const fileKind = definePageKind/);
assert.match(fileKind, /kind: "file"/);
assert.match(fileKind, /path: location\.path/);
assert.match(fileKind, /className="molecule-stage"/);
assert.match(fileKind, /className="viewer-iframe"/);
assert.match(fileKind, /data-document-id=\{document\.id\}/);
assert.match(fileKind, /const sandbox = tauriRuntime \? "allow-scripts allow-downloads" : "allow-scripts allow-downloads allow-same-origin"/);
assert.match(fileKind, /srcDoc=\{document\.runtimePath\}/);
assert.match(gridViewer, /function resolveTheme\(value\)/);
assert.match(gridViewer, /prefers-color-scheme: light/);
assert.match(gridViewer, /function installThemeListener\(cfg\)/);
assert.doesNotMatch(gridViewer, /const theme = cfg\.theme === 'light' \? 'light' : 'dark'/);
assert.match(styles, /\.molecule-stage/);
assert.match(styles, /inset: var\(--chrome-height\) 0 0/);
assert.match(styles, /--chrome-drag-height: 56px/);
assert.match(styles, /\*\[data-tauri-drag-region\] \{[^}]*app-region: drag;[^}]*-webkit-app-region: drag;[^}]*\}/s);
assert.match(styles, /button, select, input, textarea, \.tab, \.new-tab, \.chrome-button, \.sidebar-search-row, \.project, \.splitter \{[^}]*app-region: no-drag;[^}]*-webkit-app-region: no-drag;[^}]*\}/s);
assert.match(styles, /\.drag-region \{[^}]*height: var\(--chrome-drag-height\);[^}]*z-index: 2/s);
assert.match(styles, /\.main-stage \{[^}]*overflow: hidden/s);
assert.match(styles, /\.sidebar-product:hover/);
assert.match(styles, /\.tab-strip-spacer \{[^}]*flex: 1 1 auto/s);
assert.match(styles, /\.topbar, \.sidebar-toggle-root, \.tab-strip/);
assert.doesNotMatch(styles, /instance-badge/);
assert.doesNotMatch(styles, /sidebar-link/);
assert.match(launcherKind, /export const launcherKind = definePageKind/);
assert.match(launcherKind, /<WelcomeScreen actions=\{actions\} \/>/);
assert.match(settingsKind, /export const settingsKind = definePageKind/);
assert.match(settingsKind, /<SettingsPanel state=\{state\} actions=\{actions\} \/>/);
assert.match(welcome, /export function WelcomeScreen/);
assert.match(welcome, /Open structure/);
assert.match(welcome, /Command Palette/);
assert.doesNotMatch(welcome, /new-tab-copy/);
assert.doesNotMatch(welcome, /Open molecular structures/);
assert.match(errorBoundary, /export class ErrorBoundary/);
assert.match(errorBoundary, /\[ErrorBoundary\]/);
assert.match(errorBoundary, /handleRetry/);
assert.match(scrollFade, /export function ScrollFade/);
assert.match(scrollFade, /useScrollFade/);
assert.match(scrollFadeHook, /export function useScrollFade/);
assert.match(sidebar, /from "\.\.\/scroll-fade"/);
assert.match(sidebar, /<ScrollFade className="sidebar-scroll">/);
assert.match(sidebar, /Recent/);
assert.match(sidebar, /actions\.openRecentStructure/);
assert.match(sidebar, /Search01Icon/);
assert.match(sidebar, /File02Icon/);
assert.match(sidebar, /Cancel01Icon/);
assert.match(sidebar, /fillRule="evenodd"/);
assert.match(sidebar, /from "\.\.\/\.\.\/lib\/instance"/);
assert.match(sidebar, /appInstanceLabel/);
assert.match(sidebar, /className="sidebar-product"/);
assert.match(sidebar, /sidebar-workspace-menu/);
assert.match(sidebar, /workspaceButtonRef/);
assert.match(sidebar, /workspaceMenuPosition/);
assert.match(styles, /\.sidebar-workspace-menu \{[^}]*position: fixed/s);
assert.match(styles, /--workspace-menu-left/);
assert.match(styles, /--workspace-menu-top/);
assert.match(styles, /--workspace-menu-max-height/);
assert.doesNotMatch(styles, /\.sidebar-workspace-menu \{[^}]*bottom: 48px/s);
assert.match(sidebar, /Choose workspace\.\.\./);
assert.match(sidebar, /Open folder/);
assert.doesNotMatch(sidebar, /actions\.openSettings/);
assert.doesNotMatch(sidebar, /Open preferences/);
assert.match(app, /openPath/);
assert.match(app, /chooseWorkspace/);
assert.match(app, /openWorkspaceFolder/);
assert.doesNotMatch(sidebar, /SidebarUtility/);
assert.doesNotMatch(sidebar, /Quick Look/);
assert.doesNotMatch(sidebar, /actions\.resetQuickLook\(\)/);
assert.doesNotMatch(sidebar, /sidebar-title/);
assert.doesNotMatch(sidebar, /Open Structures/);
assert.doesNotMatch(appLayout + sidebar + editorTabs, /◧|◨/);
assert.match(settingsPanel, /<h1>Preferences<\/h1>/);
assert.match(settingsPanel, /className="settings-panel"/);
assert.match(settingsPanel, /className="settings-panel-scroll"/);
assert.doesNotMatch(settingsPanel, /EditorScrollContainer/);
assert.match(editorScrollContainer, /WebkitMaskComposite:\s*"source-over"/);
assert.match(editorScrollContainer, /maskComposite:\s*"add"/);
assert.match(styles, /\.settings-panel-scroll \{[^}]*overflow-y: auto/s);
assert.match(settingsPanel, /title="Display"/);
assert.match(settingsPanel, /title="Structure Rendering"/);
assert.match(settingsPanel, /title="System"/);
assert.match(settingsPanel, /from "\.\/setting-control"/);
assert.match(settingsPanel, /SettingsSection/);
assert.match(settingsPanel, /ToggleControl/);
assert.match(settingControl, /export function SettingsSection/);
assert.match(settingControl, /export function ToggleControl/);
assert.match(settingControl, /role="switch"/);
assert.match(settingControl, /aria-label=\{label\}/);
assert.match(settingControl, /export function SettingsActionButton/);
assert.match(styles, /\.settings-toggle/);
assert.match(styles, /\.settings-select/);
assert.match(styles, /\.settings-panel-content \{[^}]*margin: 0 auto/s);
assert.match(styles, /\.page-surface\[data-page-kind="settings"\] \{[^}]*overflow: hidden/s);
assert.match(styles, /\.page-surface:not\(\[data-active\]\) \{[^}]*display: none/s);
assert.match(styles, /\.editor-progressive-blur/);
assert.match(commandPalette, /Open Recent:/);
assert.match(commandPalette, /Open Structure: /);
assert.match(commandPalette, /Clear Recent Structures/);
assert.match(commandPalette, /group: "Suggested"/);
assert.match(commandPalette, /group: "Renderer"/);
assert.match(commandPalette, /group: "Recent"/);
assert.match(commandPalette, /className="command-palette-group"/);
assert.match(commandPalette, /command-palette-group-heading/);
assert.match(commandPalette, /ArrowDown/);
assert.match(commandPalette, /ArrowUp/);
assert.match(commandPalette, /aria-selected=\{index === selectedIndex\}/);
assert.match(app, /useOpenDrop\(openDocuments, setStatus\)/);
assert.match(app, /useOpenEvents\(openDocuments, setStatus\)/);
assert.match(app, /useMenuEvents\(\{ chooseFiles, openSettings, checkForUpdates \}\)/);
assert.match(app, /<WindowTitle activeDocument=\{activeDocument\} \/>/);
assert.match(openDropHook, /export function useOpenDrop/);
assert.match(openEventsHook, /export function useOpenEvents/);
assert.match(menuEventsHook, /export function useMenuEvents/);
assert.match(windowTitle, /useWindowTitle/);
assert.match(windowTitle, /appInstanceLabel/);
assert.match(instance, /VITE_BURETTE_DEV_INSTANCE/);
assert.match(instance, /Burette Dev \$\{devInstanceSuffix\}/);
assert.match(instance, /"8a18"/);

assert.match(shortcuts, /actions\.openCommandPalette\(\)/);
assert.match(shortcuts, /if \(!enabled\) return undefined/);
assert.match(app, /isKnownViewerMessageSource\(event\.source, body\?\.documentId\)/);
assert.match(app, /querySelectorAll<HTMLIFrameElement>\("\.viewer-iframe\[data-document-id\]"\)/);
assert.match(app, /Preferences refresh all open runtimes/);
assert.doesNotMatch(app, /Preferences intentionally refresh only the active runtime/);
assert.match(app, /Quick Look reset completed/);
assert.match(app, /Quick Look reset reported issues/);
assert.doesNotMatch(app, /Quick Look reset requested/);

assert.match(shortcutDocs, /\| Cmd\+P \| Open command palette \|/);
assert.match(shortcutDocs, /Search Open Structures/);
assert.match(shortcutDocs, /Clear Recent Structures/);
assert.match(shortcutDocs, /Open Recent:/);
assert.match(shortcutDocs, /Open Structure:/);
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
assert.match(browserDevDocuments, /rdkitWasmPath: `\$\{WEB_ASSETS_BASE\}rdkit\/RDKit_minimal\.wasm`/);
assert.doesNotMatch(browserDevDocuments, /BurreteRDKitWasmBase64/);

console.log('ui shell contract tests passed');
