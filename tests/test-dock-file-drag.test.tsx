import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "getComputedStyle", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { DockFileTabs } = await import("../apps/desktop/src/components/dock-file-tabs");

const { DockHeader } = await import("../apps/desktop/src/components/dock-header");
const { useSidebarStructureDrag } = await import("../apps/desktop/src/components/sidebar/use-sidebar-structure-drag");

test.each(["file", "panel"])("dock %s tab mouse drag reaches its destination without selecting the source", async (surface) => {
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
  function Fixture() {
    const drag = useSidebarStructureDrag({ state, actions, getPayload: () => ({ paths: ["/ligand.sdf"], records: [], items: [{ kind: "file", path: "/ligand.sdf", title: "ligand.sdf" }] }) });
    return surface === "panel"
      ? <DockHeader area="bottom" tabs={[{ id: "files", kind: "files" }, { id: "jobs", kind: "jobs" }]} activeKind="jobs" panelId="panel" readOnly={false}
          fileDragProps={{ ...drag, draggable: true }} onSelect={() => calls.push("select-source")} onClose={() => {}} onAdd={() => {}} onHide={() => {}} />
      : <DockFileTabs area="right" entries={[{ key: "ligand", kind: "document", documentId: "ligand", title: "ligand.sdf", detail: "SDF", path: "/ligand.sdf" }]}
          activeKey="ligand" textViews={{}} onTextView={() => {}} actions={actions} state={state} />;
  }
  try {
    await act(async () => root.render(<Fixture />));
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

test.each([
  { name: "AppKit fallback", accepted: false, point: { x: 200, y: 200 }, opens: true },
  { name: "accepted native drop", accepted: true, point: null, opens: false },
  { name: "cancelled or unstarted drag", accepted: false, point: null, opens: false },
])("dock file drag handles $name without selecting its source", async ({ accepted, point, opens }) => {
  const container = document.createElement("div"); container.className = "app-shell"; document.body.append(container);
  const destination = document.createElement("div");
  destination.className = "dock-panel";
  Object.assign(destination.dataset, { area: "bottom", activeTab: "files" });
  container.append(destination);
  const mount = document.createElement("div"); container.append(mount);
  const originalElementFromPoint = document.elementFromPoint;
  const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
  document.elementFromPoint = () => destination;
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  const commands: unknown[] = [], dropped: unknown[] = [];
  let selected = false;
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {
    invoke: async (command: string, args: unknown) => {
      commands.push([command, args]);
      return { accepted, inAppDrop: point };
    },
  } });
  const actions = {
    setStructureDragActive: () => {},
    setDockDocument: () => { selected = true; },
    openDockPayload: async (input: unknown) => { dropped.push(input); },
  } as unknown as ShellActions;
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<DockFileTabs area="right"
      entries={[{ key: "ligand", kind: "document", documentId: "ligand", title: "ligand.sdf", detail: "SDF", path: "/ligand.sdf" }]}
      activeKey="ligand" textViews={{}} onTextView={() => {}} actions={actions} state={{ documents: [] } as unknown as ShellViewState} />));
    const source = mount.querySelector<HTMLButtonElement>('[role="tab"]')!;
    await act(async () => {
      source.dispatchEvent(new browser.MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }) as unknown as Event);
      source.dispatchEvent(new browser.Event("dragstart", { bubbles: true, cancelable: true }) as unknown as Event);
      source.click();
    });
    expect({ commands, dropped, selected }).toEqual({
      commands: [["start_file_drag", { paths: ["/ligand.sdf"] }]],
      dropped: opens ? [{ area: "bottom", tabKind: "files", payload: {
        paths: ["/ligand.sdf"], records: [], items: [{ kind: "file", path: "/ligand.sdf", title: "ligand.sdf" }],
      } }] : [],
      selected: false,
    });
  } finally {
    await act(async () => root.unmount()); container.remove(); document.elementFromPoint = originalElementFromPoint;
    if (originalPlatform) Object.defineProperty(navigator, "platform", originalPlatform);
    else Reflect.deleteProperty(navigator, "platform");
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const { nativeFileDragPayload } = await import("../apps/desktop/src/lib/native-file-drag");
    nativeFileDragPayload(["/ligand.sdf"], { consume: true });
  }
});
