import assert from "node:assert/strict";
import React, { act } from "react";
import { test } from "bun:test";
import { Fixture, doc, source, writes, until, click, button, createHost, resetSource } from "./structure-edit-fixture";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";

// Avogadro Align: first pick to the origin, second pick on +axis. Checked by geometric invariants
// of the written draft, not by re-running the transform.
const before = parseMolecule(source, "sdf").atoms;
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function rigid(atoms: typeof before) {
  for (let a = 0; a < atoms.length; a++) for (let b = a + 1; b < atoms.length; b++) assert.ok(Math.abs(distance(atoms[a], atoms[b]) - distance(before[a], before[b])) < 1e-9);
}

test("Align moves the first picked atom to the origin and the second onto the chosen axis as one Undo step", async () => {
  resetSource(true);
  const { host, root } = createHost();
  const target = { ...doc, id: "align-pair", path: "/align-pair.sdf" };
  try {
    await act(async () => root.render(<Fixture document={target} />));
    await until(host, () => host.querySelectorAll("[data-atom]").length === 3, "atoms");
    // Pick order, not index order: O3 first, then C1.
    await click(host.querySelector('[data-atom="2"]'));
    await click(host.querySelector('[data-atom="0"]'), { metaKey: true });
    await until(host, () => host.textContent?.includes("O3–C1"), "pair");
    const trigger = button(host, "Align");
    await act(async () => { trigger.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true })); });
    await until(host, () => document.querySelectorAll('[role="menuitem"]').length === 3, "axis menu");
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(item => item.textContent?.trim());
    assert.deepEqual(items, ["C1 on x axis", "C1 on y axis", "C1 on z axis"]);
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === "C1 on z axis"));
    await until(host, () => writes.length === 1, "aligned draft");
    const atoms = parseMolecule(writes[0].content, "sdf").atoms;
    assert.deepEqual([atoms[2].x, atoms[2].y, atoms[2].z], [0, 0, 0]);
    assert.ok(Math.abs(atoms[0].x) < 1e-9 && Math.abs(atoms[0].y) < 1e-9 && Math.abs(atoms[0].z - distance(before[0], before[2])) < 1e-9);
    rigid(atoms);
    assert.deepEqual(atoms.map(atom => atom.element), before.map(atom => atom.element));
    assert.match(writes[0].content, /^ethanol\n/u); assert.match(writes[0].content, /> <ID>\nEtOH-1\n/u);
    assert.equal(writes[0].options?.view, "keep");
    assert.ok(host.textContent?.includes("O3–C1"), "the pick survives the rigid motion");
    await click(button(host, "Undo"));
    await until(host, () => writes.length === 2, "undo");
    assert.deepEqual(parseMolecule(writes[1].content, "sdf").atoms.map(atom => [atom.x, atom.y, atom.z]), before.map(atom => [atom.x, atom.y, atom.z]));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Align with one atom translates every atom by the same vector", async () => {
  resetSource(true);
  const { host, root } = createHost();
  const target = { ...doc, id: "align-one", path: "/align-one.sdf" };
  try {
    await act(async () => root.render(<Fixture document={target} />));
    await until(host, () => host.querySelectorAll("[data-atom]").length === 3, "atoms");
    await click(host.querySelector('[data-atom="1"]'));
    await until(host, () => host.querySelector('section[aria-label="Atom C2"]'), "atom");
    await click(button(host, "Align"));
    await until(host, () => writes.length === 1, "translated draft");
    const atoms = parseMolecule(writes[0].content, "sdf").atoms;
    atoms.forEach((atom, index) => ["x", "y", "z"].forEach(axis => assert.ok(Math.abs(atom[axis as "x"] - (before[index][axis as "x"] - before[1][axis as "x"])) < 1e-9)));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
