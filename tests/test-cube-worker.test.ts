import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { serializeCube } from '../apps/desktop/src/lib/workbench/cube-task';
import { runReaderTask } from '../apps/desktop/src/lib/workbench/reader-task';
import { parseMolden } from '../apps/desktop/src/lib/molecular-workbench/gaussian';
import { computeQuantumGrid } from '../apps/desktop/src/lib/molecular-workbench/quantum-client';
import type { ScalarGrid } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
const source = () => parseMolden(readFileSync(new URL('fixtures/quantum/dispatcher/hydrogen.molden', import.meta.url), 'utf8'));
test('actual orbital, density and signed-spin workers serialize and reopen through the real scientific reader', async () => {
 const science = source(); science.orbitals[0].occupancy = 0.25; science.orbitals[1].occupancy = 0.75;
 for (const field of [{ kind: 'orbital', orbitalIndex: 1 }, { kind: 'density' }, { kind: 'spin-density' }] as const) {
  const grid = await computeQuantumGrid(science, field, { spacingAngstrom: 0.5, paddingAngstrom: 1 });
  const text = await serializeCube(grid, science.atoms);
  const reopened = await runReaderTask({ action: 'parse', name: 'field.cube', text });
  expect(reopened.grid!.dimensions).toEqual(grid.dimensions);
  expect(Array.from(reopened.grid!.values)).toEqual(Array.from(grid.values));
  expect(reopened.grid!.origin.every((value, i) => Math.abs(value-grid.origin[i]) < 1e-7)).toBe(true);
  expect(reopened.grid!.axes.every((axis, i) => axis.every((value, j) => Math.abs(value-grid.axes[i][j]) < 1e-7))).toBe(true);
  expect(reopened.atoms).toEqual(science.atoms);
 }
});
test('source grid with oblique axes preserves physical coordinates and signed values', async () => {
 const grid: ScalarGrid = { dimensions: [2,2,2], origin: [1,2,3], axes: [[0.5,0.1,0],[-0.2,0.6,0.1],[0.1,0,0.7]], values: new Float32Array([-1,0,1,2,-2,0,2,3]) };
 const text = await serializeCube(grid, source().atoms);
 const result = await runReaderTask({ action: 'parse', name: 'oblique.cube', text });
 expect(Array.from(result.grid!.values)).toEqual(Array.from(grid.values));
 for (const [i,j,k] of [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,1]]) {
  const point = (g: ScalarGrid) => g.origin.map((origin, axis) => origin+i*g.axes[0][axis]+j*g.axes[1][axis]+k*g.axes[2][axis]);
  expect(point(result.grid!).every((value, axis) => Math.abs(value-point(grid)[axis]) < 1e-7)).toBe(true);
 }
});
test('maximum supported grid and atom payload still reopens within the 16 MiB scientific reader bound', async () => {
 const maximum = new Float32Array(new Uint32Array([0x7f7fffff]).buffer)[0];
 const grid: ScalarGrid = { dimensions: [100,100,100], origin: [0,0,0], axes: [[1,0,0],[0,1,0],[0,0,1]], values: new Float32Array(1000000).fill(-maximum) };
 const atoms = Array.from({length:10000}, () => ({ element:'H',x:0,y:0,z:0 }));
 const text = await serializeCube(grid, atoms);
 expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(16*1024*1024);
 const result = await runReaderTask({action:'parse',name:'maximum.cube',text});
 expect([result.atoms.length,result.grid!.values.length,result.grid!.values.every(value=>value===-maximum)]).toEqual([10000,1000000,true]);
}, 10000);
test('cancel and malformed grid never yield export text', async () => {
 const science = source(), grid: ScalarGrid = { dimensions:[1,1,1],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],values:new Float32Array([1]) };
 const abort = new AbortController(); const pending = serializeCube(grid,science.atoms,{signal:abort.signal});abort.abort();
 await expect(pending).rejects.toMatchObject({name:'AbortError'});
 await expect(serializeCube(grid,science.atoms,{signal:abort.signal})).rejects.toMatchObject({name:'AbortError'});
 await expect(serializeCube({...grid,dimensions:[2,2,2]},science.atoms)).rejects.toThrow('dimensions');
 await expect(serializeCube({...grid,values:new Float32Array(1000001)},science.atoms)).rejects.toThrow('limits');
});
