import { expect, test } from "bun:test";
import { act } from "react";
import { readFileSync } from "node:fs";
import { fixture } from "./measurement-pair-fixture";
const { useGraphDraft } = await import("../apps/desktop/src/components/workbench/use-graph-draft");

test("the advanced adapter adds hydrogens through the real worker and shares exact source Undo/Redo with the core", async () => {
  const view = await fixture("sdf", useGraphDraft);
  try {
    const before = view.graph.history!.current;
    expect(await view.apply({ kind: "add-hydrogens" })).not.toBeNull();
    const after = view.graph.history!.current;
    expect(view.graph.error).toBeNull();
    expect(view.dockTabs.at(-1)).toBe("structure-edit");
    expect(after.structure.atoms.map(atom => atom.element)).toEqual(["C", "C", "O", "H", "H", "H", "H", "H", "H"]);
    expect(after.metadata!.atoms.slice(0, 3)).toEqual(before.metadata!.atoms);
    expect(new Set(after.metadata!.atoms.map(atom => atom.id)).size).toBe(9);
    expect(view.focused.history).toBe(view.graph.history);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(after.text);
    await act(async () => view.focused.undo());
    expect(view.graph.history!.current).toBe(before);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(before.text);
    await act(async () => view.graph.redo());
    expect(view.focused.history!.current).toBe(after);
    expect(await view.apply({ kind: "remove-hydrogens" })).not.toBeNull();
    expect(view.graph.history!.current.structure.atoms.map(atom => atom.element)).toEqual(["C", "C", "O"]);
    await act(async () => view.graph.undo()); expect(view.graph.history!.current).toBe(after);
  } finally { await view.close(); }
});

test("a rejected source write never publishes the advanced worker result", async () => {
  const view = await fixture("sdf", useGraphDraft);
  try {
    const before = view.graph.history!.current;
    view.setWriteMode("noop");
    expect(await view.apply({ kind: "add-hydrogens" })).toBeNull();
    expect(view.graph.history!.current).toBe(before);
    expect(view.graph.history!.undo).toEqual([]);
    expect(view.graph.error).toContain("could not be updated");
  } finally { await view.close(); }
});


test("the actual collinear sample and its existing-H variant retain atom IDs and exact source Undo/Redo", async () => {
  const sample = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8");
  const partial = sample.replace("  3  2", "  4  3")
    .replace("  1  2  1", "   -1.4000    0.7000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1")
    .replace("M  END", "  1  4  1  0  0  0  0\nM  END");
  for (const text of [sample, partial]) {
    const view = await fixture("sdf", useGraphDraft, text);
    try {
      const before = view.graph.history!.current;
      expect(await view.apply({ kind: "add-hydrogens" })).not.toBeNull();
      const after = view.graph.history!.current, count = before.structure.atoms.length;
      expect(after.structure.atoms).toHaveLength(9);
      expect(after.structure.atoms.slice(0, count)).toEqual(before.structure.atoms);
      expect(after.metadata!.atoms.slice(0, count)).toEqual(before.metadata!.atoms);
      expect(new Set(after.metadata!.atoms.map(atom => atom.id)).size).toBe(9);
      await act(async () => view.graph.undo()); expect(view.graph.history!.current).toBe(before);
      expect(view.controller.sessionForDocument(view.doc)?.content).toBe(before.text);
      await act(async () => view.graph.redo()); expect(view.graph.history!.current).toBe(after);
      expect(view.controller.sessionForDocument(view.doc)?.content).toBe(after.text);
    } finally { await view.close(); }
  }
});
