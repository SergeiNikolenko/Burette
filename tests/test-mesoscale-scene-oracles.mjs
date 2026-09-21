#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("tests/fixtures/mesoscale/basic/manifest.json", "utf8"));
const pdb = await readFile("tests/fixtures/mesoscale/basic/mini.pdb", "utf8");
const archive = await readFile("tests/fixtures/mesoscale/basic.mesozip");
const oracle = JSON.parse(await readFile("tests/fixtures/mesoscale/basic.oracle.json", "utf8"));

const groups = manifest.roots.length + manifest.roots.reduce((total, root) => total + (root.children?.length ?? 0), 0);
const atomsPerModel = pdb.split(/\r?\n/u).filter((line) => line.startsWith("ATOM") || line.startsWith("HETATM")).length;
const instances = manifest.entities.reduce((total, entity) => total + ((entity.instances?.positions?.data?.length ?? 3) / 3), 0);
assert.deepEqual({
  roots: manifest.roots.length,
  groups,
  entities: manifest.entities.length,
  instances,
  elements: atomsPerModel * instances,
  meshes: manifest.entities.filter((entity) => entity.file.endsWith(".ply")).length,
}, oracle.counts);
assert.equal(createHash("sha256").update(archive).digest("hex"), oracle.sourceSha256);

const positions = manifest.entities[0].instances.positions.data;
const firstAtom = pdb.split(/\r?\n/u).find((line) => line.startsWith("ATOM"));
const coordinate = [Number(firstAtom.slice(30, 38)), Number(firstAtom.slice(38, 46)), Number(firstAtom.slice(46, 54))];
const transformed = Array.from({ length: positions.length / 3 }, (_, index) => coordinate.map((value, axis) => value + positions[index * 3 + axis]));
for (let index = 0; index < transformed.length; index += 1) {
  for (let axis = 0; axis < 3; axis += 1) assert.ok(Math.abs(transformed[index][axis] - oracle.sampledTransformedCoordinates[index][axis]) <= 1e-3);
}

console.log("mesoscale scientific oracle passed");
