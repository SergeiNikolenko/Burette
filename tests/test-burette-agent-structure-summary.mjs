#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  summarizeStructureFile,
  summarizeStructureText,
} from "../plugins/burette-agent/mcp/lib/structure-summary.mjs";

const miniPdb = await summarizeStructureFile("samples/mini.pdb");
assert.equal(miniPdb.format, "PDB");
assert.equal(miniPdb.kind, "Macromolecule");
assert.equal(miniPdb.counts.atoms, 9);
assert.equal(miniPdb.counts.residues, 2);
assert.equal(miniPdb.counts.chains, 1);
assert.equal(miniPdb.counts.polymerResidues, 2);
assert.equal(miniPdb.counts.ligandInstances, 0);
assert.equal(miniPdb.components.chains[0].id, "A");
assert.match(miniPdb.summaryLine, /PDB macromolecule/);

const miniPdbText = await readFile("samples/mini.pdb", "utf8");
const inlineMiniPdb = summarizeStructureText({
  text: miniPdbText,
  fileName: "mini.pdb",
});
assert.equal(inlineMiniPdb.summaryLine, miniPdb.summaryLine);
assert.equal(inlineMiniPdb.counts.atoms, miniPdb.counts.atoms);
assert.equal("path" in inlineMiniPdb, false);

const oneHtbPdb = await summarizeStructureFile("samples/structures/proteins/1htb.pdb");
assert.equal(oneHtbPdb.format, "PDB");
assert.equal(oneHtbPdb.kind, "Macromolecule");
assert.ok(oneHtbPdb.counts.atoms > 0);
assert.ok(oneHtbPdb.counts.chains > 0);
assert.equal(oneHtbPdb.counts.ligandInstances, 4);
assert.equal(oneHtbPdb.components.ligands[0].label, "NAD A 377");
assert.equal(oneHtbPdb.components.ligands[0].selector.kind, "ligand");
assert.equal(oneHtbPdb.components.ligands[0].selector.label_comp_id, "NAD");
assert.equal(oneHtbPdb.components.ligands[0].selector.auth_asym_id, "A");
assert.equal(oneHtbPdb.components.ligands[0].selector.auth_seq_id, 377);
assert.match(oneHtbPdb.summaryLine, /4 ligand instances/);

const miniCif = await summarizeStructureFile("samples/mini.cif");
assert.equal(miniCif.format, "CIF");
assert.ok(miniCif.counts.atomSiteRows > 0);

const fixtureDir = await mkdtemp(path.join(tmpdir(), "burrete-summary-"));

const mlipCfgPath = path.join(fixtureDir, "mlip.cfg");
await writeFile(mlipCfgPath, `BEGIN_CFG
 Size
    3
 AtomData:  id type       cartes_x      cartes_y      cartes_z           fx          fy          fz
      1    1        0.0           0.0           0.0             0.0         0.0         0.0
      2    6        1.0           0.0           0.0             0.0         0.0         0.0
      3    6        0.0           1.0           0.0             0.0         0.0         0.0
 Energy
    -1.0
END_CFG
BEGIN_CFG
END_CFG
`);
const mlipCfg = await summarizeStructureFile(mlipCfgPath);
assert.equal(mlipCfg.format, "CFG");
assert.equal(mlipCfg.kind, "MLIP configuration");
assert.equal(mlipCfg.counts.atoms, 3);
assert.equal(mlipCfg.counts.configurations, 2);
assert.match(mlipCfg.summaryLine, /MLIP configuration/);

const qeInputPath = path.join(fixtureDir, "in_md");
await writeFile(qeInputPath, `&CONTROL
 calculation = 'md'
/
ATOMIC_POSITIONS angstrom
C 0.0 0.0 0.0
H 0.0 0.0 1.1
H 1.0 0.0 0.0
`);
const qeInput = await summarizeStructureFile(qeInputPath);
assert.equal(qeInput.format, "QE");
assert.equal(qeInput.kind, "Quantum ESPRESSO input");
assert.equal(qeInput.counts.atoms, 3);
assert.equal(qeInput.extension, "in");

const lammpsDataPath = path.join(fixtureDir, "benz.data");
await writeFile(lammpsDataPath, `LAMMPS data

3 atoms
2 atom types

Masses

1 12.011
2 1.008

Atoms # full

1 1 1 0.0 0.0 0.0 0.0
2 1 2 0.0 1.0 0.0 0.0
3 1 2 0.0 0.0 1.0 0.0
`);
const lammpsData = await summarizeStructureFile(lammpsDataPath);
assert.equal(lammpsData.format, "LAMMPS");
assert.equal(lammpsData.kind, "LAMMPS data");
assert.equal(lammpsData.counts.atoms, 3);
assert.match(lammpsData.rows.find((row) => row.label === "Elements")?.value ?? "", /H 2/);

await rm(fixtureDir, { recursive: true, force: true });

console.log("burette-agent structure summary tests passed");
