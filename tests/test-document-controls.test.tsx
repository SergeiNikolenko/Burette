import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";
import type { ViewerDownloadAction, ViewerDownloadPayload } from "../apps/desktop/src/lib/viewer-download-actions";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { ViewerControls } = await import("../apps/desktop/src/components/ui/viewer-controls");
const { ViewerDownloadControl } = await import("../apps/desktop/src/components/ui/viewer-download");

async function mountTest(content: React.ReactNode, run: (mount: HTMLDivElement) => Promise<void>) {
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount);
  try { await act(async () => root.render(content)); await run(mount); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}

test("document toolbar keeps zoom, reset, fit, rotation and original download behavior", async () => {
  let rotated = 0, fitted = 0;
  function Fixture() {
    const [scale, setScale] = useState(1);
    return <ViewerControls title="Report" position={{ kind: "page", current: 2, total: 5 }}
      zoom={{ scale, onZoomIn: () => setScale(s => s + .25), onZoomOut: () => setScale(s => s - .25), onReset: () => setScale(1), onFit: () => { fitted++; } }}
      rotate={{ onRotate: () => { rotated++; } }}
      downloads={[{ id: "source", label: "Download original", fileName: "report.pdf", origin: "original", getPayload: () => ({ kind: "href", href: "/report.pdf" }) }]} />;
  }
  await mountTest(<Fixture />, async mount => {
    const click = async (label: string) => act(async () => mount.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
    await click("Zoom in"); expect(mount.textContent).toContain("125%");
    await click("Zoom out"); expect(mount.textContent).toContain("100%");
    await click("Zoom in"); await click("Reset zoom"); expect(mount.textContent).toContain("100%");
    await click("Fit width"); await click("Rotate"); expect([fitted, rotated]).toEqual([1, 1]);
    const link = mount.querySelector('a[download]')!;
    expect([link.getAttribute("href"), link.getAttribute("download"), link.getAttribute("aria-label")]).toEqual(["/report.pdf", "report.pdf", "Download original"]);
    expect(mount.textContent).toContain("Page 2 of 5");
  });
});

test("download menu preserves disabled actions, pending state and failure reporting", async () => {
  let resolve!: (payload: ViewerDownloadPayload) => void; let calls = 0; const failures: string[] = [];
  const actions: ViewerDownloadAction[] = [
    { id: "derived", label: "Export report", fileName: "report.txt", origin: "derived", getPayload: () => { calls++; return new Promise(r => { resolve = r; }); } },
    { id: "disabled", label: "Export image", fileName: "report.png", origin: "derived", isDisabled: true, getPayload: () => { throw new Error("Disabled action ran"); } },
    { id: "failed", label: "Export table", fileName: "report.csv", origin: "derived", getPayload: () => { throw new Error("Export failed"); } },
  ];
  await mountTest(<ViewerDownloadControl actions={actions} onError={error => failures.push(error.kind)} />, async mount => {
    const trigger = () => mount.querySelector<HTMLButtonElement>('button[aria-label="Download"]')!;
    const open = async () => act(async () => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await open();
    const menu = mount.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull(); // Portalled inside the theme scope.
    const item = (label: string) => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(el => el.textContent === label)!;
    expect(item("Export image").getAttribute("aria-disabled")).toBe("true");
    await act(async () => item("Export report").click());
    expect(calls).toBe(1); expect(trigger().disabled).toBe(true);
    expect(trigger().querySelector('[data-slot="spinner"]')).not.toBeNull();
    await act(async () => resolve({ kind: "none" }));
    expect(trigger().disabled).toBe(false);
    await open();
    await act(async () => Array.from(mount.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(el => el.textContent === "Export table")!.click());
    expect(failures).toEqual(["payload_failed"]);
    expect(trigger().disabled).toBe(false);
  });
});
