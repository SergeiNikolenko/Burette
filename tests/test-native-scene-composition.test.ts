import { expect, test } from "bun:test";
import { nativeCompositionFixture } from "./native-composition-fixture.mjs";

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
test("the built native reporter describes the actual saved peptide without text metadata or state mutation", async () => {
 const f = await nativeCompositionFixture();
 try {
  const before = JSON.stringify(f.snapshot());
  f.receive({ type: "compositionVisibilityRequest", queries: ["all"] });
  expect(f.last().rows[0].hierarchy).toBeUndefined();
  f.receive({ type: "compositionVisibilityRequest", queries: ["all"], hierarchy: true, requestId: "native-fixture" });
  expect(plain(f.last().rows[0])).toEqual({ query: "all", present: true, counts: { atoms: 43, residues: 3, chains: 1, types: 3 },
   hierarchy: { polymer: { atoms: 43, residues: 3, chains: 1 }, chains: [{ authId: "7", atoms: 43, residues: 3 }], truncated: false }, hidden: false, color: null });
  expect(JSON.stringify(f.snapshot())).toBe(before);
  // An ordinary visibility consumer cannot disable the inspector's hierarchy subscription.
  f.receive({ type: "compositionVisibilityRequest", queries: ["all"] });
  expect(f.last().rows[0].hierarchy.chains[0].authId).toBe("7");
  const structure = f.plugin.managers.structure.hierarchy.current.structures[0];
  await f.plugin.builders.structure.tryCreateComponentStatic(structure.cell, "all", { label: "Duplicate representation" });
  f.report(); expect(f.last().rows[0].counts.atoms).toBe(43);
  const action = { query: "polymer and chain 7", kind: "polymer", componentLabel: "Chain 7" };
  const hidden = await f.edit(action, "hide"); expect(hidden.ok).toBe(true);
  f.report(); expect([f.last().rows[0].counts.atoms, f.last().rows[0].hidden]).toEqual([43, true]);
  const shown = await f.edit(action, "show"); expect(shown.ok).toBe(true);
  const saved = f.snapshot(); expect((await f.edit(action, "remove")).ok).toBe(true);
  f.report(); expect(f.last().rows[0].counts.atoms).toBe(0); expect(f.last().rows[0].hierarchy.chains).toHaveLength(0);
  await f.restore(saved); f.report(); expect(f.last().rows[0].hierarchy.chains[0].residues).toBe(3);
  for (let i=0;i<16;i++) f.receive({ type: "compositionVisibilityRequest", queries: ["all"], hierarchy: true, requestId: `consumer-${i}` });
  expect(f.last().hierarchyRequestIds).toHaveLength(16); expect(f.last().hierarchyRequestIds).not.toContain("consumer-15");
  f.receive({ type: "compositionVisibilityRequest", releaseId: "native-fixture" });
  f.receive({ type: "compositionVisibilityRequest", queries: ["all"], hierarchy: true, requestId: "consumer-15" });
  expect(f.last().hierarchyRequestIds).toHaveLength(16); expect(f.last().hierarchyRequestIds).toContain("consumer-15");

 } finally { await f.close(); }
});

test("native hierarchy stays bounded and its whole-scene subscription survives the existing query budget", async () => {
 const f = await nativeCompositionFixture();
 try {
  await f.plugin.clear();
  const fields = "group_PDB id type_symbol label_atom_id label_alt_id label_comp_id label_asym_id label_entity_id label_seq_id Cartn_x Cartn_y Cartn_z occupancy B_iso_or_equiv auth_seq_id auth_comp_id auth_asym_id auth_atom_id pdbx_PDB_model_num".split(" ");
  const text = "data_authored_bounds\nloop_\n" + fields.map(field => `_atom_site.${field}`).join("\n") + "\n"
   + Array.from({ length: 130 }, (_, i) => `ATOM ${i + 1} C CA . ALA C${i} 1 1 ${i * 3} 0 0 1 0 1 ALA C${i} CA 1`).join("\n") + "\n#\n";
  const raw = await f.plugin.builders.data.rawData({ data: text }), trajectory = await f.plugin.builders.structure.parseTrajectory(raw, "mmcif");
  await f.plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
  await f.plugin.builders.structure.tryCreateComponentStatic(f.plugin.managers.structure.hierarchy.current.structures[0].cell, "all");
  f.receive({ type: "compositionVisibilityRequest", queries: ["all"], hierarchy: true, requestId: "native-fixture" });
  let whole = f.last().rows.find((row: { query: string }) => row.query === "all");
  expect(plain(whole.counts)).toEqual({ atoms: 130, residues: 130, chains: 130, types: 1 });
  expect(whole.hierarchy.chains).toHaveLength(126); expect(whole.hierarchy.truncated).toBe(true);
  f.receive({ type: "compositionVisibilityRequest", queries: Array.from({ length: 128 }, (_, i) => `chain C${i}`) });
  expect(f.last().rows).toHaveLength(128); whole = f.last().rows.find((row: { query: string }) => row.query === "all");
  expect(whole.hierarchy.chains).toHaveLength(126);
  expect((await f.edit({ query: "polymer and chain C0", kind: "polymer", componentLabel: "Chain C0" }, "remove")).ok).toBe(true);
  f.report(); whole = f.last().rows.find((row: { query: string }) => row.query === "all");
  expect(whole.counts.atoms).toBe(129); expect(whole.hierarchy.chains.some((chain: { authId: string }) => chain.authId === "C0")).toBe(false);
 } finally { await f.close(); }
});
