import assert from "node:assert/strict";
import React, { act } from "react";
import { test } from "bun:test";
import { Fixture, doc, writes, rememberViewerAtomSelection, until, createHost } from "./structure-edit-fixture";
const { requestOptimizationCommand } = await import("../apps/desktop/src/lib/workbench/optimization-commands");

test("menu and palette commands reach the Edit panel: freeze the selection, configure, and run Optimize Geometry", async () => {
  const { host, root } = createHost();
  const opened: string[] = [];
  const actions = { setDockDocument: () => {}, openDockTab: (_area: string, kind: string) => { opened.push(kind); } };
  const command = (name: Parameters<typeof requestOptimizationCommand>[3]) => act(async () => requestOptimizationCommand(actions as never, doc, "structure-edit", name));
  try {
    // A command sent before the panel has its structure waits for it.
    await command("freeze");
    await act(async () => root.render(<Fixture />));
    await until(host, () => host.querySelectorAll("[data-atom]").length === 3, "the atom table");
    assert.deepEqual(opened, ["structure-edit"]);
    await until(host, () => host.querySelector('[role="alert"]')?.textContent === "Select the atoms to freeze.", "the empty-selection reason");

    await act(async () => rememberViewerAtomSelection(doc.id, { atoms: 2, atomIdentities: [{ sourceIndex: 0, atomIndex: 0 }, { sourceIndex: 2, atomIndex: 2 }] }));
    await command("freeze");
    await until(host, () => host.querySelectorAll(".structure-edit-constraint-list li").length === 2, "two frozen atoms");
    await command("unfreeze");
    await until(host, () => !host.querySelector(".structure-edit-constraint-list li"), "the atoms unfrozen");

    await command("configure");
    await until(host, () => document.querySelector('[role="dialog"]')?.textContent?.includes("Configure Optimization"), "the Configure dialog");
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => item.textContent === "Cancel");
    await act(async () => cancel!.click());
    await until(host, () => !document.querySelector('[role="dialog"]'), "the dialog closed");

    // Ethanol has implicit hydrogens: Automatic resolves to MMFF94, which runs and states why it cannot.
    const before = writes.length;
    await command("optimize");
    await until(host, () => host.querySelector('[role="alert"]')?.textContent?.includes("explicit hydrogens"), "the optimization result");
    assert.equal(writes.length, before);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 60_000);
