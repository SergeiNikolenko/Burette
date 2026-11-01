// Actual compiled host hook → HTTP session server → CLI subprocess → numerical workers.
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory } from "fake-indexeddb";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { addDocumentInternalCoordinates, releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";

plugin({ name: "orbital-agent-production-compiler", setup(build) {
  build.onLoad({ filter: /(?:use-(?:agent-session|source-editing|source-close-confirmation)\.ts|source-close-confirmation-dialog\.tsx|source-editing\/context\.tsx)$/u }, ({ path }) => {
    const source = readFileSync(path, "utf8").replace('import.meta.env.VITE_BURETTE_AGENT_SHELL', '"1"');
    const code = transformSync(source, { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] })?.code;
    if (!code) throw new Error("React compiler returned no code");
    console.log(JSON.stringify({ module: path.split("/").pop(), compilerCacheEmitted: code.includes("react/compiler-runtime") }));
    return { contents: code, loader: path.endsWith(".tsx") ? "tsx" : "ts" };
  });
} });
const browser = new Window({ url: "http://localhost/" });
const prior = new Map<string, PropertyDescriptor | undefined>();
function install(key: string, value: unknown) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, CSS: browser.CSS, localStorage: browser.localStorage, indexedDB: new IDBFactory(), HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Element: browser.Element, Node: browser.Node, NodeFilter: browser.NodeFilter, DocumentFragment: browser.DocumentFragment, CustomEvent: browser.CustomEvent, HTMLButtonElement: browser.HTMLButtonElement, HTMLInputElement: browser.HTMLInputElement, MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) install(key, value);
// Happy DOM has no EventSource. This adapter consumes the real server's SSE stream;
// polling and dispatch remain entirely in the production hook.
class HttpEvents extends EventTarget {
  abort = new AbortController();
  constructor(url: string) { super(); void fetch(url, { signal: this.abort.signal }).then(async response => {
    const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = "";
    while (!this.abort.signal.aborted) {
      const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      let boundary: number; while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const name = /^event: (.+)$/mu.exec(packet)?.[1]; if (name) this.dispatchEvent(new Event(name));
      }
    }
  }).catch(error => { if (!this.abort.signal.aborted) throw error; }); }
  close() { this.abort.abort(); }
}
install("EventSource", HttpEvents);
// Unrelated navigation/Ketcher adapters are outside this operation; source, controller,
// all workers, HTTP session transport, and CLI are real.
mock.module("../apps/desktop/src/components/editor-area/page-kinds", () => ({ deserializeLocation: () => null, serializeLocation: () => null }));
mock.module("../apps/desktop/src/lib/ketcher-agent", () => ({ subscribeKetcherAgentRegistry: () => () => {} }));
const { createRoot } = await import("react-dom/client");
const { openScientificDocument } = await import("../apps/desktop/src/lib/workbench/generated-document-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useAgentSession } = await import("../apps/desktop/src/hooks/use-agent-session");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { adoptLogicalSource, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
let sourceEditing!: ReturnType<typeof useSourceEditingController>;
const molden = `[Molden Format]\n[Atoms] AU\nH 1 1 0 0 0\n[GTO]\n1 0\ns 1 1.00\n1.0D+00 1.0\n[MO]\nSym= A\nEne= -0.5\nSpin= Alpha\nOccup= 0.25\n1 1.0\nSym= B\nEne= 0.25\nSpin= Beta\nOccup= 0.75\n1 -1.0\n`;
const repo = resolve(import.meta.dir, ".."), node = Bun.which("node")!;
const originalFetch = globalThis.fetch;
let root = "", session = "", baseUrl = "", token = "", draft: string | null = null;
let server: ReturnType<typeof spawn>, mounted: ReturnType<typeof createRoot>, unmounted = false;
let documents: ViewerDocument[] = [], source: ViewerDocument, sourceText = "";
const hookErrors: unknown[] = [];
function Probe() {
  sourceEditing = useSourceEditingController({ activeDocument: documents[0] ?? null, preferences: defaultPreferences, pushErrorStatus: (error: unknown) => hookErrors.push(error), setDockOpen() {}, setDockActiveTab() {} });
  useAgentSession({ activeDocument: documents[0], documents, activeTabId: "tab", activeTabKind: "document", tabs: [],
    tabActions: { openNewTab() {}, setActiveTab() {}, closeTab() {}, moveTab() {} }, openDockingDocument: async () => null,
    openPaths() {}, openKetcherTab() {}, openTextDocuments: async () => null, pushErrorStatus(error) { hookErrors.push(error); }, setDockDocument() {},
    sourceDraftForDocument: document => sourceEditing.sessionForDocument(document)?.content ?? null });
  return <SourceEditingProvider value={sourceEditing}><button type="button" data-close-invoker>Close source</button></SourceEditingProvider>;
}
async function render() { await act(async () => mounted.render(<Probe />)); }
function cli(request: Record<string, unknown>, extra: string[] = []) {
  return new Promise<{ status: number | null; body: any }>((done, reject) => {
    const child = spawn(node, [join(repo, "scripts/burette-agent.mjs"), "workbench", "--session-dir", session, JSON.stringify(request), "--wait-ms", "10000", ...extra], { cwd: repo });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject); child.on("close", status => { try { done({ status, body: JSON.parse(status === 0 ? stdout : stderr) }); } catch { reject(new Error(stdout + stderr)); } }); child.stdin.end();
  });
}
async function ok(request: Record<string, unknown>, extra: string[] = []) {
  const reply = await cli(request, extra); if (reply.status) throw new Error(JSON.stringify(reply.body)); expect(reply.status).toBe(0); return reply.body.result;
}
async function finished(jobId: string) {
  for (let i = 0; i < 50; i++) { const { job } = await ok({ operation: "status", jobId }); if (!["running", "queued"].includes(job.status)) return job; await Bun.sleep(10); }
  throw new Error("job did not finish");
}
const params = { field: "orbital", orbitalIndex: 1, spacingAngstrom: 0.5, paddingAngstrom: 1 };
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "burette-orbital-host-")); session = join(root, "session");
  await Promise.all([mkdir(session), mkdir(join(root, "dist"))]); await writeFile(join(root, "dist/index.html"), "<!doctype html><title>Agent fixture</title>");
  const listener = createServer(); await new Promise<void>(done => listener.listen(0, "127.0.0.1", done));
  const port = (listener.address() as { port: number }).port; await new Promise(done => listener.close(done));
  baseUrl = `http://127.0.0.1:${port}`; token = randomUUID();
  source = { id: "orbital-source", path: join(root, "h.xyz"), title: "h.xyz", extension: "xyz", renderer: "molstar", byteCount: molden.length, runtimePath: "viewer" };
  documents = [source];
  await openScientificDocument({ openStructureRecords: async records => {
    sourceText = records[0].text; await writeFile(source.path, sourceText);
    useMoleculeStore.setState({ documents }); return documents;
  } }, "h.molden", parseScientificFile("h.molden", molden), "final", { name: "h.molden", file: new Blob([molden]) });
  await writeFile(join(session, "session.json"), JSON.stringify({ apiVersion: "burette-agent-cli/v1", mode: "browser-dev-shell", token, createdAt: new Date().toISOString(), initialPaths: [source.path], allowedRoots: [root], sessionDir: session, host: "127.0.0.1", port, url: `${baseUrl}/?shellToken=${token}` }));
  await writeFile(join(session, "actions.json"), JSON.stringify({ apiVersion: "burette-agent-control/v1", actions: [] }));
  server = spawn(node, [join(repo, "scripts/agent-shell-server.mjs"), "--dist", join(root, "dist"), "--session-dir", session, "--allow", root, "--host", "127.0.0.1", "--port", String(port)], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { if (await originalFetch(baseUrl + "/healthz").then(r => r.ok, () => false)) break; await Bun.sleep(25); }
  // Browser URL/cookie semantics adapted to Bun, without replacing any HTTP response.
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => originalFetch(typeof url === "string" ? new URL(url, baseUrl) : url,
    { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } })) as typeof fetch;
  mounted = createRoot(document.body.appendChild(document.createElement("div"))); await render();
  for (let i = 0; i < 100; i++) { if (await readFile(join(session, "observe.json")).then(() => true, () => false)) break; await Bun.sleep(10); }
});
afterAll(async () => {
  if (mounted && !unmounted) await act(async () => mounted.unmount()); await Bun.sleep(20);
  server?.kill("SIGTERM"); releaseClosedImports(new Set()); releaseClosedScienceSessions(new Set()); globalThis.fetch = originalFetch;
  for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  if (root) await new Promise<void>((done, reject) => execFile("timeout", ["30", "/usr/bin/trash", root], error => error ? reject(error) : done()));
});

