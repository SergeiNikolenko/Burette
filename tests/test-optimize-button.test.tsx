import { expect, test } from "bun:test";
import React, { act } from "react";
import { mount, button, click } from "./structure-controls-dom";
import type { MinimizerMethod, MolecularForceField } from "../apps/desktop/src/lib/molecular-workbench/types";
const { OptimizeButton } = await import("../apps/desktop/src/components/workbench/optimize-button");
async function openMenu(host: ParentNode) {
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}
async function choose(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(node => node.textContent?.trim() === label);
  if (!item) throw new Error(`Missing menu item: ${label}`);
  await click(item);
}

test("force field and every method are chosen through the menu and survive remount", async () => {
  localStorage.clear();
  const calls: [MinimizerMethod | undefined, MolecularForceField][] = [];
  const render = (count: number) => <OptimizeButton atomCount={count} onOptimize={(method, field) => calls.push([method, field])} />;
  const view = await mount(render(3));
  try {
    await click(button(view.host, "Optimize"));
    expect(calls.pop()).toEqual([undefined, "MMFF94"]);
    for (const [label, method] of [["FIRE", "fire"], ["ABC-FIRE", "abc-fire"], ["FIRE, then L-BFGS", "hybrid"], ["L-BFGS", undefined]] as const) {
      await openMenu(view.host); await choose(label); await click(button(view.host, "Optimize"));
      expect(calls.pop()).toEqual([method, "MMFF94"]);
    }
    for (const field of ["MMFF94s", "UFF"] as const) {
      await openMenu(view.host); await choose(field); await click(button(view.host, "Optimize"));
      expect(calls.pop()).toEqual([undefined, field]);
    }
    await openMenu(view.host); await choose("ABC-FIRE");
    await view.render(null); await view.render(render(3));
    await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["abc-fire", "UFF"]);
  } finally { await view.close(); localStorage.clear(); }
});

test("large molecules retain the selected field but cannot dispatch unavailable UFF; MMFF uses default minimization", async () => {
  localStorage.setItem("burette.workbench.force-field", "UFF"); localStorage.setItem("burette.workbench.optimizer", "fire");
  const calls: [MinimizerMethod | undefined, MolecularForceField][] = [];
  const view = await mount(<OptimizeButton atomCount={65} onOptimize={(method, field) => calls.push([method, field])} />);
  try {
    expect(button(view.host, "Optimize").disabled).toBe(true);
    await openMenu(view.host);
    const disabled = [...document.querySelectorAll('[role="menuitemradio"][aria-disabled="true"]')].map(item => item.textContent?.trim());
    expect(disabled).toEqual(["UFF", "FIRE", "ABC-FIRE", "FIRE, then L-BFGS"]);
    await choose("MMFF94s"); await click(button(view.host, "Optimize")); expect(calls).toEqual([[undefined, "MMFF94s"]]);
    await view.render(<OptimizeButton atomCount={3} disabled onOptimize={(method, field) => calls.push([method, field])} />);
    expect([...view.host.querySelectorAll<HTMLButtonElement>("button")].every(node => node.disabled)).toBe(true);
  } finally { await view.close(); localStorage.clear(); }
});
