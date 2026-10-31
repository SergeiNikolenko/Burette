#!/usr/bin/env node
import { appendFile, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { molstarCubeUnitsPlugin } from "./molstar-cube-units.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "apps/desktop/src/preview-mesoscale/mesoscale-runtime.ts");
const web = resolve(root, "PreviewExtension/Web");
const mirror = resolve(root, "plugins/burette-agent/preview-web");
const theme = resolve(root, "apps/desktop/src/preview-mesoscale/mesoscale-burette-theme.css");

await mkdir(web, { recursive: true });
const build = await Bun.build({
  entrypoints: [source], outdir: web, naming: "mesoscale.js", target: "browser",
  format: "iife", minify: true, loader: { ".jpg": "dataurl" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [molstarCubeUnitsPlugin],
});
if (!build.success) throw new AggregateError(build.logs, "Mesoscale runtime build failed.");
await run(resolve(root, "node_modules/.bin/sass"), ["--no-source-map", "--style=compressed", resolve(root, "node_modules/molstar/lib/apps/mesoscale-explorer/style.scss"), resolve(web, "mesoscale.css")]);
await appendFile(resolve(web, "mesoscale.css"), `\n${(await readFile(theme, "utf8")).trimEnd()}\n`);
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
