import { test, expect, React, act, createRoot, browser, doc } from "./geometry-foundation-fixture";
import { afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { adoptLogicalSource, beginScienceSessionRestore, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { addDocumentInternalCoordinates, recordImportedRevision, releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ HTMLSelectElement: browser.HTMLSelectElement, HTMLButtonElement: browser.HTMLButtonElement,
  SVGElement: browser.SVGElement, HTMLFormElement: browser.HTMLFormElement, DocumentFragment: browser.DocumentFragment, KeyboardEvent: browser.KeyboardEvent, MessageEvent: browser.MessageEvent,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterAll(() => { for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });
const { ScientificSpectraDockContent } = await import("../apps/desktop/src/components/workbench/scientific-spectra-dock-content");
const producer = (kind: "camphor" | "nmr") => parseScientificFile(`${kind}.out`, readFileSync(new URL(`./fixtures/quantum/spectra-orca-${kind}.out`, import.meta.url), "utf8"));
async function settle(host: Element) {
  for (let i = 0; i < 100; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (host.querySelector("tbody") && !host.querySelector('[role="status"]')) return; }
  throw new Error(`Spectrum did not settle: ${host.textContent}`);
}
async function fixture(science: ScientificDocument = producer("camphor")) {
  let current = doc(); const text = serializeXyz(science.atoms, current.id);
  const restore = () => adoptLogicalSource({ documentId: current.id, extension: "xyz", text }, "display-source", null, science.atoms.map(atom => atom.element));
  restore(); addDocumentInternalCoordinates(current.id, text, science);
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = current.id; frame.dataset.renderer = "molstar"; document.body.append(frame);
  let requests = 0; const source = frame.contentWindow!;
  source.postMessage = value => { if (value.body.type !== "agent-action") return; requests++; queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { source,
    data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: value.body.id, result: { ok: true, result: {} } } } }))); };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const actions = { saveKetcherExportFile: async () => ({ status: "saved" as const, path: null }) };
  const show = async () => { await act(async () => root.render(<ScientificSpectraDockContent document={current} actions={actions} />)); await settle(host); };
  const hide = () => act(async () => root.render(null));
  const select = async (label: string, value: string) => { const field = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    await act(async () => { field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); }); await settle(host); };
  const step = async (label: string, count: number) => { await act(async () => { for (let i = 0; i < count; i++) host.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); }); await settle(host); };
  const state = () => ({ kind: host.querySelector<HTMLSelectElement>('[aria-label="Spectrum"]')?.value,
    start: host.querySelector('[aria-label="Axis start, eV"]')?.getAttribute("aria-valuenow"), raw: host.querySelector('[role="checkbox"]')?.getAttribute("aria-checked"), row: host.querySelector('tr[aria-selected="true"] th')?.textContent });
  await show();
  return { host, root, science, text, current, show, hide, restore, select, step, state, requests: () => requests,
    replaceDocument: () => { current = { ...current }; },
    close: async () => { await act(async () => root.unmount()); host.remove(); frame.remove(); releaseClosedImports(new Set()); releaseClosedScienceSessions(new Set()); } };
}

test("actual CD display survives Settings-style unmount/remount with kind, range, raw and source row", async () => {
  const f = await fixture();
  try {
    await f.select("Spectrum", "ecd"); await f.step("Axis start, eV", 5);
    await act(async () => { f.host.querySelectorAll<HTMLElement>("tbody tr")[1].click(); f.host.querySelector<HTMLElement>('[role="checkbox"]')!.click(); });
    const before = f.state(); expect(before).toEqual({ kind: "ecd", start: "10", raw: "false", row: "0-1A -> 2-1A" });
    await f.hide(); await f.show(); expect(f.state()).toEqual(before); expect(f.requests()).toBe(0);
  } finally { await f.close(); }
});

test("NMR element and reference survive remount without replaying native atom selection", async () => {
  const f = await fixture(producer("nmr"));
  try {
    await f.select("NMR element", "6"); await f.step("Reference, ppm", 1);
    await act(async () => f.host.querySelector<HTMLElement>("tbody tr")!.click());
    const before = { element: f.host.querySelector<HTMLSelectElement>('[aria-label="NMR element"]')!.value, reference: f.host.querySelector('[aria-label="Reference, ppm"]')!.getAttribute("aria-valuenow"), row: f.host.querySelector('tr[aria-selected="true"] th')?.textContent };
    expect(f.requests()).toBe(1); await f.hide(); await f.show();
    expect({ element: f.host.querySelector<HTMLSelectElement>('[aria-label="NMR element"]')!.value, reference: f.host.querySelector('[aria-label="Reference, ppm"]')!.getAttribute("aria-valuenow"), row: f.host.querySelector('tr[aria-selected="true"] th')?.textContent }).toEqual(before);
    expect(f.requests()).toBe(1);
  } finally { await f.close(); }
});

test("unmounted revision replacement, rollback ABA, logical restore and new document reset; unrelated sources preserve", async () => {
  for (const change of ["replacement", "rollback", "restore", "document", "unrelated"]) {
    const f = await fixture();
    try {
      await f.select("Spectrum", "ecd"); await f.step("Axis start, eV", 5); await f.hide();
      await act(async () => {
        if (change === "replacement") addDocumentInternalCoordinates(f.current.id, f.text, f.science);
        else if (change === "rollback") { const rollback = recordImportedRevision(f.current.id, f.text, { text: f.text, document: { ...f.science } }); if (!rollback) throw new Error("Missing source"); rollback(); }
        else if (change === "restore") { beginScienceSessionRestore(f.current.id); f.restore(); }
        else if (change === "document") f.replaceDocument();
        else addDocumentInternalCoordinates("unrelated", "unrelated source", f.science);
      });
      await f.show(); expect([f.state().kind, f.state().start]).toEqual(change === "unrelated" ? ["ecd", "10"] : ["electronic", "5"]);
    } finally { await f.close(); }
  }
});

test("file/frame dataset choice and bounded source table page survive the same owner remount", async () => {
  const science = producer("camphor");
  science.spectra = { kind: "scientific-spectra", version: 1, source: { name: "pagination.json", format: "avogadro-matrix", scope: "file" }, atomicNumbers: [],
    spectra: [{ kind: "dos", xUnit: "eV", positions: Array.from({ length: 60 }, (_, i) => i), values: Array.from({ length: 60 }, () => 1), valueUnit: "states/eV" }] };
  const f = await fixture(science);
  try {
    const next = [...f.host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Next")!;
    await act(async () => next.click()); await act(async () => f.host.querySelector<HTMLElement>("tbody tr")!.click());
    const row = f.host.querySelector('tr[aria-selected="true"] th')?.textContent; expect(f.host.querySelectorAll("tbody tr")).toHaveLength(10);
    await f.hide(); await f.show(); expect(f.host.querySelectorAll("tbody tr")).toHaveLength(10); expect(f.host.querySelector('tr[aria-selected="true"] th')?.textContent).toBe(row);
    await f.select("Spectrum source", "frame-0"); await f.select("Spectrum", "ecd"); await f.hide(); await f.show();
    expect(f.host.querySelector<HTMLSelectElement>('[aria-label="Spectrum source"]')!.value).toBe("frame-0"); expect(f.state().kind).toBe("ecd");
  } finally { await f.close(); }
});
