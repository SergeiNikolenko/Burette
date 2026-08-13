// Golden-value tests for the structure-derived column compute module. Runs the
// exact code the app ships (apps/desktop/src/lib/derived-column-compute.mjs)
// against the real vendored engines: openchemlib and the RDKit WASM build.
import assert from "node:assert/strict";

import {
  computeDerivedValue,
  DERIVED_COLUMN_KINDS,
} from "../apps/desktop/src/lib/derived-column-compute.mjs";

const ASPIRIN_SMILES = "CC(=O)Oc1ccccc1C(=O)O";
const ASPIRIN_INCHI = "InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)";
const ASPIRIN_INCHIKEY = "BSYNRYMUTXBXSQ-UHFFFAOYSA-N";

async function loadEngines() {
  const [ocl, rdkitLoader] = await Promise.all([
    import("openchemlib"),
    import("@rdkit/rdkit"),
  ]);
  const rdkit = await rdkitLoader.default();
  const oclNamespace = ocl.default ?? ocl;
  oclNamespace.Resources.registerFromNodejs();
  return { ocl: oclNamespace, rdkit };
}

const engines = await loadEngines();
const aspirin = { smiles: ASPIRIN_SMILES, molblock: null };

// Kind registry sanity: every kind carries a column id valid for the
// descriptor id namespace (alnum/underscore/dash, <= 80 chars).
for (const [kind, info] of Object.entries(DERIVED_COLUMN_KINDS)) {
  assert.match(info.columnId, /^[A-Za-z0-9_-]{1,80}$/u, `column id for ${kind}`);
  assert.ok(info.label.length > 0 && info.label.length <= 120, `label for ${kind}`);
  assert.ok(info.engine === "ocl" || info.engine === "rdkit", `engine for ${kind}`);
}

// Golden values on aspirin.
assert.deepEqual(computeDerivedValue("formula", engines, aspirin), { valueText: "C9H8O4" });
assert.deepEqual(computeDerivedValue("inchi", engines, aspirin), { valueText: ASPIRIN_INCHI });
assert.deepEqual(computeDerivedValue("inchikey", engines, aspirin), { valueText: ASPIRIN_INCHIKEY });
assert.deepEqual(computeDerivedValue("canonical-smiles", engines, aspirin), { valueText: "CC(=O)Oc1ccccc1C(=O)O" });

// The OCL idcode is a stable canonical encoding; pin it so silent canonizer
// changes surface here instead of as shifting dedupe keys.
const idcode = computeDerivedValue("idcode", engines, aspirin);
assert.ok(idcode.valueText && !idcode.errorText, "idcode computed");
const idcodeAgain = computeDerivedValue("idcode", engines, {
  smiles: "OC(=O)c1ccccc1OC(C)=O",
  molblock: null,
});
assert.equal(idcodeAgain.valueText, idcode.valueText, "idcode is canonical across input orderings");

// Canonical SMILES canonicalizes equivalent inputs to one string.
const canonicalFromReordered = computeDerivedValue("canonical-smiles", engines, {
  smiles: "OC(=O)c1ccccc1OC(C)=O",
  molblock: null,
});
assert.deepEqual(canonicalFromReordered, { valueText: "CC(=O)Oc1ccccc1C(=O)O" });

// A molblock input takes precedence over smiles and computes the same values.
const rmol = engines.rdkit.get_mol(ASPIRIN_SMILES);
const molblock = rmol.get_molblock();
rmol.delete();
assert.deepEqual(
  computeDerivedValue("formula", engines, { smiles: "invalid-should-be-ignored", molblock }),
  { valueText: "C9H8O4" },
);
assert.deepEqual(
  computeDerivedValue("inchikey", engines, { smiles: null, molblock }),
  { valueText: ASPIRIN_INCHIKEY },
);

// Salted structure: values cover the full molecule (largest-fragment handling
// arrives with Calculate Properties, not here). OCL appends the counterion
// element after the Hill-ordered organic part.
assert.deepEqual(
  computeDerivedValue("formula", engines, { smiles: "CC(=O)Oc1ccccc1C(=O)O.[Na+]", molblock: null }),
  { valueText: "C9H8O4Na" },
);

