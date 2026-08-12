import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../PreviewExtension/Web/grid-viewer.js", import.meta.url), "utf8");
const start = source.indexOf("  function hasMolblockInputCoordinates(value)");
const end = source.indexOf("\n  function stripSVGClipping", start);
assert.ok(start >= 0 && end > start, "Grid coordinate helpers must remain discoverable");

const helpers = new Function(`${source.slice(start, end)}\nreturn { hasMolblockInput3DCoordinates };`)();
const planar = `planar\n  Burette          2D\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.5000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\nM  END`;
const spatial = planar
  .replace("Burette          2D", "Burette          3D")
  .replace("1.5000    0.0000    0.0000", "1.5000    0.0000    0.7500");

assert.equal(helpers.hasMolblockInput3DCoordinates("CCO"), false);
assert.equal(helpers.hasMolblockInput3DCoordinates(planar), false);
assert.equal(helpers.hasMolblockInput3DCoordinates(spatial), true);

console.log("Grid 3D coordinate detection tests passed");
