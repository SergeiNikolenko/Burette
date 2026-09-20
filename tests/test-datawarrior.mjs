#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import OCL from "openchemlib";
import { parseDataWarrior } from "../apps/desktop/src/lib/datawarrior.ts";

const text = await readFile(new URL("../samples/collections/datawarrior/mini.dwar", import.meta.url), "utf8");
const records = parseDataWarrior(text);

assert.equal(records.length, 2);
assert.deepEqual(records.map((record) => record.name), ["Ethanol", "Water"]);
assert.equal(records[0].idcode, "eMHAIh@");
assert.equal(records[0].idcoordinates, "!B_vq?Dp");
assert.equal(records[0].props.Activity, "1.25");
assert.equal(records[0].props.coords, undefined);

const molecule = OCL.Molecule.fromIDCode(records[0].idcode, records[0].idcoordinates);
assert.equal(molecule.toIsomericSmiles(), "CCO");
assert.match(molecule.toMolfile(), /V2000/u);

const generatedFingerprintText = `<datawarrior-fileinfo>\n<version="3.3">\n</datawarrior-fileinfo>\n<column properties>\n<columnName="SmilesFragFp">\n<columnProperty="specialType\tFragFp">\n<columnName="Structure of smiles">\n<columnProperty="specialType\tidcode">\n</column properties>\nSmilesFragFp\tStructure of smiles\tsmiles\tname\nabc\teMHAIh@\tCCO\tEthanol\n`;
const generatedRecords = parseDataWarrior(generatedFingerprintText);
assert.equal(generatedRecords.length, 1);
assert.equal(generatedRecords[0].name, "Ethanol");
assert.equal(generatedRecords[0].idcode, "eMHAIh@");
assert.equal(generatedRecords[0].props.smiles, "CCO");

console.log("DataWarrior parser tests passed");
