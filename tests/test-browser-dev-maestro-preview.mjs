#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  maestroPdbDataFromText,
} = await import("../apps/desktop/src/lib/browser-dev-documents.ts");

const maestroWithIncompatibleCts = `
f_m_ct {
  s_m_title
  m_atom[3] {
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_atom_name
    :::
    6 0.000000 0.000000 0.000000 "C1"
    7 1.250000 0.000000 0.000000 "N1"
    8 0.000000 1.250000 0.000000 "O1"
    :::
  }
}
f_m_ct {
  s_m_title
  m_atom[2] {
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_atom_name
    :::
    6 0.100000 0.000000 0.000000 "C1"
    1 0.900000 0.000000 0.000000 "H1"
    :::
  }
}
`;

const incompatiblePreview = maestroPdbDataFromText(maestroWithIncompatibleCts);
assert.ok(incompatiblePreview);
const incompatiblePdb = new TextDecoder().decode(incompatiblePreview.bytes);
assert.doesNotMatch(incompatiblePdb, /^MODEL/m, "different Maestro CT topologies must not be presented as Mol* trajectory models");
assert.match(incompatiblePdb, /Combined independent Maestro CT entries/);
assert.equal([...incompatiblePdb.matchAll(/^(?:ATOM|HETATM)/gm)].length, 5);
assert.match(incompatiblePdb, /^HETATM\s+4 C1\s+MOL B\s+1/m);
assert.match(incompatiblePdb, /^HETATM\s+5 H1\s+MOL B\s+1/m);
const incompatibleSceneEntries = incompatiblePreview.stagedEntries?.filter((entry) => entry.representation === "structure-scene-entry") || [];
assert.equal(incompatibleSceneEntries.length, 2, "independent Maestro CTs must be exposed as switchable scene structures");
assert.deepEqual(incompatibleSceneEntries.map((entry) => entry.label), ["Structure 1", "Structure 2"]);
for (const entry of incompatibleSceneEntries) {
  assert.equal(entry.format, "pdb");
  assert.equal(entry.binary, false);
  const entryPdb = new TextDecoder().decode(Buffer.from(entry.dataBase64, "base64"));
  assert.match(entryPdb, /^REMARK Structure /m);
  assert.match(entryPdb, /^END$/m);
}

const maestroWithCompatibleCts = `
f_m_ct {
  s_m_title
  m_atom[2] {
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_atom_name
    :::
    6 0.000000 0.000000 0.000000 "C1"
    7 1.250000 0.000000 0.000000 "N1"
    :::
  }
}
f_m_ct {
  s_m_title
  m_atom[2] {
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_atom_name
    :::
    6 0.100000 0.000000 0.000000 "C1"
    7 1.350000 0.000000 0.000000 "N1"
    :::
  }
}
`;

const compatiblePreview = maestroPdbDataFromText(maestroWithCompatibleCts);
assert.ok(compatiblePreview);
const compatiblePdb = new TextDecoder().decode(compatiblePreview.bytes);
assert.match(compatiblePdb, /^MODEL/m, "compatible Maestro CTs can still use Mol* model paging");
assert.equal([...compatiblePdb.matchAll(/^MODEL/gm)].length, 2);
assert.equal(
  compatiblePreview.stagedEntries?.some((entry) => entry.representation === "structure-scene-entry"),
  undefined,
  "compatible Maestro trajectory models must not be duplicated as scene entries",
);

console.log("browser dev Maestro preview tests passed");
