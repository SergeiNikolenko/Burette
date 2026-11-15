#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const build = await Bun.build({
  entrypoints: [resolve("apps/desktop/src/lib/web-demo-text.ts")],
  target: "bun",
  define: { "import.meta.env.VITE_BURETTE_WEB_DEMO": '"1"' },
});
assert.equal(build.success, true, String(build.logs));
const { readWebDemoTextDocument } = await import(`data:text/javascript;base64,${Buffer.from(await build.outputs[0].text()).toString("base64")}`);
const root = resolve("apps/burette-public-plugin/public");
const requests = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const range = request.headers.get("range");
    requests.push({ pathname, range });
    const bytes = await readFile(resolve(root, `.${pathname}`));
    if (range) {
      const end = Math.min(Number(range.match(/bytes=0-(\d+)/u)[1]), bytes.length - 1);
      return new Response(bytes.subarray(0, end + 1), {
        status: 206,
        headers: { "Content-Range": `bytes 0-${end}/${bytes.length}` },
      });
    }
    return new Response(bytes);
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => originalFetch(new URL(url, server.url), options);
try {
  for (const relative of ["Crystals/roy.res", "Motion & Reactions/bimp.out", "Motion & Reactions/mn-h2.log", "Quantum/caffeine_charges.txt"]) {
    const path = `/BuretteDemo/${relative}`;
    const bytes = await readFile(resolve(root, "demo-library", relative));
    const title = relative.split("/").pop();
    const extension = title.split(".").pop();
    const expected = {
      id: `web-demo-text-${path}`, path, title, extension, language: extension,
      content: bytes.toString("utf8"), byteCount: bytes.length, truncated: false, modifiedAt: null,
    };
    assert.deepEqual(await readWebDemoTextDocument(path), expected);
    assert.deepEqual(await readWebDemoTextDocument(path, 1), {
      ...expected, content: bytes.subarray(0, 1).toString("utf8"), truncated: true,
    });
  }
  assert.equal(await readWebDemoTextDocument("/tmp/unknown.txt"), null);
  const disabledBuild = await Bun.build({
    entrypoints: [resolve("apps/desktop/src/lib/web-demo-text.ts")],
    target: "bun",
    define: { "import.meta.env.VITE_BURETTE_WEB_DEMO": '"0"' },
  });
  assert.equal(disabledBuild.success, true, String(disabledBuild.logs));
  const disabled = await import(`data:text/javascript;base64,${Buffer.from(await disabledBuild.outputs[0].text()).toString("base64")}`);
  assert.equal(await disabled.readWebDemoTextDocument("/BuretteDemo/Crystals/roy.res"), null);
  assert.equal(requests.length, 8);
  assert.ok(requests.every(request => request.pathname.startsWith("/demo-library/")));
  assert.equal(requests.filter(request => request.range === "bytes=0-0").length, 4);
} finally {
  globalThis.fetch = originalFetch;
  server.stop(true);
}
console.log("Published demo text files and bounded source reads passed");
