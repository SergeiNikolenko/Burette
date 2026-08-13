#!/usr/bin/env node
// A Database menu entry only works when it exists in five places at once: the
// native menu, the forwarded-command list, the enable rules, the desktop
// dispatcher and the provider table the dialog reads. Half-wired items look fine
// in review and do nothing when clicked, so the wiring is pinned here rather than
// rediscovered per provider.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const read = (path) => readFile(resolve(path), 'utf8');

const [
  menuBuild,
  menuEvents,
  menuState,
  nativeMenuHook,
  databaseLib,
  databaseHook,
  databaseMod,
  lib,
  permissions,
  packageJson,
] = await Promise.all([
  read('apps/desktop/src-tauri/src/menu/build.rs'),
  read('apps/desktop/src-tauri/src/menu/events.rs'),
  read('apps/desktop/src-tauri/src/menu/state.rs'),
  read('apps/desktop/src/hooks/use-app-native-menu.ts'),
  read('apps/desktop/src/lib/database.ts'),
  read('apps/desktop/src/hooks/use-app-database.ts'),
  read('apps/desktop/src-tauri/src/commands/database/mod.rs'),
  read('apps/desktop/src-tauri/src/lib.rs'),
  read('apps/desktop/src-tauri/permissions/burette.toml'),
  read('package.json'),
]);

