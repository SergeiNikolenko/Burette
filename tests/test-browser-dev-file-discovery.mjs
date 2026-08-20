#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canonicalExistingPath,
  collectBrowserDevFiles,
  isBrowserDevPathAllowed,
} from "../apps/desktop/vite/browser-dev/file-discovery.ts";
import { absoluteBrowserDevPath, scanBrowserDevFolders } from "../apps/desktop/src/lib/browser-dev-startup.ts";

// Relative devFiles paths must resolve to absolute repo paths before any
// /@fs/ URL is built; a relative /@fs/ request falls through to vite's SPA
// fallback and index.html gets rendered as the file contents.
assert.equal(
  absoluteBrowserDevPath("samples/collections/tables/compounds.csv", "/repo/"),
  "/repo/samples/collections/tables/compounds.csv",
);
assert.equal(absoluteBrowserDevPath("/abs/structure.pdb", "/repo"), "/abs/structure.pdb");
assert.equal(absoluteBrowserDevPath("relative.csv", ""), "relative.csv");
assert.equal(absoluteBrowserDevPath("nested\\file.sdf", "/repo"), "/repo/nested/file.sdf");

const root = await mkdtemp(join(tmpdir(), "burette-browser-files-"));
const outside = await mkdtemp(join(tmpdir(), "burette-browser-outside-"));

try {
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "one.csv"), "x,y\n1,2\n");
  await writeFile(join(root, "nested", "two.png"), "png");
  await writeFile(join(root, "three.md"), "# three\n");
  await writeFile(join(outside, "secret.md"), "secret\n");
  await symlink(outside, join(root, "outside-link"));
  await symlink(root, join(root, "self-link"));

  const allowedRoots = [canonicalExistingPath(root)];
  assert.equal(isBrowserDevPathAllowed(join(root, "one.csv"), allowedRoots), true);
  assert.equal(isBrowserDevPathAllowed(join(root, "outside-link", "secret.md"), allowedRoots), false);
  assert.equal(isBrowserDevPathAllowed(join(root, "outside-link", "missing.md"), allowedRoots), false);

  const files = [];
  const scan = await collectBrowserDevFiles(root, files, {
    allowedExtensions: new Set(["csv", "md", "png"]),
    fileExtension: (path) => path.split(".").pop()?.toLowerCase() || "",
    maxDirectories: 10,
    maxEntries: 20,
    maxFileBytes: 1024,
    maxFiles: 10,
  });
  assert.equal(scan.truncated, false);
  assert.deepEqual(files.sort(), [
    join(root, "nested", "two.png"),
    join(root, "one.csv"),
    join(root, "three.md"),
  ].sort());

  const boundedFiles = [];
  const boundedScan = await collectBrowserDevFiles(root, boundedFiles, {
    allowedExtensions: new Set(["csv", "md", "png"]),
    fileExtension: (path) => path.split(".").pop()?.toLowerCase() || "",
    maxDirectories: 10,
    maxEntries: 20,
    maxFileBytes: 1024,
    maxFiles: 2,
  });
  assert.equal(boundedScan.truncated, true);
  assert.equal(boundedFiles.length, 2);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
}

const originalFetch = globalThis.fetch;
const requestedUrls = [];
globalThis.fetch = async (url) => {
  requestedUrls.push(String(url));
  const index = requestedUrls.length;
  return {
    ok: true,
    async json() {
      if (index === 1) {
        return {
          files: Array.from({ length: 1_999 }, (_, item) => `/first/file-${item}.md`),
          truncated: false,
          scannedEntries: 19_999,
          scannedDirectories: 399,
        };
      }
      return {
        files: ["/second/final.md"],
        truncated: true,
        scannedEntries: 1,
        scannedDirectories: 1,
      };
    },
  };
};

try {
  const scan = await scanBrowserDevFolders(["/first", "/second"]);
  assert.equal(scan.files.length, 2_000);
  assert.equal(scan.truncated, true);
  const secondQuery = new URL(requestedUrls[1], "http://localhost").searchParams;
  assert.equal(secondQuery.get("maxFiles"), "1");
  assert.equal(secondQuery.get("maxEntries"), "1");
  assert.equal(secondQuery.get("maxDirectories"), "1");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("browser-dev file discovery tests passed");
