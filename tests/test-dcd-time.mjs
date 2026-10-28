import { readMolstarModule } from '../scripts/molstar-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { Cell } from '@molstar/core/math/geometry/spacegroup/cell';
import { degToRad } from '@molstar/core/math/misc';
import { EPSILON, equalEps } from '@molstar/core/math/linear-algebra/3d/common';
import { parseDcd } from '@molstar/io/reader/dcd/parser';
import { patchMolstarDcdTime } from '../scripts/molstar-dcd-time.mjs';

const source = await readMolstarModule('@molstar/model/formats/structure/dcd');
const patched = patchMolstarDcdTime(source).replace(/^import .*;$/gm, '')
  .replace('export function coordinatesFromDcd', 'function coordinatesFromDcd');
const context = vm.createContext({ Cell, Vec3, degToRad, EPSILON, equalEps, halfPI: Math.PI / 2,
  Task: { create: (_name, run) => run({ update: async () => {} }) },
  Time: (value, unit) => ({ value, unit }),
  Coordinates: { create: (frames, deltaTime, offsetTime) => ({ frames, deltaTime, offsetTime }) },
});
vm.runInContext(`${patched}\nglobalThis.convert = coordinatesFromDcd;`, context);
const frames = Array.from({ length: 3 }, () => ({ elementCount: 1, x: [0], y: [0], z: [0] }));
const result = await context.convert({ header: { DELTA: 10, NSAVC: 5, ISTART: 25 }, frames });
assert.ok(Math.abs(result.deltaTime.value - 2.4444105) < 1e-9);
assert.ok(Math.abs(result.offsetTime.value - 12.2220525) < 1e-9);
assert.equal(result.frames[2].time.unit, 'ps');
assert.ok(Math.abs(result.frames[2].time.value - 17.1108735) < 1e-9);
assert.throws(() => patchMolstarDcdTime(patchMolstarDcdTime(source)), /reader changed/);
if (process.argv[2]) {
  const parsed = await parseDcd(new Uint8Array(readFileSync(process.argv[2]))).run();
  assert.equal(parsed.isError, false);
  const coordinates = await context.convert(parsed.result);
  assert.ok(coordinates.frames.every(frame => frame.cell === undefined), "empty boxes must not create singular cells");
  assert.deepEqual(Array.from(coordinates.frames, frame => Number(frame.time.value.toFixed(5))), [10, 12.5, 15]);
}
console.log('DCD reader standard AKMA, NSAVC and initial time passed');
