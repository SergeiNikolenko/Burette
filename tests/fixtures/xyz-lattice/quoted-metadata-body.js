(async () => {
 const runtime = globalThis.molstar;
 const { PluginContext, DefaultPluginSpec } = runtime.lib.plugin;
 const base = DefaultPluginSpec();
 const plugin = new PluginContext({ ...base, behaviors: [...base.behaviors, ...Object.values(runtime.ExtensionMap)] });
 await plugin.init();
 try {
  const cases = [...quoteCases,
   { ...quoteCases[0], name: 'unterminated-known-pbc', hasCell: false,
     comment: 'Lattice="0 2 0 -3 1 0 0 0 5" pbc="F F F' },
   { ...quoteCases[0], name: 'unterminated-second-lattice', hasCell: false,
     comment: 'Lattice="0 2 0 -3 1 0 0 0 5" Lattice="2 0 0 0 3 0 0 0 5' },
   { ...quoteCases[0], name: 'unterminated-unknown-note-keeps-cell', hasCell: true,
     comment: 'Lattice="0 2 0 -3 1 0 0 0 5" Note=\'retain pbc="F F F" as text' },
  ];
  for (const example of cases) {
   const text = `1\n${example.comment}\nHe 0.25 -0.5 2\n`;
   const raw = await plugin.builders.data.rawData({ data: text, label: example.name });
   const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
   const { model } = await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
   const check = (data) => {
    const cell = data._dynamicPropertyData.model_symmetry?.spacegroup.cell;
    assert.equal(Boolean(cell), example.hasCell, `${example.name}: quoted metadata must not change cell admission`);
    assert.equal(data.atomicConformation.x[0], example.positions[0][0]);
    assert.equal(data.atomicConformation.y[0], example.positions[0][1]);
    assert.equal(data.atomicConformation.z[0], example.positions[0][2]);
    if (cell) {
     example.fromFractional.forEach((value, index) => assert.ok(Math.abs(cell.fromFractional[index] - value) <= 1e-12, `${example.name}: matrix ${index}`));
     assert.equal(cell.volume, example.physicalVolume);
    } else {
     assert.equal(Object.hasOwn(data._dynamicPropertyData, 'model_symmetry'), false);
     assert.equal(data.customProperties.all.some(d => d.name === 'model_symmetry'), false);
    }
   };
   check(model.data);
   assert.equal(raw.data, text);
   if (!example.hasCell) assert.equal(runtime.BuretteTopologyScene.capture(plugin, runtime.BuretteGeometry.binding(plugin).lease).atomCount, 1);
   const snapshot = JSON.parse(JSON.stringify(plugin.state.data.getSnapshot()));
   await plugin.runTask(plugin.state.data.setSnapshot(snapshot));
   check(plugin.state.data.cells.get(model.ref).obj.data);
   assert.equal(plugin.state.data.cells.get(raw.ref).obj.data, text);
   await plugin.clear();
  }
  return { cases: cases.length, parsedNativeModels: true, snapshotReopens: cases.length, rawTextAndAtomsExact: true };
 } finally { plugin.dispose(); }
})()
