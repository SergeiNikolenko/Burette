'use strict';

// PoseEdit grammar (ProteinsPlus): ligand and residue fragments share one chemical drawing,
// polar hydrogens are explicit at the donor end of every H-bond, charges are circled signs,
// hydrophobic contacts are green splines along the ligand with stacked green residue names.
// Sized for a side panel that shows 1.7 to 2 px per drawing unit: no label under 5.3 units,
// residue names 5.8, strokes of 0.8 to 1 unit.
(() => {
  const ID = document.currentScript.src.split('/').pop().replace(/\.js.*$/, '');
  const FONT = 'DejaVu Sans, Verdana, sans-serif';
  // One colour per interaction type, as in the library behind PoseEdit (blue, magenta, yellow, turquoise, lime, green),
  // deepened or lightened until each reads on its background; the metal yellow is an amber so it is not the sulfur yellow.
  const PALETTE = {
    light: { hbond: '#3d7bf7', ionic: '#d900d9', metal: '#b7791f', pi: '#0e9c9c', cationPi: '#6b9a16', halogen: '#e8590c',
      water: '#3d7bf7', hydrophobic: '#019a4d', metalAtom: '#555555', muted: '#666666', ...MOLSTAR_CONTACTS },
    dark: { hbond: '#7fa8ff', ionic: '#ff6bff', metal: '#f5b041', pi: '#4dd6d6', cationPi: '#b5e05a', halogen: '#ff8a50',
      water: '#7fa8ff', hydrophobic: '#4cc47f', metalAtom: '#bdbdbd', muted: '#a1a1aa', ...MOLSTAR_CONTACTS },
  };
  // In drawing units, for a ligand bond of 10. PoseEdit itself draws finer (stroke 0.05 and label 0.35 of a bond);
  // these are the smallest weights and sizes that still read in the panel.
  const BOND = 10, STROKE = 0.45, CONTACT = 0.55, SIZE = 5.4, NAME = 5.8, SUB = 3.9;
  const DASH_ON = 2.4, DASH_GAP = 1.5, RING_DASH = '1.5 1.1';
  const palette = theme => PALETTE[theme === 'dark' ? 'dark' : 'light'];
  const mean = points => ({ x: points.reduce((n, p) => n + p.x, 0) / points.length, y: points.reduce((n, p) => n + p.y, 0) / points.length });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l, l }; };
  const along = (p, u, d) => ({ x: p.x + u.x * d, y: p.y + u.y * d });
  const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const median = values => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
  const turn = (p, centre, angle, shrink = 1) => {
    const cos = Math.cos(angle) * shrink, sin = Math.sin(angle) * shrink, x = p.x - centre.x, y = p.y - centre.y;
    return { x: centre.x + x * cos - y * sin, y: centre.y + x * sin + y * cos };
  };
  const crosses = (p, q, r, s) => {
    const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
    return t > 0 && t < 1 && u > 0 && u < 1;
  };
  const gapTo = (p, q, c) => {
    const u = unit(p, q), t = Math.max(0, Math.min(u.l, (c.x - p.x) * u.x + (c.y - p.y) * u.y));
    return dist(c, along(p, u, t));
  };
  // DejaVu Sans advance widths per em (Verdana, its fallback on macOS, is within a few percent),
  // so glyphs abut without overlapping and label boxes match what is drawn
  const ADVANCE = { H: 0.752, N: 0.748, O: 0.787, C: 0.698, R: 0.695, P: 0.603, S: 0.635, Z: 0.685, F: 0.575, B: 0.686, I: 0.295,
    A: 0.684, G: 0.775, L: 0.557, M: 0.863, T: 0.611, V: 0.684, Y: 0.611, K: 0.656, W: 0.989, D: 0.77, E: 0.632, Q: 0.787, U: 0.732,
    a: 0.613, c: 0.55, d: 0.635, e: 0.615, g: 0.635, h: 0.634, i: 0.278, l: 0.278, n: 0.634, o: 0.612, p: 0.635, r: 0.411, s: 0.521,
    t: 0.392, u: 0.634, y: 0.592, ' ': 0.318, '.': 0.318, 'Å': 0.684 };
  const advance = ch => ADVANCE[ch] ?? (ch >= '0' && ch <= '9' ? 0.636 : 0.62);
  const width = (value, size) => [...value].reduce((n, ch) => n + advance(ch), 0) * size;
  const title = value => value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : '';
  const residueLabel = (name, number, chain) => `${title(name)}${number ?? ''}${chain || ''}`;
  const pathOf = points => points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const curveOf = points => {
    if (points.length < 3) return pathOf(points);
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const next = i === points.length - 2 ? points[i + 1] : mean([points[i], points[i + 1]]);
      d += ` Q${points[i].x},${points[i].y} ${next.x},${next.y}`;
    }
    return d;
  };
  // points along curveOf, each tagged with the control-point segment it belongs to
  const sampleCurve = points => {
    if (points.length < 3) return points.map((p, i) => ({ ...p, segment: Math.max(0, i - 1) }));
    const out = [{ ...points[0], segment: 0 }];
    let start = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      const c = points[i], end = i === points.length - 2 ? points[i + 1] : mean([points[i], points[i + 1]]);
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, s = 1 - t;
        out.push({ x: s * s * start.x + 2 * s * t * c.x + t * t * end.x, y: s * s * start.y + 2 * s * t * c.y + t * t * end.y, segment: t <= 0.5 ? i - 1 : i });
      }
      start = end;
    }
    return out;
  };
  // a dashed line always starts and ends on a dash, however short it is
  const dashFor = length => {
    const n = Math.max(2, Math.round((length + DASH_GAP) / (DASH_ON + DASH_GAP)));
    const gap = Math.min(DASH_GAP, length / (2 * n - 1));
    return `${Math.max(0.3, (length - (n - 1) * gap) / n).toFixed(2)} ${gap.toFixed(2)}`;
  };

  // ---- the scene as drawn: molecules at their live coordinates, residue fragments shrunk to the ligand's bond
  //      length around their contact atoms, and the polar contacts between them
  const labelledAtom = atom => atom.label === 'R' || atom.element !== 'C';
  const build = (data, coordOf, visible, contacts) => {
    const scene = data.scene.scene;
    const byId = new Map(scene.structures.map(s => [s.id, s]));
    const edgeOf = record => record.type === 'hydrophobicContacts' ? null : (scene[record.type] || []).find(e => e.id === record.id);
    const ringAtoms = (sid, id) => (byId.get(sid)?.rings || []).find(r => r.id === id)?.atoms || [];
    const endsOf = (record, edge) => {
      const pi = record.type === 'piStackings';
      return [{ sid: edge.fromStructure, id: edge.from, ring: pi || record.type === 'cationPiStackings' }, { sid: edge.toStructure, id: edge.to, ring: pi }];
    };
    const anchorsOf = new Map();
    for (const c of contacts) {
      const edge = edgeOf(c.record);
      if (!edge) continue;
      for (const e of endsOf(c.record, edge)) {
        if (!anchorsOf.has(e.sid)) anchorsOf.set(e.sid, []);
        anchorsOf.get(e.sid).push(...(e.ring ? ringAtoms(e.sid, e.id) : [e.id]));
      }
    }
    const bondLength = s => median((s.bonds || []).map(b => {
      const a = coordOf(s.id, b.from), c = coordOf(s.id, b.to);
      return a && c ? dist(a, c) : NaN;
    }).filter(Number.isFinite));
    const ligandBond = bondLength(byId.get(0)) || BOND;
    const molecules = new Map();
    for (const s of scene.structures) {
      if (s.id !== 0 && !visible(s.id)) continue;
      const info = s.additionalInformation || {};
      const kind = s.id === 0 ? 'ligand' : info.class === 'water' ? 'water' : info.class === 'metal' ? 'metal' : 'fragment';
      const live = new Map(s.atoms.map(a => [a.id, coordOf(s.id, a.id) || a.coordinates]));
      let scale = 1, anchor = null;
      if (kind === 'fragment') {
        const own = bondLength(s);
        scale = own ? Math.min(1, ligandBond / own) : 1;
        const ids = (anchorsOf.get(s.id) || []).filter(id => live.has(id));
        anchor = ids.length ? mean(ids.map(id => live.get(id))) : mean([...live.values()]);
      }
      // prepare() may have turned or shrunk the fragment about its anchor; that pose is kept beside the scene
      const turned = { angle: 0, shrink: 1, ...(kind === 'fragment' && data.studyLayout?.poses?.[s.id]) };
      const atoms = new Map(s.atoms.map(atom => {
        const q = live.get(atom.id);
        const p = anchor ? turn({ x: anchor.x + (q.x - anchor.x) * scale, y: anchor.y + (q.y - anchor.y) * scale }, anchor, turned.angle, turned.shrink) : { x: q.x, y: q.y };
        return [atom.id, { atom, p, neighbours: [], explicit: [] }];
      }));
      for (const bond of s.bonds || []) {
        const a = atoms.get(bond.from), b = atoms.get(bond.to);
        if (a && b) { a.neighbours.push(b); b.neighbours.push(a); }
      }
      const center = mean([...atoms.values()].map(a => a.p));
      molecules.set(s.id, { s, info, kind, atoms, anchor, center, turned, home: anchor || center });
    }
    const links = [];
    for (const c of contacts) {
      if (!c.visible || c.record.kind === 'hydrophobic') continue;
      const edge = edgeOf(c.record);
      if (!edge || !molecules.has(edge.fromStructure) || !molecules.has(edge.toStructure)) continue;
      const ends = endsOf(c.record, edge);
      const keys = new Set(ends.flatMap(e => (e.ring ? ringAtoms(e.sid, e.id) : [e.id]).map(id => `${e.sid}:${id}`)));
      links.push({ ends, keys, sids: new Set(ends.map(e => e.sid)), kind: c.record.kind });
    }
    return { molecules, links, edgeOf, scaleBy: ligandBond / BOND };
  };

  // ---- crossings and overlaps of the arrangement, kept current while molecules are moved
  const solverOf = ({ molecules, links }) => {
    const endPoint = e => {
      const m = molecules.get(e.sid);
      if (!e.ring) return m.atoms.get(e.id)?.p;
      const pts = ((m.s.rings || []).find(r => r.id === e.id)?.atoms || []).map(id => m.atoms.get(id)?.p).filter(Boolean);
      return pts.length ? mean(pts) : null;
    };
    const inkOf = m => {
      const key = id => `${m.s.id}:${id}`, segs = [], discs = [];
      for (const b of m.s.bonds || []) {
        const A = m.atoms.get(b.from), B = m.atoms.get(b.to);
        if (!A || !B) continue;
        const u = unit(A.p, B.p);
        const p = labelledAtom(A.atom) ? along(A.p, u, SIZE * 0.5) : A.p, q = labelledAtom(B.atom) ? along(B.p, u, -SIZE * 0.5) : B.p;
        segs.push({ p, q, keys: [key(b.from), key(b.to)] });
      }
      for (const a of m.atoms.values()) if (m.kind !== 'fragment' || labelledAtom(a.atom)) discs.push({ c: a.p, r: SIZE * 0.6, key: key(a.atom.id) });
      const all = [...segs.flatMap(s => [s.p, s.q]), ...discs.map(d => d.c)];
      const box = { x0: Math.min(...all.map(p => p.x)) - SIZE, x1: Math.max(...all.map(p => p.x)) + SIZE,
        y0: Math.min(...all.map(p => p.y)) - SIZE, y1: Math.max(...all.map(p => p.y)) + SIZE };
      return { m, segs, discs, box };
    };
    const near = (box, p, q) => Math.max(p.x, q.x) >= box.x0 && Math.min(p.x, q.x) <= box.x1 && Math.max(p.y, q.y) >= box.y0 && Math.min(p.y, q.y) <= box.y1;
    const boxesMeet = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    // how often a segment runs through an ink set, ignoring the pieces that belong to its own endpoints
    const hits = (p, q, ink, skip) => {
      if (!near(ink.box, p, q)) return 0;
      let n = 0;
      for (const s of ink.segs) if (!s.keys.some(k => skip.has(k)) && crosses(p, q, s.p, s.q)) n++;
      for (const d of ink.discs) if (!skip.has(d.key) && gapTo(p, q, d.c) < d.r) n++;
      return n;
    };
    const drawn = new Map();
    const NONE = new Set();
    const span = l => { l.p = endPoint(l.ends[0]); l.q = endPoint(l.ends[1]); };
    for (const l of links) l.shares = new Set(links.filter(o => o !== l && [...o.keys].some(k => l.keys.has(k))));
    const linksOf = members => links.filter(l => members.some(o => l.sids.has(o.s.id)));
    // call after moving atoms: redraws the ink of these molecules and the lines that end on them
    const refresh = (members, touched = linksOf(members)) => {
      for (const o of members) drawn.set(o.s.id, inkOf(o));
      touched.forEach(span);
    };
    refresh([...molecules.values()], links);
    const localCost = (m, ink) => {
      let cost = 0;
      for (const l of links) {
        const { p, q } = l;
        if (!p || !q) continue;
        if (!l.sids.has(m.s.id)) { cost += 10 * hits(p, q, ink, l.keys); continue; }
        for (const other of drawn.values()) {
          if (other.m === m) cost += 2 * hits(p, q, ink, l.keys);
          else cost += 10 * hits(p, q, other, l.sids.has(other.m.s.id) ? l.keys : NONE);
        }
        for (const o of links) if (o !== l && o.p && o.q && !l.shares.has(o) && crosses(p, q, o.p, o.q)) cost += 10;
      }
      for (const other of drawn.values()) {
        if (other.m === m || !boxesMeet(ink.box, other.box)) continue;
        for (const s of ink.segs) cost += 10 * hits(s.p, s.q, other, NONE);
        for (const d of ink.discs) {
          for (const s of other.segs) if (gapTo(s.p, s.q, d.c) < d.r) cost += 10;
          for (const e of other.discs) if (dist(d.c, e.c) < d.r + e.r) cost += 10;
        }
      }
      return cost;
    };
    const costOf = members => members.reduce((n, o) => n + localCost(o, drawn.get(o.s.id)), 0);
    const movable = [...molecules.values()].filter(m => m.kind === 'fragment' || m.kind === 'water');
    // a water carries along the residues that only it holds, so its bridge keeps its shape
    const ridersOf = m => m.kind !== 'water' ? [] : movable.filter(o => o.kind === 'fragment'
      && links.some(l => l.sids.has(o.s.id)) && links.every(l => !l.sids.has(o.s.id) || l.sids.has(m.s.id)));
    const shift = (members, dx, dy, touched) => {
      for (const o of members) {
        for (const a of o.atoms.values()) a.p = { x: a.p.x + dx, y: a.p.y + dy };
        if (o.anchor) o.anchor = { x: o.anchor.x + dx, y: o.anchor.y + dy };
        o.center = { x: o.center.x + dx, y: o.center.y + dy };
      }
      refresh(members, touched);
    };
    // a fragment turns, and if that is not enough shrinks, about its contact anchor until no contact line runs
    // through foreign ink and the fragment clears the ligand and its neighbours; only when turning cannot clear it,
    // the fragment (or a water) moves the shortest distance to a spot where its lines cross nothing
    const untangle = () => {
      for (let pass = 0; pass < 2; pass++) for (const m of movable) {
        const members = [m, ...ridersOf(m)], touched = linksOf(members);
        const cost = costOf(members);
        if (!cost) continue;
        const base = new Map(members.map(o => [o, new Map([...o.atoms].map(([id, a]) => [id, { ...a.p }]))]));
        const pivot = m.anchor || m.center;
        const moved = (o, p, { angle, shrink, dx, dy }) => {
          const q = o === m ? turn(p, pivot, angle, shrink) : p;
          return { x: q.x + dx, y: q.y + dy };
        };
        const pose = candidate => {
          for (const o of members) for (const [id, a] of o.atoms) a.p = moved(o, base.get(o).get(id), candidate);
          refresh(members, touched);
          return costOf(members);
        };
        const still = { angle: 0, shrink: 1, dx: 0, dy: 0 };
        let best = { ...still, cost, score: cost };
        const consider = candidate => {
          const crossings = pose(candidate);
          const score = crossings + angleDiff(candidate.angle, 0) * 1.2 + (1 - candidate.shrink) * 6 + Math.hypot(candidate.dx, candidate.dy) * 0.2;
          if (score < best.score) best = { ...candidate, cost: crossings, score };
        };
        if (m.kind === 'fragment') for (const shrink of [1, 0.85, 0.7]) for (let step = 0; step < 24; step++) {
          consider({ ...still, angle: step * Math.PI / 12, shrink });
        }
        if (best.cost) {
          const { angle, shrink } = best;
          for (const reach of [1.5, 3, 5, 8, 12, 16, 20, 25, 30, 36, 42]) for (let step = 0; step < 16; step++) {
            consider({ ...still, angle, shrink, dx: Math.cos(step * Math.PI / 8) * reach, dy: Math.sin(step * Math.PI / 8) * reach });
          }
        }
        pose(best);
        m.turned = { angle: m.turned.angle + best.angle, shrink: m.turned.shrink * best.shrink };
        for (const o of members) {
          if (o.anchor) o.anchor = moved(o, o.anchor, { ...best, angle: 0, shrink: 1 });
          o.center = mean([...o.atoms.values()].map(a => a.p));
        }
      }
    };
    return { untangle, costOf, shift, refresh, linksOf, movable, ridersOf, ink: m => drawn.get(m.s.id) };
  };

  // a redraw that moved nothing (a selection, the theme) reuses the arrangement instead of searching again
  let settled = { key: null, places: null };
  const settle = (model, solver) => {
    const all = [...model.molecules.values()];
    const key = all.map(m => `${m.s.id}:${[...m.atoms.values()].map(a => `${a.p.x.toFixed(2)},${a.p.y.toFixed(2)}`).join(' ')}`).join('|')
      + '#' + model.links.map(l => [...l.keys].join('~')).join('|');
    if (settled.key !== key) {
      solver.untangle();
      settled = { key, places: new Map(all.map(m => [m.s.id,
        { anchor: m.anchor, center: m.center, turned: m.turned, atoms: new Map([...m.atoms].map(([id, a]) => [id, a.p])) }])) };
      return;
    }
    for (const m of all) {
      const place = settled.places.get(m.s.id);
      for (const [id, a] of m.atoms) a.p = place.atoms.get(id);
      Object.assign(m, { anchor: place.anchor, center: place.center, turned: place.turned });
    }
    solver.refresh(all, model.links);
  };

  // ---- the whole drawing. draw() runs it on the live scene; prepare() runs it on the pipeline scene with a blank
  //      canvas, to learn where every name lands before anything is shown
  const compose = env => {
    const { el, hit, root, bg, fg, data } = env;
    const P = palette(env.theme);
    const scene = data.scene.scene;
    const font = styleOf().fontFamily || FONT;
    const inks = atomColors();
    const ink = element => element === 'C' ? fg : inks[element.toUpperCase()] || inks[element] || fg;
    // a tall frame is short of width, a wide one of height: labels avoid growing the drawing that way
    const tall = window.lid?.state.orientation === 'portrait';
    root.setAttribute('data-study', 'poseedit');
    const layerLines = el('g', { class: 'pe-contacts' });
    const layerMolecules = el('g', { class: 'pe-molecules' });
    // every text carries a background rim, so it stays legible where a line passes close by
    const write = (x, y, value, size, fill, parent, attrs = {}) => env.text(x, y + size * 0.36, value,
      { 'text-anchor': 'middle', 'font-size': size, 'font-family': font, fill, stroke: bg, 'stroke-width': 1.3, 'paint-order': 'stroke',
        'stroke-linejoin': 'round', ...attrs }, parent);
    const stroke = (a, b, color, parent, attrs = {}) => el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color,
      'stroke-width': STROKE, 'stroke-linecap': 'round', ...attrs }, parent);

    // ---- occupancy of everything actually drawn, in a coarse grid so a label can test thousands of spots
    const occupied = [], grid = new Map(), CELL = 8;
    const cellsOf = (box, visit) => {
      for (let i = Math.floor(box.x0 / CELL); i <= Math.floor(box.x1 / CELL); i++) for (let j = Math.floor(box.y0 / CELL); j <= Math.floor(box.y1 / CELL); j++) visit(i * 8192 + j);
    };
    const claim = (box, weight = 1) => {
      const entry = { ...box, weight, seen: 0 };
      occupied.push(entry);
      cellsOf(entry, key => { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(entry); });
    };
    const boxAt = (x, y, w, h) => ({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 });
    const occupy = (x, y, w, h, weight = 1) => claim(boxAt(x, y, w, h), weight);
    const occupySegment = (a, b, size, weight = 1) => {
      const n = Math.max(1, Math.ceil(dist(a, b) / (size * 0.9)));
      for (let i = 0; i <= n; i++) occupy(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, size, size, weight);
    };
    const shared = (box, b) => {
      const ox = Math.min(box.x1, b.x1) - Math.max(box.x0, b.x0), oy = Math.min(box.y1, b.y1) - Math.max(box.y0, b.y0);
      return ox > 0 && oy > 0 ? ox * oy * b.weight : 0;
    };
    let query = 0;
    const overlap = box => {
      let sum = 0;
      query++;
      cellsOf(box, key => {
        for (const b of grid.get(key) || []) if (b.seen !== query) { b.seen = query; sum += shared(box, b); }
      });
      return sum;
    };

    const model = build(data, env.liveAtom, env.visible, env.contacts);
    const { molecules, edgeOf, scaleBy } = model;
    const solver = solverOf(model);
    settle(model, solver);
    const ligand = molecules.get(0);
    for (const m of molecules.values()) {
      const { info } = m;
      m.name = m.kind === 'water' || m.kind === 'metal' ? `${info.number ?? ''}${info.chainLabel || ''}`
        : info.name ? residueLabel(info.name, info.number, info.chainLabel) : m.s.structureLabel || m.s.structureName || '';
    }

    // ---- what each atom shows as text
    const labelled = a => labelledAtom(a.atom);
    const mainOf = a => a.atom.label === 'R' ? 'R' : a.atom.element[0].toUpperCase() + a.atom.element.slice(1).toLowerCase();
    const fillOf = (a, m) => m.kind === 'metal' ? P.metalAtom : a.atom.label === 'R' ? P.muted : ink(a.atom.element);

    // ---- resolved contact ends
    const endOf = (sid, id, ring) => {
      const m = molecules.get(sid);
      if (!m) return null;
      if (ring) {
        const members = (m.s.rings || []).find(r => r.id === id)?.atoms.map(a => m.atoms.get(a)?.p).filter(Boolean);
        return members?.length ? { sid, ring: true, p: mean(members), m } : null;
      }
      const a = m.atoms.get(id);
      return a ? { sid, id, ring: false, p: a.p, a, m } : null;
    };
    const polar = [];
    const hydrophobic = [];
    for (const c of env.contacts) {
      if (!c.visible) continue;
      const record = c.record;
      if (record.kind === 'hydrophobic') { hydrophobic.push(c); continue; }
      const edge = edgeOf(record);
      if (!edge) continue;
      const a = endOf(edge.fromStructure, edge.from, record.type === 'piStackings' || record.type === 'cationPiStackings');
      const b = endOf(edge.toStructure, edge.to, record.type === 'piStackings');
      if (a && b) polar.push({ c, record, a, b });
    }

    // ---- donors carry explicit hydrogens pointing to their acceptors
    const canDonate = end => !end.ring && end.m.kind !== 'water' && end.m.kind !== 'metal' && ['N', 'O', 'S'].includes(end.a.atom.element);
    const donorOf = k => {
      const { record, a, b } = k;
      if (!['hbond', 'water'].includes(record.kind)) return null;
      if (record.kind === 'hbond' && (record.direction === 'ligand->partner' || record.direction === 'partner->ligand')) {
        const ligandEnd = a.sid === 0 ? a : b.sid === 0 ? b : null;
        if (ligandEnd) {
          const donor = record.direction === 'ligand->partner' ? ligandEnd : ligandEnd === a ? b : a;
          return canDonate(donor) ? donor : null;
        }
      }
      // without an explicit direction only an N–H, or the only end that carries hydrogens, donates
      const hydrogens = end => canDonate(end) ? end.a.atom.hydrogenCount || 0 : 0;
      for (const [end, other] of [[a, b], [b, a]]) {
        if (!hydrogens(end)) continue;
        if (end.a.atom.element === 'N' && !(other.a?.atom.element === 'N' && hydrogens(other))) return end;
        if (record.kind === 'hbond' && !hydrogens(other)) return end;
      }
      return null;
    };
    const donors = new Map();
    for (const k of polar) {
      const donor = donorOf(k);
      if (!donor) continue;
      k.donor = donor;
      k.acceptor = donor === k.a ? k.b : k.a;
      const key = `${donor.sid}:${donor.id}`;
      if (!donors.has(key)) donors.set(key, { end: donor, contacts: [] });
      donors.get(key).contacts.push(k);
    }
    const idealAngles = a => {
      const dirs = [...a.neighbours.map(n => Math.atan2(n.p.y - a.p.y, n.p.x - a.p.x)), ...a.explicit.map(h => h.angle)];
      if (!dirs.length) return [...Array(12)].map((_, i) => i * Math.PI / 6);
      if (dirs.length === 1) return [dirs[0] + 2 * Math.PI / 3, dirs[0] - 2 * Math.PI / 3, dirs[0] + Math.PI];
      const sorted = [...dirs].sort((x, y) => x - y);
      const out = [];
      sorted.forEach((d, i) => {
        const next = i === sorted.length - 1 ? sorted[0] + 2 * Math.PI : sorted[i + 1];
        if (next - d > Math.PI * 0.55) out.push((d + next) / 2);
        if (next - d > Math.PI * 1.2) out.push(d + (next - d) / 3, d + (next - d) * 2 / 3);
      });
      return out.length ? out : [sorted[0] + Math.PI];
    };
    for (const { end, contacts } of donors.values()) {
      const a = end.a;
      const slots = Math.max(1, a.atom.hydrogenCount || 0);
      const byDistance = [...contacts].sort((x, y) => dist(x.acceptor.p, a.p) - dist(y.acceptor.p, a.p));
      for (const k of byDistance) {
        const toward = Math.atan2(k.acceptor.p.y - a.p.y, k.acceptor.p.x - a.p.x);
        const shared = a.explicit.find(h => angleDiff(h.angle, toward) < Math.PI / 3.2);
        if (shared || a.explicit.length >= slots) {
          k.h = shared || a.explicit.reduce((x, y) => angleDiff(x.angle, toward) < angleDiff(y.angle, toward) ? x : y);
          continue;
        }
        // straight at the acceptor when that is clear of the atom's bonds and of its neighbours' labels,
        // otherwise the free position nearest to that direction
        const room = t => Math.min(Math.PI, ...a.neighbours.map(n => angleDiff(Math.atan2(n.p.y - a.p.y, n.p.x - a.p.x), t) - (labelled(n) ? 0.87 : 0.52)),
          ...a.explicit.map(h => angleDiff(h.angle, t) - Math.PI / 3));
        const options = [toward, ...idealAngles(a)];
        const free = options.filter(t => room(t) >= 0);
        const angle = free.length ? free.reduce((x, y) => angleDiff(x, toward) <= angleDiff(y, toward) ? x : y) : options.reduce((x, y) => room(x) >= room(y) ? x : y);
        const h = { angle, p: along(a.p, { x: Math.cos(angle), y: Math.sin(angle) }, BOND * 0.75 * scaleBy) };
        a.explicit.push(h);
        k.h = h;
      }
    }

    // ---- implicit hydrogens go to the side that is free of bonds and contact lines; a metal-bound atom shows none.
    //      A water is written out as H₂O (or OH₂ when its lines arrive from the left), so it reads as water at a glance.
    const contactDirs = new Map();
    for (const k of polar) for (const [end, other] of [[k.a, k.b], [k.b, k.a]]) {
      if (end.ring || !end.a) continue;
      if (k.record.kind === 'metal') end.a.metalBound = true;
      if (!contactDirs.has(end.a)) contactDirs.set(end.a, []);
      contactDirs.get(end.a).push(unit(end.a.p, (end === k.acceptor && k.h ? k.h.p : other.p)));
    }
    const SIDES = [{ x: 1, y: 0, cost: 0 }, { x: -1, y: 0, cost: 0.04 }, { x: 0, y: 1, cost: 0.12 }, { x: 0, y: -1, cost: 0.14 }];
    const WATER_SIDES = [{ x: -1, y: 0, cost: 0 }, { x: 1, y: 0, cost: 0.25 }];
    for (const m of molecules.values()) for (const a of m.atoms.values()) {
      a.implicit = m.kind === 'water' ? 2 : m.kind === 'metal' || a.metalBound ? 0 : Math.max(0, (a.atom.hydrogenCount || 0) - a.explicit.length);
      if (!labelled(a) || !a.implicit || a.atom.element === 'C') continue;
      const dirs = [...a.neighbours.map(n => unit(a.p, n.p)), ...a.explicit.map(h => ({ x: Math.cos(h.angle), y: Math.sin(h.angle) })),
        ...(contactDirs.get(a) || [])];
      a.side = (m.kind === 'water' ? WATER_SIDES : SIDES).reduce((best, side) => {
        const cost = Math.max(-1, ...dirs.map(d => d.x * side.x + d.y * side.y)) + side.cost;
        return !best || cost < best.cost ? { ...side, cost } : best;
      }, null);
    }
    const clearance = (a, dir) => {
      if (!labelled(a)) return 0;
      let c = Math.max(SIZE * 0.5, width(mainOf(a), SIZE) * 0.47);
      if (a.side) c += Math.max(0, dir.x * a.side.x + dir.y * a.side.y) * SIZE * (a.implicit > 1 ? 1.2 : 0.75);
      return c;
    };

    // ---- molecules
    const groups = new Map();
    const isAromatic = (m, ring) => {
      if (![5, 6].includes(ring.atoms.length)) return false;
      const inRings = new Set((m.s.rings || []).flatMap(r => r.atoms));
      let lonePairs = 0;
      for (const id of ring.atoms) {
        const double = (m.s.bonds || []).some(b => b.type === 'double' && (b.from === id || b.to === id) && inRings.has(b.from === id ? b.to : b.from));
        if (double) continue;
        const atom = m.atoms.get(id)?.atom;
        if (ring.atoms.length === 5 && atom && ['N', 'O', 'S'].includes(atom.element) && !lonePairs++) continue;
        return false;
      }
      return true;
    };
    const drawMolecule = (m, g) => {
      const rings = (m.s.rings || []).filter(r => r.atoms.every(id => m.atoms.has(id)));
      const aromatic = rings.filter(r => isAromatic(m, r));
      const ringOfBond = (bond, list) => list.filter(r => r.atoms.includes(bond.from) && r.atoms.includes(bond.to))
        .sort((x, y) => y.atoms.length - x.atoms.length)[0];
      const centreOf = r => mean(r.atoms.map(id => m.atoms.get(id).p));
      for (const bond of m.s.bonds || []) {
        const A = m.atoms.get(bond.from), B = m.atoms.get(bond.to);
        if (!A || !B) continue;
        const u = unit(A.p, B.p), back = { x: -u.x, y: -u.y };
        const a = along(A.p, u, clearance(A, u)), b = along(B.p, back, clearance(B, back));
        if (dist(a, b) < 0.5 || (b.x - a.x) * u.x + (b.y - a.y) * u.y <= 0) continue;
        occupySegment(a, b, 1.8);
        const n = { x: -u.y, y: u.x };
        const inner = (r, dash) => {
          const centre = centreOf(r), side = Math.sign((centre.x - A.p.x) * n.x + (centre.y - A.p.y) * n.y) || 1;
          const l = dist(a, b), trim = Math.min(l * 0.18, BOND * 0.15);
          const p = along(along(a, n, side * 1.75), u, labelled(A) ? 0 : trim), q = along(along(b, n, side * 1.75), back, labelled(B) ? 0 : trim);
          stroke(p, q, fg, g, dash ? { 'stroke-dasharray': dash, 'stroke-linecap': 'butt' } : {});
        };
        const aromaticRing = ringOfBond(bond, aromatic);
        if (aromaticRing) {
          stroke(a, b, fg, g);
          inner(aromaticRing, RING_DASH);
        } else if (bond.type === 'double') {
          const ring = ringOfBond(bond, rings);
          const terminal = A.neighbours.length === 1 || B.neighbours.length === 1;
          if (ring) { stroke(a, b, fg, g); inner(ring); }
          else if (terminal) for (const side of [-1, 1]) stroke(along(a, n, side * 0.9), along(b, n, side * 0.9), fg, g);
          else {
            const others = [...A.neighbours, ...B.neighbours].filter(x => x !== A && x !== B);
            const side = Math.sign(others.reduce((s, o) => s + (o.p.x - A.p.x) * n.x + (o.p.y - A.p.y) * n.y, 0)) || 1;
            stroke(a, b, fg, g);
            stroke(along(along(a, n, side * 1.75), u, 1), along(along(b, n, side * 1.75), back, 1), fg, g);
          }
        } else if (bond.type === 'triple') {
          for (const side of [-1, 0, 1]) stroke(along(a, n, side * 1.6), along(b, n, side * 1.6), fg, g);
        } else if (bond.type.startsWith('stereo')) {
          const [narrow, wide] = bond.type.endsWith('Reverse') ? [b, a] : [a, b];
          const v = unit(narrow, wide), w = { x: -v.y, y: v.x }, half = 1.4;
          if (bond.type.startsWith('stereoFront')) {
            el('path', { d: `M${narrow.x},${narrow.y}L${wide.x + w.x * half},${wide.y + w.y * half}L${wide.x - w.x * half},${wide.y - w.y * half}Z`,
              fill: fg, stroke: fg, 'stroke-width': 0.4, 'stroke-linejoin': 'round' }, g);
          } else {
            const steps = Math.max(3, Math.round(v.l / 1.7));
            for (let i = 1; i <= steps; i++) {
              const p = along(narrow, v, v.l * i / steps), h = half * i / steps + 0.2;
              stroke({ x: p.x + w.x * h, y: p.y + w.y * h }, { x: p.x - w.x * h, y: p.y - w.y * h }, fg, g, { 'stroke-width': 0.55, 'stroke-linecap': 'butt' });
            }
          }
        } else stroke(a, b, fg, g);
      }
      // explicit polar hydrogens with their short bond
      for (const a of m.atoms.values()) for (const h of a.explicit) {
        const u = unit(a.p, h.p), back = { x: -u.x, y: -u.y };
        const from = along(a.p, u, clearance(a, u)), to = along(h.p, back, SIZE * 0.45);
        if ((to.x - from.x) * u.x + (to.y - from.y) * u.y > 0.4) stroke(from, to, fg, g);
        write(h.p.x, h.p.y, 'H', SIZE, fillOf(a, m), g, { class: 'pe-hydrogen' });
        occupy(h.p.x, h.p.y, SIZE * 0.8, SIZE * 0.9);
      }
      // atom labels with their implicit hydrogens
      for (const a of m.atoms.values()) {
        if (!labelled(a)) continue;
        const fill = fillOf(a, m), main = mainOf(a), w = width(main, SIZE);
        write(a.p.x, a.p.y, main, SIZE, fill, g, { class: 'pe-atom' });
        occupy(a.p.x, a.p.y, w + 0.6, SIZE * 0.95);
        if (!a.side) continue;
        const count = a.implicit > 1 ? String(a.implicit) : '';
        const wH = width('H', SIZE), wSub = count ? width(count, SUB) : 0;
        let hx, hy = a.p.y;
        if (a.side.x > 0) hx = a.p.x + w / 2 + wH / 2;
        else if (a.side.x < 0) hx = a.p.x - w / 2 - wSub - wH / 2;
        else { hx = a.p.x; hy = a.p.y + a.side.y * SIZE * 0.95; }
        // the count is a subscript inside the hydrogen's own text, so the browser spaces it with the real font
        const middle = a.side.x ? hx + wSub / 2 : hx;
        const hydrogen = write(middle, hy, 'H', SIZE, fill, g, { class: 'pe-atom' });
        if (count) el('tspan', { 'font-size': SUB, dy: SIZE * 0.3 }, hydrogen).textContent = count;
        occupy(middle, hy, wH + wSub + 0.4, SIZE * 0.95);
        a.reach = { x: a.side.x * (w / 2 + wH + wSub), y: 0 };
      }
    };
    for (const m of molecules.values()) {
      const g = el('g', { class: `binding-residue pe-${m.kind}`, 'data-structure-id': m.s.id }, layerMolecules);
      groups.set(m.s.id, g);
      drawMolecule(m, g);
      // where each ligand atom is drawn, for a host that picks atoms by pointer (embed.js)
      if (m.s.id === 0) for (const [id, a] of m.atoms) el('circle', { cx: a.p.x, cy: a.p.y, r: 0.01, fill: 'none', stroke: 'none', 'data-ligand-atom': id }, g);
    }

    // ---- contact lines (below the molecules): dashed and coloured, so none reads as a bond
    const clip = (end, toward) => {
      if (end.ring) return end.p;
      const u = unit(end.p, toward);
      return along(end.p, u, end.a ? (labelled(end.a) ? clearance(end.a, u) + 0.5 : 1) : 0);
    };
    for (const k of polar) {
      const { c, record } = k;
      const color = P[record.kind] || P.hbond;
      const selected = c.index === env.selected;
      const g = hit(el('g', { class: 'pe-contact', 'data-kind': record.kind }, layerLines), c.index);
      let from, to;
      if (k.h) {
        const u = unit(k.h.p, k.acceptor.p);
        from = along(k.h.p, u, SIZE * 0.5);
        to = clip(k.acceptor, k.h.p);
      } else {
        from = clip(k.a, k.b.p);
        to = clip(k.b, k.a.p);
      }
      if ((to.x - from.x) * (k.b.p.x - k.a.p.x) + (to.y - from.y) * (k.b.p.y - k.a.p.y) < 0 && !k.h) { from = k.a.p; to = k.b.p; }
      el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: color, 'stroke-width': selected ? CONTACT * 1.9 : CONTACT,
        'stroke-dasharray': dashFor(dist(from, to)), 'stroke-linecap': 'butt', class: 'pe-contact-line' }, g);
      for (const end of [k.a, k.b]) if (end.ring) {
        el('circle', { cx: end.p.x, cy: end.p.y, r: 1.3, fill: color }, g);
        occupy(end.p.x, end.p.y, 3.4, 3.4);
      }
      el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: 'transparent', 'stroke-width': 7, 'pointer-events': 'stroke' }, g);
      occupySegment(from, to, 1.8, 0.6);
      k.from = from; k.to = to; k.g = g; k.color = color;
    }

    // ---- circled charges
    const chargeMark = (p, sign, parent) => {
      el('circle', { cx: p.x, cy: p.y, r: 2, fill: bg, stroke: fg, 'stroke-width': 0.45 }, parent);
      stroke({ x: p.x - 1.15, y: p.y }, { x: p.x + 1.15, y: p.y }, fg, parent, { 'stroke-width': 0.5, 'stroke-linecap': 'butt' });
      if (sign > 0) stroke({ x: p.x, y: p.y - 1.15 }, { x: p.x, y: p.y + 1.15 }, fg, parent, { 'stroke-width': 0.5, 'stroke-linecap': 'butt' });
    };
    for (const m of molecules.values()) for (const a of m.atoms.values()) {
      if (!a.atom.charge) continue;
      let best = null;
      for (const reach of [SIZE * 0.95, SIZE * 1.2, SIZE * 1.5, SIZE * 1.9, SIZE * 2.4]) for (let i = 0; i < 24; i++) {
        const angle = -Math.PI / 4 + i * Math.PI / 12;
        const p = { x: a.p.x + Math.cos(angle) * reach, y: a.p.y + Math.sin(angle) * reach };
        const score = overlap(boxAt(p.x, p.y, 4.8, 4.8)) * 30 + reach * 0.6 + Math.min(i, 24 - i) * 0.05;
        if (!best || score < best.score) best = { ...p, score };
      }
      occupy(best.x, best.y, 4.6, 4.6);
      chargeMark(best, a.atom.charge, groups.get(m.s.id));
    }

    // ---- hydrophobic splines along the ligand; every arc claims its ink before any name is placed
    const transform = env.transform;
    const patches = new Map();
    for (const c of hydrophobic) {
      const key = c.record.type === 'hydrophobicContacts' ? `s${c.record.id}` : `r${c.record.structure}:${c.index}`;
      if (!patches.has(key)) patches.set(key, []);
      patches.get(key).push(c);
    }
    const ligandAtomByName = new Map([...ligand.atoms.values()].map(a => [a.atom.additionalInformation?.atomName, a]));
    const ringCentres = (ligand.s.rings || []).map(r => {
      const pts = r.atoms.map(id => ligand.atoms.get(id)?.p).filter(Boolean);
      const c = mean(pts);
      return { c, r: Math.max(...pts.map(p => dist(p, c))) };
    });
    const ligandBonds = (ligand.s.bonds || []).map(b => [ligand.atoms.get(b.from)?.p, ligand.atoms.get(b.to)?.p]).filter(([p, q]) => p && q);
    const arcs = [];
    for (const entries of patches.values()) {
      const first = entries[0];
      const spline = first.record.type === 'hydrophobicContacts' && scene.hydrophobicContacts.find(s => s.id === first.record.id);
      let points = spline ? spline.controlPoints.map(p => { const q = transform([p.x, p.y]); return { x: q[0], y: q[1] }; }) : [];
      if (points.length < 2) {
        const atom = ligandAtomByName.get(first.record.ligandAtom) || [...ligand.atoms.values()][0];
        const u = unit(ligand.center, atom.p), p = along(atom.p, u, 5);
        points = [along(p, { x: -u.y, y: u.x }, 5), along(p, u, 1.2), along(p, { x: u.y, y: -u.x }, 5)];
      }
      // an arc point that falls inside a ligand ring or onto an atom is pushed just outside it
      points = points.map(p => {
        let q = { ...p };
        for (const ring of ringCentres) if (dist(q, ring.c) < ring.r + 2.8) {
          const u = dist(q, ring.c) > 0.3 ? unit(ring.c, q) : unit(ligand.center, ring.c);
          q = along(ring.c, u, ring.r + 2.8);
        }
        for (let pass = 0; pass < 3; pass++) {
          for (const a of ligand.atoms.values()) {
            const clear = labelled(a) ? 4.6 : 2.9;
            if (dist(q, a.p) < clear) q = along(a.p, dist(q, a.p) > 0.2 ? unit(a.p, q) : unit(ligand.center, a.p), clear);
          }
          for (const [A, B] of ligandBonds) {
            const u = unit(A, B), t = Math.max(0, Math.min(u.l, (q.x - A.x) * u.x + (q.y - A.y) * u.y));
            const foot = along(A, u, t), off = dist(q, foot);
            if (off < 2.9) q = along(foot, off > 0.2 ? unit(foot, q) : { x: -u.y, y: u.x }, 2.9);
          }
        }
        return q;
      });
      // an arc that still cuts a ligand bond (it wraps two rings across their link) keeps its longer clean part
      const cutAt = pts => {
        const curve = sampleCurve(pts);
        const i = curve.findIndex((p, k) => k && ligandBonds.some(([r, s]) => crosses(curve[k - 1], p, r, s)));
        return i < 0 ? -1 : curve[i].segment;
      };
      const length = pts => pts.slice(1).reduce((n, p, i) => n + dist(pts[i], p), 0);
      for (let cut = cutAt(points); cut >= 0 && points.length > 2; cut = cutAt(points)) {
        const parts = [points.slice(0, cut + 1), points.slice(cut + 1)].filter(part => part.length >= 2);
        if (!parts.length) break;
        points = parts.reduce((x, y) => (cutAt(x) < 0) !== (cutAt(y) < 0) ? (cutAt(x) < 0 ? x : y) : length(x) >= length(y) ? x : y);
      }
      sampleCurve(points).forEach((p, i, curve) => { if (i) occupySegment(curve[i - 1], p, 1.8); });
      arcs.push({ entries, points });
    }

    // ---- names: each takes the free spot nearest its own ink, the name with the fewest free spots choosing first.
    //      A name is a block of lines; its box is the ink of the text, capitals above and descenders below.
    const extent = occupied.reduce((e, b) => ({ x0: Math.min(e.x0, b.x0), x1: Math.max(e.x1, b.x1), y0: Math.min(e.y0, b.y0), y1: Math.max(e.y1, b.y1) }),
      { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
    const growth = box => tall ? Math.max(0, extent.x0 - box.x0, box.x1 - extent.x1) : Math.max(0, extent.y0 - box.y0, box.y1 - extent.y1);
    const jobs = [];
    const blockOf = (lines, size) => {
      const pitch = size * 1.18, drop = lines.some(line => /[gjpqy]/.test(line.value)) ? 0.58 : 0.38;
      const top = -((lines.length - 1) / 2) * pitch - size * 0.39, bottom = ((lines.length - 1) / 2) * pitch + size * drop;
      // hw, hh: half the ink box; lift: from the middle of the ink box up to the middle of the lines
      return { lines, size, pitch, hw: Math.max(...lines.map(line => width(line.value, size))) / 2, hh: (bottom - top) / 2, lift: (top + bottom) / 2 };
    };
    // other text keeps a wider berth sideways than above and below: two labels on one baseline read as one string
    const boxOf = (block, at, padX = 0, padY = padX) => ({ x0: at.x - block.hw - padX, x1: at.x + block.hw + padX, y0: at.y - block.hh - padY, y1: at.y + block.hh + padY });
    const boxGap = (block, at, p) => Math.hypot(Math.max(0, Math.abs(p.x - at.x) - block.hw), Math.max(0, Math.abs(p.y - at.y) - block.hh));
    // spots around a point: the block's edge sits `gap` away from it in sixteen directions
    const around = (block, p, gaps, cost) => gaps.flatMap(gap => [...Array(16)].map((_, step) => {
      const angle = step * Math.PI / 8, dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const reach = gap + Math.abs(dir.x) * block.hw + Math.abs(dir.y) * block.hh;
      const at = { x: p.x + dir.x * reach, y: p.y + dir.y * reach };
      return { ...at, cost: cost(at, gap, angle) };
    }));
    const everyAtom = [...molecules.values()].flatMap(m => [...m.atoms.values()].map(a => ({ p: a.p, m })));
    const nameJob = (m, size, fill) => {
      if (!m.name) return;
      const block = blockOf([{ value: m.name, fill, parent: groups.get(m.s.id), attrs: { class: 'pe-name' } }], size);
      const own = [...m.atoms.values()];
      const reachable = 16 + block.hw * 2;
      const foreign = everyAtom.filter(e => e.m !== m && own.some(a => dist(a.p, e.p) < reachable + 12));
      // a name nearer to another molecule than to its own reads as that molecule's name
      const stray = at => {
        const mine = Math.min(...own.map(a => boxGap(block, at, a.p)));
        return foreign.reduce((worst, e) => Math.max(worst, mine + 3.5 - boxGap(block, at, e.p)), 0) * 1.5;
      };
      if (m.kind !== 'fragment') {
        // a water or a metal carries its residue number; best right after the glyph, where "H₂O 146" reads as one label
        const only = own[0], after = Math.max(width(mainOf(only), SIZE) / 2, only.reach?.x || 0);
        jobs.push({ block, owner: m, stray, candidates: [{ x: only.p.x + after + 1.7 + block.hw, y: only.p.y + block.lift, cost: 0 },
          ...around(block, only.p, [3.2, 4.8, 7, 10, 14], (at, gap) => 2 + gap * 0.5)] });
        return;
      }
      const ca = own.find(a => a.atom.additionalInformation?.atomName === 'CA') || null;
      const focus = ca ? ca.p : m.center;
      const away = Math.atan2(m.center.y - ligand.center.y, m.center.x - ligand.center.x);
      jobs.push({ block, owner: m, stray, candidates: own.flatMap(a => around(block, a.p, [3.2, 4.8, 7, 10, 14], (at, gap) => Math.hypot(at.x - focus.x, at.y - focus.y) * 0.3 + gap * 0.5
        + (1 - Math.cos(Math.atan2(at.y - ligand.center.y, at.x - ligand.center.x) - away)) * 2)) });
    };
    for (const m of molecules.values()) if (m.kind === 'water' || m.kind === 'metal') nameJob(m, SIZE, P.muted);
    for (const m of molecules.values()) if (m.kind === 'fragment') nameJob(m, NAME, fg);
    for (const arc of arcs) {
      const { entries, points } = arc;
      const d = curveOf(points), selected = entries.some(c => c.index === env.selected);
      // one drawn arc; every residue that shares it has its own hit target and its own name
      arc.groups = entries.map((c, i) => {
        const g = hit(el('g', { class: 'pe-hydrophobic', 'data-kind': 'hydrophobic', 'data-residue-key': JSON.stringify(c.record.residueKey) }, layerLines), c.index);
        if (i === 0) el('path', { d, fill: 'none', stroke: P.hydrophobic, 'stroke-width': selected ? CONTACT * 1.9 : CONTACT,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'pe-spline' }, g);
        el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 7, 'pointer-events': 'stroke' }, g);
        return g;
      });
      // the stacked names sit on the outer side of the arc's middle
      const middle = points[Math.floor(points.length / 2)];
      const nearest = [...ligand.atoms.values()].reduce((x, y) => dist(x.p, middle) < dist(y.p, middle) ? x : y);
      const out = dist(nearest.p, middle) > 0.5 ? unit(nearest.p, middle) : unit(ligand.center, middle);
      const outward = Math.atan2(out.y, out.x);
      const block = blockOf(entries.map((c, i) => {
        const [chain, number, name] = c.record.residueKey || [];
        return { value: name ? residueLabel(name, number, data.severalChains ? chain : '') : c.label, fill: P.hydrophobic, parent: arc.groups[i], attrs: { class: 'pe-hydrophobic-name' } };
      }), NAME);
      arc.block = block;
      jobs.push({ block, candidates: points.flatMap(p => around(block, p, [2.2, 3.6, 5.5, 8, 11, 15], (at, gap, angle) => gap * 0.45 + dist(p, middle) * 0.05
        + (angleDiff(angle, outward) > Math.PI / 2 + 0.01 ? 40 : angleDiff(angle, outward) * 1.3))) });
    }
    const placed = [];
    for (const job of jobs) for (const c of job.candidates) {
      const box = boxOf(job.block, c, 1.7, 0.7);
      c.ink = overlap(box);
      c.fixed = c.ink * 30 + c.cost + growth(box) * 0.5 + (c.ink < 0.05 && job.stray ? job.stray(c) : 0);
    }
    const freedom = job => job.candidates.reduce((n, c) => n + (c.ink < 0.05), 0);
    for (const job of [...jobs].sort((a, b) => freedom(a) - freedom(b))) {
      let best = null;
      for (const c of job.candidates) {
        if (best && c.fixed >= best.score) continue;
        const box = boxOf(job.block, c, 1.7, 0.7);
        const score = c.fixed + placed.reduce((n, b) => n + shared(box, b), 0) * 30;
        if (!best || score < best.score) best = { x: c.x, y: c.y, score };
      }
      job.at = best;
      job.rect = boxOf(job.block, best);
      // what the bare text covers of other ink and of the names placed before it
      job.covered = overlap(job.rect) + placed.reduce((n, b) => n + shared(job.rect, b.rect), 0);
      placed.push({ ...boxOf(job.block, best, 1, 0.3), weight: 1, rect: { ...job.rect, weight: 1 } });
    }
    for (const box of placed) claim(box);
    for (const { block, at } of jobs) block.lines.forEach((line, i) => {
      line.at = { x: at.x, y: at.y - block.lift + (i - (block.lines.length - 1) / 2) * block.pitch };
      write(line.at.x, line.at.y, line.value, block.size, line.fill, line.parent, { 'stroke-width': 1.8, ...line.attrs });
    });

    // ---- the selected contact shows its distance: beside the line, or after the name of a hydrophobic residue
    const distanceAt = (value, candidates, color, parent) => {
      const block = blockOf([{ value }], SIZE);
      let best = null;
      for (const c of candidates(block)) {
        const score = overlap(boxOf(block, c, 1.4, 0.6)) * 30 + c.cost;
        if (!best || score < best.score) best = { ...c, score };
      }
      claim(boxOf(block, best, 1, 0.3));
      write(best.x, best.y - block.lift, value, SIZE, color, parent, { class: 'pe-distance', 'stroke-width': 1.8 });
    };
    for (const k of polar) {
      if (k.c.index !== env.selected || !(k.c.distance > 0)) continue;
      const u = unit(k.from, k.to), n = { x: -u.y, y: u.x };
      distanceAt(`${k.c.distance.toFixed(2)} Å`, block => [0.5, 0.35, 0.65, 0.2, 0.8].flatMap(t => [1, -1].map(side => {
        const reach = 2 + Math.abs(n.x) * block.hw + Math.abs(n.y) * block.hh;
        return { x: k.from.x + (k.to.x - k.from.x) * t + n.x * side * reach, y: k.from.y + (k.to.y - k.from.y) * t + n.y * side * reach, cost: Math.abs(t - 0.5) * 4 };
      })), k.color, k.g);
    }
    for (const arc of arcs) arc.entries.forEach((c, i) => {
      if (c.index !== env.selected || !(c.distance > 0)) return;
      const line = arc.block.lines[i], half = width(line.value, NAME) / 2;
      distanceAt(`${c.distance.toFixed(2)} Å`, block => [
        { x: line.at.x + half + 1.6 + block.hw, y: line.at.y + block.lift, cost: 0 },
        { x: line.at.x - half - 1.6 - block.hw, y: line.at.y + block.lift, cost: 0.5 },
        ...around(block, { x: line.at.x, y: line.at.y }, [NAME * 0.9, NAME * 1.6], (at, gap) => 2 + gap * 0.3),
      ], P.hydrophobic, arc.groups[i]);
    });
    // for prepare(): the arrangement, where every name landed, how many names touch something and how tangled the lines are
    return { model, solver, jobs, arcs, clashes: jobs.filter(job => job.covered > 0.3).length, tension: solver.costOf(solver.movable) };
  };

  // ---- residues come in along their contact lines. The pipeline spaces the fragments for its own, larger drawing,
  //      which leaves lines up to fourteen bonds long and a picture wider than a side panel. Here every unit (a residue,
  //      or a water or metal with the residues only it holds) slides towards what it binds until its shortest line is
  //      about two and a half bonds, and only while nothing new crosses, crowds or lands on a name.
  const pullIn = ({ model, solver, jobs, arcs }) => {
    const { molecules, links } = model;
    const all = [...molecules.values()], ligand = molecules.get(0);
    const names = new Map(), fixed = [];
    for (const job of jobs) { if (job.owner) names.set(job.owner, { ...job.rect }); else fixed.push(job.rect); }
    const curves = arcs.map(arc => sampleCurve(arc.points));
    const rectGap = (r, p) => Math.hypot(Math.max(0, r.x0 - p.x, p.x - r.x1), Math.max(0, r.y0 - p.y, p.y - r.y1));
    const rectsMeet = (a, b, pad) => a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1;
    const through = (p, q, r) => {
      if (Math.max(p.x, q.x) < r.x0 || Math.min(p.x, q.x) > r.x1 || Math.max(p.y, q.y) < r.y0 || Math.min(p.y, q.y) > r.y1) return false;
      const inside = v => v.x > r.x0 && v.x < r.x1 && v.y > r.y0 && v.y < r.y1;
      if (inside(p) || inside(q)) return true;
      const c = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
      return c.some((v, i) => crosses(p, q, v, c[(i + 1) % 4]));
    };
    // the shortest a line may get, centre to centre: room for the donor hydrogen, both labels and a few dashes
    const floor = l => ({ hbond: 24, water: 23, metal: 23 }[l.kind] || 22) + l.ends.reduce((n, e) => n + (e.ring ? 7 : 0), 0);
    const tag = a => labelledAtom(a.atom);
    const hubs = all.filter(m => m.kind === 'water' || m.kind === 'metal');
    const ridersOf = m => !hubs.includes(m) ? [] : all.filter(o => o.kind === 'fragment'
      && links.some(l => l.sids.has(o.s.id)) && links.every(l => !l.sids.has(o.s.id) || l.sids.has(m.s.id)));
    const pull = members => {
      const mine = new Set(members), inside = new Set(members.map(o => o.s.id)), touched = solver.linksOf(members).filter(l => l.p && l.q);
      // the lines that leave the unit, each with its own end and the end it is drawn towards
      const outer = touched.filter(l => [...l.sids].some(sid => !inside.has(sid)))
        .map(l => inside.has(l.ends[0].sid) ? { l, own: l.p, other: l.q } : { l, own: l.q, other: l.p });
      if (!outer.length) return false;
      const length = (dx, dy) => outer.reduce((n, { l, own, other }) => n + Math.max(floor(l), Math.hypot(own.x + dx - other.x, own.y + dy - other.y)), 0);
      const now = length(0, 0);
      const from = mean(outer.map(o => o.own)), to = mean(outer.map(o => o.other));
      const heading = Math.atan2(to.y - from.y, to.x - from.x);
      const far = Math.min(160, Math.max(...outer.map(({ l }) => dist(l.p, l.q) - floor(l))));
      const options = [];
      for (const veer of [0, 0.4, -0.4, 0.8, -0.8]) for (let t = 2; t <= far; t += 2) {
        const dx = Math.cos(heading + veer) * t, dy = Math.sin(heading + veer) * t;
        const gain = now - length(dx, dy) - Math.abs(veer);
        if (gain > 1) options.push({ dx, dy, gain });
      }
      if (!options.length) return false;
      options.sort((a, b) => b.gain - a.gain);

      // how crowded the unit would be after a shift: every shortfall against the clearances a readable drawing needs.
      // The unit is measured as a shifted copy, the cheap tests first, and the sum stops once it passes the budget.
      const others = all.filter(o => !mine.has(o));
      const foreign = others.flatMap(o => [...o.atoms.values()].map(b => ({ x: b.p.x, y: b.p.y, big: tag(b), sid: o.s.id })));
      const walls = [...others.map(o => names.get(o)).filter(Boolean), ...fixed];
      const foreignBonds = others.flatMap(o => solver.ink(o).segs);
      const apart = links.filter(l => l.p && l.q && ![...l.sids].some(sid => inside.has(sid)));
      const atoms = members.flatMap(o => [...o.atoms.values()].map(a => ({ x: a.p.x, y: a.p.y, big: tag(a) })));
      const rects = members.map(o => names.get(o)).filter(Boolean);
      const bonds = members.flatMap(o => solver.ink(o).segs);
      const spans = touched.map(l => ({ l, p: l.p, q: l.q, movesP: inside.has(l.ends[0].sid), movesQ: inside.has(l.ends[1].sid) }));
      const strain = (dx, dy, budget) => {
        const at = p => ({ x: p.x + dx, y: p.y + dy });
        const lines = spans.map(sp => ({ l: sp.l, p: sp.movesP ? at(sp.p) : sp.p, q: sp.movesQ ? at(sp.q) : sp.q }));
        let sum = 0;
        for (const l of lines) sum += Math.max(0, floor(l.l) - dist(l.p, l.q)) * 2;
        if (sum > budget) return sum;
        for (const a of atoms) {
          const x = a.x + dx, y = a.y + dy;
          for (const b of foreign) {
            const need = a.big && b.big ? 13 : 10, ex = x - b.x, ey = y - b.y;
            if (ex < need && ex > -need && ey < need && ey > -need) sum += Math.max(0, need - Math.hypot(ex, ey));
          }
          if (sum > budget) return sum;
        }
        const moved = rects.map(r => ({ x0: r.x0 + dx, x1: r.x1 + dx, y0: r.y0 + dy, y1: r.y1 + dy }));
        for (const r of moved) {
          for (const b of foreign) sum += Math.max(0, (b.big ? 4.2 : 2.4) - rectGap(r, b));
          for (const wall of walls) if (rectsMeet(r, wall, 1.5)) sum += 6;
          for (const seg of foreignBonds) if (through(seg.p, seg.q, r)) sum += 6;
          for (const l of apart) if (through(l.p, l.q, r)) sum += 6;
          for (const l of lines) if (through(l.p, l.q, r)) sum += 6;
        }
        if (sum > budget) return sum;
        for (const wall of walls) {
          for (const a of atoms) sum += Math.max(0, (a.big ? 4.2 : 2.4) - rectGap(wall, { x: a.x + dx, y: a.y + dy }));
          for (const seg of bonds) if (through(at(seg.p), at(seg.q), wall)) sum += 6;
          for (const l of lines) if (through(l.p, l.q, wall)) sum += 6;
        }
        if (sum > budget) return sum;
        // a line passing close to a molecule it does not end on, either way round
        for (const l of lines) {
          const x0 = Math.min(l.p.x, l.q.x) - 5.5, x1 = Math.max(l.p.x, l.q.x) + 5.5, y0 = Math.min(l.p.y, l.q.y) - 5.5, y1 = Math.max(l.p.y, l.q.y) + 5.5;
          for (const b of foreign) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1 && !l.l.sids.has(b.sid)) sum += Math.max(0, (b.big ? 5.5 : 3.5) - gapTo(l.p, l.q, b));
        }
        for (const l of apart) {
          const x0 = Math.min(l.p.x, l.q.x) - 5.5 - dx, x1 = Math.max(l.p.x, l.q.x) + 5.5 - dx, y0 = Math.min(l.p.y, l.q.y) - 5.5 - dy, y1 = Math.max(l.p.y, l.q.y) + 5.5 - dy;
          for (const a of atoms) if (a.x > x0 && a.x < x1 && a.y > y0 && a.y < y1) sum += Math.max(0, (a.big ? 5.5 : 3.5) - gapTo(l.p, l.q, { x: a.x + dx, y: a.y + dy }));
        }
        if (sum > budget) return sum;
        for (const curve of curves) for (let i = 1; i < curve.length; i++) {
          const p = curve[i - 1], q = curve[i];
          for (const a of atoms) sum += Math.max(0, 5 - gapTo(p, q, { x: a.x + dx, y: a.y + dy }));
          for (const r of moved) if (through(p, q, r)) sum += 6;
          for (const l of lines) if (crosses(l.p, l.q, p, q)) sum += 6;
        }
        return sum;
      };
/*DIAG*/      const strainParts = (dx, dy) => { const parts = {}; const budget = Infinity; const add = (k, v) => { if (v > 0) parts[k] = (parts[k] || 0) + v; return v; };
        const at = p => ({ x: p.x + dx, y: p.y + dy });
        const lines = spans.map(sp => ({ l: sp.l, p: sp.movesP ? at(sp.p) : sp.p, q: sp.movesQ ? at(sp.q) : sp.q }));
        let sum = 0;
        for (const l of lines) sum += add('short', Math.max(0, floor(l.l) - dist(l.p, l.q)) * 2);
        if (sum > budget) return sum;
        for (const a of atoms) {
          const x = a.x + dx, y = a.y + dy;
          for (const b of foreign) {
            const need = a.big && b.big ? 13 : 10, ex = x - b.x, ey = y - b.y;
            if (ex < need && ex > -need && ey < need && ey > -need) sum += add('atoms', Math.max(0, need - Math.hypot(ex, ey)));
          }
          if (sum > budget) return sum;
        }
        const moved = rects.map(r => ({ x0: r.x0 + dx, x1: r.x1 + dx, y0: r.y0 + dy, y1: r.y1 + dy }));
        for (const r of moved) {
          for (const b of foreign) sum += add('name-atom', Math.max(0, (b.big ? 4.2 : 2.4) - rectGap(r, b)));
          for (const wall of walls) if (rectsMeet(r, wall, 1.5)) sum += add('name-name', 6);
          for (const seg of foreignBonds) if (through(seg.p, seg.q, r)) sum += add('name-bond', 6);
          for (const l of apart) if (through(l.p, l.q, r)) sum += add('name-foreignline', 6);
          for (const l of lines) if (through(l.p, l.q, r)) sum += add('name-ownline', 6);
        }
        if (sum > budget) return sum;
        for (const wall of walls) {
          for (const a of atoms) sum += add('wall-atom', Math.max(0, (a.big ? 4.2 : 2.4) - rectGap(wall, { x: a.x + dx, y: a.y + dy })));
          for (const seg of bonds) if (through(at(seg.p), at(seg.q), wall)) sum += add('wall-bond', 6);
          for (const l of lines) if (through(l.p, l.q, wall)) sum += add('wall-line', 6);
        }
        if (sum > budget) return sum;
        // a line passing close to a molecule it does not end on, either way round
        for (const l of lines) {
          const x0 = Math.min(l.p.x, l.q.x) - 5.5, x1 = Math.max(l.p.x, l.q.x) + 5.5, y0 = Math.min(l.p.y, l.q.y) - 5.5, y1 = Math.max(l.p.y, l.q.y) + 5.5;
          for (const b of foreign) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1 && !l.l.sids.has(b.sid)) sum += add('line-near-atom', Math.max(0, (b.big ? 5.5 : 3.5) - gapTo(l.p, l.q, b)));
        }
        for (const l of apart) {
          const x0 = Math.min(l.p.x, l.q.x) - 5.5 - dx, x1 = Math.max(l.p.x, l.q.x) + 5.5 - dx, y0 = Math.min(l.p.y, l.q.y) - 5.5 - dy, y1 = Math.max(l.p.y, l.q.y) + 5.5 - dy;
          for (const a of atoms) if (a.x > x0 && a.x < x1 && a.y > y0 && a.y < y1) sum += add('foreignline-near-atom', Math.max(0, (a.big ? 5.5 : 3.5) - gapTo(l.p, l.q, { x: a.x + dx, y: a.y + dy })));
        }
        if (sum > budget) return sum;
        for (const curve of curves) for (let i = 1; i < curve.length; i++) {
          const p = curve[i - 1], q = curve[i];
          for (const a of atoms) sum += add('arc-atom', Math.max(0, 5 - gapTo(p, q, { x: a.x + dx, y: a.y + dy })));
          for (const r of moved) if (through(p, q, r)) sum += add('arc-name', 6);
          for (const l of lines) if (crosses(l.p, l.q, p, q)) sum += add('arc-line', 6);
        }
        return parts;
      };
