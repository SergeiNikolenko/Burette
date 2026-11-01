import { expect, test } from "bun:test";
import React, { act } from "react";
import { mount, button, click } from "./structure-controls-dom";
import type { MolecularForceField } from "../apps/desktop/src/lib/molecular-workbench/types";
import type { OptimizationMethod } from "../apps/desktop/src/lib/molecular-workbench/optimization";
const { OptimizeButton } = await import("../apps/desktop/src/components/workbench/optimize-button");
type Call = [OptimizationMethod, MolecularForceField];
async function openMenu(host: ParentNode) {
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
async function choose(label: string) {
  const item = items().find(node => node.textContent?.trim() === label);
  if (!item) throw new Error(`Missing menu item: ${label}`);
  await click(item);
}
const menuState = () => items().map(node => [node.textContent?.trim(), node.getAttribute("aria-checked") === "true", node.getAttribute("aria-disabled") === "true" ? node.title : null]);
async function closeMenu() { await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); }

test("every force field and method is explicit, remembered across remounts, and BFGS is the unconstrained MMFF default", async () => {
  localStorage.clear();
  const calls: Call[] = [];
  const render = (count: number) => <OptimizeButton atomCount={count} onOptimize={(method, field) => calls.push([method, field])} />;
  const view = await mount(render(3));
  try {
    await click(button(view.host, "Optimize"));
    expect(calls.pop()).toEqual(["bfgs", "MMFF94"]);
    for (const [label, method] of [["L-BFGS", "lbfgs"], ["FIRE", "fire"], ["ABC-FIRE", "abc-fire"], ["FIRE, then L-BFGS", "hybrid"], ["BFGS", "bfgs"]] as const) {
      await openMenu(view.host); await choose(label); await click(button(view.host, "Optimize"));
      expect(calls.pop()).toEqual([method, "MMFF94"]);
    }
    await openMenu(view.host); await choose("MMFF94s"); await click(button(view.host, "Optimize"));
    expect(calls.pop()).toEqual(["bfgs", "MMFF94s"]);
    // BFGS is the MMFF toolkit minimizer: under UFF it is shown unavailable and L-BFGS runs, visibly checked.
    await openMenu(view.host); await choose("UFF"); await openMenu(view.host);
    expect(menuState().slice(3, 5)).toEqual([["BFGS", false, "BFGS is the MMFF94 toolkit minimizer. Choose L-BFGS, FIRE, ABC-FIRE or hybrid for UFF."], ["L-BFGS", true, null]]);
    await closeMenu(); await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["lbfgs", "UFF"]);
    expect(view.host.querySelector('[aria-haspopup="menu"]')!.getAttribute("aria-label")).toBe("Optimization method: L-BFGS, UFF");
    await openMenu(view.host); await choose("ABC-FIRE");
    await view.render(null); await view.render(render(3));
    await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["abc-fire", "UFF"]);
  } finally { await view.close(); localStorage.clear(); }
});

test("constraints and coupled Z-matrix variables rule out BFGS with a stated reason", async () => {
  localStorage.setItem("burette.workbench.optimizer", "bfgs");
  const calls: Call[] = [];
  const view = await mount(<OptimizeButton atomCount={9} constraintCount={2} onOptimize={(method, field) => calls.push([method, field])} />);
  try {
    await openMenu(view.host);
    expect(menuState()[3]).toEqual(["BFGS", false, "BFGS cannot hold frozen atoms or constraints. Choose L-BFGS, FIRE, ABC-FIRE or hybrid."]);
    await closeMenu(); await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["lbfgs", "MMFF94"]);
    await view.render(<OptimizeButton atomCount={9} coupled onOptimize={(method, field) => calls.push([method, field])} />);
    await openMenu(view.host);
    expect(menuState()[3]).toEqual(["BFGS", false, "BFGS cannot keep Z-matrix variables coupled. Choose L-BFGS, FIRE, ABC-FIRE or hybrid."]);
    await closeMenu();
    await view.render(<OptimizeButton atomCount={9} unavailableReason="The C1–C2–N3 angle is linear." onOptimize={(method, field) => calls.push([method, field])} />);
    expect([button(view.host, "Optimize").disabled, button(view.host, "Optimize").title]).toEqual([true, "The C1–C2–N3 angle is linear."]);
    expect(calls).toEqual([]);
  } finally { await view.close(); localStorage.clear(); }
});

test("above 64 atoms only unconstrained MMFF BFGS runs; nothing is dropped silently", async () => {
  localStorage.setItem("burette.workbench.force-field", "UFF"); localStorage.setItem("burette.workbench.optimizer", "fire");
  const calls: Call[] = [];
  const view = await mount(<OptimizeButton atomCount={65} onOptimize={(method, field) => calls.push([method, field])} />);
  try {
    expect([button(view.host, "Optimize").disabled, button(view.host, "Optimize").title]).toEqual([true, "UFF optimization supports up to 64 atoms; this structure has 65."]);
    await openMenu(view.host);
    expect(menuState().filter(item => item[2]).map(item => item[0])).toEqual(["UFF", "BFGS", "L-BFGS", "FIRE", "ABC-FIRE", "FIRE, then L-BFGS"]);
    await choose("MMFF94s"); await openMenu(view.host);
    expect(menuState().filter(item => item[2]).map(item => item[0])).toEqual(["UFF", "L-BFGS", "FIRE", "ABC-FIRE", "FIRE, then L-BFGS"]);
    await closeMenu(); await click(button(view.host, "Optimize")); expect(calls).toEqual([["bfgs", "MMFF94s"]]);
    await view.render(<OptimizeButton atomCount={65} constraintCount={1} onOptimize={(method, field) => calls.push([method, field])} />);
    expect(button(view.host, "Optimize").disabled).toBe(true);
    await view.render(<OptimizeButton atomCount={3} disabled onOptimize={(method, field) => calls.push([method, field])} />);
    expect([...view.host.querySelectorAll<HTMLButtonElement>("button")].every(node => node.disabled)).toBe(true);
  } finally { await view.close(); localStorage.clear(); }
});
