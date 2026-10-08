import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { DockHeader } = await import("../apps/desktop/src/components/dock-header");
import type { DockTab, DockTabKind } from "../apps/desktop/src/lib/dock";

test("dock tabs navigate, close without selecting, and retain file drag handlers", async () => {
  const calls: string[] = [];
  function Fixture() {
    const [tabs, setTabs] = useState<DockTab[]>([{ id: "f", kind: "files" }, { id: "j", kind: "jobs" }, { id: "l", kind: "logs" }]);
    const [active, select] = useState<DockTabKind>("files");
    return <><DockHeader area="bottom" tabs={tabs} activeKind={active} panelId="panel" readOnly={false}
      fileDragProps={{ draggable: true, onMouseDown: () => calls.push("drag-start"), onClickCapture: event => { if (event.shiftKey) { event.preventDefault(); event.stopPropagation(); } } }}
      onSelect={kind => { calls.push(`select:${kind}`); select(kind); }}
      onClose={id => { calls.push(`close:${id}`); setTabs(tabs.filter(tab => tab.id !== id)); if (tabs.find(tab => tab.id === id)?.kind === active) select("files"); }}
      onAdd={() => calls.push("add")} onHide={() => calls.push("hide")} />
      <div id="panel" role="tabpanel" aria-labelledby={`panel-${active}`}>{active}</div></>;
  }
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<Fixture />));
    const tab = (name: string) => mount.querySelector<HTMLButtonElement>(`[role="tab"][aria-label="${name}"]`)!;
    const button = (name: string) => mount.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
    const key = async (element: HTMLElement, key: string) => { await act(async () => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 5));
    }); };
    await act(async () => tab("Files").focus());
    expect(tab("Files").getAttribute("draggable")).toBe("true");
    expect(tab("Files").getAttribute("aria-controls")).toBe("panel");
    await key(tab("Files"), "ArrowRight"); expect(document.activeElement).toBe(tab("Jobs"));
    expect(tab("Files").getAttribute("aria-selected")).toBe("true");
    await act(async () => tab("Jobs").click());
    expect(mount.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("panel-jobs");
    await key(tab("Jobs"), "End"); expect(document.activeElement).toBe(tab("Logs"));
    await key(tab("Logs"), "ArrowRight"); expect(document.activeElement).toBe(tab("Files"));
    await key(tab("Files"), "Home"); expect(document.activeElement).toBe(tab("Files"));
    await act(async () => { button("Close Logs").focus(); button("Close Logs").click(); });
    expect(calls).toEqual(["select:jobs", "close:l"]);
    expect(document.activeElement).toBe(tab("Jobs"));
    await key(tab("Jobs"), "Delete"); expect(document.activeElement).toBe(tab("Files"));
    await act(async () => {
      tab("Files").dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
      tab("Files").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
      button("Add bottom dock tab").click();
    });
    await key(tab("Files"), "Delete");
    expect(calls).toEqual(["select:jobs", "close:l", "close:j", "drag-start", "add", "hide"]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("read-only and transient tabs cannot be closed", async () => {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const calls: string[] = [];
  const props = { area: "right" as const, tabs: [{ id: "x", kind: "xyzrender" as const }], activeKind: "xyzrender" as const, panelId: "right-panel", fileDragProps: {}, onSelect: () => {}, onClose: () => calls.push("close"), onHide: () => calls.push("hide"), onAdd: () => {} };
  try {
    await act(async () => root.render(<DockHeader {...props} readOnly />));
    expect(Array.from(mount.querySelectorAll("button"), button => button.getAttribute("aria-label"))).toEqual(["xyzr"]);
    await act(async () => mount.querySelector('button')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    expect(calls).toEqual([]);
    await act(async () => root.render(<DockHeader {...props} readOnly={false} transientTabId="x" />));
    expect(Array.from(mount.querySelectorAll("button"), button => button.getAttribute("aria-label"))).toEqual(["xyzr", "Add right dock tab", "Close right dock"]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
