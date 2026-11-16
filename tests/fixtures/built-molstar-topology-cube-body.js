(async () => {
 const runtime = globalThis.molstar;
 assert.ok(runtime?.BuretteTopologyScene && runtime?.BuretteGeometry && runtime?.lib?.plugin?.PluginContext);
 if (lane === "root-shadow") assert.ok(runtime.BurettePlyExport, "root-owned PLY facade remains exported");
 const { PluginContext, DefaultPluginSpec, StateTransforms } = runtime.lib.plugin;
 const plugins = [];
 const xyz = "1\nOriginal exact\nH 0 0 0\n";
 const make = async (text = xyz) => {
  const base = DefaultPluginSpec();
  const plugin = new PluginContext({ ...base, behaviors: [...base.behaviors, ...Object.values(runtime.ExtensionMap)] });
  plugins.push(plugin); await plugin.init();
  assert.equal(plugin.state.data.burettePreconditionVersion, 1, "compiled state precondition plugin is installed");
  const raw = await plugin.builders.data.rawData({ data: text, label: "Original exact" });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
  plugin.state.setSnapshotParams({ camera: false, image: false, animation: false });
  return plugin;
 };
 const readSettings = p => JSON.parse(JSON.stringify({ picking: p.managers.interactivity.props,
  options: p.managers.structure.component.state.options,
  behavior: [...p.state.behaviors.cells.values()].map(c => [c.transform.transformer.id, c.params?.values]).sort((a,b) => a[0].localeCompare(b[0])) }));
 try {
  const source = await make(), target = await make();
  assert.equal(source.spec.behaviors.length, 35);
  const focus = source.spec.behaviors.find(b => b.transformer.id === "ms-plugin.create-structure-focus-representation").transformer;
  source.managers.interactivity.setProps({ granularity: "chain" });
  await source.managers.structure.component.setOptions({ ...source.managers.structure.component.state.options, ignoreLight: true });
  await source.state.updateBehavior(focus, p => { p.expandRadius = 8; });
  const expected = readSettings(source);
  const lease = runtime.BuretteGeometry.binding(source).lease;
  const { receipt, ...transfer } = runtime.BuretteTopologyScene.capture(source, lease);
  assert.equal(runtime.BuretteTopologyScene.validate(source, receipt, lease), true);
  await runtime.BuretteTopologyScene.restore(target, transfer);
  assert.deepEqual(readSettings(target), expected);
  source.managers.interactivity.setProps({ granularity: "residue" });
  assert.throws(() => runtime.BuretteTopologyScene.validate(source, receipt, lease), { code: "UNSUPPORTED_TOPOLOGY_ENVIRONMENT" });
  const extract = name => viewerSource.match(new RegExp("\\n  (?:async )?function " + name + "\\([\\s\\S]*?\\n  \\}", "u"))[0];
  const unavailable = () => { throw new Error("Unexpected script load"); };
  const viewer = { plugin: target };
  // Snapshots serialize through the scene file actions, which the viewer has loaded by then.
  const sceneWindow = {};
  new Function("window", sceneFilesSource)(sceneWindow);
  const execute = new Function("window", "activeMolstarViewer", "activeConfig", "document", "runtimeURL", "loadScript",
    extract("bytesToBase64") + "\n" + extract("executeBuretteAgentAction") + "\nreturn executeBuretteAgentAction;")
    (sceneWindow, () => viewer, { renderer: "molstar" }, document, unavailable, unavailable);
  assert.equal(target.state.snapshotParams.value.behavior, false);
  const exported = await execute({ type: "workspace_scene_snapshot" });
  assert.equal(exported.ok, true);
  const binary = atob(exported.result.dataBase64);
  const archive = Uint8Array.from(binary, c => c.charCodeAt(0));
  const reopened = await make();
  await reopened.managers.snapshot.open(new File([archive], "built-scene.molx"));
  assert.deepEqual(readSettings(reopened), expected);
  const reopenLease = runtime.BuretteGeometry.binding(reopened).lease;
  const reopenedCapture = runtime.BuretteTopologyScene.capture(reopened, reopenLease);
  assert.equal(runtime.BuretteTopologyScene.validate(reopened, reopenedCapture.receipt, reopenLease), true);
  const edited = await make("2\nEdited topology\nH 0 0 0\nH 0 0 0.74\n");
  const { receipt: unused, ...nextTransfer } = reopenedCapture;
  await runtime.BuretteTopologyScene.restore(edited, { ...nextTransfer, atomCount: 2 });
  assert.deepEqual(readSettings(edited), expected);
  assert.equal(runtime.BuretteTopologyScene.capture(edited, runtime.BuretteGeometry.binding(edited).lease).atomCount, 2);
  const cube = "Three fields\nKnown interleaved samples\n-1 1.25 -2.5 3.75\n-2 0.5 0.125 0\n-1 0 0.75 -0.125\n-1 0.25 0 1.5\n8 8 2 3 4\n3 7 11 17\n-4 40 400 -3 30 300\n";
  const cubePlugin = new PluginContext(DefaultPluginSpec()); plugins.push(cubePlugin); await cubePlugin.init();
  const cubeRaw = await cubePlugin.builders.data.rawData({ data: cube });
  const format = await cubePlugin.build().to(cubeRaw).apply(StateTransforms.Data.ParseCube).commit();
  const volume = await cubePlugin.build().to(format).apply(StateTransforms.Volume.VolumeFromCube, { dataIndex: 1 }).commit();
  assert.deepEqual(Array.from(volume.data.grid.cells.data), [40, 30]);
  assert.deepEqual(Array.from(volume.data.grid.transform.matrix), [0.5,0.125,0,0,0,0.75,-0.125,0,0.25,0,1.5,0,1.25,-2.5,3.75,1]);
  const trajectory = await cubePlugin.build().to(format).apply(StateTransforms.Model.TrajectoryFromCube).commit();
  const model = await cubePlugin.builders.structure.createModel(trajectory);
  assert.deepEqual([Array.from(model.data.atomicConformation.x),Array.from(model.data.atomicConformation.y),Array.from(model.data.atomicConformation.z)], [[2],[3],[4]]);
  await cubePlugin.build().to(volume).update({ dataIndex: 2, entryId: "" }).commit({ canUndo: "Select Cube dataset" });
  assert.deepEqual(Array.from(volume.cell.obj.data.grid.cells.data), [400,300]);
  await cubePlugin.runTask(cubePlugin.state.data.undo());
  assert.deepEqual(Array.from(volume.cell.obj.data.grid.cells.data), [40,30]);
  assert.equal(cubeRaw.data, cube);
  return { compiledNativeBehaviorCount: 35, topology: "capture/restore/owner-change/continued2atom", workspaceSceneSnapshot: "actual dispatcher/native MOLX reopen with behavior", cube: "angstrom negative counts/oblique matrix/selected interleaved dataset/native Undo/original bytes", plyExportPresent: Boolean(runtime.BurettePlyExport), archiveBytes: archive.length };
 } finally { for (const plugin of plugins) plugin.dispose(); }
})()
