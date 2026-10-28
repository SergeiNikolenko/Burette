import { plugin } from "bun";
import { molstarV3000ChargesPlugin } from "../scripts/molstar-v3000-charges.mjs";
import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { patchMolstarMolV3000, molstarMolV3000Plugin } from "../scripts/molstar-mol-v3000.mjs";
import { IndexPairBonds } from "molstar/lib/mol-model-formats/structure/property/bonds/index-pair.js";
const browser = new Window();
Object.assign(browser, { setImmediate, clearImmediate });
Object.assign(globalThis, { window: browser, document: browser.document });
plugin(molstarMolV3000Plugin);
plugin(molstarV3000ChargesPlugin);
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
const { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");

const source = ["Charged MOL", "Burette", "", "  0  0  0     0  0            999 V3000",
  "M  V30 BEGIN CTAB", "M  V30 COUNTS 3 2 0 0 0", "M  V30 BEGIN ATOM",
  "M  V30 20 C 0 0 0 0", "M  V30 7 N 1 0 0 0 CHG=1", "M  V30 90 O 2 0 0 0 CHG=-1",
  "M  V30 END ATOM", "M  V30 BEGIN BOND", "M  V30 1 1 20 7", "M  V30 2 2 7 90",
  "M  V30 END BOND", "M  V30 END CTAB", "M  END", ""].join("\n");

async function load(plugin: InstanceType<typeof PluginContext>, text: string) {
  const raw = await plugin.builders.data.rawData({ data: text, label: "source.mol" });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, "mol");
  return { raw, trajectory };
}

test("source-owned MOL provider retains complete V3000 raw bytes, source IDs, charges and bonds", async () => {
  for (const newline of ["\n", "\r\n", "\r"]) {
    const text = source.replace(/\n/gu, newline) + ` ${newline}\t${newline}`;
    const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
    try {
      const { raw, trajectory } = await load(plugin, text);
      expect(raw.cell!.obj!.data).toBe(text);
      expect(trajectory.cell!.transform.transformer.id.endsWith("trajectory-from-mol")).toBe(true);
      expect(trajectory.cell!.transform.parent).toBe(raw.ref);
      const model = trajectory.cell!.obj!.data.representative, hierarchy = model.atomicHierarchy;
      expect(model.sourceData.kind).toBe("mol");
      expect(Array.from(hierarchy.atomSourceIndex.toArray())).toEqual([0, 1, 2]);
      expect(Array.from(hierarchy.atoms.pdbx_formal_charge.toArray())).toEqual([0, 1, -1]);
      expect(Array.from(IndexPairBonds.Provider.get(model)!.bonds.edgeProps.order)).toEqual([1, 1, 2, 2]);
      await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
      expect(plugin.managers.structure.hierarchy.current.structures).toHaveLength(1);
    } finally { plugin.dispose(); }
  }
});

test("incomplete, concatenated or tailed V3000 fails before publishing a replacement model", async () => {
  const invalid = [source.replace("M  END", ""), source.replace("M  V30 END CTAB", ""),
    source + source, source + "foreign trailing content", source + "$$$$\n" + source + "$$$$\n",
    source.replace("M  V30 BEGIN CTAB", ""), source.replace("M  V30 END CTAB", "M  END\nM  V30 END CTAB"),
    source.replace("M  V30 BEGIN CTAB", "M  V30 BEGIN CTAB\nM  V30 BEGIN CTAB")];
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  const errors: string[] = [], subscription = plugin.events.log.subscribe(entry => { if (entry.type === "error") errors.push(entry.message); });
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  try {
    const good = await load(plugin, source);
    await plugin.builders.structure.hierarchy.applyPreset(good.trajectory, "default", { representationPreset: "empty" });
    const structure = plugin.managers.structure.hierarchy.current.structures[0];
    for (const text of invalid) for (const newline of ["\n", "\r\n", "\r"]) {
      const before = errors.length, bad = await load(plugin, text.replace(/\n/gu, newline));
      expect(bad.trajectory?.cell?.obj).toBeUndefined();
      expect(errors.slice(before).some(message => message.includes("Open one complete MOL structure"))).toBe(true);
      expect(plugin.managers.structure.hierarchy.current.structures).toEqual([structure]);
      expect(good.raw.cell!.obj!.data).toBe(source);
    }
  } finally { consoleError.mockRestore(); subscription.unsubscribe(); plugin.dispose(); }
});

test("MOL source adapter refuses unexpected or already patched upstream transforms", () => {
  const original = readFileSync(new URL("../node_modules/molstar/lib/mol-plugin-state/transforms/model.js", import.meta.url), "utf8");
  expect(() => patchMolstarMolV3000("unexpected upstream")).toThrow("review before vendoring");
  expect(() => patchMolstarMolV3000(patchMolstarMolV3000(original))).toThrow("review before vendoring");
});
