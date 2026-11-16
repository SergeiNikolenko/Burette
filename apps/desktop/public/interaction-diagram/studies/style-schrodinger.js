'use strict';

// Schrödinger Maestro ligand interaction diagram: gradient residue drops pointing at the ligand,
// a black backbone through consecutive residues, a pocket ribbon tinted by the nearest residue,
// and Maestro's interaction colours.
(() => {
  // [highlight, body, outline, label]
  const DROPS = {
    light: {
      res_hydrophobic: ['#f6fbe6', '#a9d63c', '#86b12a', '#111111'],
      res_polar: ['#eefafe', '#6fd0f1', '#3fb2da', '#111111'],
      res_basic: ['#f1f0ff', '#8585ff', '#5c5ce6', '#111111'],
      res_acidic: ['#fff0e8', '#f2894f', '#d85d1f', '#111111'],
      res_glycine: ['#ffffff', '#ececd4', '#c8c8a4', '#111111'],
      res_other: ['#f4f4f4', '#9a9a9a', '#767676', '#111111'],
      metal: ['#f4f4f4', '#9a9a9a', '#767676', '#111111'],
      water: ['#ffffff', '#b4b4b4', '#8c8c8c', '#222222'],
    },
    // Fills stay dark enough for the light label to keep a contrast of 4.5 where it is brightest.
    dark: {
      res_hydrophobic: ['#4f781a', '#2a4010', '#a6d64a', '#f5f5f5'],
      res_polar: ['#1c6f8e', '#0f3a4a', '#5cc8ec', '#f5f5f5'],
      res_basic: ['#4545c4', '#22225e', '#8f8fff', '#f5f5f5'],
      res_acidic: ['#b04e1c', '#5c230a', '#f58a52', '#f5f5f5'],
      res_glycine: ['#6f6f5a', '#3a3a30', '#c4c4a4', '#f5f5f5'],
      res_other: ['#666666', '#333333', '#a8a8a8', '#f5f5f5'],
      metal: ['#666666', '#333333', '#a8a8a8', '#f5f5f5'],
      water: ['#6e6e6e', '#3c3c3c', '#b4b4b4', '#f5f5f5'],
    },
  };
  const RIBBON = {
    light: { res_hydrophobic: '#a3cf1d', res_polar: '#5fc8ee', res_basic: '#4f4ff0', res_acidic: '#e2560e', res_glycine: '#e6e6c6', res_other: '#7c7c7c', metal: '#7c7c7c' },
    dark: { res_hydrophobic: '#93c22a', res_polar: '#49b5dc', res_basic: '#7272ff', res_acidic: '#f0783a', res_glycine: '#8c8c72', res_other: '#8c8c8c', metal: '#8c8c8c' },
  };
  const INK = {
    light: { hbond: '#c935ef', pi: '#1fa43a', cationPi: '#e0141b', metal: '#8a8a8a', halogen: '#b08d00', negative: '#e8141b', positive: '#2b2bff',
      backbone: '#000000', exposure: '#8f8f8f', hydrophobic: '#86b12a', ...MOLSTAR_CONTACTS, negative: MOLSTAR_CONTACTS.ionic, positive: MOLSTAR_CONTACTS.ionic },
    dark: { hbond: '#e27bff', pi: '#4fd36b', cationPi: '#ff5a5a', metal: '#a6a6a6', halogen: '#e6c84f', negative: '#ff5a5a', positive: '#7c7cff',
      backbone: '#e8e8e8', exposure: '#9a9a9a', hydrophobic: '#a6d64a', ...MOLSTAR_CONTACTS, negative: MOLSTAR_CONTACTS.ionic, positive: MOLSTAR_CONTACTS.ionic },
  };
  const CLASS_LABELS = { res_acidic: 'Negative', res_basic: 'Positive', res_glycine: 'Glycine', res_hydrophobic: 'Hydrophobic',
    metal: 'Metal', res_polar: 'Polar', res_other: 'Other', water: 'Water' };
  // Label sizes in drawing units: a panel draws at least 1.7 px per unit, which keeps names at 9.5 px and numbers at 9 px.
  const NAME_SIZE = 5.6, NUMBER_SIZE = 5.3, SUBSCRIPT_SIZE = 3.8;
  const CAP = 0.73;                                             // cap and digit height of the label font, in em
  const BLOCK = NAME_SIZE * CAP + 1.7 + NUMBER_SIZE * CAP;      // name line, gap, number line
  const BLOCK_TOP = -4.4;                                       // where the block starts in a drop with room to spare
  const INSET = 0.75;                                           // label corner to drop outline
  const R = { drop: 8.2, water: 6.4 };
  const TIP = 1.42;
  const RIBBON_STEP = 1.6;                                      // spacing of the ribbon's points
  const RIBBON_KEEP = 2;                                        // a glyph's edge to the middle of the ribbon
  const GLYPH_ROOM = 5.5;                                       // room a drop keeps around an atom centre that a glyph beside it does not need

  // The layout search calls this millions of times; Math.hypot is several times slower.
  const distance = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  const dropClass = info => info.class === 'water' || info.class === 'metal' ? info.class
    : info.name === 'GLY' ? 'res_glycine' : CLASS_LABELS[info.class] ? info.class : 'res_other';
  // Residues are drops with a tip; waters and metals are round beads, as in Maestro.
  const tipped = cls => cls !== 'water' && cls !== 'metal';
  const ruler = document.createElement('canvas').getContext('2d');
  const widthOf = (value, size, font) => { ruler.font = `100px ${font}`; return ruler.measureText(value).width * size / 100; };
  // What a drop prints and the radius that holds it. The chain is printed only when the pocket spans several chains.
  const glyphOf = (info, font) => {
    const cls = dropClass(info);
    if (cls === 'water') return { cls, r: R.water };
    const name = (info.name || '').toUpperCase(), number = `${info.chainLabel ? `${info.chainLabel}:` : ''}${info.number ?? ''}`;
    const a = widthOf(name, NAME_SIZE, font) / 2, b = widthOf(number, NUMBER_SIZE, font) / 2;
    // Both lines are centred. The smallest circle around them has the block slid to where its top and bottom
    // corners are equally far from the centre; a wider label than usual grows the drop.
    const slid = Math.max(-BLOCK, Math.min(0, (a * a - b * b - BLOCK * BLOCK) / (2 * BLOCK)));
    const r = Math.max(R.drop, Math.max(Math.hypot(a, slid), Math.hypot(b, slid + BLOCK)) + INSET);
    const room = (r - INSET) ** 2, highest = -Math.sqrt(Math.max(0, room - a * a)), lowest = Math.sqrt(Math.max(0, room - b * b)) - BLOCK;
    return { cls, r, name, number, top: Math.max(highest, Math.min(lowest, BLOCK_TOP)) };
  };
  const fontOf = () => styleOf().fontFamily || 'Helvetica, Arial, sans-serif';
  // Which side of an atom InteractionDrawer writes its hydrogens on: the one the neighbours leave most free
  // (the drawer's findSideMostSpace, repeated here so the layout knows before anything is drawn).
  const sideOf = (p, around) => {
    if (!around.length) return 'right';
    const free = (ux, uy) => Math.min(...around.map(q => {
      const cos = ((q.x - p.x) * ux + (q.y - p.y) * uy) / (distance(p, q) || 1);
      return Math.acos(Math.max(-1, Math.min(1, Math.round(cos * 1e6) / 1e6))) * 180 / Math.PI;
    }));
    if (around.length === 1) return Math.round(free(1, 0)) >= 60 ? 'right' : 'left';
    let side = 'right', most = free(1, 0);
    for (const [name, ux, uy] of [['left', -1, 0], ['down', 0, 1], ['up', 0, -1]]) {
      const angle = free(ux, uy);
      if (angle > most) { most = angle; side = name; }
    }
    return side;
  };
  // The drawer's lettering of a ligand atom: the element centred on the atom, a raised charge after it, then the
  // hydrogens with a lowered count (sizes and offsets are the drawer's defaults, as shares of its text size).
  // Returns the box around all of it and the glyphs beside the element as discs.
  const letteringOf = (atom, p, around, size, font) => {
    const half = widthOf(atom.label || atom.element, size, font) / 2, tall = size * CAP / 2;
    const box = { left: p.x - half, right: p.x + half, top: p.y - tall, bottom: p.y + tall }, glyphs = [];
    const add = (x, y, w, h) => {
      glyphs.push({ x, y, r: Math.hypot(w, h) });
      Object.assign(box, { left: Math.min(box.left, x - w), right: Math.max(box.right, x + w), top: Math.min(box.top, y - h), bottom: Math.max(box.bottom, y + h) });
    };
    if (atom.charge) {
      const sign = `${atom.charge > 0 ? '+' : '-'}${Math.abs(atom.charge) === 1 ? '' : Math.abs(atom.charge)}`;
      const w = widthOf(sign, size * 0.775, font) * 0.53;
      add(box.right + w, p.y - size * 0.3, w, size * 0.775 * CAP / 2);
    }
    if (atom.hydrogenCount > 0) {
      const side = sideOf(p, around), lift = side === 'up' ? -1 : side === 'down' ? 1 : 0;
      const w = widthOf('H', size, font) / 2, n = atom.hydrogenCount > 1 ? widthOf(`${atom.hydrogenCount}`, size * 0.6, font) / 2 : 0;
      const x = lift ? p.x : side === 'right' ? box.right + w : p.x - half - 2 * n - w, y = p.y + lift * size * 0.915;
      add(x, y, w, tall);
      if (n) add(side === 'left' ? p.x - half - n : x + w + n, y + size * 0.235, n, size * 0.6 * CAP / 2);
    }
    return { box, glyphs };
  };
  // Lettering of every ligand atom the drawer letters (all but carbon), by atom id; `at` gives an atom's position.
  const letterLigand = (ligand, at) => {
    const size = styleOf().textSize || 6.5, font = fontOf(), around = new Map(ligand.atoms.map(a => [a.id, []]));
    for (const bond of ligand.bonds || []) {
      const p = at(bond.from), q = at(bond.to);
      if (p && q) { around.get(bond.from).push(q); around.get(bond.to).push(p); }
    }
    return new Map(ligand.atoms.filter(a => a.element !== 'C' && at(a.id)).map(a => [a.id, letteringOf(a, at(a.id), around.get(a.id), size, font)]));
  };
  // The pipeline keeps the pocket contour a fixed distance from atom centres, which runs it through the hydrogens
  // and charges lettered beside an atom. The ribbon, resampled evenly, bows out around those glyphs, and the bow
  // is spread along the path so it has no corners.
  const bowed = (path, glyphs) => {
    const points = [path[0]];
    for (const p of path.slice(1)) {
      const last = points[points.length - 1], l = distance(last, p);
      for (let k = 1; k * RIBBON_STEP < l; k++) points.push({ x: last.x + (p.x - last.x) * k * RIBBON_STEP / l, y: last.y + (p.y - last.y) * k * RIBBON_STEP / l });
      points.push(p);
    }
    const end = points.length - 1, closed = distance(points[0], points[end]) < 0.5;
    let shift = points.map(() => ({ x: 0, y: 0 }));
    for (let pass = 0; pass < 8; pass++) {
      let pushed = false;
      for (const [i, p] of points.entries()) for (const g of glyphs) {
        const x = p.x + shift[i].x - g.x, y = p.y + shift[i].y - g.y, l = Math.sqrt(x * x + y * y) || 1, short = g.r + RIBBON_KEEP - l;
        if (short > 0.05) { shift[i] = { x: shift[i].x + x / l * short, y: shift[i].y + y / l * short }; pushed = true; }
      }
      if (!pushed || pass === 7) break;
      for (let k = 0; k < 2; k++) {
        shift = shift.map((s, i) => {
          const a = shift[i ? i - 1 : closed ? end - 1 : 0], b = shift[i < end ? i + 1 : closed ? 1 : end];
          return { x: (a.x + 2 * s.x + b.x) / 4, y: (a.y + 2 * s.y + b.y) / 4 };
        });
      }
    }
    return points.map((p, i) => ({ x: p.x + shift[i].x, y: p.y + shift[i].y }));
  };
  const segmentDistance = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.sqrt((p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2);
  };
  const outline = (drop, angle) => {
    if (drop.tip == null) return drop.r;
    const delta = Math.abs(Math.atan2(Math.sin(angle - drop.tip), Math.cos(angle - drop.tip)));
    return delta >= drop.tipAngle ? drop.r : drop.r / Math.cos(drop.tipAngle - delta);
  };
  const dropPath = drop => {
    const { x, y, r } = drop;
    if (drop.tip == null) return `M${x - r},${y}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0Z`;
    const d = r / Math.cos(drop.tipAngle);
    const at = (angle, length) => `${(x + Math.cos(angle) * length).toFixed(2)},${(y + Math.sin(angle) * length).toFixed(2)}`;
    return `M${at(drop.tip, d)}L${at(drop.tip + drop.tipAngle, r)}A${r},${r} 0 1 1 ${at(drop.tip - drop.tipAngle, r)}Z`;
  };
  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const mix = weights => {
    const total = weights.reduce((s, [, w]) => s + w, 0) || 1;
    const rgb = [0, 1, 2].map(k => Math.round(weights.reduce((s, [c, w]) => s + hex(c)[k] * w, 0) / total));
    return `rgb(${rgb.join(',')})`;
  };
  // Catmull-Rom spline through the points, as cubic Bézier segments.
  const spline = points => points.slice(0, -1).map((p, i) => {
    const prev = points[i - 1] || p, next = points[i + 1], after = points[i + 2] || next;
    return [p, { x: p.x + (next.x - prev.x) / 6, y: p.y + (next.y - prev.y) / 6 }, { x: next.x - (after.x - p.x) / 6, y: next.y - (after.y - p.y) / 6 }, next];
  });
  const bezier = ([p0, p1, p2, p3], t) => {
    const u = 1 - t;
    return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
  };
  // Where segment pq crosses rs, as a fraction of pq; null when they do not cross.
  const cut = (p, q, r, s) => {
    const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? t : null;
  };
  const crosses = (p, q, r, s) => cut(p, q, r, s) !== null;
  const entersBox = (p, q, b) => {
    if (Math.max(p.x, q.x) < b.left || Math.min(p.x, q.x) > b.right || Math.max(p.y, q.y) < b.top || Math.min(p.y, q.y) > b.bottom) return false;
    const inside = v => v.x > b.left && v.x < b.right && v.y > b.top && v.y < b.bottom;
    if (inside(p) || inside(q)) return true;
    const c = [{ x: b.left, y: b.top }, { x: b.right, y: b.top }, { x: b.right, y: b.bottom }, { x: b.left, y: b.bottom }];
    return c.some((v, i) => crosses(p, q, v, c[(i + 1) % 4]));
  };
  // A drop as discs for overlap tests: the body and two along the tip, which aims at `aim` as draw() aims it.
  const discsOf = (p, r, aim) => {
    const discs = [{ x: p.x, y: p.y, r }], l = aim ? distance(p, aim) : 0;
    if (l - 3 >= r * 1.1) {
      const reach = Math.min(r * TIP, l - 3);
      for (const [at, size] of [[(r + reach) / 2, (reach - r) / 2], [reach - 0.4, 0.4]]) {
        discs.push({ x: p.x + (aim.x - p.x) / l * at, y: p.y + (aim.y - p.y) / l * at, r: size });
      }
    }
    return discs;
  };
  // The tip discs are consulted only when the bodies are within a tip's length of each other or of the segment.
  const discsMeet = (a, b, gap) => distance(a[0], b[0]) < (a[0].r + b[0].r) * TIP + gap
    && a.some(c => b.some(d => distance(c, d) < c.r + d.r + gap));
  const discsOnSegment = (discs, p, q, gap) => segmentDistance(discs[0], p, q) < discs[0].r * TIP + gap
    && discs.some(c => segmentDistance(c, p, q) < c.r + gap);
  const nearestOf = (points, p) => {
    let best = null, least = Infinity;
    for (const q of points) { const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < least) { least = d; best = q; } }
    return best;
  };
  const gapTo = (points, p) => points.length ? distance(nearestOf(points, p), p) : Infinity;

  // Local search after the force layout: nudge each drop (at most MAX_NUDGE from where the forces left it) to
  // the spot where its contact lines cross no other line, ligand bond, atom label or foreign drop, and its body
  // touches no other drop and keeps clear of the ligand and of the ribbon.
  const MAX_NUDGE = 20;
  const MAX_TRADE = 32;
  const TRADE_GAIN = 6;
  const DROP_GAP = 2;
  const untangle = (data, nodes, byId, { ribbon, inside, lettering }) => {
    const scene = data.scene.scene, lig = scene.structures[0];
    const atomById = new Map(lig.atoms.map(a => [a.id, a]));
    const bonds = (lig.bonds || []).map(b => ({ from: b.from, to: b.to, p: atomById.get(b.from)?.coordinates, q: atomById.get(b.to)?.coordinates })).filter(b => b.p && b.q);
    // What a foreign line must not run over: every element letter and the glyphs beside it.
    const beside = [...lettering.values()].flatMap(l => l.glyphs);
    const labels = [...lettering].flatMap(([id, l]) => [{ id, p: atomById.get(id).coordinates, r: 3.4 }, ...l.glyphs.map(g => ({ id, p: g, r: g.r }))]);
    const ringOf = id => (lig.rings || []).find(r => r.id === id);
    const ligandEnd = (id, ring) => {
      const r = ring && ringOf(id);
      if (r) {
        const pts = r.atoms.map(a => atomById.get(a)?.coordinates).filter(Boolean);
        return { p: { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length }, ring: new Set(r.atoms), key: `r${id}` };
      }
      const atom = atomById.get(id);
      return atom && { p: atom.coordinates, atom: id, key: `a${id}` };
    };
    const end = (sid, id, ring) => sid === 0 ? ligandEnd(id, ring) : byId.get(sid) && { node: byId.get(sid), key: `s${sid}` };
    const lines = [], aims = new Map();
    for (const record of data.contacts) {
      if (record.kind === 'hydrophobic') {
        const atom = lig.atoms.find(a => a.additionalInformation?.atomName === record.ligandAtom || a.label === record.ligandAtom);
        if (atom && !aims.has(record.structure)) aims.set(record.structure, atom.coordinates);
        continue;
      }
      const edge = (scene[record.type] || []).find(e => e.id === record.id);
      if (!edge) continue;
      const pi = record.type === 'piStackings', cation = record.type === 'cationPiStackings';
      const a = end(edge.fromStructure, edge.from, pi || cation), b = end(edge.toStructure, edge.to, pi);
      if (!a || !b) continue;
      lines.push([a, b]);
      const ligandSide = a.node ? b : a;
      if (record.ligandAtom !== '' && !ligandSide.node && !aims.has(record.structure)) aims.set(record.structure, ligandSide.p);
    }
    const ligandPoints = lig.atoms.map(a => a.coordinates);
    const aimOf = n => tipped(n.cls) ? aims.get(n.s.id) || nearestOf(ligandPoints, n.p) : null;
    const at = e => e.node ? e.node.p : e.p;
    const touches = (line, n) => line[0].node === n || line[1].node === n;
    const lineCost = line => {
      const [a, b] = line, p = at(a), q = at(b);
      let cost = 0;
      for (const other of lines) {
        if (other === line) continue;
        const keys = [other[0].key, other[1].key];
        if (keys.includes(a.key) || keys.includes(b.key)) continue;
        if (crosses(p, q, at(other[0]), at(other[1]))) cost += 10;
      }
      for (const m of nodes) if (m !== a.node && m !== b.node && discsOnSegment(m.discs, p, q, 0.3)) cost += 10;
      const own = [a, b].find(e => !e.node);
      for (const bond of bonds) {
        if (own?.atom != null && (bond.from === own.atom || bond.to === own.atom)) continue;
        if (own?.ring && own.ring.has(bond.from) && own.ring.has(bond.to)) continue;
        if (crosses(p, q, bond.p, bond.q)) cost += 10;
      }
      for (const l of labels) if (l.id !== own?.atom && segmentDistance(l.p, p, q) < l.r) cost += 6;
      // A line grazing a bond end reads as touching it.
      for (const atom of lig.atoms) {
        if (atom.id !== own?.atom && !own?.ring?.has(atom.id) && segmentDistance(atom.coordinates, p, q) < 1.8) cost += 3;
      }
      return cost;
    };
    // An overlap of bodies costs more than any tangle of lines, so the search never buys one with the other.
    // Counting stops at `limit`: a spot already worse than the best one found needs no exact cost.
    const bodyCost = (n, limit = Infinity) => {
      let room = gapTo(ligandPoints, n.p);
      for (const g of beside) room = Math.min(room, distance(g, n.p) + GLYPH_ROOM - g.r);
      const short = n.clear - 1 - room;
      let cost = short > 0 ? 100 + short : 0;
      if (cost >= limit) return cost;
      const onRibbon = n.band - 0.6 - gapTo(ribbon, n.p);
      if (onRibbon > 0) cost += 100 + onRibbon;
      for (const m of nodes) if (m !== n && discsMeet(n.discs, m.discs, DROP_GAP)) cost += 100;
      if (cost >= limit) return cost;
      for (const bond of bonds) if (discsOnSegment(n.discs, bond.p, bond.q, 1)) cost += 100;
      if (cost < limit && onRibbon <= 0 && inside(n.p)) cost += 100;
      return cost;
    };
    // Everything that changes when n moves: its body, its own lines, other lines through its body.
    const localCost = (n, limit = Infinity) => {
      let cost = bodyCost(n, limit);
      for (const line of lines) {
        if (cost >= limit) break;
        cost += touches(line, n) ? lineCost(line) : discsOnSegment(n.discs, at(line[0]), at(line[1]), 0.3) ? 10 : 0;
      }
      return cost;
    };
    const place = (n, p) => { n.p = p; n.discs = discsOf(p, n.dropR, aimOf(n)); };
    for (const n of nodes) { n.home = { ...n.p }; place(n, n.p); }
    const shift = (n, p) => 0.01 * distance(p, n.home) ** 2;
    const settle = () => {
      for (let round = 0; round < 12; round++) {
        let improved = false;
        for (const n of nodes) {
          const start = n.p, base = localCost(n);
          if (base === 0) continue;
          let best = { p: start, cost: base + shift(n, start) };
          for (const radius of [1.5, 3, 5, 8, 11, 15, 20]) {
            for (let k = 0; k < 16; k++) {
              const p = { x: start.x + Math.cos(k * Math.PI / 8) * radius, y: start.y + Math.sin(k * Math.PI / 8) * radius };
              if (distance(p, n.home) > MAX_NUDGE) continue;
              place(n, p);
              const moved = shift(n, p), cost = localCost(n, best.cost - moved) + moved;
              if (cost < best.cost - 0.01) best = { p, cost };
            }
          }
          place(n, best.p);
          if (best.p !== start) improved = true;
        }
        if (!improved) break;
      }
    };
    // Two neighbouring drops of a kind trade places when that undoes a tangle no nudge of one drop can.
    const trade = () => {
      let traded = false;
      for (const [i, a] of nodes.entries()) for (const b of nodes.slice(i + 1)) {
        if (tipped(a.cls) !== tipped(b.cls) || distance(a.p, b.p) > MAX_TRADE) continue;
        const before = localCost(a) + localCost(b), pa = a.p, pb = b.p;
        if (before < TRADE_GAIN) continue;
        place(a, pb); place(b, pa);
        if (localCost(a) + localCost(b) > before - TRADE_GAIN) { place(a, pa); place(b, pb); continue; }
        [a.home, b.home] = [b.home, a.home];
        traded = true;
      }
      return traded;
    };
    settle();
    for (let turn = 0; turn < 2 && trade(); turn++) settle();
  };

  window.LID_STUDIES['style-schrodinger'] = {
    hideBase: 'partners',
    hideHydrophobic: true,

    // Pull distant residues in, then keep every drop clear of the ligand, the ribbon, the other drops and the lines.
    prepare(data, H) {
      // Maestro's drops are about one bond long; they keep the size their labels need, so the depiction spreads
      H.spread(data, 1.25);
      const structures = data.scene.scene.structures, font = fontOf();
      const ligand = structures[0].atoms.map(a => a.coordinates);
      const nearest = p => nearestOf(ligand, p);
      const ligandById = new Map(structures[0].atoms.map(a => [a.id, a.coordinates]));
      const lettering = letterLigand(structures[0], id => ligandById.get(id)), glyphs = [...lettering.values()].flatMap(l => l.glyphs);
      // What a drop keeps clear of: atom centres, and the glyphs lettered beside them, which need less room.
      const solid = [...ligand.map(q => ({ x: q.x, y: q.y, spare: 0 })), ...glyphs.map(g => ({ x: g.x, y: g.y, spare: GLYPH_ROOM - g.r }))];
      const nodes = structures.slice(1).filter(s => s.atoms.length === 1).map(s => {
        const { cls, r } = glyphOf(s.additionalInformation || {}, font), reach = tipped(cls) ? r * TIP : r;
        // r: room the forces keep around a drop. clear: centre to the nearest ligand atom, so the tip stops short
        // of it. band: centre to the middle of the ribbon, so the tip stays off it.
        return { s, cls, p: { ...s.atoms[0].coordinates }, dropR: r, r: r + (cls === 'water' ? 1.6 : 2.6),
          clear: reach + (tipped(cls) ? 6.5 : 6), band: reach + (tipped(cls) ? 2.9 : 3.4) };
      });
      for (const n of nodes) {
        const q = nearest(n.p), d = distance(n.p, q), excess = d - 30;
        if (excess > 0) { const k = excess * 0.45 / d; n.p.x -= (n.p.x - q.x) * k; n.p.y -= (n.p.y - q.y) * k; }
      }
      // The pocket ribbon is an obstacle and drops stay outside it. A point is inside when the ribbon runs beyond
      // it, seen from the nearest ligand atom, with none in between.
      const paths = data.overlay.contour.map(path => bowed(path.map(([x, y]) => ({ x, y })), glyphs)), ribbon = paths.flat();
      const held = p => {
        const q = nearest(p), l = distance(p, q) || 1, reach = l + 45, far = { x: q.x + (p.x - q.x) / l * reach, y: q.y + (p.y - q.y) / l * reach };
        const left = Math.min(q.x, far.x) - 3, right = Math.max(q.x, far.x) + 3, top = Math.min(q.y, far.y) - 3, bottom = Math.max(q.y, far.y) + 3;
        let before = 0, beyond = Infinity;
        for (const path of paths) for (let i = 1; i < path.length; i++) {
          const v = path[i];
          if (v.x < left || v.x > right || v.y < top || v.y > bottom) continue;
          const t = cut(q, far, path[i - 1], v);
          if (t === null) continue;
          if (t * reach < l) before++; else beyond = Math.min(beyond, t * reach);
        }
        return before % 2 === 0 && beyond < Infinity ? { q, l, beyond } : null;
      };
      for (const n of nodes) {
        const hold = held(n.p);
        if (!hold) continue;
        const k = (hold.beyond + n.band) / hold.l;
        n.p = { x: hold.q.x + (n.p.x - hold.q.x) * k, y: hold.q.y + (n.p.y - hold.q.y) * k };
      }
      // Sequence neighbours on the same side of the ligand drift together, as Maestro keeps them.
      const byId = new Map(nodes.map(n => [n.s.id, n]));
      const springs = (data.overlay.chainLinks || []).map(l => [byId.get(l.from), byId.get(l.to), l.gap])
        .filter(([a, b, gap]) => a && b && gap <= 4 && distance(a.p, b.p) < 60 && !ligand.some(q => segmentDistance(q, a.p, b.p) < 8));
      // Contact lines, so other drops can be moved off them.
      const end = (sid, id) => sid === 0 ? ligandById.get(id) : byId.get(sid)?.p;
      const lines = data.contacts.map(record => (data.scene.scene[record.type] || []).find(e => e.id === record.id))
        .filter(e => e && end(e.fromStructure, e.from) && end(e.toStructure, e.to))
        .map(e => [e.fromStructure, e.from, e.toStructure, e.to]);
      for (let pass = 0; pass < 160; pass++) {
        let moved = pass < 60;
        if (pass < 60) for (const [a, b, gap] of springs) {
          const l = distance(a.p, b.p), excess = l - (a.r + b.r + 7 + gap * 7);
          if (excess <= 0) continue;
          const k = excess * 0.03 / l, dx = (b.p.x - a.p.x) * k, dy = (b.p.y - a.p.y) * k;
          a.p.x += dx; a.p.y += dy; b.p.x -= dx; b.p.y -= dy;
        }
        for (const [sa, ia, sb, ib] of lines) {
          const p = end(sa, ia), q = end(sb, ib);
          for (const m of nodes) {
            if (m.s.id === sa || m.s.id === sb) continue;
            const gap = m.r + 1 - segmentDistance(m.p, p, q);
            if (gap <= 0) continue;
            const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
            let nx = -dy / l, ny = dx / l;
            if ((m.p.x - p.x) * nx + (m.p.y - p.y) * ny < 0) { nx = -nx; ny = -ny; }
            m.p.x += nx * gap * 0.5; m.p.y += ny * gap * 0.5; moved = true;
          }
        }
        for (const n of nodes) {
          for (const q of solid) {
            const l = distance(n.p, q), gap = n.clear - q.spare - l;
            if (gap <= 0) continue;
            n.p.x += (n.p.x - q.x) / (l || 1) * gap; n.p.y += (n.p.y - q.y) / (l || 1) * gap; moved = true;
          }
          const onRibbon = nearestOf(ribbon, n.p), off = onRibbon ? distance(n.p, onRibbon) : Infinity;
          if (off < n.band) {
            const k = n.band / (off || 1);
            n.p = { x: onRibbon.x + (n.p.x - onRibbon.x) * k, y: onRibbon.y + (n.p.y - onRibbon.y) * k }; moved = true;
          }
          for (const m of nodes) {
            if (m === n) continue;
            const l = distance(n.p, m.p), gap = n.r + m.r - l;
            if (gap <= 0) continue;
            const ux = l > 0.01 ? (n.p.x - m.p.x) / l : 1, uy = l > 0.01 ? (n.p.y - m.p.y) / l : 0;
            n.p.x += ux * gap / 2; n.p.y += uy * gap / 2; m.p.x -= ux * gap / 2; m.p.y -= uy * gap / 2; moved = true;
          }
        }
        if (!moved) break;
      }
      const ribbonReach = ribbon.reduce((far, q) => Math.max(far, gapTo(ligand, q)), 0);
      untangle(data, nodes, byId, { ribbon, lettering, inside: p => gapTo(ligand, p) < ribbonReach && held(p) !== null });
      for (const n of nodes) {
        if (distance(n.s.atoms[0].coordinates, n.p) > 0.01) H.move(data, n.s.id, n.p.x, n.p.y);
      }
    },

    draw(ctx) {
      const { el, hit, root, under, ligand, contacts, data, bg, theme } = ctx;
      const fills = DROPS[theme], ribbon = RIBBON[theme], ink = INK[theme];
      const font = fontOf();
      const layers = state.layers;
      const scene = data.scene.scene;
      for (const key of ['contour', 'smudges', 'halos', 'chain']) overlay[key]?.replaceChildren();
      const ligandAtoms = ligand.atoms.map(a => ({ atom: a, p: ctx.liveAtom(0, a.id) })).filter(a => a.p);
      const nearestAtom = p => ligandAtoms.reduce((a, b) => distance(p, a.p) <= distance(p, b.p) ? a : b);
      const lettering = letterLigand(ligand, id => ctx.liveAtom(0, id)), glyphs = [...lettering.values()].flatMap(l => l.glyphs);
      const visible = contacts.filter(c => c.visible);
      const defs = el('defs', {}, under);

      const drops = new Map();
      for (const s of ctx.partners) {
        if (!structureVisible(s.id)) continue;
        const p = ctx.liveAtoms(s.id)[0];
        if (!p) continue;
        drops.set(s.id, { s, x: p.x, y: p.y, tip: null, ...glyphOf(s.additionalInformation || {}, font) });
      }
      // The tip points at the ligand atom the residue interacts with, else at the nearest one.
      const target = new Map();
      for (const c of visible) {
        if (!c.a || c.record.ligandAtom === '' || target.has(c.record.structure)) continue;
        target.set(c.record.structure, c.a);
      }
      for (const drop of drops.values()) {
        if (!tipped(drop.cls) || !ligandAtoms.length) continue;
        const aim = target.get(drop.s.id) || nearestAtom(drop).p;
        const reach = distance(drop, aim) - 3;
        if (reach < drop.r * 1.1) continue;
        drop.tip = Math.atan2(aim.y - drop.y, aim.x - drop.x);
        drop.tipAngle = Math.acos(drop.r / Math.min(drop.r * TIP, reach));
      }
      const dropEdge = (drop, toward, gap = 0.8) => {
        const angle = Math.atan2(toward.y - drop.y, toward.x - drop.x), length = outline(drop, angle) + gap;
        return { x: drop.x + Math.cos(angle) * length, y: drop.y + Math.sin(angle) * length };
      };
      // A line ends just outside the lettering of its atom; at a bare carbon it only clears the bond end.
      const atomEdge = (p, toward, ring) => {
        if (ring) return p;
        const near = nearestAtom(p), box = distance(near.p, p) < 0.5 && lettering.get(near.atom.id)?.box;
        const length = distance(p, toward) || 1, ux = (toward.x - p.x) / length, uy = (toward.y - p.y) / length;
        const gap = !box ? 1.6 : 1.2 + Math.min(ux > 0 ? (box.right - p.x) / ux : ux < 0 ? (box.left - p.x) / ux : Infinity,
          uy > 0 ? (box.bottom - p.y) / uy : uy < 0 ? (box.top - p.y) / uy : Infinity);
        return { x: p.x + ux * gap, y: p.y + uy * gap };
      };

      // Solvent exposure: a soft grey halo behind each exposed ligand atom.
      if (layers.exposure) {
        const gradient = el('radialGradient', { id: 'sch-exposure' }, defs);
        el('stop', { offset: '0%', 'stop-color': ink.exposure, 'stop-opacity': theme === 'dark' ? 0.75 : 0.6 }, gradient);
        el('stop', { offset: '100%', 'stop-color': ink.exposure, 'stop-opacity': 0 }, gradient);
        for (const measurement of data.overlay.ligandAtoms) {
          if (!(measurement.sasa >= 2)) continue;
          const p = ctx.liveAtom(0, measurement.atom);
          if (p) el('circle', { cx: p.x, cy: p.y, r: 3.5 + Math.sqrt(measurement.sasa) * 1.5, fill: 'url(#sch-exposure)',
            stroke: 'none', class: 'sch-exposure', 'data-sasa': measurement.sasa }, under);
        }
      }

      // Pocket ribbon: the colour follows the nearest residues and blends between them.
      if (layers.contour) {
        const transform = ligandTransform();
        const residues = [...drops.values()].filter(d => d.cls !== 'water');
        const colorAt = p => {
          if (!residues.length) return ribbon.res_other;
          const ranked = residues.map(d => [ribbon[d.cls], distance(p, d)]).sort((a, b) => a[1] - b[1]);
          const near = ranked[0][1];
          return mix(ranked.filter(([, d]) => d < near + 14).map(([c, d]) => [c, Math.exp(-(d - near) / 3.2)]));
        };
        const band = el('g', { class: 'sch-ribbon', fill: 'none', 'stroke-width': 2.8, 'stroke-linecap': 'round' }, under);
        const covered = p => [...drops.values()].some(d => distance(p, d) < d.r + 1.2);
        for (const source of data.overlay.contour) {
          // Evenly spaced points, so the colour blends smoothly.
          const points = bowed(source.map(q => { const t = transform(q); return { x: t[0], y: t[1] }; }), glyphs);
          // The ribbon passes under drops; short stubs left between drops are dropped.
          const stretches = [[]];
          for (const p of points) {
            if (covered(p)) { if (stretches[stretches.length - 1].length) stretches.push([]); } else stretches[stretches.length - 1].push(p);
          }
          for (const run of stretches) {
            if (run.length * RIBBON_STEP < 22) continue;
            const colors = run.map(colorAt);
            for (let i = 1; i < run.length; i++) {
              const a = run[i - 1], b = run[i];
              el('path', { d: `M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`, stroke: colors[i] }, band);
            }
          }
        }
      }

      // Backbone: one smooth black line through each run of consecutive residues.
      if (layers.chain) {
        const links = data.overlay.chainLinks.filter(link => {
          const a = drops.get(link.from), b = drops.get(link.to);
          if (!a || !b || link.gap > 4 || distance(a, b) > 95) return false;
          if (ligandAtoms.some(atom => segmentDistance(atom.p, a, b) < 6)) return false;
          return ![...drops.values()].some(other => other !== a && other !== b && segmentDistance(other, a, b) < other.r + 0.5);
        });
        const next = new Map(links.map(l => [l.from, l])), incoming = new Set(links.map(l => l.to));
        const seen = new Set();
        for (const start of links.map(l => l.from).filter(id => !incoming.has(id)).concat(links.map(l => l.from))) {
          if (seen.has(start)) continue;
          const run = [start], gaps = [];
          for (let id = start; next.has(id) && !seen.has(id); id = next.get(id).to) { seen.add(id); gaps.push(next.get(id).gap); run.push(next.get(id).to); }
          seen.add(run[run.length - 1]);
          if (run.length < 2) continue;
          const segments = spline(run.map(id => drops.get(id)));
          const d = `M${segments[0][0].x},${segments[0][0].y}` + segments.map(([, p1, p2, p3]) =>
            `C${p1.x.toFixed(2)},${p1.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)} ${p3.x.toFixed(2)},${p3.y.toFixed(2)}`).join('');
          el('path', { d, fill: 'none', stroke: ink.backbone, 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'sch-backbone' }, under);
          segments.forEach((segment, i) => {
            const a = drops.get(run[i]), b = drops.get(run[i + 1]), l = distance(a, b) || 1;
            const t0 = Math.min(0.45, a.r / l), t1 = Math.max(0.55, 1 - b.r / l);
            for (let k = 1; k <= gaps[i]; k++) {
              const p = bezier(segment, t0 + (t1 - t0) * k / (gaps[i] + 1));
              el('circle', { cx: p.x, cy: p.y, r: 1.3, fill: ink.backbone, stroke: 'none', class: 'sch-backbone-gap' }, under);
            }
          });
        }
      }

      // The measured distance of the selected contact: a box beside its line, where ligand and drops leave most room.
      // Drawn after the drops so none covers it.
      const distances = [];
      const distanceLabel = (a, b, value, color) => {
        const text = `${value.toFixed(2)} Å`, half = { x: widthOf(text, NUMBER_SIZE, font) / 2 + 0.8, y: NUMBER_SIZE * CAP / 2 + 0.8 };
        const length = distance(a, b) || 1, nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
        const offset = Math.abs(nx) * half.x + Math.abs(ny) * half.y + 1.2;
        const reach = (p, q) => Math.hypot(Math.max(0, Math.abs(q.x - p.x) - half.x), Math.max(0, Math.abs(q.y - p.y) - half.y));
        const clearance = p => Math.min(...ligandAtoms.map(atom => reach(p, atom.p) - 3.5), ...glyphs.map(g => reach(p, g) - g.r),
          ...[...drops.values()].map(drop => reach(p, drop) - outline(drop, Math.atan2(p.y - drop.y, p.x - drop.x))));
        let best = null;
        for (const t of [0.5, 0.36, 0.64, 0.24, 0.76]) {
          for (const side of [-1, 1]) {
            const p = { x: a.x + (b.x - a.x) * t + side * nx * offset, y: a.y + (b.y - a.y) * t + side * ny * offset };
            const free = clearance(p);
            if (!best || free > best.free + 0.5) best = { ...p, free };
          }
          if (best.free >= 2) break;
        }
        distances.push({ x: best.x, y: best.y + NUMBER_SIZE * CAP / 2, text, color });
      };
      const HEAD = 4.4;
      const arrowHead = (tip, from, color, parent) => {
        const length = distance(tip, from) || 1, ux = (tip.x - from.x) / length, uy = (tip.y - from.y) / length;
        el('path', { d: `M${tip.x},${tip.y}L${tip.x - ux * HEAD - uy * 1.75},${tip.y - uy * HEAD + ux * 1.75}L${tip.x - ux * HEAD + uy * 1.75},${tip.y - uy * HEAD - ux * 1.75}Z`,
          fill: color, stroke: 'none' }, parent);
        return { x: tip.x - ux * (HEAD - 0.5), y: tip.y - uy * (HEAD - 0.5) };
      };

      // Interaction lines. Several contacts between the same two ends run side by side.
      const pairOf = c => {
        const edge = (scene[c.record.type] || []).find(e => e.id === c.record.id);
        return edge ? [`${edge.fromStructure}:${edge.from}`, `${edge.toStructure}:${edge.to}`].sort().join('|') : null;
      };
      const pairs = new Map();
      for (const c of visible) {
        const key = c.record.kind !== 'hydrophobic' && c.a && c.b && pairOf(c);
        if (key) pairs.set(key, [...pairs.get(key) || [], c.index]);
      }
      const ligandBonds = (ligand.bonds || []).map(b => ({ from: b.from, to: b.to, p: ctx.liveAtom(0, b.from), q: ctx.liveAtom(0, b.to) })).filter(b => b.p && b.q);
      const letters = [...lettering].map(([id, { box }]) => ({ id, box: { left: box.left - 0.4, right: box.right + 0.4, top: box.top - 0.4, bottom: box.bottom + 0.4 } }));
      for (const drop of drops.values()) {
        const box = { left: drop.x - drop.r, right: drop.x + drop.r, top: drop.y - drop.r, bottom: drop.y + drop.r };
        if (drop.tip != null) {
          const d = drop.r / Math.cos(drop.tipAngle), tx = drop.x + Math.cos(drop.tip) * d, ty = drop.y + Math.sin(drop.tip) * d;
          Object.assign(box, { left: Math.min(box.left, tx), right: Math.max(box.right, tx), top: Math.min(box.top, ty), bottom: Math.max(box.bottom, ty) });
        }
        drop.box = { left: box.left + 0.3, right: box.right - 0.3, top: box.top + 0.3, bottom: box.bottom - 0.3 };
      }
      const routes = [];
      for (const c of visible) {
        if (c.record.kind === 'hydrophobic' || !c.a || !c.b) continue;
        const edge = (scene[c.record.type] || []).find(e => e.id === c.record.id);
        const [sa, sb] = !edge ? [0, c.record.structure] : edge.toStructure === 0 ? [0, edge.fromStructure] : [edge.fromStructure, edge.toStructure];
        const dropA = sa === 0 ? null : drops.get(sa), dropB = sb === 0 ? null : drops.get(sb);
        if ((sa !== 0 && !dropA) || (sb !== 0 && !dropB)) continue;
        const ringA = sa === 0 && c.record.ligandAtom === 'ring', ringB = sb === 0 && c.record.ligandAtom === 'ring';
        let a = dropA ? dropEdge(dropA, c.b) : atomEdge(c.a, c.b, ringA);
        let b = dropB ? dropEdge(dropB, c.a) : atomEdge(c.b, c.a, ringB);
        const twins = pairs.get(pairOf(c)) || [];
        if (twins.length > 1) {
          const length = distance(a, b) || 1, offset = (twins.indexOf(c.index) - (twins.length - 1) / 2) * 2;
          // The normal is taken in a fixed half-plane so twins drawn in opposite directions still separate.
          const flip = b.y - a.y > 0 || (b.y === a.y && b.x < a.x) ? -1 : 1;
          const ox = -(b.y - a.y) / length * offset * flip, oy = (b.x - a.x) / length * offset * flip;
          a = { x: a.x + ox, y: a.y + oy }; b = { x: b.x + ox, y: b.y + oy };
        }
        const ligandId = !edge ? null : edge.toStructure === 0 ? edge.to : edge.fromStructure === 0 ? edge.from : null;
        const ring = (ringA || ringB) && (ligand.rings || []).find(r => r.id === ligandId);
        routes.push({ c, sa, sb, dropA, dropB, a, b, twin: twins.length > 1, control: null, points: [a, b],
          own: ring ? { ring: new Set(ring.atoms) } : { atom: ligandId } });
      }

      // A line that would cut a ligand bond, an atom label, a foreign drop or another line bows around it as a
      // quadratic curve, only when the curve leaves fewer conflicts than the straight line.
      const routeCost = (route, points) => {
        const segments = points.slice(1).map((q, i) => [points[i], q]), { own } = route;
        let cost = 0;
        for (const bond of ligandBonds) {
          if (own.atom != null && (bond.from === own.atom || bond.to === own.atom)) continue;
          if (own.ring && own.ring.has(bond.from) && own.ring.has(bond.to)) continue;
          if (segments.some(([p, q]) => crosses(p, q, bond.p, bond.q))) cost += 10;
        }
        for (const { id, box } of letters) {
          if (id !== own.atom && segments.some(([u, v]) => entersBox(u, v, box))) cost += 6;
        }
        for (const drop of drops.values()) {
          if (drop !== route.dropA && drop !== route.dropB && segments.some(([p, q]) => entersBox(p, q, drop.box))) cost += 10;
        }
        for (const other of routes) {
          if (other === route) continue;
          const lines = other.points.slice(1).map((q, i) => [other.points[i], q]);
          if (segments.some(([p, q]) => lines.some(([u, v]) => crosses(p, q, u, v)))) cost += 10;
        }
        return cost;
      };
      const quadratic = (a, control, b) => Array.from({ length: 17 }, (_, i) => {
        const t = i / 16, u = 1 - t;
        return { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y };
      });
      for (const route of routes) {
        if (route.twin) continue;
        const { a, b } = route, straight = routeCost(route, [a, b]);
        if (!straight) continue;
        // The curve's midpoint is searched on a coarse grid around the chord, then refined around the best one.
        const length = distance(a, b) || 1, ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
        let best = { cost: straight - 0.5 };
        const tryMidpoint = (bow, slide) => {
          if (Math.abs(bow) < length * 0.04) return;
          const w = { x: (a.x + b.x) / 2 - uy * bow + ux * slide, y: (a.y + b.y) / 2 + ux * bow + uy * slide };
          const control = { x: 2 * w.x - (a.x + b.x) / 2, y: 2 * w.y - (a.y + b.y) / 2 };
          const points = quadratic(a, control, b), cost = routeCost(route, points) + 2 * Math.hypot(bow, slide) / length;
          if (cost < best.cost) best = { cost, control, points, bow, slide };
        };
        for (let i = -10; i <= 10; i++) for (let j = -3; j <= 3; j++) tryMidpoint(i * length / 40, j * length / 20);
        if (best.control) {
          const { bow, slide } = best;
          for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) tryMidpoint(bow + i * length / 160, slide + j * length / 80);
        }
        if (best.control) Object.assign(route, { control: best.control, points: best.points });
      }

      for (const { c, sa, sb, dropA, dropB, control, ...route } of routes) {
        let { a, b } = route;
        const kind = c.record.kind;
        // Arrowheads follow the curve's end tangents.
        const towardA = control || a, towardB = control || b;
        const selected = c.index === ctx.selected;
        const color = kind === 'water' ? ink.hbond : ink[kind] || ctx.fg;
        const g = hit(el('g', { class: 'sch-contact', 'data-kind': kind }, under), c.index);
        const attrs = { fill: 'none', stroke: color, 'stroke-width': selected ? 1.7 : 0.85, 'stroke-linecap': 'round' };
        if (kind === 'hbond' || kind === 'water' || kind === 'halogen') {
          // Donor to acceptor; a water leg without a known direction points at the water.
          const direction = c.record.direction;
          const toB = direction === 'ligand->partner' ? sa === 0 : direction === 'partner->ligand' ? sb === 0
            : kind === 'water' ? (dropB?.cls === 'water' ? true : dropA?.cls === 'water' ? false : null) : null;
          // Two heads need the length of both; a shorter two-way bond stays a plain line.
          const both = direction === 'both' && distance(a, b) > 2 * HEAD + 2;
          if (toB === true || both) b = arrowHead(b, towardA, color, g);
          if (toB === false || both) a = arrowHead(a, towardB, color, g);
        } else if (kind === 'ionic') {
          const drop = dropB || dropA;
          const partnerNegative = drop?.cls === 'res_acidic';
          const startIsPartner = drop === dropA;
          const startNegative = startIsPartner ? partnerNegative : !partnerNegative;
          const gradient = el('linearGradient', { id: `sch-ionic-${c.index}`, gradientUnits: 'userSpaceOnUse', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, el('defs', {}, g));
          el('stop', { offset: '0%', 'stop-color': startNegative ? ink.negative : ink.positive }, gradient);
          el('stop', { offset: '100%', 'stop-color': startNegative ? ink.positive : ink.negative }, gradient);
          Object.assign(attrs, { stroke: `url(#sch-ionic-${c.index})`, 'stroke-width': selected ? 1.9 : 1.1 });
        } else if (kind === 'metal') {
          attrs['stroke-width'] = selected ? 1.9 : 1.1;
        } else if (kind === 'pi' || kind === 'cationPi') {
          attrs['stroke-width'] = selected ? 1.8 : 1;
        }
        const d = control ? `M${a.x},${a.y}Q${control.x.toFixed(2)},${control.y.toFixed(2)} ${b.x},${b.y}`
          : `M${a.x},${a.y}L${b.x + (Math.abs(b.x - a.x) < 0.01 ? 0.02 : 0)},${b.y + (Math.abs(b.y - a.y) < 0.01 ? 0.02 : 0)}`;
        el('path', { d, ...attrs, class: 'sch-contact-line' }, g);
        el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 7, 'pointer-events': 'stroke' }, g);
        if (selected) distanceLabel(a, b, c.distance, kind === 'ionic' ? ink.negative : color);
      }

      // Residue drops and water spheres.
      const label = (x, y, value, attrs, parent) => {
        const node = el('text', { x, y, 'text-anchor': 'middle', 'font-family': font, 'pointer-events': 'none', stroke: 'none', ...attrs }, parent);
        node.textContent = value;
        return node;
      };
      for (const [cls, [hi, body]] of Object.entries(fills)) {
        const gradient = el('radialGradient', { id: `sch-fill-${cls}`, cx: '38%', cy: '34%', r: '72%', fx: '32%', fy: '26%' }, defs);
        el('stop', { offset: '0%', 'stop-color': hi }, gradient);
        el('stop', { offset: cls === 'water' ? '55%' : '35%', 'stop-color': hi }, gradient);
        el('stop', { offset: '100%', 'stop-color': body }, gradient);
      }
      for (const drop of drops.values()) {
        const [, , stroke, text] = fills[drop.cls];
        const g = el('g', { class: `binding-residue sch-drop sch-${drop.cls}` }, root);
        g.dataset.structureId = drop.s.id;
        el('path', { d: dropPath(drop), fill: `url(#sch-fill-${drop.cls})`, stroke, 'stroke-width': 0.5, 'stroke-linejoin': 'round', class: 'sch-body' }, g);
        if (drop.cls === 'water') {
          const name = label(drop.x, drop.y + NUMBER_SIZE * CAP / 2, 'H', { 'font-size': NUMBER_SIZE, fill: text }, g);
          el('tspan', { 'font-size': SUBSCRIPT_SIZE, dy: 1 }, name).textContent = '2';
          el('tspan', { dy: -1 }, name).textContent = 'O';
          continue;
        }
        label(drop.x, drop.y + drop.top + NAME_SIZE * CAP, drop.name, { 'font-size': NAME_SIZE, fill: text }, g);
        label(drop.x, drop.y + drop.top + BLOCK, drop.number, { 'font-size': NUMBER_SIZE, fill: text }, g);
      }

      // Hydrophobic contacts have no line in Maestro; the drop tip is the cue. Selection shows the measurement.
      for (const c of visible) {
        if (c.record.kind !== 'hydrophobic') continue;
        const drop = drops.get(c.record.structure);
        if (!drop || !c.a) continue;
        const from = dropEdge(drop, c.a, 0), to = atomEdge(c.a, drop, false);
        const g = hit(el('g', { class: 'sch-apolar', 'data-kind': 'hydrophobic' }, under), c.index);
        const selected = c.index === ctx.selected;
        el('path', { d: `M${from.x},${from.y}L${to.x},${to.y}`, fill: 'none', stroke: selected ? ink.hydrophobic : 'transparent',
          'stroke-width': selected ? 1.3 : 0.6, 'stroke-dasharray': selected ? '0.2 2.6' : 'none', 'stroke-linecap': 'round', class: 'sch-apolar-line' }, g);
        el('path', { d: `M${from.x},${from.y}L${to.x},${to.y}`, fill: 'none', stroke: 'transparent', 'stroke-width': 6, 'pointer-events': 'stroke' }, g);
        if (selected) distanceLabel(from, to, c.distance, ink.hydrophobic);
      }
      for (const { x, y, text, color } of distances) {
        label(x, y, text, { 'font-size': NUMBER_SIZE, fill: color, stroke: bg, 'stroke-width': 2.2, 'paint-order': 'stroke', 'stroke-linejoin': 'round', class: 'sch-distance' }, root);
      }
    },

    // Maestro's legend in short words, only for what this diagram draws, nine entries at most.
    legend({ svgEl, theme, data, layers }) {
      const fills = DROPS[theme], ink = INK[theme];
      const icon = () => svgEl('svg', { class: 'swatch', viewBox: '0 0 22 10' });
      const stroke = (attrs, arrow, parent = icon()) => {
        svgEl('path', { d: `M1,5H${arrow ? 16 : 21}`, fill: 'none', 'stroke-width': 1.6, ...attrs }, parent);
        if (arrow) svgEl('path', { d: 'M14.5,1.6L21.5,5L14.5,8.4Z', fill: attrs.stroke, stroke: 'none' }, parent);
        return parent;
      };
      const shown = c => !state.hiddenKinds.has(kindOf(c)) && structureVisible(c.structure);
      const present = new Set(data.contacts.filter(shown).map(c => c.kind));
      const items = [];
      const classes = new Set(data.scene.scene.structures.filter(s => s.id && structureVisible(s.id)).map(s => dropClass(s.additionalInformation || {})));
      for (const [cls, text] of Object.entries(CLASS_LABELS)) {
        if (!classes.has(cls)) continue;
        const svg = icon();
        const gradient = svgEl('radialGradient', { id: `sch-legend-${cls}`, cx: '38%', cy: '34%', r: '72%', fx: '32%', fy: '26%' }, svgEl('defs', {}, svg));
        svgEl('stop', { offset: '0%', 'stop-color': fills[cls][0] }, gradient);
        svgEl('stop', { offset: '35%', 'stop-color': fills[cls][0] }, gradient);
        svgEl('stop', { offset: '100%', 'stop-color': fills[cls][1] }, gradient);
        const bead = cls === 'water' ? 3.6 : 4.5;
        const d = tipped(cls) ? 'M16.4,5L13.17,8.19A4.5,4.5 0 1 1 13.17,1.81Z'
          : `M${11 - bead},5a${bead},${bead} 0 1 0 ${2 * bead},0a${bead},${bead} 0 1 0 ${-2 * bead},0Z`;
        svgEl('path', { d, fill: `url(#sch-legend-${cls})`, stroke: fills[cls][2], 'stroke-width': 0.5 }, svg);
        items.push([cls, svg, text]);
      }
      if (present.has('hbond') || present.has('water')) items.push(['hbond', stroke({ stroke: ink.hbond }, true), 'H-bond']);
      if (present.has('halogen')) items.push(['halogen', stroke({ stroke: ink.halogen }, true), 'Halogen bond']);
      if (present.has('metal')) items.push(['coordination', stroke({ stroke: ink.metal }), 'Coordination']);
      if (present.has('pi')) items.push(['pi', stroke({ stroke: ink.pi }), 'Pi-Pi']);
      if (present.has('cationPi')) items.push(['cationPi', stroke({ stroke: ink.cationPi }), 'Pi-cation']);
      if (present.has('ionic')) {
        const svg = icon();
        const gradient = svgEl('linearGradient', { id: 'sch-legend-ionic', gradientUnits: 'userSpaceOnUse', x1: 1, y1: 5, x2: 21, y2: 5 }, svgEl('defs', {}, svg));
        svgEl('stop', { offset: '0%', 'stop-color': ink.negative }, gradient);
        svgEl('stop', { offset: '100%', 'stop-color': ink.positive }, gradient);
        svgEl('path', { d: 'M1,5L21,5.02', fill: 'none', stroke: 'url(#sch-legend-ionic)', 'stroke-width': 1.8 }, svg);
        items.push(['ionic', svg, 'Salt bridge']);
      }
      if (layers.exposure && data.overlay.ligandAtoms.some(measurement => measurement.sasa >= 2)) {
        const svg = icon();
        svgEl('circle', { cx: 11, cy: 5, r: 4.5, fill: ink.exposure, 'fill-opacity': 0.45, stroke: 'none' }, svg);
        items.push(['exposure', svg, 'Exposed']);
      }
      // Past nine, the beads that print what they are give way first, then the rarest marks.
      for (const key of ['water', 'metal', 'res_other', 'res_glycine', 'exposure', 'halogen']) {
        const at = items.length > 9 ? items.findIndex(item => item[0] === key) : -1;
        if (at >= 0) items.splice(at, 1);
      }
      return items.map(([, svg, text]) => [svg, text]);
    },
  };
})();
