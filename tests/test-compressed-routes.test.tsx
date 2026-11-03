import { IDBObjectStore, indexedDB } from "fake-indexeddb";
import { afterAll, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { Window } from "happy-dom";
import React, { act } from "react";

// Every browser route a compressed file can take, through the hooks the app wires
// together: the Open menu, a window drop, a dock drop, Files/Recent reopen of a
// stored import, an explicitly selected server file and Download. Only the OS file
// chooser is replaced. Fixtures come from GNU gzip, XZ Utils, Zstandard and
// Biopython; compressed copies are checked with the gzip, xz and zstd tools and
// Python's own gzip and lzma modules, never only with the decoder under test.
const browser = new Window({ url: "http://localhost/" });
browser.matchMedia = (() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} })) as never;
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: browser, self: browser, document: browser.document, Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  SVGElement: browser.SVGElement, DocumentFragment: browser.DocumentFragment, MutationObserver: browser.MutationObserver,
  CustomEvent: browser.CustomEvent, Event: browser.Event, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent, navigator: browser.navigator, localStorage: browser.localStorage, CSS: browser.CSS,
  requestAnimationFrame: (callback: () => void) => browser.setTimeout(callback, 0), cancelAnimationFrame: (id: number) => browser.clearTimeout(id),
  getComputedStyle: browser.getComputedStyle.bind(browser), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  indexedDB, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
afterAll(async () => {
  await browser.happyDOM.close();
  for (const [name, value] of previous) value ? Object.defineProperty(globalThis, name, value) : Reflect.deleteProperty(globalThis, name);
});

