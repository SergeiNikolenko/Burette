import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["HTMLFormElement", "DocumentFragment"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Node", "NodeFilter", "CustomEvent", "Event", "KeyboardEvent", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let resolvePreview: (value: any) => void;
let rejectPreview: (error: Error) => void;
let applied = 0;
let dismissed = 0;
let applyPromise: Promise<void> | undefined;
const previewCalls: unknown[][] = [];
mock.module("../apps/desktop/src/hooks/rgroup-preview", () => ({
  prepareRGroupPreview: (...args: unknown[]) => { previewCalls.push(args); return new Promise((resolve, reject) => { resolvePreview = resolve; rejectPreview = reject; }); },
}));
mock.module("../apps/desktop/src/components/rgroup-preview", () => ({ RGroupPreviewResults: () => <div>Coverage preview</div> }));
const { createRoot } = await import("react-dom/client");
const { RGroupDecompositionDialog } = await import("../apps/desktop/src/components/rgroup-decomposition-dialog");
const container = document.createElement("div"); document.body.append(container);
const root = createRoot(container);
const request = { documentId: "doc", documentTitle: "series.csv" };
const preview = { documentId: "doc", core: "", sourceRows: [], result: {} };
const render = async (open: boolean, fail = false, nextRequest = request) => {
  await act(async () => { root.render(<RGroupDecompositionDialog request={open ? nextRequest : null} onDismiss={() => { dismissed++; }}
    onRun={async () => { applied++; if (fail) throw new Error("The collection changed /private/data"); await applyPromise; }} />); });
};
const button = (name: string) => [...document.querySelectorAll("button")].find(node => node.textContent === name)!;
afterEach(async () => { await render(false); applied = 0; dismissed = 0; applyPromise = undefined; previewCalls.length = 0; mock.restore(); });

test("preview never applies implicitly; editing the core invalidates the inspected result", async () => {
  await render(true);
  expect(button("Apply columns").disabled).toBe(true);
  await act(async () => button("Preview").click());
  await act(async () => resolvePreview(preview));
  expect(applied).toBe(0);
  expect(button("Apply columns").disabled).toBe(false);
  await act(async () => {
    const select = document.querySelector("select")!;
    select.value = "custom"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(button("Apply columns").disabled).toBe(true);
  expect(button("Preview").disabled).toBe(true);
});

test("closing a pending preview prevents its late response from appearing after reopen", async () => {
  await render(true);
  await act(async () => button("Preview").click());
  await render(false); await render(true);
  await act(async () => resolvePreview(preview));
  expect(document.body.textContent).not.toContain("Coverage preview");
  expect(button("Apply columns").disabled).toBe(true);
});

test("failed apply displays the error and requires a fresh preview", async () => {
  spyOn(console, "error").mockImplementation(() => {});
  await render(true, true);
  await act(async () => button("Preview").click());
  await act(async () => resolvePreview(preview));
  await act(async () => button("Apply columns").click());
  expect(applied).toBe(1);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Could not apply the columns. Preview the collection again to retry.");
  expect(document.body.textContent).not.toContain("/private/data");
  expect(button("Apply columns").disabled).toBe(true);
});

test("apply blocks dismissal and a late completion cannot close a different collection", async () => {
  let finish!: () => void;
  applyPromise = new Promise(resolve => { finish = resolve; });
  await render(true);
  await act(async () => button("Preview").click());
  await act(async () => resolvePreview(preview));
  await act(async () => button("Apply columns").click());
  expect([button("Preview").disabled, button("Apply columns").disabled, document.querySelector('[role="status"]')?.textContent]).toEqual([true, true, "Applying…"]);
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(dismissed).toBe(0);
  await render(true, false, { documentId: "other", documentTitle: "Other" });
  await act(async () => finish());
  expect([dismissed, applied, button("Apply columns").disabled]).toEqual([0, 1, true]);
});

test("preview errors preserve actionable input errors but hide internal failures", async () => {
  spyOn(console, "error").mockImplementation(() => {});
  await render(true);
  await act(async () => button("Preview").click());
  await act(async () => rejectPreview(new Error("The collection has no molecules.")));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("The collection has no molecules.");
  await act(async () => {
    const select = document.querySelector("select")!;
    select.value = "custom"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    const input = document.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " c1ccccc1 ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Preview").click());
  expect(previewCalls).toEqual([["doc", ""], ["doc", "c1ccccc1"]]);
  await act(async () => rejectPreview(new Error("Python engine /private/runtime")));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Could not preview these molecules. Check the core and try again.");
  expect(document.body.textContent).not.toContain("/private/runtime");
});
