'use strict';

(() => {
  const LINE_SPACING = 10;
  const HALF_LINE = 4.5;
  const residueKey = (chain, number, name, label) => JSON.stringify([chain, number, name.toUpperCase(), label]);

  function samplePath(points) {
    const samples = points.slice(0, 1);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
      for (let j = 1; j <= steps; j += 1) {
        samples.push({ x: a.x + (b.x - a.x) * j / steps, y: a.y + (b.y - a.y) * j / steps });
      }
    }
    return samples;
  }

  function boxDistance(box, point) {
    const dx = Math.max(0, Math.abs(box.x - point.x) - box.rx);
    const dy = Math.max(0, Math.abs(box.y - point.y) - box.ry);
    return Math.hypot(dx, dy);
  }

  function average(points) {
    return points.reduce(({ x, y }, point) => ({ x: x + point.x / points.length, y: y + point.y / points.length }), { x: 0, y: 0 });
  }

  globalThis.compactDiagramLabels = function compactDiagramLabels(data) {
    const scene = data.scene.scene;
    if (!scene.hydrophobicContacts.length) return;
    const ligand = scene.structures[0];
    const atoms = new Map(ligand.atoms.map((atom) => [atom.id, atom.coordinates]));
    const groups = new Map(scene.hydrophobicContacts.map((spline) => [spline.id, {
      points: spline.controlPoints,
      samples: samplePath(spline.controlPoints),
      labels: [],
    }]));
    const residueArcs = new Map();
    const labelArcs = new Map();
    for (const contact of data.contacts) {
      if (contact.type !== 'hydrophobicContacts') continue;
      residueArcs.set(residueKey(...contact.residueKey, contact.residue), contact.id);
      labelArcs.set(contact.residue, contact.id);
    }
    for (const annotation of scene.annotations) {
      const info = annotation.additionalInformation;
      if (info?.kind !== 'hydrophobic') continue;
      const id = info.name ? residueArcs.get(residueKey(info.chain, info.number, info.name, annotation.label)) : labelArcs.get(annotation.label);
      const group = groups.get(id);
      if (group) group.labels.push(annotation);
    }

    const geometry = [];
    const obstacles = ligand.atoms.map((atom) => ({
      ...atom.coordinates,
      rx: atom.label ? 5 + (atom.charge ? 1 : 0) : 2,
      ry: atom.label ? 4 : 2,
    }));
    for (const bond of ligand.bonds) {
      for (const point of samplePath([atoms.get(bond.from), atoms.get(bond.to)])) geometry.push({ point, clearance: 2 });
    }
    for (const { samples } of groups.values()) {
      for (const point of samples) geometry.push({ point, clearance: 2.5 });
    }
    const clear = (box) => obstacles.every((other) =>
      Math.abs(box.x - other.x) >= box.rx + other.rx + 1 || Math.abs(box.y - other.y) >= box.ry + other.ry + 1) &&
      geometry.every(({ point, clearance }) => boxDistance(box, point) >= clearance);
    const gapTo = (box, samples) => samples.reduce((gap, point) => Math.min(gap, boxDistance(box, point)), Infinity);

    const remaining = [];
    for (const group of groups.values()) {
      const { labels, points, samples } = group;
      if (!labels.length || !points.length) continue;
      labels.sort((a, b) => a.coordinates.y - b.coordinates.y);
      const origin = average(labels.map((label) => label.coordinates));
      const center = average(points);
      const attached = average(points.flatMap((point) => point.atomLinks.map((id) => atoms.get(id))));
      const direction = Math.atan2(center.y - attached.y, center.x - attached.x);
      const box = {
        ...origin,
        rx: Math.max(...labels.map(({ label }) => label.length * 2.15 + 1)),
        ry: HALF_LINE + (labels.length - 1) * LINE_SPACING / 2,
      };
      const others = [...groups.values()].filter((other) => other !== group).flatMap((other) => other.samples);
      const originalBox = {
        ...box,
        rx: box.rx + Math.max(...labels.map(({ coordinates }) => Math.abs(coordinates.x - origin.x))),
        ry: HALF_LINE + Math.max(...labels.map(({ coordinates }) => Math.abs(coordinates.y - origin.y))),
      };
      const gap = gapTo(originalBox, samples);
      const clearRows = labels.every((label, i) => !i || label.coordinates.y - labels[i - 1].coordinates.y >= 2 * HALF_LINE);
      if (clearRows && gap <= 11 && gap <= gapTo(originalBox, others) + 2 && clear(originalBox)) {
        obstacles.push(originalBox);
      } else {
        remaining.push({ labels, points, samples, others, center, direction, box, originalBox });
      }
    }

    for (const { labels, points, samples, others, center, direction, box, originalBox } of remaining) {
      let best;
      // Try the center and the tips of the bracket, biasing placement away from its linked atoms.
      for (const anchor of [center, points[0], points.at(-1)]) {
        for (const offset of [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180]) {
          const angle = direction + offset * Math.PI / 180;
          const dx = Math.cos(angle), dy = Math.sin(angle);
          const reach = Math.abs(dx) * box.rx + Math.abs(dy) * box.ry;
          for (const gap of [4, 7, 10, 15, 20, 26, 34, 44, 58]) {
            const candidate = { ...box, x: anchor.x + dx * (reach + gap), y: anchor.y + dy * (reach + gap) };
            if (!clear(candidate)) continue;
            const ownGap = gapTo(candidate, samples);
            const otherGap = gapTo(candidate, others);
            const score = ownGap + 2.5 * Math.max(0, ownGap - otherGap + 1) +
              0.18 * Math.hypot(candidate.x - center.x, candidate.y - center.y) + 0.025 * Math.abs(offset);
            if (!best || score < best.score) best = { ...candidate, score };
          }
        }
      }
      if (best) {
        for (const [i, label] of labels.entries()) {
          label.coordinates.x = best.x;
          label.coordinates.y = best.y + (i - (labels.length - 1) / 2) * LINE_SPACING;
        }
      }
      obstacles.push(best ?? originalBox);
    }
  };
})();
