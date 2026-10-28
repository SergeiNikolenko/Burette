import { expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initializeBrowserImportedFiles, registerDroppedBrowserFiles, readBrowserPickedFile, webDemoProjectStructures } from "../apps/desktop/src/lib/web-demo-workspace";
import { readBrowserImport, listBrowserImports } from "../apps/desktop/src/lib/browser-import-storage";
import { deleteBrowserDevVirtualTextDocument, readBrowserVirtualText, writeBrowserDevVirtualTextDocument } from "../apps/desktop/src/lib/browser-dev-documents";

test("published originals survive virtual eviction, preserve live drafts and keep repeated names distinct", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  try {
    const text = "data_crystal\r\n_cell_length_a 10\r\n";
    const first = await registerDroppedBrowserFiles([new File([text], "crystal.cif")], 32768);
    expect(first).toEqual({ paths: ["/OpenedFiles/crystal.cif"], errors: [] });
    const second = await registerDroppedBrowserFiles([new File(["data_second"], "crystal.cif")], 32768);
    expect(second.paths).toEqual(["/OpenedFiles/crystal (2).cif"]);
    const path = first.paths[0]; deleteBrowserDevVirtualTextDocument(path);
    expect(await readBrowserVirtualText(path)).toBe(text);
    writeBrowserDevVirtualTextDocument(path, "current draft");
    const image = new File([new Uint8Array([0, 255, 1])], "image.png");
    const media = await registerDroppedBrowserFiles([image], 32768);
    await initializeBrowserImportedFiles();
    expect(await readBrowserVirtualText(path)).toBe("current draft");
    expect(await readBrowserPickedFile(media.paths[0])!.arrayBuffer()).toEqual(await image.arrayBuffer());
    expect(await (await readBrowserImport(path))!.file.text()).toBe(text);
    const before = (await listBrowserImports()).map(item => item.path);
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function () { throw new DOMException("Quota", "QuotaExceededError"); };
    try {
      const failed = await registerDroppedBrowserFiles([new File(["data_no"], "quota.cif")], 32768);
      expect(failed.paths).toEqual([]); expect(failed.errors).toHaveLength(1);
      expect(webDemoProjectStructures().some(item => item.path.endsWith("quota.cif"))).toBe(false);
      expect((await listBrowserImports()).map(item => item.path)).toEqual(before);
    } finally { IDBObjectStore.prototype.add = add; }
  } finally { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else Reflect.deleteProperty(globalThis, "indexedDB"); }
});

function isolated(script: string, demo = false) {
  const base = new URL("../apps/desktop/src/lib/", import.meta.url).pathname;
  const result = Bun.spawnSync([process.execPath, "-e", `
    import assert from "node:assert/strict";
    const base = ${JSON.stringify(base)};
    ${script}
  `], { env: { ...process.env, VITE_BURETTE_WEB_DEMO: demo ? "1" : "0" }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).slice(0, 4000));
}

test("denied local storage does not block explicit HTTP, filesystem, MCP, Quick Look, docking or folder sources", () => isolated(`
  globalThis.window = { location: { search: "" } };
  let storageReads = 0;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { storageReads++; throw new DOMException("denied", "SecurityError"); } } });
  const { browserDevFilesFromLocation, absoluteBrowserDevPath } = await import(base + "browser-dev-startup.ts");
  const { readBrowserDevCollectionText, readBrowserVirtualText, writeBrowserDevVirtualTextDocument } = await import(base + "browser-dev-documents.ts");
  let reads = 0; globalThis.fetch = async () => { reads++; return new Response("server original"); };
  const source = "https://example.test/source.sdf";
  window.location.search = "?devFiles=" + encodeURIComponent(source);
  assert.deepEqual(await browserDevFilesFromLocation(), [source]);
  assert.equal(storageReads, 0);
  assert.equal(await readBrowserDevCollectionText(source), "server original");
  const reported = [];
  assert.deepEqual(await browserDevFilesFromLocation(error => reported.push(error)), [source]);
  assert.equal(reported.length, 1);
  for (const [search, path] of [
    ["?devFiles=/server/current.sdf", "/server/current.sdf"],
    ["?devFiles=samples/current.sdf", absoluteBrowserDevPath("samples/current.sdf")],
    ["?quickLookFile=/server/quick.sdf", "/server/quick.sdf"],
    ["?devDocking=/server/receptor.sdf%0A/server/ligand.sdf", "/server/ligand.sdf"],
    ["?devFolder=/server/project/", "/server/project/nested/current.sdf"],
  ]) {
    window.location.search = search;
    assert.equal(await readBrowserDevCollectionText(path), "server original");
  }
  window.location.search = "";
  window.BuretteMcpWorkspace = { initialPaths: ["/server/mcp.sdf"], authorizedPaths: ["/server/authorized.sdf"] };
  assert.deepEqual(await browserDevFilesFromLocation(), ["/server/mcp.sdf"]);
  for (const path of ["/server/mcp.sdf", "/server/authorized.sdf"]) assert.equal(await readBrowserDevCollectionText(path), "server original");
  assert.equal(reads, 8);
  // Current draft text always wins, even for an explicit server source.
  writeBrowserDevVirtualTextDocument("/server/mcp.sdf", "current draft");
  assert.equal(await readBrowserVirtualText("/server/mcp.sdf"), "current draft");
`));

