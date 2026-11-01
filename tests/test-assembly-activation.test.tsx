import { createRoot } from "react-dom/client";
import { act, React, test, expect, fixture, dialog, wait, closeWorkbenchDialog, buildShellCommands, filterShellCommands, browser } from "./assembly-dialog-fixture";
const { SceneComputeMenu } = await import("../apps/desktop/src/components/editor-area/scene-compute-menu");
import type { ShellViewState } from "../apps/desktop/src/components/types";

test("palette opens the assembly chooser without an eligible source", async () => {
  const f = await fixture();
  try {
    await act(async () => closeWorkbenchDialog());
    const commands = buildShellCommands({ activeDocument: null, documents: [], tabs: [], recentStructures: [], preferences: { rendererMode: "auto" } } as unknown as ShellViewState, f.actions, "assembly");
    const matches = filterShellCommands(commands, "assembly").filter(command => command.id === "workbench-assembly");
    expect(matches).toHaveLength(1); expect(matches[0].label).toBe("Build biological assembly…");
    await act(async () => matches[0].run());
    await wait(() => Boolean(dialog()?.textContent?.includes("Choose file…")), "assembly file chooser");
    expect(dialog()!.querySelector('select[aria-label="Model"]')).toBeNull();
  } finally { await f.close(); }
});

test("Compute opens exactly one assembly host for the current CIF source", async () => {
  const f = await fixture(), container = browser.document.createElement("div"), root = createRoot(container as unknown as Element);
  browser.document.body.append(container);
  try {
    await act(async () => { closeWorkbenchDialog(); root.render(<SceneComputeMenu document={f.source} actions={f.actions} />); });
    await act(async () => (container.querySelector('[aria-label="Open molecular compute menu"]') as unknown as HTMLButtonElement).dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
    await wait(() => [...browser.document.querySelectorAll('[role="menuitem"]')].some(node => node.textContent?.includes("Build biological assembly")), "assembly menu action");
    const item = [...browser.document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent?.includes("Build biological assembly")) as unknown as HTMLElement;
    await act(async () => item.click());
    await wait(() => Boolean(dialog()?.querySelector('select[aria-label="Model"]')), "source assembly models");
    expect(browser.document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()!.textContent).toContain(f.source.title);
  } finally { await act(async () => root.unmount()); container.remove(); await f.close(); }
});
