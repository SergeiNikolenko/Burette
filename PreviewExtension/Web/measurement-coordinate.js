(function () {
  'use strict';
  const fail = message => { throw new Error(message); };
  // The selections' order is the measurement's order, including filtered component loci.
  function points(viewer, target, kind) {
    const roots = viewer.plugin.managers.structure.hierarchy.current.structures;
    if (roots.length !== 1) fail('Open one molecular structure to edit a measurement.');
    const root = roots[0].cell.obj.data;
    if (root.models.length !== 1) fail('Measurements across models cannot move one fragment.');
    const cells = viewer.plugin.state.data.cells;
    let cell = target;
    const visited = new Set();
    while (cell && !Array.isArray(cell.obj?.data)) {
      if (visited.has(cell.transform.ref)) fail('Choose an atomic measurement.');
      visited.add(cell.transform.ref);
      cell = cells.get(cell.transform.parent);
    }
    const selections = cell?.obj?.data;
    const Loci = window.molstar.lib.structure.StructureElement.Loci;
    if (!Array.isArray(selections) || selections.length !== { distance: 2, angle: 3, dihedral: 4 }[kind]) fail('Choose one distance, angle or dihedral.');
    return selections.map(selection => {
      const loci = selection.loci;
      if (loci?.kind !== 'element-loci' || loci.structure.root !== root.root || Loci.size(loci) !== 1 || loci.elements.length !== 1) fail('Choose measurements with one atom at each point.');
      const { unit } = loci.elements[0];
      if (unit.kind !== 0 || unit.model !== root.models[0] || unit.conformation.operator.isIdentity !== true) fail('Measurements in transformed assemblies cannot edit source coordinates.');
      const location = Loci.getFirstLocation(loci);
      const source = unit.model.atomicHierarchy.atomSourceIndex.value(location.element);
      if (!Number.isInteger(source) || source < 0 || source >= root.elementCount) fail('This measurement has no source atom identity.');
      return source;
    });
  }
  async function describe(viewer, targets, science) {
    if (targets.length !== 1) fail('Choose one distance, angle or dihedral.');
    const target = targets[0], kind = String(target.obj?.label || '').toLowerCase();
    if (!['distance', 'angle', 'dihedral'].includes(kind)) fail('Choose a distance, angle or dihedral.');
    const atoms = points(viewer, target, kind);
    if (new Set(atoms).size !== atoms.length) fail('Choose distinct measurement atoms.');
    let binding;
    try { binding = await science.graphBinding(viewer); }
    catch { fail('Coordinate editing needs a single MOL or SDF structure.'); }
    if (binding.atomCount > 256 || binding.frameCount !== 1 || binding.frameIndex !== 0) fail('Coordinate editing needs one MOL or SDF record of up to 256 atoms.');
    if (viewer.plugin.state.data.cells.get(target.transform.ref) !== target || String(points(viewer, target, kind)) !== String(atoms)) fail('The measurement changed. Open it again.');
    const { structureRef, modelRef, trajectoryRef, frameIndex, frameCount, atomCount, sourceSha256, sourceFormat } = binding;
    return { kind, atoms, structureRef, modelRef, trajectoryRef, frameIndex, frameCount, atomCount, sourceSha256, sourceFormat };
  }
  const KINDS = { Distance: 2, Angle: 3, Dihedral: 4, Label: 1, Orientation: 0, Plane: 0 };
  // Reviewed fields of Distance/Angle/Dihedral/Label/Orientation/Plane params.
  const PARAMS = new Set([
    'customText', 'textColor', 'textSize', 'linesColor', 'linesSize', 'dashLength', 'color', 'arcScale', 'sectorOpacity',
    'borderWidth', 'borderColor', 'unitLabel', 'alpha', 'ignoreLight', 'lineSizeAttenuation', 'background', 'backgroundColor',
    'backgroundOpacity', 'backgroundMargin', 'offsetX', 'offsetY', 'offsetZ', 'fontFamily', 'fontQuality', 'fontStyle',
    'fontVariant', 'fontWeight', 'radiusScale', 'scaleFactor', 'variant', 'radialSegments', 'attachment', 'scaleByRadius',
    'snapshotKey', 'tooltip', 'tether', 'tetherLength', 'tetherBaseWidth', 'quality', 'sizeFactor', 'instanceGranularity',
    'cellSize', 'batchSize', 'doubleSided', 'flipSided', 'flatShaded', 'celShaded', 'xrayShaded', 'transparentBackfaces',
    'bumpFrequency', 'bumpAmplitude', 'emissive', 'density',
  ]);
  const material = { metalness: 'number', roughness: 'number', bumpiness: 'number' };
  const vector = ['number', 3, 3];
  const NESTED = {
    material, lod: vector,
    clip: { variant: new Set(['instance', 'pixel']), objects: [{ type: new Set(['none', 'plane', 'sphere', 'cube', 'cylinder', 'infiniteCone']), invert: 'boolean', position: vector, rotation: { axis: vector, angle: 'number' }, scale: vector, transform: ['number', 16, 16] }, 8] },
    animation: { wiggleMode: new Set(['position', 'group']), wiggleSpeed: 'number', wiggleAmplitude: 'number', wiggleFrequency: 'number', tumbleSpeed: 'number', tumbleAmplitude: 'number', tumbleFrequency: 'number' },
    interior: { color: 'number', colorStrength: 'number', substance: material, substanceStrength: 'number' },
  };
  const DEFAULT_NESTED = {
    material: { metalness: 0, roughness: 1, bumpiness: 0 }, clip: { variant: 'pixel', objects: [] }, lod: [0, 0, 0],
    animation: { wiggleMode: 'position', wiggleSpeed: 7, wiggleAmplitude: 0, wiggleFrequency: 0.2, tumbleSpeed: 1, tumbleAmplitude: 0, tumbleFrequency: 0.2 },
    interior: { color: 5000268, colorStrength: 1, substance: { metalness: 0, roughness: 1, bumpiness: 0 }, substanceStrength: 1 },
  };
  // Closed schemas exclude references/functions; limits also cover malformed or cyclic input.
  function copySetting(value, schema, depth = 0, budget = { nodes: 0 }) {
    if (++budget.nodes > 512 || depth > 6) fail('The measurement settings are too complex to retain.');
    if (schema instanceof Set) { if (!schema.has(value)) fail('A measurement setting is unsupported.'); return value; }
    if (typeof schema === 'string') {
      if (typeof value !== schema || schema === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e9) || schema === 'string' && value.length > 1024) fail('A measurement setting is invalid.');
      return value;
    }
    if (Array.isArray(schema)) {
      if (!Array.isArray(value) || value.length > schema[1] || schema[2] !== undefined && value.length !== schema[2]) fail('A measurement setting has an invalid array.');
      return Array.from(value, entry => copySetting(entry, schema[0], depth + 1, budget));
    }
    if (!value || Object.prototype.toString.call(value) !== '[object Object]' || Object.keys(value).length > 32) fail('A measurement setting has an invalid object.');
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (!Object.hasOwn(schema, key)) fail('A measurement setting is unsupported.');
      return [key, copySetting(entry, schema[key], depth + 1, budget)];
    }));
  }
  const flags = cell => ({ isHidden: cell?.state?.isHidden === true, isCollapsed: cell?.state?.isCollapsed === true });
  function style(params) {
    const result = {};
    for (const [key, value] of Object.entries(params || {})) {
      if (key === 'visuals' && Array.isArray(value) && value.length <= 8 && value.every(v => typeof v === 'string' && v.length <= 24)) result[key] = value.slice();
      else if (PARAMS.has(key) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9 || typeof value === 'string' && value.length <= 1024)) result[key] = value;
      else if (Object.hasOwn(NESTED, key)) {
        const copied = copySetting(value, NESTED[key]);
        // Omit known defaults to leave the bounded payload for authored settings.
        if (JSON.stringify(copied) !== JSON.stringify(DEFAULT_NESTED[key])) result[key] = copied;
      } else fail('A measurement setting cannot be retained.');
    }
    return result;
  }
  function validateTransfer(value) {
    if (!value || value.version !== 1 || !['sdf', 'mol'].includes(value.sourceFormat) || !/^[a-f0-9]{64}$/.test(value.targetSourceSha256) || !Number.isInteger(value.atomCount) || value.atomCount < 1 || value.atomCount > 256
      || !Array.isArray(value.items) || value.items.length > 32 || new TextEncoder().encode(JSON.stringify(value)).byteLength > 6144) fail('The measurements cannot be retained within this preview.');
    let indices = 0;
    for (const item of value.items) {
      if (!Object.hasOwn(KINDS, item.kind) || !Array.isArray(item.points) || (KINDS[item.kind] ? item.points.length !== KINDS[item.kind] : item.points.length < 1 || item.points.length > 8)) fail('The measurement points are invalid.');
      for (const point of item.points) {
        if (!Array.isArray(point) || !point.length || point.length > value.atomCount || new Set(point).size !== point.length
          || point.some(index => !Number.isInteger(index) || index < 0 || index >= value.atomCount)) fail('The measurement atoms are invalid.');
        indices += point.length;
      }
      if (indices > 1024) fail('There are too many measurement atoms to retain.');
    }
    return value;
  }
  async function capture(viewer, science) {
    const binding = await science.graphBinding(viewer);
    if (binding.atomCount > 256 || binding.frameCount !== 1) fail('Coordinate editing needs one MOL or SDF record of up to 256 atoms.');
    const root = viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data;
    const Loci = window.molstar.lib.structure.StructureElement.Loci, cells = viewer.plugin.state.data.cells, items = [];
    for (const cell of cells.values()) {
      const kind = cell.obj?.label;
      if (!Object.hasOwn(KINDS, kind) || !String(cell.transform.transformer?.id).includes('structure-selections-')) continue;
      if (items.length >= 32) fail('There are too many measurements to retain.');
      const selection = cells.get(cell.transform.parent);
      if (!Array.isArray(selection?.obj?.data) || selection.obj.data.length > 8) fail('This measurement has no bounded source atoms.');
      const points = selection.obj.data.map(({ loci }) => {
        if (loci?.kind !== 'element-loci' || loci.structure.root !== root.root || !Loci.size(loci) || Loci.size(loci) > 256) fail('This measurement has no source atoms.');
        const atoms = [];
        Loci.forEachLocation(loci, location => {
          if (location.unit.kind !== 0 || root.models.length !== 1 || location.unit.model !== root.models[0] || !location.unit.conformation.operator.isIdentity) fail('Measurements across transformed models cannot be retained.');
          atoms.push(location.unit.model.atomicHierarchy.atomSourceIndex.value(location.element));
        });
        return atoms.sort((a, b) => a - b);
      });
      items.push({ kind, points, params: style(cell.transform.params), selection: flags(selection), representation: flags(cell), orderLabel: cell.transform.tags?.includes('measurement-order-label') === true });
    }
    const group = Array.from(cells.values()).find(cell => cell.transform.tags?.includes('measurement-group'));
    const transfer = validateTransfer({ version: 1, sourceFormat: binding.sourceFormat, targetSourceSha256: binding.sourceSha256, atomCount: binding.atomCount, items, group: flags(group) });
    return { ...binding, items: transfer.items, group: transfer.group };
  }
  async function restore(viewer, value, science) {
    const transfer = validateTransfer(value), binding = await science.graphBinding(viewer);
    if (binding.sourceFormat !== transfer.sourceFormat || binding.sourceSha256 !== transfer.targetSourceSha256 || binding.atomCount !== transfer.atomCount || binding.frameCount !== 1) fail('The measurement source changed before previewing.');
    const plugin = viewer.plugin, root = plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data;
    if (Array.from(plugin.state.data.cells.values()).some(cell => Object.hasOwn(KINDS, cell.obj?.label) && String(cell.transform.transformer?.id).includes('structure-selections-'))) fail('This preview already has measurements.');
    const Loci = window.molstar.lib.structure.StructureElement.Loci, locations = new Map();
    for (const unit of root.units) for (let index = 0; index < unit.elements.length; index++) locations.set(unit.model.atomicHierarchy.atomSourceIndex.value(unit.elements[index]), { unit, index });
    const prepared = transfer.items.map(item => ({ ...item, params: style(item.params), loci: item.points.map(point => {
      const groups = new Map();
      for (const source of point) {
        const location = locations.get(source);
        if (!location || !location.unit.conformation.operator.isIdentity) fail('The measurement atoms changed.');
        if (!groups.has(location.unit)) groups.set(location.unit, []);
        groups.get(location.unit).push(location.index);
      }
      return Loci(root, Array.from(groups, ([unit, indices]) => ({ unit, indices: Int32Array.from(indices.sort((a, b) => a - b)) })));
    }) }));
    const manager = plugin.managers.structure.measurement;
    for (const item of prepared) {
      const tags = item.orderLabel ? ['measurement-order-label'] : [];
      const result = item.kind === 'Orientation' || item.kind === 'Plane'
        ? await manager[`add${item.kind}`](item.loci)
        : await manager[`add${item.kind}`](...item.loci, { visualParams: style(item.params), selectionTags: tags, reprTags: tags });
      if (!result?.representation?.cell?.obj) fail('A measurement could not be restored.');
      if (item.kind === 'Orientation' || item.kind === 'Plane') await plugin.state.data.build().to(result.representation).update(style(item.params)).commit();
      plugin.state.data.updateCellState(result.selection.ref, flags({ state: item.selection }));
      plugin.state.data.updateCellState(result.representation.ref, flags({ state: item.representation }));
    }
    if (prepared.length) plugin.state.data.updateCellState(manager.getGroup().ref, flags({ state: transfer.group }));
  }
  window.BuretteMeasurementCoordinate = { describe, capture, restore };
})();
