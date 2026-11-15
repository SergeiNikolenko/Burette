import { afterAll, expect, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { buildPolymer } from "../apps/desktop/src/lib/molecular-workbench/polymer";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
const require = createRequire(import.meta.url);
const { parseSdf } = require("@molstar/io/reader/sdf/parser");
const { trajectoryFromMol } = require("@molstar/model/formats/structure/mol");
const { Structure } = require("@molstar/model/model/structure");
const browser = new Window({ url: "http://localhost/", settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, value] of originals) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } });
plugin({ name: "molecule-preview-assets", setup(build) { build.onLoad({ filter: /grid-molecule-3d\.tsx$/ }, ({ path }) => ({ loader: "tsx", contents: readFileSync(path, "utf8")
  .replace(/^import bootstrapUrl[^\n]+/m, 'const bootstrapUrl = "/bootstrap.js";').replace(/const assets = import\.meta\.glob[^\n]+/, "const assets: Record<string, string> = {};") })); } });
const { MoleculeFilePreview } = await import("../apps/desktop/src/components/molecule-file-preview");
const source = readFileSync("tests/fixtures/polymer/chiral-reference.sdf", "utf8");
const parsed = parseMolecule(source, "sdf");
const graph = buildPolymer(parsed.atoms, parsed.bonds, { head: 0, tail: 5, headLeaving: 6, tailLeaving: 11, count: 500, bondLength: 3 });
const large = sdfFromGraph(graph.atoms, graph.bonds, "Polymer");
const input = (frame: HTMLIFrameElement) => JSON.parse(frame.srcdoc.match(/id="burette-inspector-input">([^]*?)<\/script>/)![1]);

test("owned file preview keeps large bytes out of srcdoc and retires replacement/cancel URLs", async () => {
  expect([graph.atoms.length, graph.bonds.length, large.length]).toEqual([6502, 6501, 444651]);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const props = { format: "sdf" as const, hydrogenDisplay: "all" as const, theme: "light", height: 240, onOpen() {} };
  const created: string[] = [], retired: string[] = []; const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { const url = create(blob); created.push(url); return url; };
  URL.revokeObjectURL = url => { retired.push(url); revoke(url); };
  try {
    await act(async () => root.render(<MoleculeFilePreview {...props} data={large} />));
    const first = host.querySelector("iframe")!, original = input(first);
    expect(first.srcdoc.length).toBeLessThan(8000); expect(original.config.molstarFormat).toBe("sdf"); expect(original.data).toBeUndefined();
    expect(await (await fetch(original.dataURL)).text()).toBe(large);
    await act(async () => root.render(<MoleculeFilePreview {...props} data={large} />));
    expect(host.querySelector("iframe")).toBe(first); expect(created.length).toBe(1); expect(retired).toEqual([]);
    await act(async () => root.render(<MoleculeFilePreview {...props} data={source} />));
    const second = host.querySelector("iframe")!, replacement = input(second);
    expect(second).not.toBe(first); expect(retired).toEqual([original.dataURL]);
    await expect(fetch(original.dataURL)).rejects.toThrow();
    expect(await (await fetch(replacement.dataURL)).text()).toBe(source);
    const frame = host.querySelector("iframe")!, beforeTheme = frame.srcdoc;
    const messages: unknown[] = [];
    frame.contentWindow!.postMessage = message => { messages.push(message); };
    await act(async () => root.render(<MoleculeFilePreview {...props} data={source} theme="dark" />));
    expect(frame.srcdoc).toBe(beforeTheme);
    const ready = new browser.MessageEvent("message", { data: { source: "burette-inspector-ready", channel: replacement.config.inspectorChannel } });
    Object.defineProperty(ready, "source", { value: frame.contentWindow });
    browser.dispatchEvent(ready);
    expect(messages).toContainEqual({ source: "burette-host", body: { type: "setViewerTheme", value: "dark", canvasBackground: "graphite" } });
    await act(async () => root.render(<MoleculeFilePreview {...props} data={source} hydrogenDisplay="none" theme="dark" />));
    const restyled = input(host.querySelector("iframe")!);
    expect([restyled.config.hydrogenDisplay, restyled.config.theme, restyled.dataURL]).toEqual(["none", "light", replacement.dataURL]);
    expect(retired).toEqual([original.dataURL]);
    await act(async () => root.render(null));
    expect(host.querySelector("iframe")).toBeNull(); expect(retired).toEqual(created);
    await expect(fetch(replacement.dataURL)).rejects.toThrow();
    // Cancel before a child has loaded; its owned URL must still be released.
    await act(async () => root.render(<MoleculeFilePreview {...props} data={large} />));
    const pending = input(host.querySelector("iframe")!);
    await act(async () => root.unmount()); expect(retired).toEqual(created);
    await expect(fetch(pending.dataURL)).rejects.toThrow();
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; host.remove(); }
});

test("actual bootstrap and payload loader fetch the full Blob unchanged for native V3000", async () => {
  const url = URL.createObjectURL(new Blob([large]));
  try {
    const state: { BuretteDataBytes?: Uint8Array; BuretteDataURL?: string } = {};
    runInNewContext(readFileSync("apps/desktop/src/preview-grid/molecule-preview-bootstrap.js", "utf8"), {
      window: Object.assign(state, { parent: { postMessage() {} }, addEventListener() {} }),
      document: { getElementById: () => ({ textContent: JSON.stringify({ config: { inspectorChannel: "own" }, dataURL: url }) }), addEventListener() {} },
    });
    const runtime = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
    const section = (begin: string, end: string) => runtime.slice(runtime.indexOf(begin), runtime.indexOf(end, runtime.indexOf(begin)));
    const code = section("  function appendCacheBuster(", "  function runtimeURL(") + section("  async function loadStructureData(", "  async function loadPayloadBytes(");
    const fail = () => { throw new Error("Blob fetch must not fall back to native/XHR"); };
    await new Function("window", "fetch", "Uint8Array", "debug", "loadArrayBufferViaXHR", "requestStructureDataFromNative", `${code};return loadStructureData({}, "cache-key");`)(state, fetch, Uint8Array, fail, fail, fail);
    expect(state.BuretteDataURL).toBe(url); const text = new TextDecoder().decode(state.BuretteDataBytes); expect(text).toBe(large);
    const native = await parseSdf(text).run(); expect(native.isError).toBe(false);
    const structure = Structure.ofModel((await trajectoryFromMol(native.result.compounds[0].molFile).run()).representative);
    expect([structure.elementCount, structure.units.reduce((n: number, unit: { bonds: { edgeCount: number } }) => n + unit.bonds.edgeCount, 0) + structure.interUnitBonds.edgeCount]).toEqual([6502, 6501]);
  } finally { URL.revokeObjectURL(url); }
});

test("independent preview owners cannot revoke each other's cached source", async () => {
  const a = document.createElement("div"), b = document.createElement("div"); document.body.append(a, b);
  const one = createRoot(a), two = createRoot(b);
  const view = <MoleculeFilePreview data={large} format="sdf" hydrogenDisplay="all" theme="light" height={240} onOpen={() => {}} />;
  try {
    await act(async () => { one.render(view); two.render(view); });
    const first = input(a.querySelector("iframe")!).dataURL, second = input(b.querySelector("iframe")!).dataURL;
    expect(first).not.toBe(second);
    await act(async () => one.unmount()); await expect(fetch(first)).rejects.toThrow();
    expect(await (await fetch(second)).text()).toBe(large);
    await act(async () => two.unmount()); await expect(fetch(second)).rejects.toThrow();
  } finally { a.remove(); b.remove(); }
});