test("storage failure stays explicit for imported originals and adjacent folder names are not server sources", () => isolated(`
  globalThis.window = { location: { search: "?devFolder=/server/project" } };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { throw new DOMException("denied", "SecurityError"); } } });
  const { readBrowserVirtualText } = await import(base + "browser-dev-documents.ts");
  const { browserDevFilesFromLocation } = await import(base + "browser-dev-startup.ts");
  for (const path of ["/OpenedFiles/original.cif", "/LocalProject/original.cif", "/server/project-other/original.cif"]) {
    await assert.rejects(readBrowserVirtualText(path), /denied/);
  }
  window.location.search = "";
  await assert.rejects(browserDevFilesFromLocation(), /denied/);
  await assert.rejects(browserDevFilesFromLocation(() => { throw new Error("must not report an empty inventory"); }), /denied/);
`));

test("standalone demo initialization retains restored imports in sidebar inventory", () => isolated(`
  const { IDBFactory } = await import("fake-indexeddb");
  globalThis.window = { location: { search: "" } };
  globalThis.fetch = async () => new Response("demo source");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  const store = await import(base + "browser-import-storage.ts");
  const source = new Blob(["data_original\\r\\n_cell_length_a 10\\r\\n"]);
  const saved = await store.saveBrowserImport({ path: "/OpenedFiles/restored.cif", name: "restored.cif", kind: "text", file: source });
  const workspace = await import(base + "web-demo-workspace.ts");
  await workspace.initializeBrowserImportedFiles();
  await workspace.initializeWebDemoWorkspace();
  await workspace.initializeWebDemoWorkspace();
  assert(workspace.webDemoProjectStructures().some(file => file.path === saved.path));
  assert.equal(await (await store.readBrowserImport(saved.path)).file.text(), await source.text());
`, true));

test("a corrupt saved original is reported while an explicit server file still opens", () => isolated(`
  const { IDBFactory } = await import("fake-indexeddb");
  globalThis.window = { location: { search: "?devFiles=/server/current.sdf" } };
  const factory = new IDBFactory();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: factory });
  await new Promise((resolve, reject) => {
    const request = factory.open("burette-browser-imports", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "path" });
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put({ path: "/OpenedFiles/broken.cif", name: "broken.cif", kind: "text", file: "not a Blob" });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  });
  const { browserDevFilesFromLocation } = await import(base + "browser-dev-startup.ts");
  const { readBrowserDevCollectionText, readBrowserVirtualText } = await import(base + "browser-dev-documents.ts");
  const errors = [];
  assert.deepEqual(await browserDevFilesFromLocation(error => errors.push(error.message)), ["/server/current.sdf"]);
  assert.equal(errors.length, 1); assert.match(errors[0], /could not be restored/);
  globalThis.fetch = async () => new Response("server original");
  assert.equal(await readBrowserDevCollectionText("/server/current.sdf"), "server original");
  await assert.rejects(readBrowserVirtualText("/OpenedFiles/broken.cif"), /could not be restored/);
`));

test("a picked folder sharing demo paths keeps its originals, drafts and sidebar metadata", () => isolated(`
  const { IDBFactory } = await import("fake-indexeddb");
  const { standaloneDemoScenes } = await import(base + "web-demo-scenes.ts");
  const { demoLibraryFiles } = await import(base + "web-demo-library.ts");
  globalThis.window = { location: { search: "" } };
  globalThis.fetch = async () => new Response("builtin demo body");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  const relativePaths = [standaloneDemoScenes[0].path, demoLibraryFiles[0].path];
  const picked = relativePaths.map((path, i) => {
    const file = new File(["user original " + i + "\\r\\n"], path.split("/").at(-1));
    Object.defineProperty(file, "webkitRelativePath", { value: "BuretteDemo/" + path });
    return file;
  });
  globalThis.document = { body: { append() {} }, createElement() {
    const handlers = new Map();
    return { files: picked, setAttribute() {}, remove() {}, addEventListener(name, fn) { handlers.set(name, fn); }, click() { handlers.get("change")(); } };
  } };
  const workspace = await import(base + "web-demo-workspace.ts");
  const documents = await import(base + "browser-dev-documents.ts");
  const store = await import(base + "browser-import-storage.ts");
  const selection = await workspace.pickWebDemoFiles({ directory: true });
  assert.deepEqual(selection.paths, relativePaths.map(path => "/BuretteDemo/" + path));
  const before = workspace.webDemoProjectStructures().filter(file => selection.paths.includes(file.path));
  documents.writeBrowserDevVirtualTextDocument(selection.paths[0], "current local draft");
  await workspace.initializeBrowserImportedFiles();
  await workspace.initializeWebDemoWorkspace();
  assert.equal(await documents.readBrowserVirtualText(selection.paths[0]), "current local draft");
  assert.equal(await documents.readBrowserVirtualText(selection.paths[1]), await picked[1].text());
  assert.deepEqual(workspace.webDemoProjectStructures().filter(file => selection.paths.includes(file.path)), before);
  for (let i = 0; i < picked.length; i++) assert.deepEqual(await (await store.readBrowserImport(selection.paths[i])).file.arrayBuffer(), await picked[i].arrayBuffer());
`, true));
