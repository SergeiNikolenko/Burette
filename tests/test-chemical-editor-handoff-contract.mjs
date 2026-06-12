#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function source(path) {
  return readFile(resolve(path), "utf8");
}

const [
  app,
  appLayout,
  menuTypes,
  openInEditorMenu,
  radixMenu,
  styles,
  componentTypes,
  appTypes,
  settingsPanel,
  settingsStore,
  viteConfig,
  tauriCommands,
  tauriLib,
  permissions,
  cargoToml,
] = await Promise.all([
  source("apps/desktop/src/App.tsx"),
  source("apps/desktop/src/components/app-layout.tsx"),
  source("apps/desktop/src/components/menu-types.ts"),
  source("apps/desktop/src/components/open-in-editor-menu.tsx"),
  source("apps/desktop/src/components/radix-menu.tsx"),
  source("apps/desktop/src/styles.css"),
  source("apps/desktop/src/components/types.ts"),
  source("apps/desktop/src/types.ts"),
  source("apps/desktop/src/components/settings-panel/index.tsx"),
  source("apps/desktop/src/stores/settings-store.ts"),
  source("apps/desktop/vite.config.ts"),
  source("apps/desktop/src-tauri/src/commands/chemical_editors.rs"),
  source("apps/desktop/src-tauri/src/lib.rs"),
  source("apps/desktop/src-tauri/permissions/burrete.toml"),
  source("apps/desktop/src-tauri/Cargo.toml"),
]);

assert.match(cargoToml, /plist = "1"/);
assert.match(tauriLib, /commands::chemical_editors::list_chemical_editor_targets/);
assert.match(tauriLib, /commands::chemical_editors::open_in_chemical_editor/);
assert.match(permissions, /"list_chemical_editor_targets"/);
assert.match(permissions, /"open_in_chemical_editor"/);

assert.match(tauriCommands, /struct ChemicalEditorTarget/);
assert.match(tauriCommands, /const EDITOR_PROFILES/);
assert.match(tauriCommands, /com\.schrodinger\.Maestro/);
assert.match(tauriCommands, /cc\.avogadro/);
assert.match(tauriCommands, /edu\.ucsf\.cgl\.ChimeraX/);
assert.match(tauriCommands, /org\.openmolecules\.datawarrior/);
assert.match(tauriCommands, /VESTA\.app/);
assert.match(tauriCommands, /is_wildcard_extension/);
assert.match(tauriCommands, /extension == "\*" \|\| extension == "\*\*\*\*"/);
assert.match(tauriCommands, /app_icon_png_path/);
assert.match(tauriCommands, /app_cache_dir\(\)/);
assert.match(tauriCommands, /is_burrete_app_candidate/);
assert.match(tauriCommands, /CFBundleIconFile/);
assert.match(tauriCommands, /Command::new\("\/usr\/bin\/sips"\)/);
assert.match(tauriCommands, /tauri_plugin_opener::open_path\(target_path, Some\(target\.app_path\)\)/);

assert.match(componentTypes, /export type ChemicalEditorTarget/);
assert.match(componentTypes, /iconPath\?: string \| null/);
assert.match(componentTypes, /listChemicalEditorTargets: \(path: string\) => Promise<ChemicalEditorTarget\[\]>/);
assert.match(componentTypes, /openPathInChemicalEditor: \(path: string, targetId: string, targetName: string\)/);
assert.match(componentTypes, /openPathWithDefaultApp: \(path: string\)/);
assert.match(appTypes, /openInDefaultDestination: "default-app" \| "finder" \| `editor:\$\{string\}`/);
assert.match(settingsStore, /openInDefaultDestination: "finder"/);

assert.match(app, /invoke<ChemicalEditorTarget\[\]>\("list_chemical_editor_targets"/);
assert.match(app, /invoke\("open_in_chemical_editor", \{ path, targetId \}\)/);
assert.match(app, /openPathWithDefaultApp/);
assert.match(app, /iconUrl: "\/__burette\/app-icon\/maestro\.png"/);
assert.match(viteConfig, /BROWSER_DEV_APP_ICONS/);
assert.match(viteConfig, /finder: "\/System\/Library\/CoreServices\/CoreTypes\.bundle\/Contents\/Resources\/FinderIcon\.icns"/);
assert.match(viteConfig, /server\.middlewares\.use\("\/__burette\/app-icon\/"/);

assert.match(appLayout, /import \{ OpenInEditorMenu \}/);
assert.match(appLayout, /<OpenInEditorMenu state=\{layoutState\} actions=\{actions\} \/>/);
assert.match(openInEditorMenu, /export function OpenInEditorMenu/);
assert.match(openInEditorMenu, /activeFileFromState/);
assert.match(openInEditorMenu, /No compatible chemical editors found/);
assert.match(openInEditorMenu, /Open with Default App/);
assert.match(openInEditorMenu, /Reveal in Finder/);
assert.match(openInEditorMenu, /convertFileSrc\(target\.iconPath\)/);
assert.match(openInEditorMenu, /function browserDevIconUrl/);
assert.match(openInEditorMenu, /\/__burette\/app-icon\/maestro\.png/);
assert.match(openInEditorMenu, /preferredTargetForDestination\(state\.preferences\.openInDefaultDestination, visibleTargets\)/);
assert.match(openInEditorMenu, /destination === "default-app"/);
assert.match(openInEditorMenu, /destination === "finder"/);
assert.match(openInEditorMenu, /function finderIconUrl/);
assert.match(openInEditorMenu, /const FINDER_ICON_PATH = "\/System\/Library\/CoreServices\/CoreTypes\.bundle\/Contents\/Resources\/FinderIcon\.icns"/);
assert.match(openInEditorMenu, /if \(isTauriRuntime\(\)\) return convertFileSrc\(FINDER_ICON_PATH\)/);
assert.match(settingsPanel, /Default open destination/);
assert.match(settingsPanel, /OpenDestinationControl/);
assert.match(settingsPanel, /actions\.setPreference\("openInDefaultDestination"/);
assert.match(settingsPanel, /actions\.listChemicalEditorTargets\(openDestinationProbePath\)/);
assert.doesNotMatch(settingsPanel, /label: "Auto"/);
assert.match(settingsPanel, /\/__burette\/app-icon\/finder\.png/);
assert.match(settingsPanel, /if \(isTauriRuntime\(\)\) return convertFileSrc\(FINDER_ICON_PATH\)/);

assert.match(menuTypes, /iconText\?: string/);
assert.match(menuTypes, /iconUrl\?: string/);
assert.match(radixMenu, /radix-menu-item-icon/);
assert.match(radixMenu, /<img className="radix-menu-item-icon"/);
assert.match(radixMenu, /radix-menu-item-detail/);
assert.match(styles, /\.open-editor-trigger/);
assert.match(styles, /\.open-editor-trigger-icon img/);
assert.match(styles, /\.radix-menu-item-icon/);
assert.match(styles, /\.settings-open-destination-trigger/);
assert.match(styles, /\.open-editor-trigger \{\n  width: auto;\n  min-width: 56px;\n  height: 28px;/);
assert.match(styles, /\.open-editor-trigger \{[\s\S]*?border-radius: 10px;/);
assert.match(styles, /\.open-editor-trigger \{[\s\S]*?border: 1px solid var\(--line-subtler\);[\s\S]*?box-shadow: none;/);
assert.match(styles, /\.open-editor-menu-content \{\n  min-width: 224px;/);
