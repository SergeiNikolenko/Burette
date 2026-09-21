import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { xtbStructureMenuItems } from "../apps/desktop/src/components/xtb-context-menu.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const viteConfig = source("apps/desktop/vite.config.ts");
const xtbCommand = source("apps/desktop/src-tauri/src/commands/xtb.rs");
const xtbRuntime = source("apps/desktop/src-tauri/src/commands/xtb_runtime.rs");
const conformerCommand = source("apps/desktop/src-tauri/src/commands/conformer.rs");
const browserDevXtbRuntime = source("apps/desktop/vite/browser-dev/xtb-runtime.ts");
const chemistrySettings = source("apps/desktop/src/lib/chemistry-settings.ts");
const chemistryTypes = source("apps/desktop/src/types.ts");
const chemistryJobsHook = source("apps/desktop/src/hooks/use-app-chemistry-jobs.ts");
const shellActionsHook = source("apps/desktop/src/hooks/use-app-shell-actions.ts");
const componentTypes = source("apps/desktop/src/components/types.ts");
const app = source("apps/desktop/src/App.tsx");
const xtbWorkflow = source("apps/desktop/src/hooks/use-app-xtb-workflows.ts");

const calls = [];
const actions = new Proxy({}, {
  get: (_target, key) => (...args) => calls.push([key, ...args]),
});
const gridMenu = xtbStructureMenuItems(actions, {
  path: "/tmp/collection.sdf",
  title: "collection.sdf",
  renderer: "grid2d",
  idPrefix: "collection",
});

assert.deepEqual(gridMenu.map((item) => item.text), ["Open xTB Jobs", "xTB Settings"]);
assert.doesNotMatch(JSON.stringify(gridMenu), /Grid Properties|grid-properties/u);
assert.match(xtbWorkflow, /Open a specific molecule from the collection in Mol\* before running xTB Properties/);

assert.doesNotMatch(chemistryTypes, /grid-properties/u);
assert.doesNotMatch(chemistryTypes, /\| "dock"/u);
assert.doesNotMatch(chemistrySettings, /xTB Dock/u);
assert.doesNotMatch(xtbWorkflow, /operation === "dock"/u);
assert.doesNotMatch(xtbCommand, /args\.push\("dock"\.into\(\)\)/u);
assert.doesNotMatch(viteConfig, /args\.push\("dock", inputPath/u);
for (const text of [chemistryTypes, componentTypes, app, shellActionsHook, xtbWorkflow, xtbCommand, viteConfig]) {
  assert.doesNotMatch(text, /runXtbPoseRefinement|runXtbFepPreflight|pose-refine|fep-preflight|secondaryPaths|secondary_paths/u);
}

assert.match(viteConfig, /runBrowserDevXtbJobImpl\(request, jobKey\)[\s\S]*finally \{\s*finishBrowserDevJob\(jobKey\);/);
assert.match(xtbCommand, /xTB job cancelled before the process started/);
assert.match(viteConfig, /function execBrowserDevJobFile[\s\S]*browserDevJobWasCancelled\(jobKey\)[\s\S]*code: 130/);
assert.match(xtbCommand, /fn assert_supported_xtb_operation[\s\S]*grid-properties/);
assert.match(viteConfig, /function assertBrowserDevXtbOperation[\s\S]*grid-properties/);
assert.match(viteConfig, /child\.exitCode === null && child\.signalCode === null/);
assert.match(viteConfig, /function browserDevCommandTimedOut[\s\S]*value\?\.killed === true/);
assert.match(viteConfig, /exitCode: cancelled \? 130 : timedOut \? 124/);
assert.match(chemistryJobsHook, /cancelledXtbJobIdsRef\.current\.delete\(jobId\)[\s\S]*status: "running"/);

assert.match(xtbRuntime, /Managed xTB installation requires Pixi or Conda/);
assert.match(xtbRuntime, /"install", "--locked", "--manifest-path"/);
assert.match(xtbRuntime, /"create",\s*"--yes",\s*"--no-default-packages",\s*"--override-channels"/);
assert.match(xtbRuntime, /path\.is_absolute\(\) && is_executable_file\(path\)/);
assert.match(browserDevXtbRuntime, /"install", "--locked", "--manifest-path"/);
assert.match(browserDevXtbRuntime, /Managed xTB installation requires Pixi or Conda/);
assert.match(browserDevXtbRuntime, /"create",\s*"--yes",\s*"--no-default-packages",\s*"--override-channels"/);
assert.match(browserDevXtbRuntime, /isAbsolute\(path\) && isExecutableFile\(path\)/);
assert.doesNotMatch(xtbRuntime, /global["']?,\s*["']install/);
assert.doesNotMatch(browserDevXtbRuntime, /global["']?,\s*["']install/);
assert.doesNotMatch(xtbCommand, /uv tool install xtb/);
assert.doesNotMatch(viteConfig, /\["tool", "install", "xtb"\]/);
assert.match(xtbRuntime, /MANAGED_INSTALL_TIMEOUT/);
assert.match(xtbRuntime, /if validate_xtb\(&managed\)\.is_ok\(\)[\s\S]*return resolve_from_root\(&root\)/);
assert.match(xtbRuntime, /clear_selection_if_unchanged/);
assert.match(xtbRuntime, /cleanup_inactive_managed_runtimes/);
assert.match(xtbRuntime, /validate_xtb\(&path\)/);
assert.match(xtbRuntime, /fs::canonicalize\(&path\)/);
assert.match(xtbRuntime, /symlink\(target, &next\)/);
assert.match(xtbCommand, /started\.elapsed\(\) < Duration::from_secs\(5\)/);
assert.match(xtbCommand, /\.clamp\(1, 86_400\)/);
assert.match(viteConfig, /Math\.min\(86_400, Math\.max\(1, Number\(request\.timeoutSeconds\)/);
assert.match(conformerCommand, /xtb_runtime::resolve\(&app\)/);
assert.doesNotMatch(conformerCommand, /resolve_executable\("xtb"\)/);
assert.match(viteConfig, /xtb = resolveBrowserDevXtb\(\)\.executablePath/);
assert.match(browserDevXtbRuntime, /realpathSync\(path\)/);
assert.match(browserDevXtbRuntime, /spawnSync\(path, \["--version"\]/);
assert.match(browserDevXtbRuntime, /if \(isValidXtbExecutable\(managed\)\)[\s\S]*return resolveBrowserDevXtb\(\)/);
assert.match(browserDevXtbRuntime, /selectionBefore/);
assert.match(browserDevXtbRuntime, /selectionRevision/);
assert.match(browserDevXtbRuntime, /cleanupInactiveManagedRuntimes/);

assert.match(xtbCommand, /fn primary_open_path_for[\s\S]*\n\s*None\n\}/);
assert.match(viteConfig, /function primaryBrowserDevXtbOpenPath[\s\S]*\n\s*return null;\n\}/);

console.log("xTB workflow contract tests passed");
