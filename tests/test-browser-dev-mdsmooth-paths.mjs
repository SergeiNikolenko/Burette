import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { isBrowserDevPathAllowed } from "../apps/desktop/vite/browser-dev/file-discovery.ts";
const { registerBrowserDevMdsmoothRoute } = await import("../apps/desktop/vite/browser-dev/mdsmooth.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "burette-mdsmooth-paths-")));
const originalPath = process.env.PATH;
const log = join(root, "requests.jsonl");
const launched = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
writeFileSync(join(root, "uv"), `#!/bin/sh
/bin/cat >> '${log}'
printf '\n' >> '${log}'
printf '{"ok":true}\n'
`, { mode: 0o700 });
process.env.PATH = root;
try {
  const allowed = join(root, "allowed"); mkdirSync(allowed);
  const trajectory = join(allowed, "sample.xtc"); writeFileSync(trajectory, "fixture");
  const outside = join(root, "outside.xtc"); writeFileSync(outside, "fixture");
  symlinkSync(root, join(allowed, "escape"));
  let handler;
  registerBrowserDevMdsmoothRoute({ middlewares: { use(_, fn) { handler = fn; } } }, "/unused-runner.py", {
    isDevFileReadAllowed: (path) => isBrowserDevPathAllowed(path, [allowed]),
  });
  async function call(body) {
    const res = { statusCode: 0, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
    await handler(Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: "POST" }), res);
    return res;
  }
  for (const body of [
    { trajectoryPath: outside },
    { trajectoryPath: trajectory, topologyPath: outside },
    { trajectoryPath: trajectory, outputPath: join(root, "result.xyz") },
    { trajectoryPath: trajectory, outputPath: join(allowed, "escape", "new", "result.xyz") },
    { trajectoryPath: join(allowed, "escape", "outside.xtc") },
  ]) {
    const before = launched().length;
    assert.equal((await call(body)).statusCode, 403);
    assert.equal(launched().length, before);
  }
  assert.equal((await call({ trajectoryPath: trajectory, outputPath: trajectory })).statusCode, 400);
  assert.equal((await call({ trajectoryPath: trajectory, outputPath: join(allowed, "nested", "result.xyz") })).statusCode, 200);
  assert.equal(launched().at(-1).trajectoryPath, trajectory);
  assert.equal((await call({ trajectoryPath: trajectory })).statusCode, 200);
  assert.equal((await call({ operation: "capabilities" })).statusCode, 200);
  symlinkSync(outside, join(allowed, "sample.mdsmooth.xyz"));
  const before = launched().length;
  assert.equal((await call({ trajectoryPath: trajectory })).statusCode, 403);
  assert.equal(launched().length, before);
} finally { rmSync(root, { recursive: true, force: true }); process.env.PATH = originalPath; }
console.log("browser-dev MDSmooth path tests passed (no compute launched)");
