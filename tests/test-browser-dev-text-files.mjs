#!/usr/bin/env bun
import assert from "node:assert/strict";

import { openBrowserDevTextFiles } from "../apps/desktop/src/lib/browser-dev-text-files.ts";

const originalFetch = globalThis.fetch;
let requestIndex = 0;
const requestedUrls = [];
globalThis.fetch = async (url) => {
  requestIndex += 1;
  requestedUrls.push(String(url));
  return {
    ok: true,
    async json() {
      return {
        id: `image-${requestIndex}`,
        path: `/tmp/image-${requestIndex}.png`,
        title: `image-${requestIndex}.png`,
        extension: "png",
        language: "image",
        byteCount: 20 * 1024 * 1024,
        content: "data:image/png;base64,AA==",
        truncated: false,
        modifiedAt: null,
      };
    },
  };
};

try {
  const result = await openBrowserDevTextFiles(["/tmp/one.png", "/tmp/two.png", "/tmp/three.png"]);
  assert.equal(result.documents.length, 3);
  assert.notEqual(result.documents[0].content, "");
  assert.notEqual(result.documents[1].content, "");
  assert.equal(result.documents[2].content, "");
  assert.equal(result.documents[2].truncated, true);
  assert.equal(new URL(requestedUrls[0], "http://localhost").searchParams.get("maxImageBytes"), String(48 * 1024 * 1024));
  assert.equal(new URL(requestedUrls[2], "http://localhost").searchParams.get("maxImageBytes"), String(8 * 1024 * 1024));
} finally {
  globalThis.fetch = originalFetch;
}

console.log("browser-dev text file batch tests passed");
