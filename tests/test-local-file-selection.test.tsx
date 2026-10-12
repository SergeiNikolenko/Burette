import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MouseEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { useFileSelection } = await import("../apps/desktop/src/components/sidebar/use-file-selection");

test("Cmd toggles, Shift expands and shrinks from a stable anchor, and ranges exclude collapsed rows and other trees", async () => {
  let selected: Set<string> = new Set();
  function Tree() {
    const selection = useFileSelection(); selected = selection.selected;
    const row = (path: string) => <div data-sidebar-structure-path={path} onClick={event => selection.select(path, event)}>{path}</div>;
    return <><div role="tree">{row("a")}<div data-expanded="false">{row("hidden")}</div>{row("b")}{row("c")}{row("d")}</div><div role="tree">{row("other")}</div></>;
  }
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const click = async (path: string, modifiers = {}) => act(async () => mount.querySelector(`[data-sidebar-structure-path="${path}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers })));
  try {
    await act(async () => root.render(<Tree />));
    await click("a"); await click("d", { shiftKey: true }); expect([...selected]).toEqual(["a", "b", "c", "d"]);
    await click("b", { shiftKey: true }); expect([...selected]).toEqual(["a", "b"]);
    await click("d", { metaKey: true }); expect([...selected]).toEqual(["a", "b", "d"]);
    await click("c", { metaKey: true, shiftKey: true }); expect([...selected]).toEqual(["a", "b", "d", "c"]);
    await click("d", { metaKey: true }); expect([...selected]).toEqual(["a", "b", "c"]);
    await click("other", { shiftKey: true }); expect([...selected]).toEqual(["other"]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
