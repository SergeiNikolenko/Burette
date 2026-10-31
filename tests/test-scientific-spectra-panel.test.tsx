import { test, expect, React, act, createRoot, browser, water, doc } from "./geometry-foundation-fixture";
import type { ShellActions } from "./geometry-foundation-fixture";
import { afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import type { ScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import { scientificSpectrumCsv, scientificSpectraJson } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { parseXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ HTMLSelectElement: browser.HTMLSelectElement, HTMLButtonElement: browser.HTMLButtonElement,
  SVGElement: browser.SVGElement, HTMLFormElement: browser.HTMLFormElement, DocumentFragment: browser.DocumentFragment, KeyboardEvent: browser.KeyboardEvent,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterAll(() => { for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });
const { ScientificSpectraPanel } = await import("../apps/desktop/src/components/workbench/scientific-spectra-panel");
const { ScientificSpectraDockContent } = await import("../apps/desktop/src/components/workbench/scientific-spectra-dock-content");
const { adoptLogicalSource, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { addDocumentInternalCoordinates, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const golden: { data: ScientificSpectra }[] = JSON.parse(readFileSync(new URL("./fixtures/quantum/scientific-spectra-golden.json", import.meta.url), "utf8"));
const sources: ScientificSpectra = { ...golden[2].data, source: { name: "six-source.json", format: "avogadro-matrix", scope: "file" }, spectra: golden.flatMap(value => value.data.spectra) };
const saved: { title: string; text: string }[] = [];
const actions: Pick<ShellActions, "saveKetcherExportFile"> = { saveKetcherExportFile: async (value: { title: string; text: string }) => { saved.push(value); return { status: "saved", path: null }; } };
async function settle(host: Element, predicate = () => Boolean(host.querySelector("table tbody tr"))) {
  for (let index = 0; index < 100; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (predicate() && !host.querySelector('[role="status"]')) return; }
  throw new Error(`Spectrum did not settle: ${host.textContent}`);
}
async function mount(element: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, root, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
async function select(host: Element, name: string, value: string) {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;
  await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function exportItem(host: Element, label: string) {
  const button = [...host.querySelectorAll("button")].find(value => value.textContent === "Export")!;
  await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(value => value.textContent === label)!;
  await act(async () => item.click());
}

test("all six real worker plots use their own units and exact raw exports", async () => {
  const before = scientificSpectraJson(sources), view = await mount(<ScientificSpectraPanel sources={[{ key: "file", label: "File", data: sources }]} actions={actions} />);
  try {
    expect([...view.host.querySelectorAll('select[aria-label="Spectrum"] option')].map(value => value.getAttribute("value"))).toEqual(["vcd", "mcd", "nmr", "electronic", "ecd", "dos"]);
    for (const kind of ["vcd", "mcd", "nmr", "electronic", "ecd", "dos"] as const) {
      await select(view.host, "Spectrum", kind); await settle(view.host);
      expect(view.host.querySelector("figcaption")?.textContent).toContain(kind === "nmr" ? "ppm" : kind === "vcd" || kind === "mcd" ? "cm⁻¹" : "eV");
      await exportItem(view.host, "Source CSV"); expect(saved.at(-1)?.text).toBe(scientificSpectrumCsv(sources, kind));
      await exportItem(view.host, "Source JSON"); expect(saved.at(-1)?.text).toBe(before);
      expect(view.host.querySelector('[role="alert"]')).toBeNull();
    }
    expect(scientificSpectraJson(sources)).toBe(before);
  } finally { await view.close(); }
});

test("signed source row IDs drive keyboard/chart/table selection and bounded pagination", async () => {
  const data: ScientificSpectra = { ...sources, atomicNumbers: [], spectra: [{ kind: "dos", xUnit: "eV", positions: Array.from({ length: 60 }, (_, index) => index - 30), values: Array.from({ length: 60 }, (_, index) => index % 2 ? -2 : 3), valueUnit: "states/eV", sourceRowIds: Array.from({ length: 60 }, (_, index) => `transition-${60 - index}`) }] };
  const view = await mount(<ScientificSpectraPanel sources={[{ key: "file", label: "File", data }]} actions={actions} />);
  try {
    await settle(view.host); expect(view.host.querySelectorAll("tbody tr").length).toBe(50);
    expect([view.host.querySelector('[role="slider"]')?.getAttribute("aria-valuemin"), view.host.querySelector('[role="slider"]')?.getAttribute("aria-valuenow")]).toEqual(["0", "0"]);
    const slider = view.host.querySelector('[role="slider"]')!;
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(view.host.querySelector('tr[aria-selected="true"] th')?.textContent).toBe("transition-1");
    expect(view.host.querySelectorAll("tbody tr").length).toBe(10);
    expect(slider.getAttribute("aria-valuetext")).toContain("transition-1, 29.0000 eV");
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(view.host.querySelector('tr[aria-selected="true"] th')?.textContent).toBe("transition-60");
    expect(view.host.querySelector("figure svg")?.textContent).toContain("-2");
  } finally { await view.close(); }
});

test("actual ORCA NMR source has element filtering and reference settings without modifying shielding", async () => {
  const science = parseScientificFile("nmr.out", readFileSync(new URL("./fixtures/quantum/spectra-orca-nmr.out", import.meta.url), "utf8"));
  const data = science.frames.find(frame => frame.spectra?.spectra.some(value => value.kind === "nmr"))!.spectra!;
  const view = await mount(<ScientificSpectraPanel sources={[{ key: "nmr", label: "Frame 1", data }]} actions={actions} />);
  try {
    await settle(view.host); const elements = [...view.host.querySelectorAll('select[aria-label="NMR element"] option')].map(value => value.getAttribute("value"));
    expect(elements.length).toBeGreaterThan(1);
    await select(view.host, "NMR element", "6"); await settle(view.host);
    expect([...view.host.querySelectorAll("tbody th")].every(value => value.textContent?.startsWith("C"))).toBe(true);
    expect(view.host.querySelector('[aria-label="Reference, ppm"]')).not.toBeNull();
    await act(async () => view.host.querySelector('[aria-label="Reference, ppm"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))); await settle(view.host);
    await exportItem(view.host, "Display settings"); const settings = JSON.parse(saved.at(-1)!.text);
    expect([settings.selection, settings.nmr.sourceQuantity, settings.nmr.referencePpm]).toEqual([{ kind: "nmr", atomicNumber: 6 }, "isotropic-shielding", 192.048]);
    await exportItem(view.host, "Source CSV"); expect(saved.at(-1)?.text).toBe(scientificSpectrumCsv(data, "nmr"));
  } finally { await view.close(); }
});

test("lazy owner follows exact source revisions and frame changes; close removes all plot output", async () => {
  const current = doc(), atoms = parseXyz(water).atoms;
  const signal = (frameIndex: number, value: number): ScientificSpectra => ({ kind: "scientific-spectra", version: 1, source: { name: "trajectory.out", format: "orca-output", scope: "frame", frameIndex, frameCount: 2 }, atomicNumbers: [8, 1, 1], spectra: [{ kind: "electronic", xUnit: "eV", positions: [2], values: [value], valueUnit: null, sourceRowIds: [`frame-${frameIndex}`] }] });
  const text = water + water, science = { format: "xyz" as const, atoms, frames: [{ atoms, spectra: signal(0, 1) }, { atoms, spectra: signal(1, -2) }], modes: [], orbitals: [] };
  adoptLogicalSource({ documentId: current.id, extension: "xyz", text }, "science-restore", null, []); addDocumentInternalCoordinates(current.id, text, science);
  const view = await mount(<ScientificSpectraDockContent document={current} actions={actions} />);
  try {
    await settle(view.host); expect(view.host.querySelector("tbody")?.textContent).toContain("frame-0");
    await act(async () => window.dispatchEvent(new CustomEvent("burette:trajectory-frame-changed", { detail: { documentId: current.id, frameIndex: 1, frameCount: 2 } })));
    await settle(view.host); expect(view.host.querySelector("tbody")?.textContent).toContain("frame-1"); expect(view.host.textContent).not.toContain("frame-0");
    await act(async () => addDocumentInternalCoordinates(current.id, text, { ...science, frames: [{ atoms }, { atoms }] }));
    expect(view.host.querySelector("table")).toBeNull();
    await act(async () => view.root.render(<ScientificSpectraDockContent document={null} actions={actions} />));
    expect(view.host.textContent).toBe("");
  } finally { await view.close(); releaseClosedImports(new Set()); releaseClosedScienceSessions(new Set()); }
});


test("real delayed workers cannot publish after source replacement or Cancel; retry owns its own result", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker")!, NativeWorker = Worker;
  const workers: { worker: Worker; terminated: boolean }[] = [], held: (() => void)[] = [];
  class HeldWorker extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options); const entry = { worker: this, terminated: false }; workers.push(entry);
      const terminate = this.terminate.bind(this); this.terminate = () => { entry.terminated = true; return terminate(); };
      Object.defineProperty(this, "onmessage", { configurable: true, set: (handler: (event: MessageEvent) => void) => {
        this.addEventListener("message", event => held.push(() => handler(event)));
      } });
    }
  }
  Object.defineProperty(globalThis, "Worker", { ...descriptor, value: HeldWorker });
  const current = doc(), atoms = parseXyz(water).atoms;
  const science = (value: number) => ({ format: "xyz" as const, atoms, frames: [{ atoms }], modes: [], orbitals: [], spectra: {
    kind: "scientific-spectra" as const, version: 1 as const, source: { name: "owned.out", format: "orca-output" as const, scope: "file" as const }, atomicNumbers: [8, 1, 1],
    spectra: [{ kind: "electronic" as const, xUnit: "eV" as const, positions: [2], values: [value], valueUnit: null, sourceRowIds: [`source-${value}`] }],
  } });
  const waitHeld = async (count: number) => { for (let index = 0; index < 100 && held.length < count; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(held.length).toBe(count); };
  adoptLogicalSource({ documentId: current.id, extension: "xyz", text: water }, "science-restore", null, []); addDocumentInternalCoordinates(current.id, water, science(1));
  const view = await mount(<ScientificSpectraDockContent document={current} actions={actions} />);
  try {
    await waitHeld(1);
    await act(async () => addDocumentInternalCoordinates(current.id, water, science(2))); await waitHeld(2);
    expect(workers[0].terminated).toBe(true);
    await act(async () => held[1]()); expect(view.host.querySelector("tbody")?.textContent).toContain("source-2");
    await act(async () => held[0]()); expect(view.host.querySelector("tbody")?.textContent).not.toContain("source-1");
    await act(async () => addDocumentInternalCoordinates(current.id, water, science(3))); await waitHeld(3);
    await act(async () => [...view.host.querySelectorAll("button")].find(value => value.textContent === "Cancel")!.click());
    expect(workers[2].terminated).toBe(true);
    await act(async () => held[2]()); expect(view.host.querySelector("figure")).toBeNull();
    await act(async () => [...view.host.querySelectorAll("button")].find(value => value.textContent === "Calculate")!.click()); await waitHeld(4);
    await act(async () => held[3]()); expect(view.host.querySelector("tbody")?.textContent).toContain("source-3");
  } finally { await view.close(); for (const entry of workers) entry.worker.terminate(); Object.defineProperty(globalThis, "Worker", descriptor); releaseClosedImports(new Set()); releaseClosedScienceSessions(new Set()); }
});


test("file, exact frame and paired MCD remain separate sources including original absorption values", async () => {
  const current = doc(), atoms = parseXyz(water).atoms;
  const file: ScientificSpectra = { ...sources, atomicNumbers: [8, 1, 1], spectra: [{ kind: "electronic", xUnit: "eV", positions: [2], values: [1], valueUnit: null }] };
  const frame: ScientificSpectra = { ...file, source: { name: "primary.out", format: "orca-output", scope: "frame", frameIndex: 0, frameCount: 1 }, spectra: [{ kind: "vcd", xUnit: "cm^-1", positions: [1000], values: [-2], valueUnit: null }] };
  const mcd: ScientificSpectra = { ...frame, source: { name: "chosen.mcd", format: "orca-mcd", scope: "frame", frameIndex: 0, frameCount: 1 }, spectra: [{ kind: "mcd", xUnit: "cm^-1", positions: [10000, 20000], values: [-2, 3], valueUnit: null, auxiliary: [{ name: "absorption", unit: null, values: [.25, .5] }] }] };
  const { checkMcdCompanion } = await import("../apps/desktop/src/lib/molecular-workbench/mcd-companion");
  const binding = { primaryOriginalSha256: "a".repeat(64), companionOriginalSha256: "b".repeat(64), sourceRevisionSha256: "c".repeat(64) };
  const companion = checkMcdCompanion({ ...binding, spectra: mcd }, { ...binding, frameIndex: 0, frameCount: 1, atomicNumbers: [8, 1, 1] });
  const science = { format: "xyz" as const, atoms, frames: [{ atoms, spectra: frame, mcdCompanion: companion }], modes: [], orbitals: [], spectra: file };
  adoptLogicalSource({ documentId: current.id, extension: "xyz", text: water }, "science-restore", null, []); addDocumentInternalCoordinates(current.id, water, science);
  const view = await mount(<ScientificSpectraDockContent document={current} actions={actions} />);
  try {
    await settle(view.host);
    expect([...view.host.querySelectorAll('select[aria-label="Spectrum source"] option')].map(value => value.textContent)).toEqual(["File", "Frame 1", "chosen.mcd"]);
    await select(view.host, "Spectrum source", "frame-0"); await settle(view.host); expect(view.host.querySelector("table")?.getAttribute("aria-label")).toBe("VCD source values");
    await select(view.host, "Spectrum source", "companion-0"); await settle(view.host);
    expect(view.host.querySelector("thead")?.textContent).toContain("absorption"); expect(view.host.querySelector("tbody")?.textContent).toContain("0.250000");
    await exportItem(view.host, "Source CSV"); expect(saved.at(-1)?.text).toBe(scientificSpectrumCsv(mcd, "mcd")); expect(saved.at(-1)?.title).toBe("chosen-frame-1-mcd.csv");
  } finally { await view.close(); releaseClosedImports(new Set()); releaseClosedScienceSessions(new Set()); }
});


test("a range with no source peaks is an image, not an empty interactive slider", async () => {
  const data: ScientificSpectra = { ...sources, atomicNumbers: [], spectra: [{ kind: "vcd", xUnit: "cm^-1", positions: [-10], values: [-2], valueUnit: null }] };
  const view = await mount(<ScientificSpectraPanel sources={[{ key: "file", label: "File", data }]} actions={actions} />);
  try {
    await settle(view.host); const chart = view.host.querySelector("figure")!;
    expect([chart.getAttribute("role"), chart.getAttribute("tabindex"), chart.getAttribute("aria-valuenow"), chart.getAttribute("aria-valuemin"), chart.getAttribute("aria-valuemax"), chart.getAttribute("aria-valuetext")]).toEqual(["img", "-1", null, null, null, null]);
    expect(view.host.querySelector("tbody")?.textContent).toContain("-10.0000");
  } finally { await view.close(); }
});
