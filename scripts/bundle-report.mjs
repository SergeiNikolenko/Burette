#!/usr/bin/env bun
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const repoRoot = process.cwd();
const distRoot = join(repoRoot, "apps", "desktop", "dist");
const indexHtmlPath = join(distRoot, "index.html");
const reportDir = join(repoRoot, "build", "reports");
const jsonPath = join(reportDir, "bundle-report.json");
const textPath = join(reportDir, "bundle-report.txt");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function assetRefs(html, pattern) {
  return Array.from(html.matchAll(pattern), (match) => match[1]?.replace(/^\.\//u, "")).filter(Boolean);
}

function classifyChunk(path, source, entryScript, bootstrapScripts) {
  const lower = path.toLowerCase();
  if (bootstrapScripts.has(path)) return "bootstrap";
  if (lower.includes("ketcher")) return "ketcher";
  if (lower.includes("molstar")) return "molstar";
  if (lower.includes("command-palette")) return "command-palette";
  if (lower.includes("settings")) return "settings";
  if (lower.includes("update")) return "update";
  if (path === entryScript) return "main";
  if (
    source.includes("ketcher-standalone")
    || source.includes("ketcher-react")
    || source.includes("ketcher-core")
    || source.includes("indigo-ketcher")
    || source.includes("StandaloneStructServiceProvider")
    || source.includes("Unsupported Ketcher CommonJS module")
  ) {
    return "ketcher";
  }
  if (source.includes("molstar")) return "molstar";
  return "other";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

const html = await readFile(indexHtmlPath, "utf8");
const scriptRefs = assetRefs(html, /<script[^>]+src="([^"]+)"/gu);
const moduleEntryScripts = assetRefs(html, /<script[^>]+\btype="module"[^>]+src="([^"]+)"/gu);
const initialStyles = new Set(assetRefs(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gu));
const entryScript = moduleEntryScripts[0] ?? null;
const initialScripts = new Set(scriptRefs);
const bootstrapScripts = new Set(scriptRefs.filter((script) => script !== entryScript));
const files = await listFiles(distRoot);
const assets = [];

for (const path of files) {
  const relativePath = relative(distRoot, path);
  const extension = extname(path).toLowerCase();
  if (![".js", ".css"].includes(extension)) continue;
  const content = await readFile(path);
  const source = extension === ".js" ? content.toString("utf8") : "";
  const role = extension === ".js"
    ? classifyChunk(relativePath, source, entryScript, bootstrapScripts)
    : relativePath.toLowerCase().includes("ketcher")
      ? "ketcher"
      : "style";
  assets.push({
    path: relativePath,
    bytes: content.byteLength,
    type: extension.slice(1),
    role,
    initial: initialScripts.has(relativePath) || initialStyles.has(relativePath),
  });
}

assets.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));

const mainChunk = assets.find((asset) => asset.role === "main" && asset.type === "js") ?? null;
const ketcherChunks = assets.filter((asset) => asset.role === "ketcher" && asset.type === "js");
const molstarChunks = assets.filter((asset) => asset.role === "molstar" && asset.type === "js");
const initialKetcherAssets = assets.filter((asset) => asset.role === "ketcher" && asset.initial);
const mainChunkSource = mainChunk ? await readFile(join(distRoot, mainChunk.path), "utf8") : "";
const mainImportsKetcher = /from\s*["']\.\/ketcher-/u.test(mainChunkSource);
const ketcherBoundaryOk = ketcherChunks.length > 0 && initialKetcherAssets.length === 0 && !mainImportsKetcher;

const report = {
  generatedAt: new Date().toISOString(),
  distRoot,
  entryScript,
  bootstrapScripts: [...bootstrapScripts],
  initialStyles: [...initialStyles],
  mainChunk,
  ketcherChunks,
  initialKetcherAssets,
  mainImportsKetcher,
  ketcherBoundaryOk,
  molstarChunks,
  assets,
};

await mkdir(reportDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(textPath, [
  "Burrete web bundle report",
  `Generated: ${report.generatedAt}`,
  `Dist: ${distRoot}`,
  "",
  `Main JS: ${mainChunk ? `${mainChunk.path} ${formatBytes(mainChunk.bytes)}` : "not found"}`,
  `Bootstrap JS: ${[...bootstrapScripts].join(", ") || "none"}`,
  `Initial CSS: ${[...initialStyles].join(", ") || "none"}`,
  `Ketcher JS chunks: ${ketcherChunks.length}`,
  `Ketcher initial assets: ${initialKetcherAssets.length ? initialKetcherAssets.map((asset) => asset.path).join(", ") : "none"}`,
  `Main imports Ketcher: ${mainImportsKetcher ? "yes" : "no"}`,
  `Ketcher lazy boundary: ${ketcherBoundaryOk ? "ok" : "failed"}`,
  `Molstar JS chunks: ${molstarChunks.length}`,
  "",
  "Assets:",
  ...assets.map((asset) => `${asset.role.padEnd(16)} ${asset.type.padEnd(3)} ${asset.initial ? "initial" : "lazy   "} ${formatBytes(asset.bytes).padStart(10)} ${asset.path}`),
  "",
].join("\n"));

console.log(`Wrote ${relative(repoRoot, jsonPath)}`);
console.log(`Wrote ${relative(repoRoot, textPath)}`);
if (!ketcherBoundaryOk) {
  console.error("Ketcher lazy boundary failed: expected non-initial Ketcher chunks.");
  process.exit(1);
}