async function confirmation() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    if (dialog) return dialog;
    await act(async () => { await Bun.sleep(10); });
  }
  throw new Error("The application confirmation did not appear");
}
async function choose(label: string) {
  const dialog = await confirmation();
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent === label);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}

test("compiled browser source dialog preserves Cancel/Escape/close and retires real jobs only after Discard", async () => {
  const observed = await ok({ operation: "observe" });
  const jobs: string[] = [];
  for (const field of ["orbital", "density", "spin-density"]) {
    const { job } = await ok({ operation: "submit", operationId: `dirty-close-${field}`, expectedSourceRevision: observed.sourceRevision,
      job: { kind: "orbital_cube", params: field === "orbital" ? params : { field, spacingAngstrom: 0.5, paddingAngstrom: 1 } } });
    expect((await finished(job.jobId)).status).toBe("succeeded"); jobs.push(job.jobId);
  }
  await act(async () => { await sourceEditing.beginEditing(source); });
  expect(hookErrors).toEqual([]);
  expect(sourceEditing.sessionForDocument(source)?.content).toBe(sourceText);
  const edited = sourceText.split("\n").map(line => /^H\s/u.test(line) ? "H 0.1 0 0" : line).join("\n");
  expect(edited).not.toBe(sourceText);
  const originalConfirm = window.confirm;
  window.confirm = () => { throw new Error("Dirty source close must use the application dialog"); };
  try {
    await act(async () => { sourceEditing.updateDraft(source, edited); });
    expect(sourceEditing.sessionForDocument(source)?.dirty).toBe(true);
    let previousRequest: ReturnType<typeof useSourceEditingController>["closeConfirmation"];
    for (const route of ["Cancel", "Escape", "corner"]) {
      const invoker = document.querySelector<HTMLButtonElement>("[data-close-invoker]")!; invoker.focus();
      let closing!: Promise<boolean>, settled = false;
      await act(async () => { closing = sourceEditing.closeDocuments([source.id]); void closing.then(() => { settled = true; }); });
      const dialog = await confirmation();
      expect(dialog.textContent).toContain(`Discard unsaved changes to “${source.title}” and close this document?`);
      expect(document.activeElement?.textContent).toBe("Cancel"); expect(settled).toBe(false);
      await act(async () => previousRequest?.discard());
      expect(settled).toBe(false); previousRequest = sourceEditing.closeConfirmation;
      // Real SSE/CLI status remains live while the close owner is waiting for a choice.
      expect((await ok({ operation: "status", jobId: jobs[0] })).job.binding).toBe("stale");
      await act(async () => { sourceEditing.updateDraft(source, "blocked replacement"); await sourceEditing.save(source); });
      expect(await sourceEditing.closeDocuments([source.id])).toBe(false);
      expect(sourceEditing.sessionForDocument(source)?.content).toBe(edited);
      if (route === "Cancel") await choose("Cancel");
      else await act(async () => {
        if (route === "Escape") dialog.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as KeyboardEvent);
        else dialog.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click();
      });
      await act(async () => { expect(await closing).toBe(false); await Bun.sleep(5); });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(document.activeElement).toBe(invoker);
      expect([sourceEditing.sessionForDocument(source)?.content, useMoleculeStore.getState().documents.map(doc => doc.id)]).toEqual([edited, [source.id]]);
    }
    const stale = (await ok({ operation: "status", jobId: jobs[0] })).job;
    expect([stale.status, stale.binding]).toEqual(["stale", "stale"]);
    const retained = await ok({ operation: "export", jobId: jobs[0], artifact: "cube", allowStale: true });
    expect((await readFile(retained.artifact.path)).length).toBeGreaterThan(0);
    let closing!: Promise<boolean>;
    await act(async () => { closing = sourceEditing.closeDocuments([source.id]); });
    await confirmation(); await choose("Discard");
    let canClose = false;
    await act(async () => {
      canClose = await closing;
      if (canClose) useMoleculeStore.getState().closeDocument(source.id);
      documents = useMoleculeStore.getState().documents;
    });
    await render();
    expect([canClose, sourceEditing.sessionForDocument(source), documents]).toEqual([true, null, []]);
    for (const jobId of jobs) {
      const closed = (await ok({ operation: "status", jobId })).job;
      expect([closed.status, closed.binding, closed.summary, closed.artifacts]).toEqual(["source_closed", "source_closed", null, []]);
      expect((await cli({ operation: "export", jobId, artifact: "cube", allowStale: true })).body.error.code).toBe("SOURCE_CLOSED");
    }
    expect(await readFile(source.path, "utf8")).toBe(sourceText); expect(hookErrors).toEqual([]);
  } finally { window.confirm = originalConfirm; }
}, 30000);

