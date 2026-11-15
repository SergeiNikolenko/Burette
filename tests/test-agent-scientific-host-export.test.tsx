import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { waterScience } from "./scientific-data-fixture";
import { addDocumentInternalCoordinates, adoptRestoredScientificSource, releaseClosedImports, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";

plugin({ name: "browser-agent-shell", setup(build) {
  build.onLoad({ filter: /use-agent-session\.ts$/u }, ({ path }) => ({ loader: "ts",
    contents: readFileSync(path, "utf8").replace('import.meta.env.VITE_BURETTE_AGENT_SHELL', '"1"'),
  }));
} });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, CSS: browser.CSS, localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const oldFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = oldFetch; for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
mock.module("../apps/desktop/src/components/editor-area/page-kinds", () => ({ deserializeLocation: () => null, serializeLocation: () => null }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/lib/ketcher-agent", () => ({ subscribeKetcherAgentRegistry: () => () => {} }));
let reads = 0;
let readHold: (() => Promise<void>) | null = null;
const files = new Map<string, string>();
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureTextDocument: async () => { throw new Error("Unexpected document read"); }, readStructureText: async (path: string) => {
  reads++; const value = files.get(path)!; if (readHold) await readHold(); return value;
} }));
const { createRoot } = await import("react-dom/client");
const { openScientificDocument } = await import("../apps/desktop/src/lib/workbench/generated-document-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useAgentSession } = await import("../apps/desktop/src/hooks/use-agent-session");
const aliases = [{ type: "export_session" }, { type: "raw_burette_agent", command: "exportSession" }];
const warning = "Scientific workbench data (source, Z-matrix, grids, Hessians, original file) is not included; save it with Export → Scene in Burette.";
type Result = { ok: boolean; warnings?: string[]; error?: { code: string }; result?: unknown };
let serial = 0;
async function fixture(scientific = true, original = true) {
  const id = `host-export-${++serial}`, initialReads = reads;
  let doc = { id, path: `/${id}.xyz`, extension: "xyz", renderer: "molstar", title: "water", byteCount: 100, runtimePath: "/viewer" } as ViewerDocument;
  if (scientific) await openScientificDocument({ openStructureRecords: async records => {
    files.set(doc.path, records[0].text); useMoleculeStore.setState({ documents: [doc] }); return [doc];
  } }, "water.out", waterScience(), "final", original ? { name: "water.out", file: new Blob(["exact original"]) } : null);
  else files.set(doc.path, "1\nforeign\nH 0 0 0\n");
  let draft: string | null = null, poll!: () => void;
  const host = document.createElement("div"), frame = document.createElement("iframe");
  frame.className = "viewer-iframe"; frame.dataset.documentId = id; frame.dataset.renderer = "molstar";
  document.body.append(host, frame);
  const root = createRoot(host);
  let action: { id: string; action: Record<string, unknown>; status: string; result?: Result } | null = null;
  let posted: { id: string; action: Record<string, unknown> } | null = null;
  const bindFrame = (value: HTMLIFrameElement) => { const target = value.contentWindow!; target.postMessage = ((message: { body: typeof posted }) => { posted = message.body; }) as typeof target.postMessage; };
  bindFrame(frame);
  const originalSetInterval = browser.setInterval;
  browser.setInterval = ((callback: () => void) => { poll = callback; return 1; }) as unknown as typeof browser.setInterval;
  window.BuretteMcpWorkspace = {} as NonNullable<typeof window.BuretteMcpWorkspace>;
  globalThis.fetch = (async (_url: string | URL | Request, options?: RequestInit) => {
    if (String(_url).endsWith("actions.json")) {
      if (options?.method === "PUT") action = JSON.parse(String(options.body)).actions[0] ?? null;
      return new Response(JSON.stringify({ actions: action ? [action] : [] }));
    }
    return new Response("{}");
  }) as typeof fetch;
  function Probe() { useAgentSession({ activeDocument: doc, documents: [doc], activeTabId: "tab", activeTabKind: "document", tabs: [],
    tabActions: { openNewTab() {}, setActiveTab() {}, closeTab() {}, moveTab() {} }, openDockingDocument: async () => null,
    openPaths() {}, openKetcherTab() {}, openTextDocuments: async () => null, pushErrorStatus(error) { throw error; }, setDockDocument() {},
    sourceDraftForDocument: () => draft }); return null; }
  const settle = async (ready: () => boolean) => { for (let i = 0; i < 100 && !ready(); i++) await act(async () => { await Bun.sleep(2); }); expect(ready()).toBe(true); };
  const render = async () => { await act(async () => root.render(<Probe />)); };
  await render();
  browser.dispatchEvent(new browser.MessageEvent("message", { data: { source: "burette-viewer", body: { type: "agentReady", documentId: id } } }));
  await act(async () => { await Bun.sleep(5); });
  return { frame, bindFrame, get reads() { return reads - initialReads; }, get doc() { return doc; }, setDraft(text: string | null) { draft = text; },
    replace: async (patch: Partial<ViewerDocument>) => { doc = { ...doc, ...patch }; await render(); },
    async start(alias: Record<string, unknown>) { posted = null; action = { id: `${id}-action`, action: alias, status: "queued" }; poll(); await act(async () => { await Bun.sleep(3); }); },
    async posted() { await settle(() => posted !== null); return posted!; },
    async finish(result: Result, responseSource: globalThis.Window | null = frame.contentWindow) { await settle(() => posted !== null); browser.dispatchEvent(new browser.MessageEvent("message", { source: responseSource as unknown as Window,
      data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: posted!.id, result } } })); },
    async result() { await settle(() => action?.status === "completed" || action?.status === "failed"); return action!.result!; },
    get dispatched() { return posted !== null; },
    async close() { readHold = null; await act(async () => root.unmount()); host.remove(); frame.remove(); browser.setInterval = originalSetInterval; releaseClosedImports(new Set()); files.clear(); },
  };
}

