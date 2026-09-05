import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, statSync, chmodSync, utimesSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerBrowserDevFoldingResultRoute } from "../apps/desktop/vite/browser-dev/folding-results.ts";
import { registerBrowserDevFileContentRoutes } from "../apps/desktop/vite/browser-dev/files.ts";
import { isBrowserDevPathAllowed } from "../apps/desktop/vite/browser-dev/file-discovery.ts";

function response() {
  return { statusCode: 0, body: null, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
}
const root = realpathSync(mkdtempSync(join(tmpdir(), "burette-path-boundaries-")));
try {
  const allowed = join(root, "allowed");
  mkdirSync(allowed);
  const input = join(allowed, "sample.pdb");
  writeFileSync(input, "HEADER TEST\n");
  const outside = join(root, "scores.json");
  writeFileSync(outside, JSON.stringify({ ranking_score: 0.8123 }));
  const isDevFileReadAllowed = (path) => isBrowserDevPathAllowed(path, [allowed]);
  let folding;
  registerBrowserDevFoldingResultRoute({ middlewares: { use(_, handler) { folding = handler; } } }, { isDevFileReadAllowed });
  const denied = response();
  await folding({ method: "GET", url: `/?path=${encodeURIComponent(outside)}` }, denied);
  assert.equal(denied.statusCode, 403);
  const confined = response();
  await folding({ method: "GET", url: `/?path=${encodeURIComponent(input)}` }, confined);
  assert.deepEqual({ models: confined.body.models, artifacts: confined.body.artifacts }, { models: [], artifacts: [] });
  symlinkSync(outside, join(allowed, "scores.json"));
  const linked = response();
  await folding({ method: "GET", url: `/?path=${encodeURIComponent(input)}` }, linked);
  assert.deepEqual(linked.body.artifacts, []);
  writeFileSync(join(allowed, "confidence.json"), JSON.stringify({ ranking_score: 0.75 }));
  const local = response();
  await folding({ method: "GET", url: `/?path=${encodeURIComponent(input)}` }, local);
  assert.equal(local.body.models[0].metrics[0].value, 0.75);

  let save;
  registerBrowserDevFileContentRoutes({ middlewares: { use(route, handler) { if (route === "/__burette/write-text-file") save = handler; } } }, { isDevFileReadAllowed, devFileSizeLimit: 1024 });
  const file = join(allowed, "notes.txt");
  writeFileSync(file, "initial");
  const baseline = Math.floor(statSync(file).mtimeMs);
  const stale = response();
  await save({ method: "PUT", url: `/?path=${encodeURIComponent(file)}`, async *iterator() {
    writeFileSync(file, "external update");
    utimesSync(file, new Date(), new Date(baseline + 5000));
    yield Buffer.from(JSON.stringify({ contents: "stale draft", expectedModifiedAt: baseline }));
  } }, stale);
  assert.equal(stale.statusCode, 409);
  assert.equal(readFileSync(file, "utf8"), "external update");
  chmodSync(file, 0o640);
  if (process.platform === "darwin") {
    execFileSync("/usr/bin/xattr", ["-w", "com.burette.audit-test", "preserved", file]);
  }
  const saved = response();
  await save({ method: "PUT", url: `/?path=${encodeURIComponent(file)}`, async *iterator() {
    yield Buffer.from(JSON.stringify({ contents: "new draft", expectedModifiedAt: Math.floor(statSync(file).mtimeMs) }));
  } }, saved);
  assert.equal(saved.statusCode, 200);
  assert.equal(readFileSync(file, "utf8"), "new draft");
  assert.equal(statSync(file).mode & 0o777, 0o640);
  if (process.platform === "darwin") {
    assert.equal(execFileSync("/usr/bin/xattr", ["-p", "com.burette.audit-test", file], { encoding: "utf8" }).trim(), "preserved");
  }
} finally { rmSync(root, { recursive: true, force: true }); }
console.log("browser-dev path boundary tests passed");
