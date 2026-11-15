// The viewer's Select commands against real Mol* scenes and selection managers:
// several units with bonds between them, several structures in one scene,
// two-letter elements and a residue picking level.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultRegistry } from '@molstar/plugin/default-registry';
import { StructureElement } from '@molstar/model/model/structure';
import { OrderedSet } from '@molstar/core/data/int';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const functionSource = name => source.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
const names = ['molstarCurrentStructures', 'molstarStructureFromRef', 'molstarSelectionQuery', 'applyMolstarSelectionQuery', 'molstarAtomicUnits',
  'molstarShownElements', 'selectMolstarAtomsWhere', 'forEachSelectedMolstarAtom', 'enlargeMolstarSelection', 'invertMolstarSelection', 'runMolstarSelectCommand'];
const molfile = (atoms, bonds) => [
  '', '  test', '', `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
  ...atoms.map(([element, ...position]) => `${position.map(value => value.toFixed(4).padStart(10)).join('')} ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`),
  ...bonds.map(bond => `${bond.map(value => String(value).padStart(3)).join('')}  0`), 'M  END', '',
].join('\n');
// Chloromethane and methanol, heavy atoms with one hydrogen each.
const chloromethane = molfile([['C', 0, 0, 0], ['Cl', 1.78, 0, 0], ['H', -0.36, 1.03, 0]], [[1, 2, 1], [1, 3, 1]]);
const methanol = molfile([['C', 0, 0, 5], ['O', 1.43, 0, 5], ['H', 1.75, 0.9, 5]], [[1, 2, 1], [2, 3, 1]]);

const dom = new Window({ url: 'http://localhost/' }), previous = globalThis.document;
globalThis.document = dom.document;
const plugins = [];
async function open(entries) {
  const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] });
  plugins.push(plugin);
  await plugin.init();
  for (const [data, format] of entries) {
    const raw = await plugin.builders.data.rawData({ data });
    const model = await plugin.builders.structure.createModel(await plugin.builders.structure.parseTrajectory(raw, format));
    await plugin.builders.structure.createStructure(model);
  }
  const structures = plugin.managers.structure.hierarchy.current.structures.map(ref => ref.cell.obj.data);
  const commands = new Function('activeMolstarViewer', 'window', `${names.map(functionSource).join('\n')}\n  return { runMolstarSelectCommand, molstarShownElements };`)(
    () => ({ plugin }), { molstar: { lib: { structure: { StructureElement } } } });
  const selects = plugin.managers.interactivity.lociSelects;
  // Selected atoms of one structure as "unit id:unit index".
  const selected = structure => {
    const loci = plugin.managers.structure.selection.getLoci(structure), out = [];
    if (StructureElement.Loci.is(loci)) for (const { unit, indices } of loci.elements) OrderedSet.forEach(indices, index => out.push(`${unit.id}:${index}`));
    return out.sort();
  };
  const pick = (structure, unit, ...indices) => selects.select({ loci: StructureElement.Loci(structure, [{ unit, indices: Int32Array.from(indices) }]) }, false);
  return { plugin, structures, selects, selected, pick, ...commands };
}

try {
  // Two-letter elements: Mol* keeps symbols in upper case, the menu and the action use the usual spelling.
  {
    const scene = await open([[chloromethane, 'mol']]);
    assert.deepEqual(scene.molstarShownElements(), ['C', 'H', 'Cl']);
    assert.equal(await scene.runMolstarSelectCommand('element', 'Cl'), 1);
    assert.deepEqual(scene.selected(scene.structures[0]), ['0:1']);
  }

  // Two structures in one scene: unit ids repeat between them, selections do not leak across.
  {
    const scene = await open([[chloromethane, 'mol'], [methanol, 'mol']]);
    const [first, second] = scene.structures;
    assert.equal(first.units[0].id, second.units[0].id, 'the fixture needs equal unit ids in both structures');
    scene.pick(first, first.units[0], 1);
    assert.equal(await scene.runMolstarSelectCommand('enlarge'), 2, 'chlorine and its carbon');
    assert.deepEqual([scene.selected(first), scene.selected(second)], [['0:0', '0:1'], []]);
    assert.equal(await scene.runMolstarSelectCommand('invert'), 4);
    assert.deepEqual([scene.selected(first), scene.selected(second)], [['0:2'], ['0:0', '0:1', '0:2']]);

    // Atom-level commands stay at atom level when picking takes whole residues.
    scene.plugin.managers.interactivity.setProps({ granularity: 'residue' });
    await scene.runMolstarSelectCommand('none');
    scene.pick(second, second.units[0], 1);
    assert.equal(await scene.runMolstarSelectCommand('invert'), 5);
    assert.deepEqual(scene.selected(second), ['0:0', '0:2']);
    assert.equal(await scene.runMolstarSelectCommand('none'), 0);
    assert.deepEqual([scene.selected(first), scene.selected(second)], [[], []]);
  }

  // Enlarge follows bonds between units (here a link between two chains of 1HTB).
  {
    const scene = await open([[readFileSync(new URL('../samples/structures/proteins/1htb.pdb', import.meta.url), 'utf8'), 'pdb']]);
    const [structure] = scene.structures, edge = structure.interUnitBonds.edges[0];
    assert.ok(edge && edge.unitA !== edge.unitB, 'the fixture needs a bond between two units');
    scene.pick(structure, structure.unitMap.get(edge.unitA), edge.indexA);
    await scene.runMolstarSelectCommand('enlarge');
    assert.ok(scene.selected(structure).includes(`${edge.unitB}:${edge.indexB}`), 'the atom bonded across units joins the selection');
  }

  // The 3D menu's Select none and Invert selection are the same atom-level commands:
  // Mol*'s own inverse query widens to the picking level and selection.clear() keeps the marks.
  const menu = functionSource('moleculeContextMenuAction');
  for (const [action, command] of [['select:invert', 'invert'], ['select:clear', 'none']]) {
    const branch = menu.slice(menu.indexOf(`action === '${action}'`)).split('} else if')[0];
    assert.match(branch, new RegExp(`runMolstarSelectCommand\\('${command}'\\)`), `${action} runs the ${command} command`);
  }
  console.log('Select commands stay within their structure, follow bonds between units and match two-letter elements.');
} finally {
  for (const plugin of plugins) plugin.dispose();
  await dom.happyDOM.close();
  globalThis.document = previous;
}