test("fresh actual generated scientific imports warn through both public host aliases and dedupe runtime warnings", async () => {
  const view = await fixture();
  try {
    expect(scientificStateFor(view.doc.id, files.get(view.doc.path)!).revision?.document.modes.length).toBe(1);
    for (const alias of aliases) {
      await view.start(alias); await view.posted(); await view.finish({ ok: true, result: { format: "molx", dataBase64: "archive" }, warnings: ["SDK warning"] });
      expect(await view.result()).toEqual({ ok: true, result: { format: "molx", dataBase64: "archive" }, warnings: ["SDK warning", warning] });
      await view.start(alias); await view.posted(); await view.finish({ ok: true, warnings: [warning] });
      expect((await view.result()).warnings).toEqual([warning]);
    }
    view.setDraft(files.get(view.doc.path)! + "\nchanged");
    await view.start(aliases[0]); await view.posted(); await view.finish({ ok: true });
    expect((await view.result()).warnings).toEqual([warning]); // The uploaded Original still belongs to this document.
  } finally { await view.close(); }
});

test("ordinary foreign files, other raw commands, and failed exports retain their exact result", async () => {
  const view = await fixture(false);
  try {
    for (const alias of [...aliases, { type: "raw_burette_agent", command: "snapshot" }]) {
      await view.start(alias); await view.posted(); await view.finish({ ok: true, result: { foreign: true } });
      expect(await view.result()).toEqual({ ok: true, result: { foreign: true } });
    }
    expect(view.reads).toBe(0);
  } finally { await view.close(); }
  const science = await fixture();
  try {
    await science.start({ type: "raw_burette_agent", command: "snapshot" }); await science.posted(); await science.finish({ ok: true });
    expect(await science.result()).toEqual({ ok: true });
    await science.start(aliases[0]); await science.posted(); await science.finish({ ok: false, error: { code: "BUSY" } });
    expect(await science.result()).toEqual({ ok: false, error: { code: "BUSY" } });
  } finally { await science.close(); }
});

