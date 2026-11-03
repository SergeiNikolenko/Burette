// A real Mol* scene (ethanol as spacefill, with a hidden ball-and-stick on top) exported
// in every 3D model format, then read back by independent readers: plyfile, trimesh,
// XML parsing and, where installed, VTK's VRML importer and POV-Ray itself.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { BuretteSceneExport } from '../scripts/molstar-scene-export.js';

const fixture = new URL('./fixtures/scene-export/ethanol.sdf', import.meta.url);
// Mol*'s plugin layout listens for fullscreen changes on the document.
const dom = new Window(); globalThis.document = dom.document;
const plugin = new PluginContext(DefaultPluginSpec());
await plugin.init();
const data = await plugin.builders.data.rawData({ data: await readFile(fixture, 'utf8') });
const trajectory = await plugin.builders.structure.parseTrajectory(data, 'sdf');
const model = await plugin.builders.structure.createModel(trajectory);
const structure = await plugin.builders.structure.createStructure(model);
const component = await plugin.builders.structure.tryCreateComponentStatic(structure, 'all');
// Element colours without Mol*'s default lightening, so the drawn colours are the Jmol table.
const colorParams = { carbonColor: { name: 'element-symbol', params: {} }, lightness: 0 };
await plugin.builders.structure.representation.addRepresentation(component, { type: 'spacefill', color: 'element-symbol', colorParams });
const hidden = await plugin.builders.structure.representation.addRepresentation(component, { type: 'ball-and-stick', color: 'uniform' });
hidden.obj.data.repr.setState({ visible: false });

const objects = [];
plugin.state.data.cells.forEach((cell) => objects.push(...(cell.obj?.data?.repr?.renderObjects ?? [])));
assert.ok(objects.some((object) => !object.state.visible), 'the hidden representation is part of the exported scene');

// The camera looks down -z at the molecule's centre, so +x is to the right in a rendered view.
const coordinates = (await readFile(fixture, 'utf8')).split('\n').slice(4, 13).map((line) => [0, 10, 20].map((start) => Number(line.slice(start, start + 10))));
const target = [0, 1, 2].map((axis) => coordinates.reduce((sum, atom) => sum + atom[axis], 0) / coordinates.length);
const view = { mode: 'perspective', position: [target[0], target[1], target[2] + 20], target, up: [0, 1, 0], fov: Math.PI / 4, aspect: 4 / 3, scale: 1, background: [1, 1, 1] };

const directory = await mkdtemp(join(tmpdir(), 'burette-scene-export-'));
for (const format of Object.keys(BuretteSceneExport.formats)) {
  const { blob } = await BuretteSceneExport.task(objects, { format, view }).run();
  await writeFile(join(directory, `scene.${BuretteSceneExport.formats[format].extension}`), new Uint8Array(await blob.arrayBuffer()));
}
for (const format of ['x3d', 'pov']) {
  const { blob } = await BuretteSceneExport.task(objects, { format, view: { ...view, mode: 'orthographic' } }).run();
  await writeFile(join(directory, `scene-orthographic.${format}`), new Uint8Array(await blob.arrayBuffer()));
}
plugin.dispose();

const reader = new URL('./fixtures/scene-export/read-exports.py', import.meta.url).pathname;
const result = spawnSync('uv', ['run', '--quiet', '--with', 'numpy', '--with', 'plyfile', '--with', 'trimesh', '--with', 'pillow', 'python', reader, directory, fixture.pathname], { encoding: 'utf8' });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'every export reads back as the visible scene');
console.log(`scene exports in ${directory}`);
