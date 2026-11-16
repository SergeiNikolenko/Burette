'use strict';

(() => {
  const KIND_LABELS = {
    hbond: 'H-bonds',
    ionic: 'Salt bridges',
    metal: 'Metal coordination',
    pi: 'π-stacking',
    cationPi: 'Cation–π',
    halogen: 'Halogen bonds',
    water: 'Water bridges',
  };
  const CONTACT_TYPES = ['atomPairInteractions', 'piStackings', 'cationPiStackings'];
  const CELL_PADDING = 18;
  const HEADING_HEIGHT = 16;

  function measureStructure(structure, annotations, splines) {
    const items = structure.atoms.map((a) => ({
      point: a.coordinates,
      rx: structure.representation === 2 ? 11 : a.label ? 6 : 1,
      ry: structure.representation === 2 ? 11 : 4,
    }));
    for (const a of annotations) {
      items.push({ point: a.coordinates, rx: Math.max(5, a.label.length * 2.25), ry: 5 });
    }
    for (const spline of splines) {
      for (const point of spline.controlPoints) items.push({ point, rx: 1, ry: 1 });
    }
    return {
      left: Math.min(...items.map(({ point, rx }) => point.x - rx)),
      right: Math.max(...items.map(({ point, rx }) => point.x + rx)),
      top: Math.min(...items.map(({ point, ry }) => point.y - ry)),
      bottom: Math.max(...items.map(({ point, ry }) => point.y + ry)),
    };
  }

  function movePartner(partner, x, y) {
    const { bounds, structure, annotations } = partner;
    const dx = x - (bounds.left + bounds.right) / 2;
    const dy = y - (bounds.top + bounds.bottom) / 2;
    for (const item of [...structure.atoms, ...annotations]) {
      item.coordinates.x += dx;
      item.coordinates.y += dy;
    }
  }

  function rowHeight(row) {
    return Math.max(28, ...row.map(({ bounds }) => bounds.bottom - bounds.top)) + 2 * CELL_PADDING;
  }

  function placeRows(panel, partners, left, top, columns, width, dividers) {
    for (let start = 0; start < partners.length; start += columns) {
      const row = partners.slice(start, start + columns);
      const height = rowHeight(row);
      for (const [i, partner] of row.entries()) {
        const x = left + i * width;
        movePartner(partner, x + width / 2, top + height / 2);
        if (dividers && i > 0) panel.rules.push([x, top, x, top + height]);
      }
      top += height;
      if (dividers) panel.rules.push([left, top, left + row.length * width, top]);
    }
    return top;
  }

  function contactEndpoints(scene, contacts, structures) {
    const interactions = new Map(CONTACT_TYPES.flatMap((type) =>
      scene[type].map((interaction) => [`${type}:${interaction.id}`, interaction])));
    const endpoint = (sid, id, isRing) => ({
      sid,
      atomIds: isRing ? structures.get(sid).rings.find((ring) => ring.id === id).atoms : [id],
    });
    return contacts.flatMap((c, index) => {
      const entry = interactions.get(`${c.type}:${c.id}`);
      if (!entry) return [];
      return [{
        index,
        endpoints: [
          endpoint(entry.fromStructure, entry.from, c.type !== 'atomPairInteractions'),
          endpoint(entry.toStructure, entry.to, c.type === 'piStackings'),
        ],
      }];
    });
  }

  globalThis.arrangePanelDiagram = function arrangePanelDiagram(data, mode) {
    if (!['atlas', 'lanes'].includes(mode) || data.diagramPanels) return;
    const scene = data.scene.scene;
    const structures = new Map(scene.structures.map((s) => [s.id, s]));
    const annotationsOf = (sid) => scene.annotations.filter((a) => a.belongsTo?.id === sid);
    const ligand = measureStructure(structures.get(0), annotationsOf(0), scene.hydrophobicContacts);
    const panels = { mode, rules: [], headings: [], indexedContacts: contactEndpoints(scene, data.contacts, structures) };
    data.diagramPanels = panels;

    const kinds = new Map();
    for (const { index, endpoints } of panels.indexedContacts) {
      for (const { sid } of endpoints) {
        if (!kinds.has(sid)) kinds.set(sid, new Set());
        kinds.get(sid).add(data.contacts[index].kind);
      }
    }
    const partners = scene.structures.filter((s) => s.id !== 0).map((structure) => {
      const annotations = annotationsOf(structure.id);
      const types = Object.keys(KIND_LABELS).filter((kind) => kinds.get(structure.id)?.has(kind));
      return { structure, annotations, types, bounds: measureStructure(structure, annotations, []) };
    });
    if (!partners.length) return;

    const cellWidth = Math.max(56, ...partners.map(({ bounds }) => bounds.right - bounds.left)) + 2 * CELL_PADDING;
    if (mode === 'atlas') {
      const columns = Math.min(4, Math.ceil(Math.sqrt(partners.length)));
      const width = columns * cellWidth;
      const left = (ligand.left + ligand.right - width) / 2;
      const top = ligand.bottom + 35;
      panels.headings.push({ x: left, y: top - 6, label: 'Contact partners' });
      panels.rules.push([left, top, left + width, top]);
      placeRows(panels, partners, left, top, columns, cellWidth, true);
      return;
    }

    const lanes = new Map();
    for (const partner of partners) {
      const label = partner.types.map((kind) => KIND_LABELS[kind]).join(' / ') || 'Contact partners';
      if (!lanes.has(label)) lanes.set(label, []);
      lanes.get(label).push(partner);
    }
    const columns = Math.min(2, Math.max(...Array.from(lanes.values(), (row) => row.length)));
    const left = ligand.right + 34;
    const width = columns * cellWidth;
    const ordered = [...lanes].sort(([, a], [, b]) => b.length - a.length);
    let height = ordered.length * HEADING_HEIGHT;
    for (const [, row] of ordered) {
      for (let i = 0; i < row.length; i += columns) height += rowHeight(row.slice(i, i + columns));
    }
    const bandTop = (ligand.top + ligand.bottom - height) / 2;
    let top = bandTop;
    for (const [label, row] of ordered) {
      panels.headings.push({ x: left, y: top + 8, label });
      panels.rules.push([left, top + HEADING_HEIGHT, left + width, top + HEADING_HEIGHT]);
      top = placeRows(panels, row, left, top + HEADING_HEIGHT, columns, cellWidth, false);
    }
    const ruleX = left - 10;
    panels.rules.push([ruleX, Math.min(ligand.top - 12, bandTop), ruleX, Math.max(ligand.bottom + 12, top)]);
  };

  function squaredSegmentDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
  }

  function insideRing(point, polygon) {
    let inside = false;
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) inside = !inside;
    }
    return inside;
  }

  function crossesBond(a, b, c, d) {
    const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  }

  function badgePosition(anchor, isRing, radius, pad, { obstacles, segments, bonds, rings }) {
    let best;
    for (const distance of (isRing ? [0, 11, 15, 20, 27, 36, 48] : [11, 15, 20, 27, 36, 48])) {
      const distanceCost = distance * 0.15;
      if (best && best.score >= 3 - distanceCost) break;
      const count = distance === 0 ? 1 : 20;
      for (let i = 0; i < count; i += 1) {
        const angle = (-0.25 + i / count) * 2 * Math.PI;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const point = { x: anchor.x + distance * dx, y: anchor.y + distance * dy };
        let free = (radius + 3) ** 2;
        for (const { x, y, rx, ry } of obstacles) {
          const dx = Math.max(0, Math.abs(point.x - x) - rx);
          const dy = Math.max(0, Math.abs(point.y - y) - ry);
          free = Math.min(free, dx * dx + dy * dy);
        }
        for (const [a, b] of segments) free = Math.min(free, squaredSegmentDistance(point, a, b));
        let score = Math.sqrt(free) - radius - distanceCost;
        if (best && score <= best.score) continue;
        if (!isRing && rings.some((ring) => insideRing(point, ring))) score -= 20;
        const start = Math.max(3, pad);
        if (distance > start + radius) {
          const from = { x: anchor.x + start * dx, y: anchor.y + start * dy };
          const to = { x: point.x - radius * dx, y: point.y - radius * dy };
          if (bonds.some(([a, b]) => crossesBond(from, to, a, b))) score -= 6;
        }
        if (score >= 3 - distanceCost) return { ...point, distance, score };
        if (!best || score > best.score) best = { ...point, distance, score };
      }
    }
    return best;
  }

  globalThis.drawPanelDiagram = function drawPanelDiagram(context) {
    const { root, data, svgEl, liveAtoms, liveAtom, colorOf, kindOf, background, foreground, isContactVisible } = context;
    const panels = data.diagramPanels;
    if (!panels) return;
    const frame = svgEl('g', { class: 'lid-panel-frame', 'pointer-events': 'none' }, root);
    for (const [x1, y1, x2, y2] of panels.rules) {
      svgEl('line', { x1, y1, x2, y2, stroke: foreground, 'stroke-width': 0.5, opacity: 0.32 }, frame);
    }
    for (const { x, y, label } of panels.headings) {
      svgEl('text', { x, y, fill: foreground, 'font-size': 7, 'font-weight': 600 }, frame).textContent = label;
    }

    const scene = data.scene.scene;
    const obstacles = [];
    const segments = panels.rules.map(([x1, y1, x2, y2]) => [{ x: x1, y: y1 }, { x: x2, y: y2 }]);
    const bonds = [];
    const rings = [];
    const deltas = new Map();
    const atomPadding = new Map();
    for (const structure of scene.structures) {
      const points = liveAtoms(structure.id);
      if (!points.length) continue;
      deltas.set(structure.id, {
        x: points[0].x - structure.atoms[0].coordinates.x,
        y: points[0].y - structure.atoms[0].coordinates.y,
      });
      for (const atom of structure.atoms) {
        const p = liveAtom(structure.id, atom.id);
        if (!p) continue;
        const pad = structure.representation === 2 ? 10 : atom.label ? 4.5 : 1;
        atomPadding.set(atom.id, pad);
        obstacles.push({ ...p, rx: pad, ry: pad });
      }
      for (const bond of structure.bonds) {
        const a = liveAtom(structure.id, bond.from), b = liveAtom(structure.id, bond.to);
        if (a && b) bonds.push([a, b]);
      }
      for (const ring of structure.rings ?? []) {
        const polygon = ring.atoms.map((id) => liveAtom(structure.id, id));
        if (polygon.every(Boolean)) rings.push(polygon);
      }
    }
    segments.push(...bonds);
    for (const a of scene.annotations) {
      const delta = deltas.get(a.belongsTo?.id);
      if (delta) obstacles.push({ x: a.coordinates.x + delta.x, y: a.coordinates.y + delta.y, rx: a.label.length * 2.25, ry: 4 });
    }
    for (const spline of scene.hydrophobicContacts) {
      const delta = deltas.get(spline.belongsTo);
      if (!delta) continue;
      const points = spline.controlPoints.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
      for (let i = 1; i < points.length; i += 1) segments.push([points[i - 1], points[i]]);
    }

    for (const { index, endpoints } of panels.indexedContacts) {
      const contact = data.contacts[index];
      const number = String(index + 1);
      const color = colorOf(kindOf(contact));
      const radius = 4.3 + (number.length - 1) * 0.95;
      for (const { sid, atomIds } of endpoints) {
        const points = atomIds.map((id) => liveAtom(sid, id)).filter(Boolean);
        if (!points.length) continue;
        const isRing = atomIds.length > 1;
        const anchor = points.reduce((sum, p) => ({
          x: sum.x + p.x / points.length,
          y: sum.y + p.y / points.length,
        }), { x: 0, y: 0 });
        const pad = isRing ? 1 : atomPadding.get(atomIds[0]) ?? 1;
        const { x, y, distance } = badgePosition(anchor, isRing, radius, pad, { obstacles, segments, bonds, rings });
        obstacles.push({ x, y, rx: radius, ry: radius });
        if (!isContactVisible(contact)) continue;

        const badge = svgEl('g', {
          class: 'lid-contact-badge',
          'data-contact-index': index,
          role: 'button',
          tabindex: 0,
          'aria-label': `Contact ${number}, ${contact.residue}`,
          cursor: 'pointer',
        }, root);
        if (distance > pad + radius) {
          svgEl('line', {
            x1: anchor.x + (x - anchor.x) * pad / distance,
            y1: anchor.y + (y - anchor.y) * pad / distance,
            x2: x, y2: y, stroke: color, 'stroke-width': 0.55, opacity: 0.7, 'pointer-events': 'none',
          }, badge);
          if (isRing) svgEl('circle', { cx: anchor.x, cy: anchor.y, r: 0.85, fill: color, 'pointer-events': 'none' }, badge);
        }
        svgEl('circle', { cx: x, cy: y, r: radius, fill: background, stroke: color, 'stroke-width': 0.65 }, badge);
        svgEl('text', {
          x, y: y + 1.75, fill: color, 'text-anchor': 'middle', 'font-size': 5.2, 'font-weight': 600, 'pointer-events': 'none',
        }, badge).textContent = number;
      }
    }
  };
})();