for (const mutation of ["document", "source", "frame", "draft", "readonly", "srcdoc"] as const) test(`pending export rejects ${mutation} replacement`, async () => {
  const view = await fixture();
  try {
    await view.start(aliases[mutation === "source" ? 1 : 0]); await view.posted();
    if (mutation === "document") await view.replace({ id: "different-document" });
    if (mutation === "source") await view.replace({ runtimePath: "/replacement" });
    if (mutation === "draft") view.setDraft(files.get(view.doc.path)! + "\nchanged");
    if (mutation === "readonly") view.frame.dataset.readOnly = "true";
    if (mutation === "srcdoc") view.frame.srcdoc = "<html>replacement</html>";
    if (mutation === "frame") { const next = view.frame.cloneNode() as HTMLIFrameElement; view.frame.replaceWith(next); }
    await view.finish({ ok: true, result: { dataBase64: "old" } });
    expect((await view.result()).error?.code).toBe("STALE_TARGET");
  } finally { document.querySelectorAll("iframe").forEach(frame => frame.remove()); await view.close(); }
});

test("source change during file read refuses dispatch; metadata-only clones keep the same source lifetime", async () => {
  const view = await fixture();
  try {
    let release!: () => void;
    readHold = () => new Promise<void>(resolve => { release = resolve; });
    await view.start(aliases[0]);
    await view.replace({ openClaimId: "replacement-claim" }); readHold = null; release();
    expect((await view.result()).error?.code).toBe("STALE_TARGET"); expect(view.dispatched).toBe(false);
    await view.start(aliases[1]); await view.posted(); await view.replace({ title: "Renamed", sceneUnsaved: false });
    await view.finish({ ok: true }); expect((await view.result()).warnings).toEqual([warning]);
  } finally { await view.close(); }
});

test("unsaved unregistered text without an Original is neutral; external file replacement is stale", async () => {
  const view = await fixture(true, false);
  try {
    view.setDraft(files.get(view.doc.path)! + "\nchanged");
    await view.start(aliases[0]); await view.posted(); await view.finish({ ok: true }); expect(await view.result()).toEqual({ ok: true });
    view.setDraft(null); await view.start(aliases[1]); await view.posted(); files.set(view.doc.path, "replacement file");
    await view.finish({ ok: true }); expect((await view.result()).error?.code).toBe("STALE_TARGET");
  } finally { await view.close(); }
});


test("a delayed final source read rechecks the frame and scientific registry before publishing success", async () => {
  for (const mutation of ["frame", "data"] as const) {
    const view = await fixture();
    try {
      await view.start(aliases[1]); await view.posted();
      let release!: () => void;
      readHold = () => new Promise<void>(resolve => { release = resolve; });
      await view.finish({ ok: true });
      for (let i = 0; i < 50 && !release; i++) await act(async () => { await Bun.sleep(2); });
      expect(typeof release).toBe("function");
      if (mutation === "frame") view.frame.dataset.documentId = "replacement";
      else adoptRestoredScientificSource(view.doc.id, { text: files.get(view.doc.path)!, document: waterScience() }, null);
      readHold = null; release();
      expect((await view.result()).error?.code).toBe("STALE_TARGET");
    } finally { await view.close(); }
  }
});


test("another iframe cannot complete the pinned scientific export", async () => {
  const view = await fixture(), other = document.createElement("iframe"); document.body.append(other);
  try {
    await view.start(aliases[0]); await view.posted(); await view.finish({ ok: true }, other.contentWindow);
    expect((await view.result()).error?.code).toBe("STALE_TARGET");
  } finally { other.remove(); await view.close(); }
});


test("an ordinary pending export rejects scientific ownership acquired through actual internal-coordinate registration", async () => {
  for (const alias of aliases) {
    const view = await fixture(false);
    try {
      await view.start(alias); await view.posted();
      addDocumentInternalCoordinates(view.doc.id, files.get(view.doc.path)!, waterScience());
      await view.finish({ ok: true, result: { dataBase64: "pre-registration archive" } });
      expect((await view.result()).error?.code).toBe("STALE_TARGET");
      expect(view.reads).toBe(0);
    } finally { await view.close(); }
  }
});
