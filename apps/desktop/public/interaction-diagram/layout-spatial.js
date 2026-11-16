// Arrange the existing chemistry in scene coordinates before the drawer takes ownership.
function arrangeSpatialDiagram(data, mode) {
  if (mode !== 'orbit' && mode !== 'columns') return;
  const { structures: [ligand, ...partners], annotations, hydrophobicContacts,
    atomPairInteractions, piStackings, cationPiStackings } = data.scene.scene;
  if (!partners.length) return;

  const box = (p, x, y = x) => ({ left: p.x - x, right: p.x + x, top: p.y - y, bottom: p.y + y });
  const bounds = (boxes) => boxes.reduce((a, b) => ({
    left: Math.min(a.left, b.left), right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom),
  }));
  const center = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
  const mean = (points) => ({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  });
  const angleFrom = (p, origin) => Math.atan2(p.y - origin.y, p.x - origin.x);
  const labelWidth = (a) => 2.5 * a.label.length + 2;
  const atomBox = (a, p) => a.label ? box(p, 9, 6) : box(p, 2);
  const circleRadius = (s) => ['water', 'metal'].includes(s.structureType) ? 10 : 12;

  const ligandAtoms = new Map(ligand.atoms.map((a) => [a.id, a.coordinates]));
  const ligandRings = new Map(ligand.rings.map((r) => [r.id, mean(r.atoms.map((id) => ligandAtoms.get(id)))]));
  const ligandBoxes = ligand.atoms.map((a) => atomBox(a, a.coordinates));
  const origin = center(bounds(ligand.atoms.map((a) => box(a.coordinates, 0))));
  const central = bounds([
    ...ligandBoxes,
    ...hydrophobicContacts.flatMap((s) => s.controlPoints.map((p) => box(p, 3))),
    ...annotations.filter((a) => a.belongsTo?.id === ligand.id)
      .map((a) => box(a.coordinates, labelWidth(a), 5)),
  ]);

  const anchorPoints = new Map(partners.map((s) => [s.id, []]));
  for (const [edges, fromRings, toRings] of [
    [atomPairInteractions, false, false],
    [piStackings, true, true],
    [cationPiStackings, true, false],
  ]) {
    for (const edge of edges) {
      if (edge.fromStructure === ligand.id) {
        anchorPoints.get(edge.toStructure).push((fromRings ? ligandRings : ligandAtoms).get(edge.from));
      } else if (edge.toStructure === ligand.id) {
        anchorPoints.get(edge.fromStructure).push((toRings ? ligandRings : ligandAtoms).get(edge.to));
      }
    }
  }
  const fragments = partners.map((structure) => {
    const bodyCenter = center(bounds(structure.atoms.map((a) => box(a.coordinates, 0))));
    const points = anchorPoints.get(structure.id);
    return {
      structure, bodyCenter, angle: angleFrom(bodyCenter, origin),
      anchor: points.length ? mean(points) : bodyCenter,
      annotations: annotations.filter((a) => a.belongsTo?.type === 'structure' && a.belongsTo.id === structure.id),
    };
  });

  function makePose(fragment, heading, referenceAngle) {
    const { structure, bodyCenter } = fragment;
    const turn = heading - referenceAngle;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const rotate = ({ x, y }) => {
      x -= bodyCenter.x;
      y -= bodyCenter.y;
      return { x: x * cos - y * sin, y: x * sin + y * cos };
    };
    const atoms = structure.atoms.map((a) => ({ entry: a, point: rotate(a.coordinates) }));
    const body = structure.representation === 2
      ? box({ x: 0, y: 0 }, circleRadius(structure))
      : bounds(atoms.map(({ entry, point }) => atomBox(entry, point)));
    const bodyMidpoint = center(body);
    const outwardX = Math.cos(heading);
    const outwardY = Math.sin(heading);
    const labels = fragment.annotations.map((entry) => {
      const width = labelWidth(entry);
      const point = rotate(entry.coordinates);
      if (entry.isStructureLabel) {
        if (Math.abs(outwardX) >= Math.abs(outwardY)) {
          point.x = outwardX < 0 ? body.left - width - 5 : body.right + width + 5;
          point.y = bodyMidpoint.y;
        } else {
          point.x = bodyMidpoint.x;
          point.y = outwardY < 0 ? body.top - 10 : body.bottom + 10;
        }
      }
      return { entry, point, bounds: box(point, width, 5) };
    });
    return { ...fragment, points: [...atoms, ...labels], body, bounds: bounds([body, ...labels.map((l) => l.bounds)]) };
  }

  function position(pose, x, y) {
    for (const { entry, point } of pose.points) {
      entry.coordinates.x = x + point.x;
      entry.coordinates.y = y + point.y;
    }
  }

  if (mode === 'columns') {
    for (const side of [-1, 1]) {
      const rows = fragments.filter((f) => (Math.sign(f.anchor.x - origin.x)
        || Math.sign(f.bodyCenter.x - origin.x) || 1) === side)
        .sort((a, b) => a.anchor.y - b.anchor.y || a.bodyCenter.y - b.bodyCenter.y)
        .map((f) => makePose(f, side < 0 ? Math.PI : 0, f.anchor === f.bodyCenter ? f.angle : angleFrom(f.bodyCenter, f.anchor)));
      if (!rows.length) continue;
      const gap = 12;
      const railHeight = rows.reduce((total, row) => total + row.bounds.bottom - row.bounds.top, 0) + (rows.length - 1) * gap;
      const anchorMidY = (rows[0].anchor.y + rows.at(-1).anchor.y) / 2;
      const railX = side < 0 ? central.left - 23 : central.right + 23;
      let y = anchorMidY - railHeight / 2;
      for (const row of rows) {
        const innerEdge = side < 0 ? row.body.right : row.body.left;
        position(row, railX - innerEdge, y - row.bounds.top);
        y += row.bounds.bottom - row.bounds.top + gap;
      }
    }
    return;
  }

  // Fit the ellipse to the ligand and labels, then distribute fragments in their original cyclic order.
  const rx = Math.max(origin.x - central.left, central.right - origin.x) + 35;
  const ry = Math.max(origin.y - central.top, central.bottom - origin.y) + 35;
  const fullTurn = 2 * Math.PI;
  const step = fullTurn / fragments.length;
  const order = fragments.map((f) => ({
    fragment: f, angle: Math.atan2((f.bodyCenter.y - origin.y) / ry, (f.bodyCenter.x - origin.x) / rx),
  })).sort((a, b) => a.angle - b.angle);
  const phaseOffsets = order.map((item, i) => item.angle - i * step);
  const phase = Math.atan2(
    phaseOffsets.reduce((sum, a) => sum + Math.sin(a), 0),
    phaseOffsets.reduce((sum, a) => sum + Math.cos(a), 0),
  );
  const firstSlot = phase + fullTurn * Math.round((order[0].angle - phase) / fullTurn);
  const orbit = order.map(({ fragment, angle }, i) => {
    // Bias even spacing toward each fragment's original direction to limit line crossings.
    const theta = (firstSlot + i * step) * 0.55 + angle * 0.45;
    const x = rx * Math.cos(theta);
    const y = ry * Math.sin(theta);
    const heading = Math.atan2(y, x);
    const pose = makePose(fragment, heading, fragment.angle);
    return { pose, x, y };
  });
  const localCentral = {
    left: central.left - origin.x, right: central.right - origin.x,
    top: central.top - origin.y, bottom: central.bottom - origin.y,
  };
  // Two boxes are separated as soon as they clear each other on either axis.
  function clearanceScale(a, b, dx, dy, gap) {
    const horizontal = dx >= 0 ? b.right - a.left : a.right - b.left;
    const vertical = dy >= 0 ? b.bottom - a.top : a.bottom - b.top;
    if (horizontal + gap <= 0 || vertical + gap <= 0) return 0;
    return Math.min((horizontal + gap) / Math.abs(dx), (vertical + gap) / Math.abs(dy));
  }
  let scale = 1;
  for (const [i, a] of orbit.entries()) {
    scale = Math.max(scale, clearanceScale(a.pose.bounds, localCentral, a.x, a.y, 19));
    for (let j = 0; j < i; j++) {
      const b = orbit[j];
      scale = Math.max(scale, clearanceScale(a.pose.bounds, b.pose.bounds, a.x - b.x, a.y - b.y, 11));
    }
  }
  for (const { pose, x, y } of orbit) position(pose, origin.x + x * scale, origin.y + y * scale);
}
