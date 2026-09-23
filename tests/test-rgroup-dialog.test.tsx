import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Node", "NodeFilter", "CustomEvent", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let resolvePreview: (value: any) => void;
let applied = 0;
mock.module("../apps/desktop/src/hooks/rgroup-preview", () => ({
  prepareRGroupPreview: () => new Promise(resolve => { resolvePreview = resolve; }),
}));
mock.module("../apps/desktop/src/components/rgroup-preview", () => ({ RGroupPreviewResults: () => <div>Coverage preview</div> }));
const { createRoot } = await import("react-dom/client");
const { RGroupDecompositionDialog } = await import("../apps/desktop/src/components/rgroup-decomposition-dialog");
const container = document.createElement("div"); document.body.append(container);
const root = createRoot(container);
const request = { documentId: "doc", documentTitle: "series.csv" };
const preview = { documentId: "doc", core: "", sourceRows: [], result: {} };
const render = async (open: boolean, fail = false) => {
  await act(async () => { root.render(<RGroupDecompositionDialog request={open ? request : null} onDismiss={() => {}}
    onRun={async () => { applied++; if (fail) throw new Error("The collection changed"); }} />); });
};
const button = (name: string) => [...document.querySelectorAll("button")].find(node => node.textContent === name)!;
afterEach(async () => { await render(false); applied = 0; });

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
  await render(true, true);
  await act(async () => button("Preview").click());
  await act(async () => resolvePreview(preview));
  await act(async () => button("Apply columns").click());
  expect(applied).toBe(1);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("The collection changed");
  expect(button("Apply columns").disabled).toBe(true);
});
