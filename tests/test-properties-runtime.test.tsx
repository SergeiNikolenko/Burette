import { expect, test } from "bun:test";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { mount, logical, documentFor, until, button, click, formula, hold, workers, toast, water, ammonia } from "./properties-runtime-fixture";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";

const csvButton = (label: string) => [...document.querySelectorAll("dt")].find(node => node.textContent === label)!.nextElementSibling!.querySelector("button")!;
test("logical XYZ properties retain fields and export ordered, finite charges and forces CSV", async () => {
  const doc = documentFor("molx"); logical(doc); const f = await mount(doc);
  try {
    await until(() => formula() === "H2O" && csvButton("MMFF94 forces"));
    expect([...document.querySelectorAll("dt")].map(node => node.textContent)).toEqual(["Formula", "Molecular weight", "Exact mass", "Atoms", "Bonds", "Net charge", "H-bond donors", "H-bond acceptors", "Rotatable bonds", "Polar surface area", "cLogP", "MMFF94 energy", "Gasteiger charges", "MMFF94 forces"]);
    await click(csvButton("Gasteiger charges")); await until(() => f.saved.length === 1);
    const rows = f.saved[0].text.trim().split("\n").map(row => row.split(","));
    expect(rows[0]).toEqual(["atom", "element", "charge_e"]); expect(rows.slice(1).map(row => row.slice(0, 2))).toEqual([["1", "O"], ["2", "H"], ["3", "H"]]);
    expect(Math.abs(rows.slice(1).reduce((sum, row) => sum + Number(row[2]), 0))).toBeLessThan(1e-10);
    await until(() => !document.querySelector('[role="status"]')); await click(csvButton("MMFF94 forces")); await until(() => f.saved.length === 2);
    const force = f.saved[1].text.trim().split("\n").map(row => row.split(","));
    expect(force).toHaveLength(4); expect(force[0].join(",")).toContain("kcal_mol");
    expect(force.slice(1).every(row => row.slice(3).every(value => Number.isFinite(Number(value))))).toBe(true);
    expect(f.opened).toEqual([]); expect(f.controller().sessionForDocument(doc)).toBeNull();
  } finally { await f.close(); }
});

test("Properties logical SDF uses the real source controller and shares one Undo with Edit", async () => {
  const doc = documentFor("molx"), source = readFileSync(new URL("./fixtures/properties/ethanol.sdf", import.meta.url), "utf8"); logical(doc, source, "sdf"); const f = await mount(doc);
  try {
    await until(() => !button("Add hydrogens").disabled); await click(button("Add hydrogens"));
    await until(() => f.controller().sessionForDocument(doc)?.dirty);
    const content = f.controller().sessionForDocument(doc)!.content;
    expect(parseMolecule(content, "sdf").atoms).toHaveLength(9); expect(f.dock).toEqual(["structure-edit"]); expect(f.opened).toEqual([]);
    await f.render(doc, true); await until(() => document.querySelectorAll("[data-atom]").length === 9);
    await click(button("Undo")); await until(() => f.controller().sessionForDocument(doc)?.content === source);
    expect(f.controller().sessionForDocument(doc)!.dirty).toBe(false);
  } finally { await f.close(); }
});

test("a non-graph format opens its generated SDF and retains the logical original", async () => {
  const doc = documentFor("molx"); logical(doc); const f = await mount(doc);
  try {
    await until(() => !button("Remove hydrogens").disabled); await click(button("Remove hydrogens")); await until(() => f.opened.length === 1);
    expect(f.opened[0][0].inputExtension).toBe("sdf"); expect(parseMolecule(f.opened[0][0].text, "sdf").atoms.map(atom => atom.element)).toEqual(["O"]);
    expect(f.controller().sessionForDocument(doc)).toBeNull(); expect(f.done()).toBe(1);
  } finally { await f.close(); }
});

test("cancel and logical replacement discard actual late charge replies; retry remains usable", async () => {
  const doc = documentFor("molx"); logical(doc); const f = await mount(doc);
  try {
    await until(() => formula() === "H2O"); hold("charges"); await click(csvButton("Gasteiger charges")); await until(() => workers.at(-1)?.replies.length);
    const cancelled = workers.at(-1)!; await click(button("Cancel")); expect(cancelled.terminated).toBe(true); await act(async () => cancelled.replies.shift()!()); expect(f.saved).toEqual([]);
    await click(csvButton("Gasteiger charges")); await until(() => workers.at(-1)?.replies.length); const stale = workers.at(-1)!;
    await act(async () => logical(doc, ammonia)); await until(() => stale.terminated);
    await act(async () => stale.replies.shift()!()); expect(f.saved).toEqual([]); hold(""); await until(() => formula() === "H3N");
    await click(csvButton("Gasteiger charges")); await until(() => f.saved.length === 1); expect(f.saved[0].text).toContain("1,N,");
  } finally { await f.close(); }
});

test("a replacement document never commits an old formula in its render", async () => {
  const doc = documentFor("molx"); logical(doc); const f = await mount(doc);
  try {
    await until(() => formula() === "H2O"); const next = documentFor("molx"); logical(next, ammonia); await f.render(next);
    expect(f.layouts.filter(row => row.id === next.id).some(row => row.formula === "H2O")).toBe(false); await until(() => formula() === "H3N");
  } finally { await f.close(); }
});

test("numerical optimization keeps the Open steps trajectory action", async () => {
  localStorage.setItem("burette.workbench.optimizer", "fire"); const doc = documentFor("molx"); logical(doc); const f = await mount(doc);
  const add = toast.add; let notice: Parameters<typeof toast.add>[0] | null = null;
  toast.add = options => { notice = options; return "properties-test"; };
  try {
    await until(() => !button("Optimize").disabled); await click(button("Optimize")); await until(() => f.opened.length === 1);
    expect(notice!.actionProps?.children).toBe("Open steps"); await act(async () => notice!.actionProps!.onClick()); await until(() => f.opened.length === 2);
    const steps = parseScientificFile("steps.xyz", f.opened[1][0].text); expect(steps.frames.length).toBeGreaterThan(1); expect(steps.frames.every(frame => Number.isFinite(frame.energyHartree))).toBe(true);
    expect(f.controller().sessionForDocument(doc)).toBeNull();
  } finally { toast.add = add; localStorage.removeItem("burette.workbench.optimizer"); await f.close(); }
});
