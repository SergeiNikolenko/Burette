import assert from "node:assert/strict";
import { visibleEditorTargets } from "../apps/desktop/src/lib/chemical-editor-targets";
import type { ChemicalEditorTarget } from "../apps/desktop/src/components/types";

const target = (id: string, name: string, bundleId: string | null, rank: number): ChemicalEditorTarget => ({
  id, name, bundleId, rank, appPath: `/Applications/${id}.app`, supportedExtensions: ["pdb"], matchReason: "registered",
});
const input = [
  target("test", "Burette-xyzreffix", "com.local.BuretteV10.Dev.xyzreffix", 0),
  target("stable-copy", "Burette copy", "com.local.BuretteV10", 3),
  target("stable", "Burette", "com.local.BuretteV10", 1),
  target("pymol", "PyMOL", "org.pymol", 2),
  target("pymol-copy", "PyMOL.app", null, 4),
  target("other-dev", "Other Dev", "org.other.dev.sample", 5),
];
assert.deepEqual(visibleEditorTargets(input).map(item => item.id), ["stable", "pymol", "other-dev"]);
assert.equal(input[0].id, "test", "discovery order remains untouched");
assert.deepEqual(visibleEditorTargets([input[0]]), []);
console.log("Shared Open With policy: development Burette filtered, copies deduplicated, other apps preserved");
