#!/usr/bin/env node
import assert from "node:assert/strict";
import { summarizeStructureFile } from "../plugins/burette-agent/mcp/lib/structure-summary.mjs";

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

console.log("burette-agent structure summary tests passed");
