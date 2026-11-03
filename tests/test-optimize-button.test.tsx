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
    // Every method runs under every field: the remembered BFGS runs under UFF, checked.
    await openMenu(view.host); await choose("UFF"); await openMenu(view.host);
    expect(menuState().slice(3, 5)).toEqual([["BFGS", true, null], ["L-BFGS", false, null]]);
    await closeMenu(); await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["bfgs", "UFF"]);
    expect(view.host.querySelector('[aria-haspopup="menu"]')!.getAttribute("aria-label")).toBe("Optimization method: BFGS, UFF");
    await openMenu(view.host); await choose("ABC-FIRE");
    await view.render(null); await view.render(render(3));
    await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["abc-fire", "UFF"]);
  } finally { await view.close(); localStorage.clear(); }
});

test("constraints and coupled Z-matrix variables default to L-BFGS and keep every method available", async () => {
  localStorage.clear();
  const calls: Call[] = [];
  const view = await mount(<OptimizeButton atomCount={9} constraintCount={2} onOptimize={(method, field) => calls.push([method, field])} />);
  try {
    await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["lbfgs", "MMFF94"]);
    await openMenu(view.host);
    expect(menuState().every(item => item[2] === null)).toBe(true);
    await choose("BFGS"); await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["bfgs", "MMFF94"]);
    // Coupled variables difference the energy, which bounds their size; the button says so.
    await view.render(<OptimizeButton atomCount={70} coupled onOptimize={(method, field) => calls.push([method, field])} />);
    expect([button(view.host, "Optimize").disabled, button(view.host, "Optimize").title]).toEqual([true, "Coupled Z-matrix optimization supports up to 64 atoms; this structure has 70."]);
    await view.render(<OptimizeButton atomCount={9} unavailableReason="The C1–C2–N3 angle is linear." onOptimize={(method, field) => calls.push([method, field])} />);
    expect([button(view.host, "Optimize").disabled, button(view.host, "Optimize").title]).toEqual([true, "The C1–C2–N3 angle is linear."]);
    expect(calls).toEqual([]);
  } finally { await view.close(); localStorage.clear(); }
});

test("every method and field runs up to 256 atoms; above that the button states why", async () => {
  localStorage.setItem("burette.workbench.force-field", "UFF"); localStorage.setItem("burette.workbench.optimizer", "fire");
  const calls: Call[] = [];
  const view = await mount(<OptimizeButton atomCount={65} constraintCount={1} onOptimize={(method, field) => calls.push([method, field])} />);
  try {
    await click(button(view.host, "Optimize")); expect(calls).toEqual([["fire", "UFF"]]);
    await view.render(<OptimizeButton atomCount={257} onOptimize={(method, field) => calls.push([method, field])} />);
    expect([button(view.host, "Optimize").disabled, button(view.host, "Optimize").title]).toEqual([true, "Geometry optimization supports 1–256 atoms, including added hydrogens."]);
    await view.render(<OptimizeButton atomCount={3} disabled onOptimize={(method, field) => calls.push([method, field])} />);
    expect([...view.host.querySelectorAll<HTMLButtonElement>("button")].every(node => node.disabled)).toBe(true);
  } finally { await view.close(); localStorage.clear(); }
});
