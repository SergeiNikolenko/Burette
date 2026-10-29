import { expect, test } from "bun:test";
import { act } from "react";
import { fixture } from "./measurement-pair-fixture";
const { useGraphDraft } = await import("../apps/desktop/src/components/workbench/use-graph-draft");

for (const method of [undefined, "lbfgs"] as const) test(`the full adapter keeps add-H and ${method ?? "default"} optimization in the same published source history`, async () => {
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
    expect(optimized.outcome?.method).toBe("L-BFGS");
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
