import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerBrowserDevRequestGuard } from "../apps/desktop/vite/browser-dev/http.ts";
import { isBrowserDevPathAllowed } from "../apps/desktop/vite/browser-dev/file-discovery.ts";
import { registerBrowserSidebarFileOperations } from "../apps/desktop/vite/browser-dev/sidebar-file-operations.ts";

const scratch = await realpath(await mkdtemp(join(tmpdir(), "burette-sidebar-operations-")));
const root = join(scratch, "workspace");
await mkdir(root);
const handlers = [];
const server = createServer((req, res) => {
  let index = 0;
  const next = () => {
    const entry = handlers[index++];
    if (!entry) { res.writeHead(404).end(); return; }
    if (req.url.startsWith(entry.path)) entry.handler(req, res, next);
    else next();
  };
  next();
});
const vite = {
  httpServer: server,
  config: { server: {} },
  middlewares: { use: (path, handler) => handlers.push({ path, handler }) },
};
registerBrowserDevRequestGuard(vite);
registerBrowserSidebarFileOperations(vite, path => isBrowserDevPathAllowed(path, [root]));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const request = async (body, origin = base) => {
  const response = await fetch(`${base}/__burette/sidebar-file-operation`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

try {
  const created = join(root, "New Folder");
  assert.deepEqual(await request({ operation: "createFolder", path: root, name: "New Folder" }), {
    status: 200, body: { path: created },
  });
  assert.equal((await stat(created)).isDirectory(), true);
  assert.equal((await request({ operation: "renameFolder", path: root, name: "escape" })).status, 400);
  assert.equal((await request({ operation: "createFolder", path: root, name: "../escape" })).status, 400);
  assert.equal((await request({ operation: "createFolder", path: root, name: "foreign" }, "https://example.com")).status, 403);
  await symlink(scratch, join(root, "outside"));
  assert.equal((await request({ operation: "createFolder", path: join(root, "outside"), name: "escape" })).status, 400);

  const original = join(root, "source.txt");
  const existing = join(root, "existing.txt");
  await writeFile(original, "original");
  await writeFile(existing, "existing");
  assert.equal((await request({ operation: "rename", path: original, name: "existing.txt" })).status, 400);
  assert.deepEqual(await Promise.all([readFile(original, "utf8"), readFile(existing, "utf8")]), ["original", "existing"]);
  const renamed = join(root, "renamed.txt");
  assert.deepEqual(await request({ operation: "rename", path: original, name: "renamed.txt" }), {
    status: 200, body: { path: renamed },
  });
  assert.equal(await readFile(renamed, "utf8"), "original");
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
console.log("Browser sidebar file operation route tests passed");
