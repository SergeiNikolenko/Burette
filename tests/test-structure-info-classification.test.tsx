import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useLayoutEffect } from "react";
import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { SourceEditingContextValue } from "../apps/desktop/src/lib/source-editing/context";

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "CSS", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "HTMLIFrameElement", "HTMLButtonElement", "HTMLDivElement", "Element", "Node", "NodeFilter", "DocumentFragment", "SVGElement", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
for (const key of ["fetch", "indexedDB", "IS_REACT_ACT_ENVIRONMENT"]) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
Reflect.deleteProperty(globalThis, "indexedDB");
// Exercise the actual embedded Info surface without the independent workbench Tools reader.
Object.assign(browser, { BuretteMcpWorkspace: { initialPaths: [] } });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import("react-dom/client");
const { StructureInfoPanel } = await import("../apps/desktop/src/components/structure-info-panel");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { DEFAULT_CONFORMER_SETTINGS, DEFAULT_XTB_SETTINGS } = await import("../apps/desktop/src/lib/chemistry-settings");
const { CRYSTALS_RESOURCE, verifyResourceBundle } = await import("../apps/desktop/src/lib/extensions/resource-bundle");
const bundle = await verifyResourceBundle(CRYSTALS_RESOURCE, new Uint8Array(readFileSync(new URL("../resources/extensions/openchemistry-crystals.bin", import.meta.url))));
const crystal = new TextDecoder().decode(bundle.files.find(file => file.path === "antimonides/AlSb.cif")!.data);
const polymer = "data_polymer\n_entity.id 1\n_entity.type polymer\nloop_\n_atom_site.label_entity_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n1 0 0 0\n";
const neutral = "data_unclassified\n_note 'No structural evidence'\n";
const actions = new Proxy({}, { get: () => () => {} }) as ShellActions;
function doc(id: string, extension = "cif"): ViewerDocument {
  return { id, title: `${id}.cif`, path: `https://source.test/${id}.cif`, extension, renderer: "molstar", runtimePath: "", byteCount: 1024 };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host);
  const pending = new Map<string, ReturnType<typeof deferred<Response>>>(), reads: string[] = [], layout: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/__burette/folding-result") return Response.json({ models: [], artifacts: [] });
    if (url.pathname !== "/__burette/read-file") throw new Error("Unexpected transport");
    const path = url.searchParams.get("path")!;
    reads.push(path); const gate = deferred<Response>(); pending.set(path, gate); return gate.promise;
  };
  function Frame({ document, draft }: { document: ViewerDocument; draft?: string }) {
    useLayoutEffect(() => { layout.push(host.querySelector(".structure-inspector-header p")?.textContent ?? ""); });
    const editing = { sessionForDocument: () => draft === undefined ? null : { content: draft } } as SourceEditingContextValue;
    return <SourceEditingProvider value={editing}><StructureInfoPanel document={document} gridFilterModel={null} dockDrops={[]}
      conformerStatus={null} conformerSettings={DEFAULT_CONFORMER_SETTINGS} viewerLigandSelection={null} structureOverlayMode="none"
      xtbStatus={null} xtbSettings={DEFAULT_XTB_SETTINGS} xtbJobs={[]} preferences={defaultPreferences} isBrowserDev actions={actions} /></SourceEditingProvider>;
  }
  return { host, reads, layout,
    render: (document: ViewerDocument, draft?: string) => act(async () => root.render(<Frame document={document} draft={draft} />)),
    async resolve(document: ViewerDocument, text: string) { await act(async () => { pending.get(document.path)!.resolve(new Response(text)); }); },
    async close() { await act(async () => root.unmount()); await act(async () => browser.happyDOM.waitUntilComplete()); host.remove(); },
  };
}

test("Info classifies actual AlSb from its one asynchronous composition read, including normalized CIF extension", async () => {
  const f = await fixture(), document = doc("AlSb", ".CIF");
  try {
    await f.render(document);
    expect(f.host.textContent).not.toContain("Macromolecule");
    await f.resolve(document, crystal);
    expect(f.host.querySelector(".structure-inspector-header p")?.textContent).toBe("Crystal structure");
    expect(f.reads).toEqual([document.path]);
  } finally { await f.close(); }
});

test("a late old source cannot classify a new document or a same-id replacement", async () => {
  const f = await fixture(), old = doc("old"), next = doc("next");
  try {
    await f.render(old); await f.render(next); await f.resolve(next, polymer);
    expect(f.host.querySelector(".structure-inspector-header p")?.textContent).toBe("Macromolecule");
    await f.resolve(old, crystal);
    expect(f.host.querySelector(".structure-inspector-header p")?.textContent).toBe("Macromolecule");
    const replacement = { ...next, path: "https://source.test/replacement.cif" };
    await f.render(replacement);
    expect(f.layout.at(-1)).not.toBe("Macromolecule");
    await f.resolve(replacement, neutral);
    expect(f.host.querySelector(".structure-inspector-header p")?.textContent).toBe("Molecular structure");
  } finally { await f.close(); }
});

test("a source-editing draft replaces the classification on the same document without a second transport read", async () => {
  const f = await fixture(), document = doc("draft");
  try {
    await f.render(document); await f.resolve(document, crystal);
    expect(f.host.querySelector(".structure-inspector-header p")?.textContent).toBe("Crystal structure");
    await f.render(document, neutral);
    expect(f.layout.at(-1)).not.toBe("Crystal structure");
    expect(f.host.querySelector(".structure-inspector-header p")?.textContent).toBe("Molecular structure");
    await f.render(document, polymer);
    expect(f.host.querySelector(".structure-inspector-header p")?.textContent).toBe("Macromolecule");
    expect(f.reads).toEqual([document.path]);
  } finally { await f.close(); }
});
