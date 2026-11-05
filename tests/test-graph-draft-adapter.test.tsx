import { expect, test } from "bun:test";
import { act } from "react";
import { fixture } from "./measurement-pair-fixture";
const { useGraphDraft } = await import("../apps/desktop/src/components/workbench/use-graph-draft");

test("Generate 3D refits its pose through Undo and Redo while coordinate edits retain the camera", async () => {
  const view = await fixture("sdf", useGraphDraft);
  try {
    const original = view.graph.history!.current;
    expect(await view.apply({ kind: "prepare-3d" })).not.toBeNull();
    const generated = view.graph.history!.current;
    expect(view.draftOptions.at(-1)).toEqual({ view: "fit" });
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(original);
    expect(view.draftOptions.at(-1)).toEqual({ view: "fit" });
    await act(async () => view.graph.redo());
    expect(view.graph.history!.current).toBe(generated);
    expect(view.draftOptions.at(-1)).toEqual({ view: "fit" });
    expect(await view.apply({ kind: "positions", from: generated,
      coordinates: generated.structure.atoms.map(atom => [atom.x + 0.01, atom.y, atom.z]) })).not.toBeNull();
    expect(view.draftOptions.at(-1)).toEqual({ view: "keep" });
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(generated);
    expect(view.draftOptions.at(-1)).toEqual({ view: "keep" });
    await act(async () => view.graph.redo());
    expect(view.draftOptions.at(-1)).toEqual({ view: "keep" });
  } finally { await view.close(); }
});

for (const [method, label] of [["bfgs", "BFGS"], ["lbfgs", "L-BFGS"]] as const) test(`the full adapter keeps add-H and ${label} optimization in the same published source history`, async () => {
  const view = await fixture("sdf", useGraphDraft);
  try {
    const before = view.graph.history!.current;
    expect(await view.apply({ kind: "add-hydrogens" })).not.toBeNull();
    expect(view.dockTabs.at(-1)).toBe("structure-edit");
    const hydrogenated = view.graph.history!.current;
    expect(hydrogenated.structure.atoms.length).toBeGreaterThan(before.structure.atoms.length);
    expect(view.focused.history).toBe(view.graph.history);
    await act(async () => view.focused.undo()); expect(view.graph.history!.current).toBe(before);
    await act(async () => view.graph.redo()); expect(view.focused.history!.current).toBe(hydrogenated);
    // The source is a 2D drawing. Give its added H distinct 3D positions before
    // asking a force field to evaluate angles and torsions of the test molecule.
    await act(async () => view.focused.apply({ kind: "positions", from: hydrogenated,
      coordinates: hydrogenated.structure.atoms.map((atom, index) => [atom.x, atom.y, atom.z + index * index * 0.015]) }));
    const spatial = view.graph.history!.current;
    expect(spatial).not.toBe(hydrogenated);
    const optimization = await view.apply({ kind: "optimize", forceField: "MMFF94", method });
    expect(view.graph.error).toBeNull(); expect(optimization).not.toBeNull();
    const optimized = view.graph.history!.current;
    expect(optimized.outcome?.method).toBe(label);
    expect(Number.isFinite(optimized.outcome?.energy)).toBe(true);
    expect(view.focused.history).toBe(view.graph.history);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(optimized.text);
    expect(view.graph.history!.undo).toEqual([before, hydrogenated, spatial]);
    await act(async () => view.focused.undo()); expect(view.graph.history!.current).toBe(spatial);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(spatial.text);
    await act(async () => view.graph.redo()); expect(view.focused.history!.current).toBe(optimized);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(optimized.text);
  } finally { await view.close(); }
});

test("a constrained optimization holds frozen atoms and a distance target, reports residuals, and respects the step limit", async () => {
  const { runChemistryTask } = await import("../apps/desktop/src/lib/molecular-workbench/compute-client");
  const view = await fixture("sdf", useGraphDraft);
  try {
    expect(await view.apply({ kind: "add-hydrogens" })).not.toBeNull();
    const hydrogenated = view.graph.history!.current;
    await act(async () => view.focused.apply({ kind: "positions", from: hydrogenated,
      coordinates: hydrogenated.structure.atoms.map((atom, index) => [atom.x, atom.y, atom.z + index * index * 0.015]) }));
    const spatial = view.graph.history!.current, atoms = spatial.structure.atoms;
    const length = (list: typeof atoms, a: number, b: number) => Math.hypot(list[a].x - list[b].x, list[a].y - list[b].y, list[a].z - list[b].z);
    const target = length(atoms, 1, 2) + 0.15;
    const constraints = [{ kind: "freeze" as const, atoms: [0] }, { kind: "distance" as const, atoms: [1, 2], target }];
    expect(await view.apply({ kind: "optimize", forceField: "UFF", method: "lbfgs", maxIterations: 500, constraints })).not.toBeNull();
    const optimized = view.graph.history!.current, outcome = optimized.outcome!;
    expect(view.graph.error).toBeNull();
    expect(optimized.structure.atoms[0]).toMatchObject({ x: atoms[0].x, y: atoms[0].y, z: atoms[0].z });
    expect(outcome.residuals).toHaveLength(1);
    expect(outcome.residuals![0]).toMatchObject({ kind: "distance", atoms: [1, 2], target, unit: "angstrom" });
    expect(Math.abs(length(optimized.structure.atoms, 1, 2) - target)).toBeLessThan(0.01);
    expect(outcome.residuals![0].value).toBeCloseTo(length(optimized.structure.atoms, 1, 2), 6);
    expect(outcome.frames!.length).toBeGreaterThan(2);
    await act(async () => view.graph.undo()); expect(view.graph.history!.current).toBe(spatial);

    // The worker reports steps while it runs and stops at the requested limit.
    const progress: { iteration: number; energy: number }[] = [];
    const limited = await runChemistryTask({ action: "optimize", molecule: spatial.structure, options: { forceField: "UFF", method: "fire", maxIterations: 5 } }, { onProgress: step => progress.push(step) });
    expect(limited.iterations).toBeLessThanOrEqual(5);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((step, index) => step.iteration >= 1 && step.iteration <= 5 && Number.isFinite(step.energy) && (index === 0 || step.iteration > progress[index - 1].iteration))).toBe(true);
  } finally { await view.close(); }
});
