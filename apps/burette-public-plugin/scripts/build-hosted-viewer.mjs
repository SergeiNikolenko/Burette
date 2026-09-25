import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const SOURCE_VIEWER_ROOT = path.join(REPO_ROOT, "PreviewExtension/Web");
const OUTPUT_VIEWER_ROOT = path.join(APP_ROOT, "public/burette-viewer");
const OUTPUT_SHELL_ROOT = path.join(APP_ROOT, "public/viewer-shell");
const OUTPUT_WEB_DEMO_ROOT = path.join(APP_ROOT, "public/web-demo");
const LEGACY_DEMO_ROOT = path.join(APP_ROOT, "public/demo");
const MOBILE_VIEWER_SOURCE = path.join(APP_ROOT, "assets/burette-hosted-mobile.js");
const MOBILE_VIEWER_OUTPUT = path.join(APP_ROOT, "public/burette-hosted-mobile.js");
const HOSTED_APP_SOURCE = path.join(APP_ROOT, "assets/burette-hosted-app.ts");
const HOSTED_APP_OUTPUT = path.join(APP_ROOT, "public/burette-hosted-app.js");
const VIEWER_FILES = [
  "mesoscale.js",
  "mesoscale.css",
  "burette-agent.js",
  "grid.css",
  "grid-ui.js",
  "grid-viewer.js",
  "viewer-runtime.css",
  "viewer-bootstrap.js",
  "viewer-shell.js",
  "molstar-preset-preview-controller.js",
  "trajectory-smoothing.js",
  "superposition-panel.js",
  "molecule-preview-interactions.js",
  "color-picker.js",
  "sequence-panel.js",
  "scene-file-actions.js",
  "renderer-view-state.js",
  "viewer.js",
];

await Promise.all([
  rm(OUTPUT_VIEWER_ROOT, { recursive: true, force: true }),
  rm(OUTPUT_SHELL_ROOT, { recursive: true, force: true }),
  rm(OUTPUT_WEB_DEMO_ROOT, { recursive: true, force: true }),
  rm(LEGACY_DEMO_ROOT, { recursive: true, force: true }),
]);
await Promise.all([
  mkdir(OUTPUT_VIEWER_ROOT, { recursive: true }),
]);
await Promise.all([
  ...VIEWER_FILES.map((file) => cp(
    path.join(SOURCE_VIEWER_ROOT, file),
    path.join(OUTPUT_VIEWER_ROOT, file),
  )),
  cp(
    path.join(SOURCE_VIEWER_ROOT, "rdkit"),
    path.join(OUTPUT_VIEWER_ROOT, "rdkit"),
    { recursive: true },
  ),
  cp(MOBILE_VIEWER_SOURCE, MOBILE_VIEWER_OUTPUT),
]);

await run("bun", [
  "build",
  HOSTED_APP_SOURCE,
  "--outfile",
  HOSTED_APP_OUTPUT,
  "--target",
  "browser",
  "--format",
  "iife",
  "--minify",
  // ext-apps ships a bun-built dist whose `typeof require` guards bun rewrites
  // to an undefined `__require` in IIFE output, killing the bridge at load.
  "--define",
  "require=undefined",
], { cwd: REPO_ROOT, env: process.env });
if ((await readFile(HOSTED_APP_OUTPUT, "utf8")).includes("__require")) {
  throw new Error("The hosted Apps bridge bundle references an undefined __require.");
}

await run("bun", ["run", "build"], {
  cwd: path.join(REPO_ROOT, "apps/desktop"),
  env: {
    ...process.env,
    BURETTE_AGENT_SHELL_OUT_DIR: OUTPUT_SHELL_ROOT,
    VITE_BURETTE_BUILD_IDENTIFIER: "hosted-mcp-widget",
    VITE_BURETTE_WEB_ASSETS_BASE: "/burette-viewer/",
  },
});

// The widget HTML links the bundle stylesheet by this fixed name.
const shellIndex = await readFile(path.join(OUTPUT_SHELL_ROOT, "index.html"), "utf8");
if (!shellIndex.includes('rel="stylesheet" crossorigin href="./assets/burette-hosted-shell.css"')) {
  throw new Error("The hosted shell bundle stylesheet is not assets/burette-hosted-shell.css.");
}

await run("bun", ["run", "build"], {
  cwd: path.join(REPO_ROOT, "apps/desktop"),
  env: {
    ...process.env,
    BURETTE_AGENT_SHELL_OUT_DIR: OUTPUT_WEB_DEMO_ROOT,
    VITE_BURETTE_BUILD_IDENTIFIER: "web-demo",
    VITE_BURETTE_WEB_DEMO: "1",
    VITE_BURETTE_WEB_ASSETS_BASE: "/burette-viewer/",
  },
});

console.log("Generated the hosted Burette browser shell, web demo, and viewer assets.");

function run(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} ${args.join(" ")} failed with ${signal || code}`));
    });
  });
}