// Menu ids are discovered from the native menu itself, so a new item is covered
// by this test the moment it is added.
const menuIds = [...menuBuild.matchAll(/with_id\(\s*(?:app,\s*)?"(database\.[a-z0-9-]+)"/g)].map((match) => match[1]);
assert.ok(menuIds.includes('database.menu'), 'the Database submenu must exist');
const itemIds = menuIds.filter((id) => id !== 'database.menu');
assert.ok(itemIds.length >= 4, `expected Database menu items, found ${itemIds.length}`);
assert.match(menuBuild, /SubmenuBuilder::with_id\(app, "database\.menu", "Database"\)/);
// Database is the last of the collection-facing menus: Collection acts on the
// rows you have, Analyze reads them, Database goes out and fetches more.
assert.match(
  menuBuild,
  /&collection_menu,\n\s+&analyze_menu,\n\s+&database_menu,/,
  'Database follows Collection and Analyze in the menu bar',
);

const forwarded = menuEvents.slice(
  menuEvents.indexOf('const FORWARDED_COMMANDS'),
  menuEvents.indexOf('const WINDOW_REQUIRED_COMMANDS'),
);
for (const id of itemIds) {
  assert.ok(forwarded.includes(`"${id}"`), `${id} is not forwarded to the shell`);
  assert.ok(menuState.includes(`"${id}"`), `${id} has no enable rule`);
  assert.ok(nativeMenuHook.includes(`case "${id}"`), `${id} is not dispatched by the shell`);
}

// Actives are added to the collection on screen, so the item stays disabled until
// there is one; the rest only need a window.
assert.match(menuState, /set_enabled\(\s*&app,\s*"database\.chembl-actives",\s*state\.is_grid && state\.grid_has_molecules,?\s*\)/);
assert.match(menuState, /"database\.chembl-actives",\n\s+"window\.previous-tab",/, 'the actives item resets when the last window closes');

// The provider table the dialog reads and the provider enum the backend accepts
// have to name the same set, or a menu item opens a dialog the backend rejects.
const uiProviders = [...databaseLib.matchAll(/^ {2}"?([a-z-]+)"?: \{\n {4}provider: "([a-z-]+)"/gm)]
  .map((match) => match[2]);
assert.ok(uiProviders.length >= 4, `expected provider descriptors, found ${uiProviders.length}`);
const rustProviders = databaseMod
  .slice(databaseMod.indexOf('pub(crate) enum DatabaseProvider'), databaseMod.indexOf('pub(crate) enum DatabaseDelivery'))
  .match(/^\s{4}([A-Z]\w+),$/gm)
  .map((line) => line.trim().replace(',', ''))
  .map((variant) => variant.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
assert.deepEqual(uiProviders.toSorted(), rustProviders.toSorted(), 'the dialog and the backend must agree on providers');

// Every dispatched menu item has to reach a provider the dialog knows about.
for (const id of itemIds) {
  const route = nativeMenuHook.slice(nativeMenuHook.indexOf(`case "${id}"`));
  const provider = route.match(/openDatabaseQuery\("([a-z-]+)"/)?.[1];
  assert.ok(provider, `${id} does not open a database query`);
  assert.ok(uiProviders.includes(provider), `${id} opens unknown provider ${provider}`);
}

// The network lives in Rust. The webview CSP blocks external requests and the
// grid iframe has no network at all, so a fetch here would be a hole, not a
// shortcut.
for (const [name, source] of [['lib/database.ts', databaseLib], ['use-app-database.ts', databaseHook]]) {
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket/, `${name} must not reach the network from the shell`);
  assert.doesNotMatch(source, /https?:\/\//, `${name} must not name provider endpoints`);
}

// Commands are refused at runtime unless they are registered in both places.
const handler = lib.match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1] ?? '';
const databaseCommands = [...handler.matchAll(/commands::database::(\w+)/g)].map((match) => match[1]);
assert.ok(databaseCommands.includes('database_search'), 'database_search must be registered');
for (const command of databaseCommands) {
  assert.ok(permissions.includes(`"${command}"`), `${command} is missing from the desktop command ACL`);
}

// Credentials must never ride in argv, where every local process can read them.
const http = await read('apps/desktop/src-tauri/src/commands/database/http.rs');
assert.match(http, /secret_headers/);
assert.match(http, /"--config", "-"|\["--config", "-"\]/);
assert.match(http, /reject_private_fetch_target/);
assert.match(http, /"--max-filesize"/);
assert.match(http, /"--max-time"/);
assert.match(http, /"--proto",\s*"=http,https"/);
assert.doesNotMatch(http, /Bearer [A-Za-z0-9._-]{16,}/, 'no credential may be hardcoded');

// Redirects are followed by our own loop, never by curl: `--proto-redir` checks
// the scheme of a hop but not its address, so `--location` would let a public
// endpoint bounce the request to a private one behind the guard's back.
assert.doesNotMatch(http, /"--location"/, 'curl must not follow redirects itself');
assert.match(http, /const MAX_REDIRECTS/);
assert.match(http, /target = validate_request_url\(&redirect\)\?/, 'every hop passes the guard');
// A hop off the original host is replayed without the credentials or the body.
assert.match(http, /let trusted = target\.host_str\(\) == origin\.host_str\(\)/);
assert.match(http, /if trusted \{/);

// Retrieve From URL is the one entry point where the address is the user's, so
// the guard, the download ceiling and the decompression ceiling all apply.
const customUrl = await read('apps/desktop/src-tauri/src/commands/database/custom_url.rs');
assert.match(customUrl, /validate_request_url/);
assert.match(customUrl, /MAX_DOWNLOAD_BYTES/);
assert.match(customUrl, /MAX_INFLATED_BYTES/);
assert.match(customUrl, /\.take\(MAX_INFLATED_BYTES \+ 1\)/, 'inflation is bounded while it runs');

// SQL runs read-only twice over: the statement is checked, and the connection
// itself is opened read-only so a statement that slips past still cannot write.
const sqlSource = await read('apps/desktop/src-tauri/src/commands/database/sql.rs');
assert.match(sqlSource, /fn ensure_read_only_statement/);
assert.match(sqlSource, /SET TRANSACTION READ ONLY/);
assert.match(sqlSource, /SQLITE_OPEN_READ_ONLY/);
assert.match(sqlSource, /disable_statement_logging/);
assert.match(sqlSource, /fn structure_column_index/);

// Passwords go to the keychain and nowhere else: not to the settings the shell
// keeps in localStorage, and not into the argument list of the keychain tool.
const secrets = await read('apps/desktop/src-tauri/src/commands/database/secrets.rs');
assert.match(secrets, /add-generic-password/);
assert.match(secrets, /stdin\s*$|Stdio::piped\(\)/m);
assert.match(secrets, /write_all\(format!\("\{secret\}\\n\{secret\}\\n"\)/, 'the secret is written to stdin, never to argv');
assert.doesNotMatch(secrets, /"-w",\s*(&)?secret/, 'the password must not be an argument');
for (const command of ['database_store_secret', 'database_secret_status', 'database_forget_secret']) {
  assert.ok(databaseCommands.includes(command), `${command} must be registered`);
}
assert.doesNotMatch(databaseHook, /localStorage/, 'a database password never reaches localStorage');
assert.match(databaseHook, /storeDatabaseSecret\(account, draft\.sqlPassword\)/);
assert.doesNotMatch(databaseLib, /sqlPassword/, 'the password is not part of the query request');

// Google Patents talks to an endpoint Google has never documented, and ChemSpace
// needs a key the user may not have. Neither may leave the search unreachable, so
// the browser fallback exists in the same change as the provider.
const patents = await read('apps/desktop/src-tauri/src/commands/database/patents.rs');
const chemspace = await read('apps/desktop/src-tauri/src/commands/database/chemspace.rs');
assert.match(patents, /pub\(crate\) fn browser_url/);
assert.match(chemspace, /pub\(crate\) fn browser_url/);
assert.match(databaseMod, /pub\(crate\) fn database_browser_url/);
assert.ok(databaseCommands.includes('database_browser_url'), 'the fallback must be callable');
assert.match(databaseHook, /descriptor\.hasBrowserFallback/);
assert.match(databaseHook, /openInBrowser\(request\)/);
for (const provider of ['patents', 'chemspace']) {
  const block = databaseLib.slice(databaseLib.indexOf(`provider: "${provider}"`));
  assert.match(block.slice(0, 800), /hasBrowserFallback: true/, `${provider} needs a browser fallback`);
}

// No credential from any upstream project may be in the tree: the ChemSpace key
// is the user's, entered once and kept in the keychain.
assert.doesNotMatch(chemspace, /Bearer\s+[A-Za-z0-9._-]{16,}/, 'no token may be hardcoded');
assert.doesNotMatch(chemspace, /api[_-]?key\s*=\s*"[^"]{8,}"/i, 'no key may be hardcoded');
assert.match(chemspace, /with_secret_header/, 'the key rides on stdin, not in argv');
assert.match(databaseLib, /CHEMSPACE_KEY_ACCOUNT/);
assert.doesNotMatch(databaseLib, /apiKey\??:/, 'the key is not part of the query request');
assert.match(databaseMod, /DatabaseProvider::Chemspace => \{[\s\S]*?secrets::read/, 'the key is read in the backend');

// The building block service documents its own REST interface; the query may
// only carry the parameters it names.
const buildingBlocks = await read('apps/desktop/src-tauri/src/commands/database/building_blocks.rs');
assert.match(buildingBlocks, /bb\.datawarrior\.org/);
for (const parameter of ['what', 'smiles', 'searchType', 'threshold', 'providers', 'price', 'amount', 'maxrows']) {
  assert.ok(buildingBlocks.includes(`"${parameter}"`), `the catalogue query is missing ${parameter}`);
}

// The live smoke script stays out of CI: a red run there means a third-party
// service moved, not that the build broke.
const scripts = JSON.parse(packageJson).scripts;
assert.ok(!Object.values(scripts).some((command) => command.includes('db-smoke')), 'db-smoke must not run in CI');
assert.ok(scripts['test:ui'].includes('test-database-menu-contract.mjs'), 'this contract must run in test:ui');

console.log('database menu contract tests passed');
