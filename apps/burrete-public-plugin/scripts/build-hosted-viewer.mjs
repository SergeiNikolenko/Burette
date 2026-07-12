import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const SOURCE_VIEWER_ROOT = path.join(REPO_ROOT, "PreviewExtension/Web");
const OUTPUT_VIEWER_ROOT = path.join(APP_ROOT, "public/burrete-viewer");
const OUTPUT_SHELL_ROOT = path.join(APP_ROOT, "public/viewer-shell");
const OUTPUT_WEB_DEMO_ROOT = path.join(APP_ROOT, "public/web-demo");
const LEGACY_DEMO_ROOT = path.join(APP_ROOT, "public/demo");
const MOBILE_VIEWER_SOURCE = path.join(APP_ROOT, "assets/burrete-hosted-mobile.js");
const MOBILE_VIEWER_OUTPUT = path.join(APP_ROOT, "public/burrete-hosted-mobile.js");
const VIEWER_FILES = [
  "burette-agent.js",
  "viewer-runtime.css",
  "viewer-bootstrap.js",
  "viewer-shell.js",
  "trajectory-smoothing.js",
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

await run("bun", ["run", "build"], {
  cwd: path.join(REPO_ROOT, "apps/desktop"),
  env: {
    ...process.env,
    BURRETE_AGENT_SHELL_OUT_DIR: OUTPUT_SHELL_ROOT,
    VITE_BURRETE_BUILD_IDENTIFIER: "hosted-mcp-widget",
    VITE_BURRETE_WEB_ASSETS_BASE: "/burrete-viewer/",
  },
});

await run("bun", ["run", "build"], {
  cwd: path.join(REPO_ROOT, "apps/desktop"),
  env: {
    ...process.env,
    BURRETE_AGENT_SHELL_OUT_DIR: OUTPUT_WEB_DEMO_ROOT,
    VITE_BURRETE_BUILD_IDENTIFIER: "web-demo",
    VITE_BURRETE_WEB_DEMO: "1",
    VITE_BURRETE_WEB_ASSETS_BASE: "/burrete-viewer/",
  },
});

console.log("Generated the hosted Burrete browser shell, web demo, and viewer assets.");

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
