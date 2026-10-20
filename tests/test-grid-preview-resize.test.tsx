import { test, expect, mock } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "ResizeObserver"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("../apps/desktop/src/components/grid-selection-scaffold", () => ({
  useSelectionScaffold: () => ({ kind: "idle" }), scaffoldStatusLine: () => null,
}));
const { createRoot } = await import("react-dom/client");
const { GridHoverMoleculeCard } = await import("../apps/desktop/src/components/grid-hover-molecule");

test("only explicit preview shrink reveals its drawing in a scrolled inspector", async () => {
  const mount = document.createElement("div"); document.body.append(mount);
  mount.className = "dock-content";
  mount.getBoundingClientRect = () => ({ top: 0, bottom: 600 }) as DOMRect;
  const root = createRoot(mount);
  const row = { index: 0, name: "ethanol", smiles: "CCO", molblock: "", props: [] } as any;
  const render = async (value = row) => act(async () => root.render(<GridHoverMoleculeCard row={value} documentId="resize-test" />));
  try {
    await render();
    const well = mount.querySelector<HTMLElement>(".grid-hover-molecule-svg")!;
    mount.scrollTop = 300;
    well.getBoundingClientRect = () => ({ top: 100 - mount.scrollTop, bottom: 100 - mount.scrollTop + Number.parseFloat(well.style.height) }) as DOMRect;
    const handle = mount.querySelector('[aria-label="Resize molecule preview"]')!;
    const key = async (value: string) => act(async () => {
      handle.dispatchEvent(new browser.KeyboardEvent("keydown", { key: value, bubbles: true }));
    });
    await key("End");
    expect(mount.scrollTop).toBe(300);
    await key("Home");
    expect(mount.scrollTop).toBe(100);
    mount.scrollTop = 300;
    await render({ ...row, name: "acetic acid", smiles: "CC(O)=O" });
    await key("Home");
    expect(mount.scrollTop).toBe(300);
    expect(well.style.height).toBe("160px");
    await key("End");
    (handle as HTMLElement).setPointerCapture = () => {};
    const pointer = async (type: string, clientY: number) => act(async () => {
      handle.dispatchEvent(new browser.PointerEvent(type, { button: 0, pointerId: 1, clientY, bubbles: true }));
    });
    await pointer("pointerdown", 600);
    await pointer("pointermove", 300);
    expect(well.style.height).toBe("420px");
    expect(mount.scrollTop).toBe(300);
    await pointer("pointerup", 300);
    expect(mount.scrollTop).toBe(100);
  } finally {
    await act(async () => root.unmount());
    mount.remove();
  }
});
