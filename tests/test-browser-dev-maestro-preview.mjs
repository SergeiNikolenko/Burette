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

console.log("browser dev Maestro preview tests passed");
