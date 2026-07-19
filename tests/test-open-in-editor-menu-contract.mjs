#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const menu = await readFile("apps/desktop/src/components/open-in-editor-menu.tsx", "utf8");
const finderHook = await readFile("apps/desktop/src/hooks/use-finder-icon-url.ts", "utf8");
const defaultApplicationHook = await readFile("apps/desktop/src/hooks/use-default-application-icon-url.ts", "utf8");
const staticServer = await readFile("scripts/agent-shell-server.mjs", "utf8");
const viteConfig = await readFile("apps/desktop/vite.config.ts", "utf8");
const tauriCommands = await readFile("apps/desktop/src-tauri/src/commands/chemical_editors.rs", "utf8");
const tauriLib = await readFile("apps/desktop/src-tauri/src/lib.rs", "utf8");
const tauriPermissions = await readFile("apps/desktop/src-tauri/permissions/burrete.toml", "utf8");

assert.match(menu, /iconUrl: defaultApplicationIconUrl \?\? undefined/);
assert.match(menu, /iconUrl: finderIconUrl \?\? undefined/);
assert.match(menu, /destination === "default-app"\) return defaultApplicationIconUrl/);
assert.doesNotMatch(finderHook, /import\.meta\.env\.DEV/);
assert.match(finderHook, /\/__burette\/app-icon\/finder\.png/);
assert.match(finderHook, /setIconUrl\(BROWSER_DEV_FINDER_ICON_URL\)/);
assert.match(defaultApplicationHook, /default_application_icon_path/);
assert.match(defaultApplicationHook, /\/__burette\/app-icon\/default-app\.png/);
assert.match(defaultApplicationHook, /setIconUrl\(BROWSER_DEFAULT_APPLICATION_ICON_URL\)/);
assert.match(viteConfig, /"default-app": join\(repoRoot, "apps", "desktop", "src-tauri", "icons", "icon\.png"\)/);
assert.match(staticServer, /'default-app': resolve\(scriptDir/);
assert.match(staticServer, /finder: '\/System\/Library\/CoreServices\/CoreTypes\.bundle\/Contents\/Resources\/FinderIcon\.icns'/);
assert.match(staticServer, /relativePath === 'index\.js'/);
assert.match(staticServer, /relativePath === 'boot-overlay\.js'/);
assert.match(tauriCommands, /pub\(crate\) fn default_application_icon_path/);
assert.match(tauriCommands, /URLForApplicationToOpenURL/);
assert.match(tauriLib, /commands::chemical_editors::default_application_icon_path/);
assert.match(tauriPermissions, /"default_application_icon_path"/);

console.log("open-in-editor menu contract ok");