/*ENDDIAG*/
      const tight = strain(0, 0, Infinity) + 1e-6, cost = solver.costOf(members), every = solver.linksOf(members);
      const slide = (dx, dy) => {
        solver.shift(members, dx, dy, every);
        for (const r of rects) { r.x0 += dx; r.x1 += dx; r.y0 += dy; r.y1 += dy; }
      };
      const dbg = { strain: 0, cost: 0 }, label = members.map(o => o.name || o.s.structureName).join('+');
      for (const { dx, dy, gain } of options) {
        if (strain(dx, dy, tight) > tight) { dbg.strain++; continue; }
        slide(dx, dy);
        if (solver.costOf(members) <= cost) { if (globalThis.PE_DEBUG) console.log(`   pull ${label}: by ${Math.hypot(dx, dy).toFixed(0)} (gain ${gain.toFixed(0)} of ${options[0].gain.toFixed(0)}), skipped strain ${dbg.strain} cost ${dbg.cost}`); return true; }
        dbg.cost++;
        slide(-dx, -dy);
      }
      if (globalThis.PE_DEBUG) console.log(`      best option blocked by ${JSON.stringify(Object.fromEntries(Object.entries(strainParts(options[0].dx, options[0].dy)).map(([k, v]) => [k, +v.toFixed(1)])))}; at 0: ${JSON.stringify(strainParts(0, 0))}`);
      if (globalThis.PE_DEBUG) console.log(`   pull ${label}: blocked (${options.length} options, strain ${dbg.strain}, cost ${dbg.cost}; strain0 ${tight.toFixed(1)}, cost0 ${cost})`);
      return false;
    };
    // the inner shell first, nearest first, so the outer shell can follow it in
    const level = m => links.some(l => l.sids.has(m.s.id) && l.sids.has(0)) ? 0 : 1;
    const order = all.filter(m => m.kind !== 'ligand').sort((a, b) => level(a) - level(b) || dist(a.center, ligand.center) - dist(b.center, ligand.center));
    for (let round = 0; round < 3; round++) {
      let moved = false;
      for (const m of order) if (pull([m, ...ridersOf(m)])) moved = true;
      if (!moved) break;
    }
  };

  window.LID_STUDIES[ID] = {
    hideBase: 'all',
    hideHydrophobic: true,

    // Runs once per loaded complex, before the scene is mounted: the arrangement search that draw() would do, then the
    // pull-in. Translations go into the scene (so dragging, reset and export keep working on what is shown); the turn
    // and shrink of each fragment go into data.studyLayout. The result is drawn on a blank canvas and kept only if no
    // name ends up touching anything it did not touch before and the lines are no more tangled.
    prepare(data, H) {
      const scene = data.scene.scene;
      const coords = new Map(scene.structures.map(s => [s.id, new Map(s.atoms.map(a => [a.id, a.coordinates]))]));
      const blank = () => ({ setAttribute() {} });
      const env = { el: blank, text: blank, hit: node => node, root: blank(), bg: '#ffffff', fg: '#000000', theme: 'light', selected: null, data,
        contacts: data.contacts.map((record, index) => ({ record, index, visible: true, label: record.residue, distance: record.distance })),
        liveAtom: (sid, id) => coords.get(sid)?.get(id) || null, visible: () => true, transform: p => p };
      const bake = model => {
        const poses = {};
        for (const m of model.molecules.values()) {
          if (m.kind === 'ligand') continue;
          const now = m.anchor || m.center, dx = now.x - m.home.x, dy = now.y - m.home.y;
          if (Math.hypot(dx, dy) > 1e-6) {
            const box = H.box(m.s.atoms.map(a => a.coordinates));
            H.move(data, m.s.id, box.x + dx, box.y + dy);
            m.home = now;
          }
          if (m.turned.angle || m.turned.shrink !== 1) poses[m.s.id] = m.turned;
        }
        data.studyLayout = { poses };
      };
      const first = compose(env);
      bake(first.model);
      const kept = [scene.structures.map(s => s.atoms.map(a => ({ ...a.coordinates }))), scene.annotations.map(a => ({ ...a.coordinates }))];
      pullIn(first);
      bake(first.model);
      const second = compose(env);
      if (globalThis.PE_DEBUG) console.log(`  prepare: clashes ${first.clashes} -> ${second.clashes}, tension ${first.tension} -> ${second.tension}`);
      if (globalThis.PE_DEBUG) console.log('  clashing: ' + second.jobs.filter(job => job.at.clash > 0.05).map(job => job.block.lines.map(l => l.value).join('/') + ' ' + job.at.clash.toFixed(2)).join(', '));
      if (globalThis.PE_FORCE || (second.clashes <= first.clashes && second.tension <= first.tension)) return;
      scene.structures.forEach((s, i) => s.atoms.forEach((a, j) => Object.assign(a.coordinates, kept[0][i][j])));
      scene.annotations.forEach((a, i) => Object.assign(a.coordinates, kept[1][i]));
    },

    draw(ctx) {
      compose({ ...ctx, visible: structureVisible, transform: ligandTransform() });
    },

    legend(info) {
      const P = palette(info.theme), fg = info.atomColors.DEFAULT, O = info.atomColors.O || '#ff0000';
      const kinds = new Set(info.data.contacts.map(c => c.kind));
      const icon = paint => { const s = info.svgEl('svg', { class: 'swatch', viewBox: '0 0 28 12', style: 'width:28px;height:12px' }); paint(s); return s; };
      const dashed = (color, x1 = 1, x2 = 27) => s => info.svgEl('line', { x1, y1: 6, x2, y2: 6, stroke: color, 'stroke-width': 1.7, 'stroke-dasharray': '4 2.5' }, s);
      const glyph = (s, x, value, fill, size = 10, y = 9.6) => { info.svgEl('text', { x, y, 'font-size': size, 'text-anchor': 'middle', fill, 'font-family': FONT }, s).textContent = value; };
      const dot = (s, x, color) => info.svgEl('circle', { cx: x, cy: 6, r: 2, fill: color }, s);
      const rows = [];
      if (kinds.has('hbond')) rows.push([icon(s => { glyph(s, 4, 'H', fg); dashed(P.hbond, 10.5)(s); }), 'H-bond']);
      if (kinds.has('ionic')) rows.push([icon(dashed(P.ionic)), 'Salt bridge']);
      if (kinds.has('metal')) rows.push([icon(dashed(P.metal)), 'Metal']);
      if (kinds.has('water') && info.layers.waters) rows.push([icon(s => { glyph(s, 5, 'H', O); glyph(s, 11.4, '2', O, 7, 11.4); glyph(s, 18.6, 'O', O); }), 'Water']);
      if (kinds.has('halogen')) rows.push([icon(dashed(P.halogen)), 'Halogen']);
      if (kinds.has('pi')) rows.push([icon(s => { dashed(P.pi, 5, 23)(s); dot(s, 3, P.pi); dot(s, 25, P.pi); }), 'π-stacking']);
      if (kinds.has('cationPi')) rows.push([icon(s => { dashed(P.cationPi, 5, 27)(s); dot(s, 3, P.cationPi); }), 'Cation–π']);
      if (kinds.has('hydrophobic')) rows.push([icon(s => info.svgEl('path', { d: 'M2,10 C8,1 18,11 26,3', fill: 'none', stroke: P.hydrophobic, 'stroke-width': 1.7, 'stroke-linecap': 'round' }, s)), 'Hydrophobic']);
      return rows;
    },
  };
})();
