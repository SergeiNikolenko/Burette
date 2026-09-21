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

console.log("DataWarrior parser tests passed");