let chosen: File[] = [];
const picker = await import("../apps/desktop/src/lib/browser-file-picker");
mock.module("../apps/desktop/src/lib/browser-file-picker", () => ({ ...picker, pickBrowserFiles: async () => chosen }));
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useAppOpenActions } = await import("../apps/desktop/src/hooks/use-app-open-actions");
const { useAppDockPayloadOpen } = await import("../apps/desktop/src/hooks/use-app-dock-payload-open");
const { useOpenDrop } = await import("../apps/desktop/src/hooks/use-open-drop");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { detectContentSpectrumPaths } = await import("../apps/desktop/src/lib/content-spectrum-detection");
const { expandBrowserDevStructureBundles } = await import("../apps/desktop/src/lib/browser-dev-structure-bundles");
const { deleteBrowserDevVirtualTextDocument, readBrowserDevVirtualTextDocument, readBrowserVirtualText, writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { initializeBrowserImportedFiles, webDemoProjectStructures } = await import("../apps/desktop/src/lib/web-demo-workspace");
const { listBrowserImports, readBrowserImport, saveBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
const { compressedSourceFor, decodeCompressedSource, registerCompressedSource } = await import("../apps/desktop/src/lib/compressed-files/sources");
const { supportedCompressedName } = await import("../apps/desktop/src/lib/compressed-files/formats");
const { readStructureText } = await import("../apps/desktop/src/lib/structure-text");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { BrowserStructureDownload } = await import("../apps/desktop/src/components/browser-structure-download");

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/compressed/${name}`, import.meta.url)));
const sample = (path: string) => readFileSync(new URL(`../samples/${path}`, import.meta.url), "utf8");
const file = (bytes: BlobPart, name: string) => new File([bytes], name);
const bytesOf = async (blob: Blob | null | undefined) => new Uint8Array(await blob!.arrayBuffer());
const MINI_PDB = sample("mini.pdb"), CAFFEINE = sample("structures/small-molecules/caffeine.sdf");

type Captured = { structures: [string, string][]; texts: [string, string, string][]; documentTabs: string[]; errors: string[]; requests: string[] };
let captured: Captured;
type Hooks = ReturnType<typeof useAppFileOpen> & ReturnType<typeof useAppOpenActions> & ReturnType<typeof useOpenDrop>;

function Harness({ expose }: { expose: (hooks: Hooks) => void }) {
  const preferences = { ...defaultPreferences, rendererMode: "molstar" as const };
  const addStructures = (documents: { path: string; extension: string }[]) => {
    captured.structures.push(...documents.map((document) => [document.path, document.extension] as [string, string]));
    useMoleculeStore.getState().addDocuments(documents as never);
  };
  const addTexts = (documents: { path: string; extension: string; content: string }[]) => {
    captured.texts.push(...documents.map((document) => [document.path, document.extension, document.content] as [string, string, string]));
  };
  // A summarized status carries every message as its details.
  const status = (message: unknown, kind?: string, details?: string[]) => {
    if (kind === "error") captured.errors.push(...details ?? [String(message instanceof Error ? message.message : message)]);
  };
  const noop = () => {};
  const fileOpen = useAppFileOpen({
    preferences, addProjectRoot: noop, addBackgroundDocuments: addStructures, addBackgroundTextDocuments: addTexts,
    addDocuments: addStructures, addTextDocuments: addTexts, closeDocument: noop, detectContentSpectrumPaths,
    expandStructureBundles: expandBrowserDevStructureBundles, openDockTab: noop, openDocumentsInActiveTab: addStructures,
    openDocumentTab: (path) => captured.documentTabs.push(path), openFepNetworkTab: noop, openTextDocumentsInActiveTab: addTexts,
    pushErrorStatus: (error) => status(error, "error"), pushStatus: status, rememberRecentStructures: noop,
    replaceDocument: noop, setActiveDocument: noop, setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop, setDocuments: addStructures,
  } as never);
  const openActions = useAppOpenActions({ openPaths: fileOpen.openPaths, openStructureRecords: async () => [], pushErrorStatus: (error) => status(error, "error"), pushStatus: status, recentStructures: [] } as never);
  const openDockPayload = useAppDockPayloadOpen({
    preferences, addBackgroundDocuments: addStructures, addBackgroundTextDocuments: addTexts,
    captureDockTarget: () => ({ workspaceId: "test", addDockDrop: noop, setDockDocument: noop, setDockTool: noop }),
    detectContentSpectrumPaths, documents: [], openStructureRecordDocuments: async () => ({ opened: [], errors: [] }),
    pushErrorStatus: (error) => status(error, "error"), pushStatus: status, rememberRecentStructures: noop, textDocuments: [],
  } as never);
  const drop = useOpenDrop(fileOpen.openPaths as never, status, { openStructureRecords: async () => [], openDockPayload } as never);
  expose({ ...fileOpen, ...openActions, ...drop } as Hooks);
  return null;
}

async function withHarness(run: (hooks: Hooks) => Promise<void>) {
  captured = { structures: [], texts: [], documentTabs: [], errors: [], requests: [] };
  useMoleculeStore.getState().setDocuments([]);
  const before = globalThis.fetch;
  // Browser imports never leave the browser; any read of them would be a server request.
  globalThis.fetch = (async (url: string) => {
    captured.requests.push(String(url));
    return new Response(JSON.stringify({ error: `not served: ${url}` }), { status: 404, headers: { "Content-Type": "application/json" } });
  }) as never;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let hooks!: Hooks;
  await act(async () => root.render(<Harness expose={(next) => { hooks = next; }} />));
  try { await run(hooks); } finally {
    globalThis.fetch = before;
    await act(async () => root.unmount());
    host.remove();
  }
}

async function until(done: () => boolean, what: string) {
  for (let attempt = 0; attempt < 400 && !done(); attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  if (!done()) throw new Error(`Timed out waiting for ${what}`);
}

/** A file drop as the browser delivers it; `target` decides between the workspace and a dock. */
async function dropFiles(hooks: Hooks, files: File[], target: Element = document.body) {
  const event = { dataTransfer: { types: ["Files"], files, items: [], getData: () => "" }, preventDefault() {}, stopPropagation() {}, target, clientX: 8, clientY: 8 };
  await act(async () => { hooks.handleBrowserDrop(event as never); });
}

function routeOf(path: string) {
  const structure = captured.structures.find(([candidate]) => candidate === path);
  if (structure) return ["structure", structure[1]];
  const text = captured.texts.find(([candidate]) => candidate === path);
  if (text) return ["text", text[1], text[2]];
  return captured.documentTabs.includes(path) ? ["document"] : ["unopened"];
}

/** The two independent readers of each format: its command-line tool and Python's standard library. */
function independentDecode(codec: "gzip" | "xz" | "zstd", bytes: Uint8Array) {
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { input: bytes, maxBuffer: 256 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout;
  };
  const tool = codec === "gzip" ? "gzip" : codec;
  run(tool, ["-t"]);
  const decoded = [run(tool, ["-dc"])];
  if (codec !== "zstd") decoded.push(run("python3", ["-c", `import sys, ${codec === "gzip" ? "gzip as m" : "lzma as m"}; sys.stdout.buffer.write(m.decompress(sys.stdin.buffer.read()))`]));
  return decoded.map((output) => new TextDecoder("utf-8", { fatal: true }).decode(output));
}
const missingTools = ["gzip", "xz", "zstd", "python3"].filter((tool) => !Bun.which(tool));

test("the Open menu opens every compressed copy exactly as its uncompressed namesake", async () => {
  const log = "Normal termination of a test run\n", csv = "name,value\nalpha,1\n", fasta = ">seq1\nMKTAYIAKQR\n";
  chosen = [
    file(MINI_PDB, "menu.pdb"), file(fixture("mini.pdb.gz"), "menu.pdb.gz"), file(fixture("mini-members.pdb.gz"), "members.pdb.gz"),
    file(fixture("mini.pdb.bgz"), "reads.pdb.bgz"), file(fixture("mini-frames.pdb.zst"), "frames.pdb.zst"),
    file(sample("mini.cif"), "menu.cif"), file(fixture("mini.cif.zst"), "menu.cif.zst"),
    file(sample("mini.xyz"), "menu.xyz"), file(fixture("mini-streams.xyz.xz"), "menu.xyz.xz"),
    file(log, "run.log"), file(gzipSync(log), "run.log.gz"), file(csv, "table.csv"), file(gzipSync(csv), "table.csv.gz"),
    file(fasta, "seq.fasta"), file(gzipSync(fasta), "seq.fasta.gz"),
  ];
  await withHarness(async (hooks) => { await act(async () => hooks.chooseFiles()); });
  const compressedPaths = chosen.map(({ name }) => `/OpenedFiles/${name}`).filter((path) => /\.(?:gz|bgz|zst|xz)$/u.test(path));
  const plainFor = (path: string) => path.replace(/\.(?:gz|bgz|zst|xz)$/u, "").replace(/(members|reads|frames)\.pdb$/u, "menu.pdb");
  expect({
    routes: compressedPaths.map((path) => [path, routeOf(path)]),
    errors: captured.errors,
    // Uncompressed namesakes probe for server-side bundles; no compressed copy is ever read from the server.
    requests: captured.requests.filter((url) => compressedPaths.some((path) => url.includes(encodeURIComponent(path)))),
  }).toEqual({
    routes: compressedPaths.map((path) => [path, routeOf(plainFor(path))]),
    errors: [],
    requests: [],
  });
  expect(routeOf("/OpenedFiles/menu.pdb.gz")).toEqual(["structure", "pdb"]);
  // Every copy holds its namesake's text as the draft and keeps the chosen bytes as its Original.
  for (const path of compressedPaths) {
    expect(readBrowserDevVirtualTextDocument(path)).toBe(readBrowserDevVirtualTextDocument(plainFor(path)) ?? await readStructureText(plainFor(path)));
    const chosenFile = chosen.find(({ name }) => path.endsWith(`/${name}`))!;
    expect(await bytesOf(compressedSourceFor(path)?.file)).toEqual(await bytesOf(chosenFile));
    expect(await bytesOf((await readBrowserImport(path))?.file)).toEqual(await bytesOf(chosenFile));
  }
  // The Files sidebar lists a copy as the format inside it.
  expect(webDemoProjectStructures().find(({ path }) => path === "/OpenedFiles/menu.cif.zst")?.extension).toBe("cif");
});

test("a file that does not decode completely is refused by name and nothing of it is kept", async () => {
  const pdbGz = fixture("mini.pdb.gz");
  const badCrc = pdbGz.slice(); badCrc[badCrc.length - 8] ^= 1;
  const before = (await listBrowserImports()).map(({ path }) => path);
  chosen = [
    file(pdbGz.subarray(0, 100), "cut.pdb.gz"), file(badCrc, "crc.pdb.gz"), file(fixture("caffeine.sdf.xz"), "wrong.sdf.gz"),
    file(fixture("caffeine.sdf.xz").subarray(0, 600), "cut.sdf.xz"), file(fixture("mini-frames.pdb.zst").subarray(0, 200), "cut.pdb.zst"),
    file(gzipSync(gzipSync(MINI_PDB)), "nested.pdb.gz"), file(gzipSync(new Uint8Array([0x48, 0, 0x49])), "binary.pdb.gz"),
    file(fixture("spaces-65mib.xyz.xz"), "spaces.xyz.xz"), file(fixture("window-128mib.pdb.zst"), "window.pdb.zst"),
    file(fixture("dict-128mib.xyz.xz"), "dict.xyz.xz"), file(pdbGz, "double.pdb.gz.gz"), file(gzipSync("x"), "bundle.tar.gz"),
    file(new Uint8Array(4 * 1024 * 1024), "large.pdb.gz"), file(pdbGz, "sibling.pdb.gz"),
  ];
  await withHarness(async (hooks) => { await act(async () => hooks.chooseFiles()); });
  expect(captured.errors).toEqual([
    "cut.pdb.gz is truncated",
    "crc.pdb.gz is corrupt or truncated: a gzip member does not match its checksum",
    "wrong.sdf.gz is named as gzip but contains XZ data",
    "cut.sdf.xz is truncated or has data after its last XZ stream",
    "cut.pdb.zst is truncated",
    "nested.pdb.gz contains compressed data inside; nested archives are not opened",
    "binary.pdb.gz contains binary data, not a text file",
    "spaces.xyz.xz expands beyond the 64 MiB limit for decompressed files",
    "window.pdb.zst needs a Zstandard window larger than the 64 MiB browser limit",
    "dict.xyz.xz needs a dictionary larger than the 64 MiB browser limit",
    "double.pdb.gz.gz is compressed more than once",
    "bundle.tar.gz: Compressed .tar files cannot be opened in the browser",
    "large.pdb.gz: larger than the 3 MB browser file limit",
  ]);
  // The readable sibling still opens; no refused file is stored, listed, registered or given text.
  expect(captured.structures).toEqual([["/OpenedFiles/sibling.pdb.gz", "pdb"]]);
  expect((await listBrowserImports()).map(({ path }) => path).sort()).toEqual([...before, "/OpenedFiles/sibling.pdb.gz"].sort());
  for (const { name } of chosen.slice(0, -1)) {
    const path = `/OpenedFiles/${name}`;
    expect([compressedSourceFor(path), readBrowserDevVirtualTextDocument(path), webDemoProjectStructures().some((entry) => entry.path === path)]).toEqual([null, null, false]);
  }
});

test("window and dock drops admit compressed files once, keep same-name drops apart and report each failure", async () => {
  await withHarness(async (hooks) => {
    await dropFiles(hooks, [file(fixture("mini-members.pdb.gz"), "drop.pdb.gz"), file(fixture("caffeine.sdf.xz"), "drop.sdf.xz"), file(fixture("mini.pdb.gz").subarray(0, 100), "drop-cut.pdb.gz")]);
    await until(() => captured.structures.length === 2 && captured.errors.length === 1, "the window drop");
    await dropFiles(hooks, [file(fixture("mini-frames.pdb.zst"), "drop.pdb.gz")]);
    await until(() => captured.errors.length === 2, "the mislabelled drop");
    await dropFiles(hooks, [file(fixture("mini.pdb.gz"), "drop.pdb.gz")]);
    await until(() => captured.structures.length === 3, "the same-name drop");
    const dock = Object.assign(document.createElement("div"), { className: "dock-panel" });
    dock.dataset.area = "right";
    document.body.append(dock);
    await dropFiles(hooks, [file(fixture("mini.cif.zst"), "dock.cif.zst")], dock);
    await until(() => captured.structures.length === 4, "the dock drop");
    dock.remove();
  });
  expect({ structures: captured.structures, errors: captured.errors, requests: captured.requests }).toEqual({
    structures: [["/OpenedFiles/drop.pdb.gz", "pdb"], ["/OpenedFiles/drop.sdf.xz", "sdf"], ["/OpenedFiles/drop (2).pdb.gz", "pdb"], ["/OpenedFiles/dock.cif.zst", "cif"]],
    errors: ["drop-cut.pdb.gz is truncated", "drop.pdb.gz is named as gzip but contains Zstandard data"],
    requests: [],
  });
  // Each same-name drop keeps its own exact Original and text.
  expect(await bytesOf(compressedSourceFor("/OpenedFiles/drop.pdb.gz")?.file)).toEqual(fixture("mini-members.pdb.gz"));
  expect(await bytesOf(compressedSourceFor("/OpenedFiles/drop (2).pdb.gz")?.file)).toEqual(fixture("mini.pdb.gz"));
  expect(compressedSourceFor("/OpenedFiles/drop (2).pdb.gz")?.name).toBe("drop.pdb.gz");
  expect([await readStructureText("/OpenedFiles/drop (2).pdb.gz"), await readStructureText("/OpenedFiles/dock.cif.zst")]).toEqual([MINI_PDB, sample("mini.cif")]);
});

test.skipIf(missingTools.length > 0)(`Download writes copies independent tools decode to the edited text, Original stays exact, and a copy reopens (needs ${missingTools.join(", ") || "gzip, xz, zstd, python3"})`, async () => {
  const cases = [
    ["dl.pdb.gz", fixture("mini.pdb.gz"), "gzip", "dl.pdb.gz", MINI_PDB],
    ["dl.pdb.bgz", fixture("mini.pdb.bgz"), "gzip", "dl.pdb.gz", MINI_PDB],
    ["dl.sdf.xz", fixture("caffeine.sdf.xz"), "xz", "dl.sdf.xz", CAFFEINE],
    ["dl.cif.zst", fixture("mini.cif.zst"), "zstd", "dl.cif.zst", sample("mini.cif")],
  ] as const;
  const blobs: Blob[] = [];
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = ((blob: Blob) => { blobs.push(blob); return "blob:test"; }) as never;
  try {
    await withHarness(async (hooks) => {
      chosen = cases.map(([name, bytes]) => file(bytes, name));
      await act(async () => hooks.chooseFiles());
      for (const [index, [name, original, codec, exportName, text]] of cases.entries()) {
        const path = `/OpenedFiles/${name}`;
        const document = useMoleculeStore.getState().documents.find((candidate) => candidate.path === path)!;
        // An unsaved draft with CRLF and non-ASCII text is what Text and Compressed save.
        const draft = `${text}REMARK edited é\r\n`;
        const host = window.document.createElement("div");
        window.document.body.append(host);
        const root = createRoot(host);
        const choose = async (label: string) => {
          await act(async () => { host.querySelector('[aria-label="Download file"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
          const items = [...window.document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
          const count = blobs.length;
          await act(async () => { items.find((item) => item.textContent?.startsWith(label))!.click(); });
          await until(() => blobs.length > count, `${label} download of ${name}`);
          return { labels: items.map((item) => item.textContent), blob: blobs.at(-1)! };
        };
        try {
          await act(async () => root.render(
            <SourceEditingProvider value={{ sessionForDocument: (candidate: { id: string } | null) => candidate?.id === document.id ? { content: draft } : null } as never}>
              <BrowserStructureDownload file={{ path, label: name }} document={document} />
            </SourceEditingProvider>,
          ));
          const textDownload = await choose("Text");
          expect(textDownload.labels).toEqual([`Text · ${name.replace(/\.(?:gz|bgz|xz|zst)$/u, "")}`, `Compressed · ${exportName}`, `Original · ${name}`]);
          expect(await textDownload.blob.text()).toBe(draft);
          const copy = await bytesOf((await choose("Compressed")).blob);
          expect(independentDecode(codec, copy)).toEqual(codec === "zstd" ? [draft] : [draft, draft]);
          expect(await bytesOf((await choose("Original")).blob)).toEqual(original);
          // The draft was never written back over the decoded file text.
          expect(readBrowserDevVirtualTextDocument(path)).toBe(text);
          // The downloaded copy reopens through an ordinary drop as the edited text.
          const opened = captured.structures.length;
          await dropFiles(hooks, [file(copy, `reopened-${index}-${exportName}`)]);
          await until(() => captured.structures.length > opened, `reopening ${exportName}`);
          const reopened = captured.structures.at(-1)![0];
          expect([reopened, await readStructureText(reopened), await bytesOf(compressedSourceFor(reopened)?.file)]).toEqual([`/OpenedFiles/reopened-${index}-${exportName}`, draft, copy]);
        } finally {
          await act(async () => root.unmount());
          host.remove();
        }
      }
    });
  } finally {
    URL.createObjectURL = createObjectURL;
  }
  expect(captured.errors).toEqual([]);
});

test("a stored import reopened from Files or Recent decodes from its retained Original; a damaged one opens nothing", async () => {
  // Saved by an earlier session: the store holds the bytes, this runtime has no text yet.
  const stored = await saveBrowserImport({ path: "/OpenedFiles/earlier.sdf.xz", name: "earlier.sdf.xz", kind: "compressed", file: new Blob([fixture("caffeine.sdf.xz")]) });
  const damaged = await saveBrowserImport({ path: "/OpenedFiles/damaged.pdb.gz", name: "damaged.pdb.gz", kind: "compressed", file: new Blob([fixture("mini.pdb.gz").subarray(0, 120)]) });
  await initializeBrowserImportedFiles();
  expect([stored.path, damaged.path].map((path) => webDemoProjectStructures().find((entry) => entry.path === path)?.extension)).toEqual(["sdf", "pdb"]);
  expect(readBrowserDevVirtualTextDocument(stored.path)).toBeNull();
  await withHarness(async (hooks) => { await act(async () => hooks.openPaths([stored.path, damaged.path])); });
  expect({ structures: captured.structures, errors: captured.errors, requests: captured.requests }).toEqual({
    structures: [[stored.path, "sdf"]],
    errors: [expect.stringContaining("damaged.pdb.gz is truncated")],
    requests: [],
  });
  expect(readBrowserDevVirtualTextDocument(stored.path)).toBe(CAFFEINE);
  expect(readBrowserDevVirtualTextDocument(damaged.path)).toBeNull();
  // Neither Original was rewritten or evicted.
  expect(await bytesOf((await readBrowserImport(stored.path))?.file)).toEqual(fixture("caffeine.sdf.xz"));
  expect(await bytesOf((await readBrowserImport(damaged.path))?.file)).toEqual(fixture("mini.pdb.gz").subarray(0, 120));
  // A Recent reopen before restoration finds the stored Original through the reader itself.
  const recent = await saveBrowserImport({ path: "/OpenedFiles/recent.pdb.zst", name: "recent.pdb.zst", kind: "compressed", file: new Blob([fixture("mini-frames.pdb.zst")]) });
  expect([await readStructureText(recent.path), await bytesOf(compressedSourceFor(recent.path)?.file)]).toEqual([MINI_PDB, fixture("mini-frames.pdb.zst")]);
});

test("an explicitly selected server file is read once through /@fs/ and refused when the bytes are not what the name says", async () => {
  const path = "/authorized/from disk & query?.sdf.xz";
  const bytes = fixture("caffeine.sdf.xz");
  const before = globalThis.fetch;
  const requests: string[] = [];
  try {
    globalThis.fetch = (async (url: string) => {
      requests.push(String(url));
      return String(url).includes("not-xz") ? new Response("<html>app page</html>") : new Response(bytes, { headers: { "Content-Length": String(bytes.length) } });
    }) as never;
    expect(await readStructureText(path)).toBe(CAFFEINE);
    expect(await readStructureText(path)).toBe(CAFFEINE);
    expect(requests).toEqual(["/@fs/authorized/from%20disk%20%26%20query%3F.sdf.xz"]);
    expect(await bytesOf(compressedSourceFor(path)?.file)).toEqual(bytes);
    await expect(readStructureText("/authorized/not-xz.pdb.xz")).rejects.toThrow("not-xz.pdb.xz is named as XZ but is not XZ data");
    expect([compressedSourceFor("/authorized/not-xz.pdb.xz"), readBrowserDevVirtualTextDocument("/authorized/not-xz.pdb.xz")]).toEqual([null, null]);
  } finally { globalThis.fetch = before; }
});

test("a file replaced while it decodes never yields or caches the earlier text, and a draft written meanwhile is kept", async () => {
  const format = supportedCompressedName("handoff.pdb.gz");
  const path = "/OpenedFiles/handoff.pdb.gz", second = new Blob([gzipSync("SECOND\n")]);
  registerCompressedSource(path, "handoff.pdb.gz", new Blob([gzipSync("FIRST\n")]), format);
  const decoding = decodeCompressedSource(path);
  // Runs between the decode settling and the read resuming.
  const replacement = decoding.then(() => { deleteBrowserDevVirtualTextDocument(path); registerCompressedSource(path, "handoff.pdb.gz", second, format); });
  const reading = readBrowserVirtualText(path);
  expect(await decoding).toBe("FIRST\n");
  await replacement;
  await expect(reading).rejects.toThrow("handoff.pdb.gz was replaced while it was opening");
  expect(readBrowserDevVirtualTextDocument(path)).toBeNull();
  expect(await readBrowserVirtualText(path)).toBe("SECOND\n");

  const draftPath = "/OpenedFiles/handoff-draft.pdb.gz";
  registerCompressedSource(draftPath, "handoff-draft.pdb.gz", new Blob([gzipSync("DECODED\n")]), format);
  const edit = decodeCompressedSource(draftPath).then(() => writeBrowserDevVirtualTextDocument(draftPath, "DRAFT\n"));
  const read = readBrowserVirtualText(draftPath);
  await edit;
  expect([await read, readBrowserDevVirtualTextDocument(draftPath)]).toEqual(["DRAFT\n", "DRAFT\n"]);
});

test("a storage failure publishes no path and evicts no earlier Original", async () => {
  const before = await listBrowserImports();
  const add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function () { throw new DOMException("Quota reached", "QuotaExceededError"); };
  try {
    await withHarness(async (hooks) => {
      await dropFiles(hooks, [file(fixture("mini.pdb.gz"), "quota.pdb.gz")]);
      await until(() => captured.errors.length === 1, "the refused drop");
    });
  } finally { IDBObjectStore.prototype.add = add; }
  expect(captured.errors).toEqual(["quota.pdb.gz: Browser file storage is unavailable. Check available site storage and try again."]);
  expect([compressedSourceFor("/OpenedFiles/quota.pdb.gz"), readBrowserDevVirtualTextDocument("/OpenedFiles/quota.pdb.gz"), captured.structures]).toEqual([null, null, []]);
  const after = await listBrowserImports();
  expect(after.map(({ path }) => path)).toEqual(before.map(({ path }) => path));
  for (const [index, record] of after.entries()) expect(await bytesOf(record.file)).toEqual(await bytesOf(before[index].file));
});
