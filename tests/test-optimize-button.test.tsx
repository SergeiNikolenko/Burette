import { expect, test } from "bun:test";
import React, { act } from "react";
import { mount, button, click } from "./structure-controls-dom";
import type { EnergyModelChoice } from "../apps/desktop/src/lib/molecular-workbench/energy-models";
import type { OptimizationMethod } from "../apps/desktop/src/lib/molecular-workbench/optimization";
const { OptimizeButton } = await import("../apps/desktop/src/components/workbench/optimize-button");
type Call = [OptimizationMethod, EnergyModelChoice];
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
    expect(calls.pop()).toEqual(["bfgs", "auto"]);
    for (const [label, method] of [["L-BFGS", "lbfgs"], ["FIRE", "fire"], ["ABC-FIRE", "abc-fire"], ["FIRE, then L-BFGS", "hybrid"], ["BFGS", "bfgs"]] as const) {
      await openMenu(view.host); await choose(label); await click(button(view.host, "Optimize"));
      expect(calls.pop()).toEqual([method, "auto"]);
    }
    await openMenu(view.host); await choose("MMFF94s"); await click(button(view.host, "Optimize"));
    expect(calls.pop()).toEqual(["bfgs", "MMFF94s"]);
    // Every method runs under every field: the remembered BFGS runs under UFF, checked.
    await openMenu(view.host); await choose("UFF"); await openMenu(view.host);
    expect(menuState().slice(5, 7)).toEqual([["BFGS", true, null], ["L-BFGS", false, null]]);
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
    await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["lbfgs", "auto"]);
    await openMenu(view.host);
    expect(menuState().every(item => item[2] === null)).toBe(true);
    await choose("BFGS"); await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["bfgs", "auto"]);
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

test("the step limit is chosen in the menu, remembered, and passed with every run", async () => {
  localStorage.clear();
  const limits: number[] = [];
  const render = () => <OptimizeButton atomCount={3} onOptimize={(_method, _field, maxIterations) => limits.push(maxIterations)} />;
  const view = await mount(render());
  try {
    await click(button(view.host, "Optimize")); expect(limits.pop()).toBe(250);
    await openMenu(view.host);
    expect(menuState().slice(-4)).toEqual([["100", false, null], ["250", true, null], ["500", false, null], ["1000", false, null]]);
    await choose("1000"); await click(button(view.host, "Optimize")); expect(limits.pop()).toBe(1000);
    await view.render(null); await view.render(render());
    expect(button(view.host, "Optimize").title).toBe("Automatic, BFGS, up to 1000 steps");
    await click(button(view.host, "Optimize")); expect(limits).toEqual([1000]);
  } finally { await view.close(); localStorage.clear(); }
});

test("Automatic is passed on for the structure to resolve, and models without parameters for an element say why", async () => {
  localStorage.clear();
  const calls: Call[] = [];
  const render = (elements: string[]) => <OptimizeButton atomCount={elements.length} elements={elements} onOptimize={(method, field) => calls.push([method, field])} />;
  const view = await mount(render(["C", "O", "H"]));
  try {
    await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["bfgs", "auto"]);
    expect(button(view.host, "Optimize").title).toBe("Automatic, BFGS, up to 250 steps");
    await view.render(render(["Pt", "Cl", "Cl"]));
    await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["lbfgs", "auto"]);
    expect(button(view.host, "Optimize").title).toBe("Automatic, L-BFGS, up to 250 steps");
    await openMenu(view.host);
    expect(menuState().slice(0, 5)).toEqual([["Automatic", true, null], ["MMFF94", false, "MMFF94 has no parameters for Pt."], ["MMFF94s", false, "MMFF94s has no parameters for Pt."], ["UFF", false, null], ["Lennard-Jones", false, null]]);
    await choose("Lennard-Jones"); await click(button(view.host, "Optimize")); expect(calls.pop()).toEqual(["lbfgs", "LJ"]);
    expect(button(view.host, "Optimize").title).toBe("Lennard-Jones, L-BFGS, up to 250 steps");
    // A remembered model that cannot describe the next structure blocks Optimize with its reason.
    await openMenu(view.host); await choose("UFF");
    await view.render(render(["Og", "Og"]));
    expect([button(view.host, "Optimize").disabled, button(view.host, "Optimize").title]).toEqual([true, "UFF has no parameters for Og."]);
    expect(calls).toEqual([]);
  } finally { await view.close(); localStorage.clear(); }
});
