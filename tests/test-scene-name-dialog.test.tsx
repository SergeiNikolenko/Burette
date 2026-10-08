import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { SceneNameDialog } = await import("../apps/desktop/src/components/scene-name-dialog");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
type Scene = NonNullable<React.ComponentProps<typeof SceneNameDialog>["document"]>;
const scene = { id: "scene", title: "Complex", path: "/set/a.pdb", extension: "pdb", renderer: "molstar", runtimePath: "/viewer.html", byteCount: 123 } as Scene;
const other = { ...scene, id: "other", title: "Other", path: "/set/b.pdb" };

async function fixture(run: (mount: HTMLDivElement, closed: () => number, render: (value: Scene | null) => Promise<void>) => Promise<void>) {
  const before = useMoleculeStore.getState().documents;
  useMoleculeStore.setState({ documents: [scene, other] });
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount); let closes = 0;
  const render = (value: Scene | null) => act(async () => root.render(<SceneNameDialog document={value} onClose={() => { closes++; }} />));
  try { await render(scene); await run(mount, () => closes, render); }
  finally { await act(async () => root.unmount()); mount.remove(); useMoleculeStore.setState({ documents: before }); }
}
async function fill(mount: Element, value: string) {
  await act(async () => {
    const input = mount.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = (mount: Element) => act(async () => mount.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

test("rename trims the scene title without changing another scene or its file data", async () => {
  await fixture(async (mount, closed) => {
    expect(mount.querySelector("input")?.value).toBe("Complex");
    await fill(mount, "   "); await submit(mount);
    expect([closed(), useMoleculeStore.getState().documents]).toEqual([0, [scene, other]]);
    expect(mount.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await fill(mount, "  Binding site  "); await submit(mount);
    expect([closed(), useMoleculeStore.getState().documents]).toEqual([1, [{ ...scene, title: "Binding site" }, other]]);
  });
});

test("cancel and Escape preserve titles; reopening resets the draft to the requested scene", async () => {
  await fixture(async (mount, closed, render) => {
    await fill(mount, "Unsaved");
    await act(async () => Array.from(mount.querySelectorAll("button")).find(button => button.textContent === "Cancel")!.click());
    expect([closed(), useMoleculeStore.getState().documents]).toEqual([1, [scene, other]]);
    await render(null); await render(other);
    expect(mount.querySelector("input")?.value).toBe("Other");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect([closed(), useMoleculeStore.getState().documents]).toEqual([2, [scene, other]]);
  });
});
