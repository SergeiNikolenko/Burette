#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "apps/desktop/src/preview-mesoscale/mesoscale-runtime.ts");
const web = resolve(root, "PreviewExtension/Web");
const mirror = resolve(root, "plugins/burette-agent/preview-web");

await mkdir(web, { recursive: true });
await run("bun", ["build", source, "--outdir", web, "--entry-naming", "mesoscale.js", "--target", "browser", "--format", "iife", "--production", "--minify", "--loader", ".jpg:dataurl"]);
await run(resolve(root, "node_modules/.bin/sass"), ["--no-source-map", "--style=compressed", resolve(root, "node_modules/molstar/lib/apps/mesoscale-explorer/style.scss"), resolve(web, "mesoscale.css")]);
await mkdir(mirror, { recursive: true });
await Promise.all(["mesoscale.js", "mesoscale.css"].map((name) => copyFile(resolve(web, name), resolve(mirror, name))));
await run("bun", [resolve(root, "scripts/check-vendor-assets.mjs"), "--write"]);

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} failed with ${signal || code}`)));
  });
}
