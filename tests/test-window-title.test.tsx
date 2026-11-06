import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { mockIPC, mockWindows, clearMocks } from "@tauri-apps/api/mocks";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { useWindowTitle } = await import("../apps/desktop/src/components/window-title/use-window-title");
function Title({ title }: { title: string }) { useWindowTitle(title); return null; }

test("window titles track active content in the browser and native window", async () => {
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  const calls: unknown[] = [];
  try {
    await act(async () => root.render(<Title title="Settings — Burette" />));
    expect(document.title).toBe("Settings — Burette");
    mockWindows("workspace-second");
    mockIPC((command, args) => { calls.push({ command, args }); });
    await act(async () => root.render(<Title title="Protein — Burette" />));
    await act(async () => root.render(<Title title="Notes — Burette" />));
    expect(document.title).toBe("Notes — Burette");
    expect(calls).toEqual([
      { command: "plugin:window|set_title", args: { label: "workspace-second", value: "Protein — Burette" } },
      { command: "plugin:window|set_title", args: { label: "workspace-second", value: "Notes — Burette" } },
    ]);
  } finally { await act(async () => root.unmount()); mount.remove(); clearMocks(); }
});