// Failure contract: bad structures return errorText, never throw.
for (const kind of Object.keys(DERIVED_COLUMN_KINDS)) {
  const bad = computeDerivedValue(kind, engines, { smiles: "not-a-smiles((", molblock: null });
  assert.ok(bad.errorText, `${kind} reports a parse error`);
  assert.equal(bad.valueText, undefined, `${kind} has no value on error`);
  const empty = computeDerivedValue(kind, engines, { smiles: "", molblock: "" });
  assert.ok(empty.errorText, `${kind} reports empty structure`);
}

// Unknown kind is an error result, not an exception.
assert.ok(computeDerivedValue("no-such-kind", engines, aspirin).errorText);

console.log("derived-column-compute golden tests passed");

// --- Calculate Properties: golden values on the same engines ---
const { computeRowProperties, PROPERTY_GROUPS, PROPERTY_COLUMNS } = await import("../apps/desktop/src/lib/derived-column-compute.mjs");
const allPropertyIds = Object.keys(PROPERTY_COLUMNS);
assert.ok(PROPERTY_GROUPS.length === 3 && allPropertyIds.length >= 20, "property registry populated");

const aspirinProps = computeRowProperties(engines, aspirin, allPropertyIds, {});
const near = (id, expected, tolerance = 0.01) => {
  const value = aspirinProps[id]?.valueReal;
  assert.ok(typeof value === "number" && Math.abs(value - expected) <= tolerance, `${id}: ${value} ≈ ${expected}`);
};
near("cLogP", 1.1314, 0.01);
near("cLogS", -1.929, 0.01);
near("TPSA", 63.6, 0.1);
near("HAcceptors", 4, 0);
near("HDonors", 1, 0);
near("RotatableBonds", 3, 0);
near("MolWeight", 180.159, 0.01);
near("ExactMass", 180.042, 0.001);
near("HeavyAtoms", 13, 0);
near("Rings", 1, 0);
near("AromaticRings", 1, 0);
assert.ok(typeof aspirinProps.Druglikeness?.valueReal === "number", "druglikeness numeric");
assert.ok(typeof aspirinProps.DrugScore?.valueReal === "number" && aspirinProps.DrugScore.valueReal > 0 && aspirinProps.DrugScore.valueReal <= 1, "drug score in (0,1]");
for (const risk of ["Mutagenic", "Tumorigenic", "Irritant", "ReproEffective"]) {
  assert.ok(["none", "low", "high", "unknown"].includes(aspirinProps[risk]?.valueText), `${risk} label`);
}

// Largest-fragment: the sodium salt scores like the parent acid.
const salt = { smiles: "CC(=O)Oc1ccccc1C(=O)O.[Na+]", molblock: null };
const saltStripped = computeRowProperties(engines, salt, ["cLogP", "MolWeight"], { largestFragment: true });
assert.ok(Math.abs(saltStripped.cLogP.valueReal - aspirinProps.cLogP.valueReal) < 1e-6, "stripped salt cLogP equals parent");
assert.ok(Math.abs(saltStripped.MolWeight.valueReal - aspirinProps.MolWeight.valueReal) < 0.01, "stripped salt MW equals parent");
const saltWhole = computeRowProperties(engines, salt, ["MolWeight"], {});
assert.ok(saltWhole.MolWeight.valueReal > aspirinProps.MolWeight.valueReal + 20, "unstripped salt keeps the counterion mass");

// Bad structures error per property, never throw.
const badProps = computeRowProperties(engines, { smiles: "((broken", molblock: null }, ["cLogP", "Rings"], {});
assert.ok(badProps.cLogP.errorText && badProps.Rings.errorText, "errors per property");


// Transform ▸ Keep Largest Fragment: the salt goes, the parent compound stays.
{
  const salt = { smiles: "CC(=O)Oc1ccccc1C(=O)[O-].[Na+]", molblock: null };
  const stripped = computeDerivedValue("largest-fragment", engines, salt);
  // Dropping the counter-ion also drops the charge it balanced, so a sodium
  // salt comes back as the free acid rather than as a naked carboxylate.
  assert.equal(
    stripped.valueText,
    engines.ocl.Molecule.fromSmiles("CC(=O)Oc1ccccc1C(=O)O").toSmiles(),
    "the sodium counter-ion is dropped and the parent acid stays",
  );
  // A molecule that is already one fragment comes back unchanged.
  const single = computeDerivedValue("largest-fragment", engines, { smiles: "c1ccccc1O", molblock: null });
  assert.equal(single.valueText, engines.ocl.Molecule.fromSmiles("c1ccccc1O").toSmiles());
}

console.log("calculate-properties golden tests passed");