async function freshDirtySource(name: string) {
  sourceText = "1\nFresh close owner\nH 0 0 0\n";
  source = { id: name, path: join(root, `${name}.xyz`), title: `${name}.xyz`, extension: "xyz", renderer: "molstar", byteCount: sourceText.length, runtimePath: "viewer" };
  await writeFile(source.path, sourceText);
  documents = [source]; useMoleculeStore.setState({ documents }); await render();
  await act(async () => { await sourceEditing.beginEditing(source); sourceEditing.updateDraft(source, "1\nFresh close owner\nH 0.2 0 0\n"); });
  expect(sourceEditing.sessionForDocument(source)?.dirty).toBe(true);
  return source;
}

test("a captured close cannot discard a replacement source or another document", async () => {
  const captured = await freshDirtySource("replaced-source");
  const other = { ...captured, id: "retained-source", path: join(root, "retained-source.xyz"), title: "retained-source.xyz" };
  await writeFile(other.path, sourceText); documents = [captured, other]; useMoleculeStore.setState({ documents }); await render();
  let closing!: Promise<boolean>;
  await act(async () => { closing = sourceEditing.closeDocuments([captured.id]); });
  await confirmation();
  await act(async () => adoptLogicalSource({ documentId: captured.id, extension: "xyz", text: "1\nReplacement\nH 3 0 0\n" }, crypto.randomUUID(), null, ["H"]));
  await choose("Discard");
  await act(async () => { expect(await closing).toBe(false); });
  expect(useMoleculeStore.getState().documents.map(doc => doc.id)).toEqual([captured.id, other.id]);
  expect(await readFile(captured.path, "utf8")).toBe(sourceText);
  expect(await readFile(other.path, "utf8")).toBe(sourceText);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

test("Discard closes the captured document while a separate document stays open", async () => {
  const captured = await freshDirtySource("named-source");
  const other = { ...captured, id: "named-neighbor", path: join(root, "named-neighbor.xyz"), title: "named-neighbor.xyz" };
  await writeFile(other.path, sourceText); documents = [captured, other]; useMoleculeStore.setState({ documents }); await render();
  let closing!: Promise<boolean>;
  await act(async () => { closing = sourceEditing.closeDocuments([captured.id]); });
  expect((await confirmation()).textContent).toContain(`“${captured.title}”`);
  await choose("Discard");
  await act(async () => { expect(await closing).toBe(true); useMoleculeStore.getState().closeDocument(captured.id); documents = useMoleculeStore.getState().documents; });
  await render();
  expect(documents.map(doc => doc.id)).toEqual([other.id]);
  expect(await readFile(captured.path, "utf8")).toBe(sourceText);
  expect(await readFile(other.path, "utf8")).toBe(sourceText);
});

test("unmount before close admission resumes cannot publish an unowned dialog", async () => {
  const captured = await freshDirtySource("admitting-source");
  let closing!: Promise<boolean>;
  await act(async () => { closing = sourceEditing.closeDocuments([captured.id]); mounted.unmount(); unmounted = true; });
  expect(await closing).toBe(false);
  expect(useMoleculeStore.getState().documents.map(doc => doc.id)).toEqual([captured.id]);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  mounted = createRoot(document.body.appendChild(document.createElement("div"))); unmounted = false; await render();
});

test("unmount cancels an unanswered close without deleting its document or draft file", async () => {
  const captured = await freshDirtySource("unmounted-source");
  let closing!: Promise<boolean>;
  await act(async () => { closing = sourceEditing.closeDocuments([captured.id]); });
  await confirmation();
  await act(async () => { mounted.unmount(); unmounted = true; });
  expect(await closing).toBe(false);
  expect(useMoleculeStore.getState().documents.map(doc => doc.id)).toEqual([captured.id]);
  expect(await readFile(captured.path, "utf8")).toBe(sourceText);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
