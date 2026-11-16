(async () => {
 const runtime = globalThis.molstar;
 const { PluginContext, DefaultPluginSpec, StateTransforms } = runtime.lib.plugin;
 const plugins = [];
 const make = async () => {
  const base = DefaultPluginSpec();
  const p = new PluginContext({ ...base, behaviors: [...base.behaviors, ...Object.values(runtime.ExtensionMap)] });
  plugins.push(p); await p.init(); return p;
 };
 const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= 1e-12, `matrix element ${i}: ${value} != ${expected[i]}`));
 };
 const check = (p, modelRef, cellRef, index) => {
  const model = p.state.data.cells.get(modelRef).obj.data, expected = oracle.frames[index];
  assert.equal(model.modelNum, expected.modelNumber);
  const c = model.atomicConformation;
  for (let i = 0; i < expected.positions.length; i++) {
   assert.equal(c.x[i], expected.positions[i][0]); assert.equal(c.y[i], expected.positions[i][1]); assert.equal(c.z[i], expected.positions[i][2]);
  }
  // Mol* 6 keeps ModelSymmetry per frame in dynamic property data.
  const symmetry = model._dynamicPropertyData.model_symmetry;
  if (!expected.basis) {
   assert.equal(Object.hasOwn(model._dynamicPropertyData, 'model_symmetry'), false);
   assert.equal(model.customProperties.all.some(d => d.name === 'model_symmetry'), false);
   assert.equal(p.state.data.cells.get(cellRef).obj.type.name, 'Null');
   return;
  }
  assert.ok(symmetry, `frame ${index} requires its own native cell`);
  near(Array.from(symmetry.spacegroup.cell.fromFractional), expected.fromFractional);
  near(Array.from(symmetry.spacegroup.cell.toFractional), expected.toFractional);
  assert.equal(symmetry.spacegroup.cell.volume, expected.volume);
  const repr = p.state.data.cells.get(cellRef).obj.data.repr;
  assert.ok(repr.renderObjects.length > 0, 'actual native unitcell render geometry');
  const shape = repr.getAllLoci()[0].shape;
  const vertices = shape.geometry.vertexBuffer.ref.value;
  assert.ok(shape.geometry.vertexCount > 0);
  // Native cage cylinders meet each independently declared source-frame corner.
  const radius = Math.cbrt(expected.volume) / 300 * 2;
  for (const corner of expected.corners) {
   let closest = Infinity;
   for (let i = 0; i < shape.geometry.vertexCount * 3; i += 3) closest = Math.min(closest, Math.hypot(vertices[i] - corner[0], vertices[i+1] - corner[1], vertices[i+2] - corner[2]));
   assert.ok(closest <= radius * 1.01, `native cage misses source corner ${corner}: ${closest}`);
  }
 };
 try {
  if (lane === 'root-shadow') assert.ok(runtime.BurettePlyExport);
  const p = await make();
  const raw = await p.builders.data.rawData({ data: sourceText, label: 'Independent frame lattice' });
  const trajectory = await p.builders.structure.parseTrajectory(raw, 'xyz');
  assert.equal(trajectory.data.frameCount, 3);
  const model = await p.builders.structure.createModel(trajectory, { modelIndex: 0 });
  const cell = await p.build().to(model).apply(StateTransforms.Representation.ModelUnitcell3D, { ref: 'origin', attachment: 'corner', cellScale: 2 }).commit();
  const cellEvents = [];
  p.state.data.events.object.updated.subscribe(e => { if (e.ref === cell.ref) cellEvents.push(e); });
  for (const index of [0, 1, 2, 0]) {
   const shownCell = p.state.data.cells.get(cell.ref).obj;
   cellEvents.length = 0;
   await p.build().to(model).update({ modelIndex: index }).commit();
   check(p, model.ref, cell.ref, index);
   // The canvas only drops geometry the event names; a cell-less frame must release the shown cage.
   if (!oracle.frames[index].basis) assert.ok(cellEvents.some(e => e.oldObj === shownCell && e.oldObj.data.repr), 'cell-less frame releases the previous cage');
   assert.equal(raw.cell.obj.data, sourceText);
   const snapshot = JSON.parse(JSON.stringify(p.state.data.getSnapshot()));
   const restored = await make();
   await restored.runTask(restored.state.data.setSnapshot(snapshot));
   check(restored, model.ref, cell.ref, index);
   assert.equal(restored.state.data.cells.get(raw.ref).obj.data, sourceText);
   const archive = await p.managers.snapshot.serialize({ type: 'molx', params: { camera: false, image: false, animation: false, behavior: false } });
   const reopened = await make();
   await reopened.managers.snapshot.open(new File([archive], `frame-${index}.molx`));
   check(reopened, model.ref, cell.ref, index);
   assert.equal(reopened.state.data.cells.get(raw.ref).obj.data, sourceText);
  }
  for (const pbc of ['', ' pbc="true 1 T"']) {
   const admitted = await make();
   const data = await admitted.builders.data.rawData({ data: `1\nLattice="0 2 0 -3 1 0 0 0 5"${pbc}\nC 0.25 -0.5 2\n` });
   const tr = await admitted.builders.structure.parseTrajectory(data, 'xyz');
   const nativeCell = tr.data.getFrameAtIndex(0)._dynamicPropertyData.model_symmetry.spacegroup.cell;
   near(Array.from(nativeCell.fromFractional), oracle.frames[0].fromFractional);
   assert.equal(nativeCell.volume, 30);
  }
  const comments = ['', 'ordinary XYZ', 'Lattice="1 2"', 'Lattice="1 0 0 0 0 0 0 0 1"', 'Lattice="NaN 0 0 0 1 0 0 0 1"', 'Lattice="1 0 0 0 1 0 0 0 1" pbc="T F T"', 'Lattice="1 0 0 0 1 0 0 0 1" pbc="F F F"', 'Lattice="1 0 0 0 1 0 0 0 1" pbc="T T"', 'Lattice="1 0 0 0 1 0 0 0 1" Lattice="2 0 0 0 2 0 0 0 2"'];
  for (const comment of comments) {
   const ordinary = await make(), text = `1\n${comment}\nH 0.25 -0.5 2\n`;
   const data = await ordinary.builders.data.rawData({ data: text });
   const tr = await ordinary.builders.structure.parseTrajectory(data, 'xyz');
   await ordinary.builders.structure.hierarchy.applyPreset(tr, 'default', { representationPreset: 'empty' });
   const m = tr.data.getFrameAtIndex(0);
   assert.equal(Object.hasOwn(m._dynamicPropertyData, 'model_symmetry'), false, comment);
   assert.equal(m.customProperties.all.some(d => d.name === 'model_symmetry'), false);
   assert.deepEqual([m.atomicConformation.x[0], m.atomicConformation.y[0], m.atomicConformation.z[0]], [0.25,-0.5,2]);
   assert.equal(data.data, text);
   const captured = runtime.BuretteTopologyScene.capture(ordinary, runtime.BuretteGeometry.binding(ordinary).lease);
   assert.equal(captured.atomCount, 1);
  }
  return { frameSeeks: [0,1,2,0], snapshots: 4, molxReopens: 4, optionalPbcCases: 2, ordinaryAdmissionCases: comments.length, fullMatrices: true, nativeCageCorners: true, rawSourceExact: true, plyExportPresent: Boolean(runtime.BurettePlyExport) };
 } finally { for (const p of plugins) p.dispose(); }
})()
