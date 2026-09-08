#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { registerBrowserDevAppIconRoute } from "../apps/desktop/vite/browser-dev/assets.ts";

const menu = await readFile("apps/desktop/src/components/open-in-editor-menu.tsx", "utf8");
const finderHook = await readFile("apps/desktop/src/hooks/use-finder-icon-url.ts", "utf8");
const defaultApplicationHook = await readFile("apps/desktop/src/hooks/use-default-application-icon-url.ts", "utf8");
const staticServer = await readFile("scripts/agent-shell-server.mjs", "utf8");
const viteConfig = await readFile("apps/desktop/vite.config.ts", "utf8");
const tauriCommands = await readFile("apps/desktop/src-tauri/src/commands/chemical_editors.rs", "utf8");
const tauriLib = await readFile("apps/desktop/src-tauri/src/lib.rs", "utf8");
const tauriPermissions = await readFile("apps/desktop/src-tauri/permissions/burette.toml", "utf8");

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

// A new route instance must reuse the persistent icon without resolving the app
// or invoking conversion again, even when the original app is no longer there.
const iconId = `test-${randomUUID()}`;
const sourceIcon = "apps/desktop/src-tauri/icons/icon.png";
const expectedIcon = await readFile(sourceIcon);
let discoveries = 0;
let conversions = 0;
let outputPath;
let handler;
const fakeVite = { middlewares: { use(_path, callback) { handler = callback; } } };
registerBrowserDevAppIconRoute(fakeVite, {
  [iconId]: async () => { discoveries++; return sourceIcon; },
}, async (_command, args) => {
  conversions++;
  const pendingPath = args.at(-1);
  outputPath = pendingPath.replace(/-[a-f0-9-]{36}\.png$/u, ".png");
  await writeFile(pendingPath, expectedIcon);
});
const server = createServer((req, res) => { void handler(req, res); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
try {
  const first = await fetch(`${baseUrl}/${iconId}.png`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), expectedIcon);
  registerBrowserDevAppIconRoute(fakeVite, {
    [iconId]: async () => { throw new Error("Cached icons must skip discovery"); },
  }, async () => { throw new Error("Cached icons must skip conversion"); });
  const cached = await fetch(`${baseUrl}/${iconId}.png`);
  assert.equal(cached.status, 200);
  assert.deepEqual(Buffer.from(await cached.arrayBuffer()), expectedIcon);
  const head = await fetch(`${baseUrl}/${iconId}.png`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(`${baseUrl}/constructor.png`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/..%2F${iconId}.png`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/${iconId}.png`, { method: "POST" })).status, 405);
  assert.deepEqual({ discoveries, conversions }, { discoveries: 1, conversions: 1 });
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (outputPath) await rm(outputPath, { force: true });
}

console.log("open-in-editor menu and persistent icon cache contract ok");
