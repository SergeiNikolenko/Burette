#!/usr/bin/env bun
// focusLigand and focusSelection against real Mol* schema resolution on
// 1htb.pdb. Atom records report the operator name as instance_id while the
// Mol* schema compares instance_id with operator.instanceId, so a ligand
// selector used to resolve to no atoms: the command answered ok, the camera
// never moved and the previous selection stayed current.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { applyStructureInteractivity } from 'molstar/lib/extensions/plugin/interactivity.js';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';

const dom = new Window(); globalThis.document = dom.document;
const plugin = new PluginContext(DefaultPluginSpec());
let agent;
try {
  await plugin.init();
  const pdb = await readFile(new URL('../samples/structures/proteins/1htb.pdb', import.meta.url), 'utf8');
  const data = await plugin.builders.data.rawData({ data: pdb });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');
  // Headless Mol* has no canvas; record what the camera would be asked to frame.
  const focused = [];
  plugin.managers.camera.focusLoci = (loci, options) => focused.push({ atoms: StructureElement.Loci.size(loci), options });
  let schemaOverride = null;
  const viewer = {
    plugin,
    structureInteractivity: options => applyStructureInteractivity(plugin, schemaOverride && options.elements
      ? { ...options, elements: { ...options.elements, ...schemaOverride } } : options),
  };
  const context = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, performance, window: {} };
  vm.createContext(context);
  vm.runInContext(await readFile(new URL('../PreviewExtension/Web/burette-agent.js', import.meta.url), 'utf8'), context);
  agent = context.window.BuretteAgent;
  agent.attach({ viewer, plugin, config: { documentId: 'focus-1htb' } });
  agent.notifyStructureLoaded();
  const selectedAtoms = () => plugin.managers.structure.selection.stats.elementCount;

  const pyz = await agent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'PYZ', auth_asym_id: 'A' } } });
  assert.equal(pyz.ok, true, JSON.stringify(pyz.error));
  assert.equal(selectedAtoms(), 6);

  focused.length = 0;
  const nad = await agent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'NAD', auth_asym_id: 'A', auth_seq_id: 377 } } });
  assert.equal(nad.ok, true, JSON.stringify(nad.error));
  assert.equal(nad.result.counts.atoms, 44);
  // The focused ligand replaces the previous PYZ selection and is framed.
  assert.equal(selectedAtoms(), 44);
  assert.deepEqual(focused.map(call => [call.atoms, call.options.extraRadius]), [[44, 4]]);

  focused.length = 0;
  const again = await agent.run({ command: 'focusSelection', args: { selector: 'last' } });
  assert.equal(again.ok, true, JSON.stringify(again.error));
  assert.deepEqual(focused.map(call => call.atoms), [44]);

  // If Mol* resolves nothing, report it instead of ok with an unchanged view.
  schemaOverride = { operator_name: 'no-such-operator' };
  focused.length = 0;
  const unresolved = await agent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'PYZ', auth_asym_id: 'B' } } });
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.error.code, 'MOLSTAR_ERROR');
  assert.deepEqual(focused, []);
  console.log('Mol* ligand focus contracts passed');
} finally { agent?.detach(); plugin.dispose(); dom.happyDOM.abort(); }
