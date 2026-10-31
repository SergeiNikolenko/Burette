import { test, expect, React, act, createRoot, browser } from "./geometry-foundation-fixture";
import { afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import type { TextFileSaveOutcome } from "../apps/desktop/src/lib/file-export";
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ HTMLSelectElement: browser.HTMLSelectElement, HTMLButtonElement: browser.HTMLButtonElement,
  SVGElement: browser.SVGElement, HTMLFormElement: browser.HTMLFormElement, DocumentFragment: browser.DocumentFragment, KeyboardEvent: browser.KeyboardEvent,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterAll(() => { for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });
const { ScientificSpectraPanel } = await import("../apps/desktop/src/components/workbench/scientific-spectra-panel");

test("spectrum export displays resolved save failures, keeps cancellation quiet and clears the previous failure", async () => {
  const science = parseScientificFile("nmr.out", readFileSync(new URL("./fixtures/quantum/spectra-orca-nmr.out", import.meta.url), "utf8"));
  const data = science.frames[0].spectra!, host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let result: TextFileSaveOutcome | Promise<TextFileSaveOutcome> | Error = { status: "failed", message: "The selected folder is not writable." };
  const actions = { saveKetcherExportFile: async () => { if (result instanceof Error) throw result; return result; } };
  try {
    await act(async () => root.render(<ScientificSpectraPanel sources={[{ key: "nmr", label: "NMR", data }]} actions={actions} />));
    for (let i = 0; i < 100 && !host.querySelector("tbody"); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.querySelector("tbody")).not.toBeNull();
    const save = async (label: string) => {
      const button = [...host.querySelectorAll("button")].find(value => value.textContent === "Export")!;
      await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(value => value.textContent === label)!;
      await act(async () => item.click());
    };
    await save("Source CSV"); expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not save the spectrum. Try again.");
    result = { status: "cancelled" }; await save("Source JSON"); expect(host.querySelector('[role="alert"]')).toBeNull();
    result = new Error("Transport failed"); await save("Display settings"); expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not save the spectrum. Try again.");
    result = { status: "saved", path: null }; await save("Source CSV"); expect(host.querySelector('[role="alert"]')).toBeNull();
    for (const reject of [false, true]) {
      let finish!: (result: TextFileSaveOutcome) => void, fail!: (error: Error) => void;
      result = new Promise<TextFileSaveOutcome>((resolve, reject) => { finish = resolve; fail = reject; });
      await save("Source CSV"); result = { status: "saved", path: null }; await save("Source JSON");
      await act(async () => { if (reject) fail(new Error("Late transport error")); else finish({ status: "failed", message: "Late native error" }); });
      expect(host.querySelector('[role="alert"]')).toBeNull();
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});
