import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver", "getComputedStyle", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { DockFileTabs } = await import("../apps/desktop/src/components/dock-file-tabs");

test("dock filename mouse drag reaches its destination without selecting the source", async () => {
  const container = document.createElement("div"); container.className = "app-shell"; document.body.append(container);
  const destination = document.createElement("div");
  Object.assign(destination.dataset, { dropDocumentId: "destination", dropDocumentPath: "/target.xyz", dropDocumentRenderer: "xyzrender-external" });
  container.append(destination);
  const mount = document.createElement("div"); container.append(mount);
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => destination;
  const root = createRoot(mount);
  const calls: unknown[] = [];
  const actions = {
    setStructureDragActive: (value: boolean) => calls.push(value),
    setDockDocument: () => calls.push("select-source"),
    addXyzrenderSheetItems: (id: string, payload: unknown) => calls.push({ id, payload }),
  } as unknown as ShellActions;
  const state = { documents: [{ id: "destination", path: "/target.xyz", renderer: "xyzrender-external" }] } as unknown as ShellViewState;
  try {
    await act(async () => root.render(<DockFileTabs area="right" entries={[{ key: "ligand", kind: "document", documentId: "ligand", title: "ligand.sdf", detail: "SDF", path: "/ligand.sdf" }]}
      activeKey="ligand" textViews={{}} onTextView={() => {}} actions={actions} state={state} />));
    const source = mount.querySelector<HTMLButtonElement>('[role="tab"]')!;
    expect(source.getAttribute("draggable")).toBe("true");
    await act(async () => {
      source.dispatchEvent(new browser.MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, clientX: 10, clientY: 10 }) as unknown as Event);
      window.dispatchEvent(new browser.MouseEvent("mousemove", { buttons: 1, clientX: 200, clientY: 200 }) as unknown as Event);
      window.dispatchEvent(new browser.MouseEvent("mouseup", { button: 0, clientX: 200, clientY: 200 }) as unknown as Event);
      source.click();
    });
    expect(calls).toContainEqual({ id: "destination", payload: { paths: ["/ligand.sdf"], records: [], items: [{ kind: "file", path: "/ligand.sdf", title: "ligand.sdf" }] } });
    expect(calls).not.toContain("select-source");
  } finally {
    await act(async () => root.unmount()); container.remove(); document.elementFromPoint = originalElementFromPoint;
  }
});
