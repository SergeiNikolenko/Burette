'use strict';

// Ligand-centric burial map: a smooth per-atom solvent-exposure field under the live ligand,
// growth arrows at open hydrogen-bearing atoms, and quiet typed contact lines to compact residue tags.
(() => {
  const EXPOSED_FULL = 20; // Å² of bound-state SASA painted as fully exposed
  const BURIED_FULL = 40;  // Å² of surface lost on binding painted as fully buried
  const GROW_MIN = 10;     // Å² an open hydrogen-bearing atom needs to earn an arrow
  const GROW_MAX = 3;
  // Text sizes in drawing units. The side panel never draws below 1.7 px per unit, so both stay above 9 px.
  const NAME = 5.6;        // residue names and metal symbols
  const VALUE = 5.4;       // areas and distances
  const LEGEND_MAX = 9;
  // line vocabulary of this style; the arrowheads and the backbone dot carry the rest
  const LINE = 0.8;
  const WIDTH = { hydrophobic: 0.7, metal: 1.25 };
  const DASH = { pi: '3 1.8', cationPi: '3 1.8', halogen: '3 1.4 0.8 1.4', water: '1.4 1.5', metal: '0.01 2.5' };
  const PALETTES = {
    light: { buried: [229, 116, 48], neutral: [182, 182, 192], exposed: [46, 128, 226], alpha: 0.5,
      apolar: '#3f9b63', cool: '#1f66c7', water: '#4a82c4', surface: '#ffffff', edge: '#d4d4d8', metal: '#e4e4e7' },
    dark: { buried: [255, 140, 66], neutral: [124, 124, 136], exposed: [84, 166, 255], alpha: 0.5,
      apolar: '#5fbf87', cool: '#8cc2ff', water: '#7fb0e6', surface: '#1f1f23', edge: '#45454d', metal: '#3f3f46' },
  };
  const clamp = v => Math.max(0, Math.min(1, v));
  const blend = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  // 0 = no solvent-exposed surface left on the atom, 1 = EXPOSED_FULL Å² or more still open.
  const rampColor = (P, t) => `rgb(${(t < 0.5 ? blend(P.buried, P.neutral, t * 2) : blend(P.neutral, P.exposed, t * 2 - 1)).join(',')})`;
  const rampAlpha = (P, t, buried = 1) => P.alpha * Math.max((1 - 2 * t) * buried, 2 * t - 1, 0.28);

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const len = v => Math.hypot(v.x, v.y);
  const unit = v => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };
  const at = (p, u, d) => ({ x: p.x + u.x * d, y: p.y + u.y * d });
  const turn = (u, angle) => ({ x: u.x * Math.cos(angle) - u.y * Math.sin(angle), y: u.x * Math.sin(angle) + u.y * Math.cos(angle) });
  const rectAt = (c, w, h) => ({ x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 });
  const overlap = (a, b, pad = 0) => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.y0 - pad < b.y1 && a.y1 + pad > b.y0;
  const pointRect = (p, r) => Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.y0 - p.y, 0, p.y - r.y1));
  const pointSeg = (p, a, b) => {
    const d = sub(b, a), t = clamp(((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (d.x * d.x + d.y * d.y || 1));
    return Math.hypot(p.x - a.x - d.x * t, p.y - a.y - d.y * t);
  };
  const segHitsRect = (a, b, r, pad = 0) => {
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x - r.x0 + pad], [dx, r.x1 + pad - a.x], [-dy, a.y - r.y0 + pad], [dy, r.y1 + pad - a.y]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  };
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const segSeg = (a, b, c, d) => side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
  const title = name => name ? name[0] + name.slice(1).toLowerCase() : '';
  const neighbours = ligand => {
    const map = new Map();
    for (const b of ligand.bonds) {
      map.set(b.from, [...(map.get(b.from) || []), b.to]);
      map.set(b.to, [...(map.get(b.to) || []), b.from]);
    }
    return map;
  };
  // A tall frame is the narrow side panel. Its width sets the scale of the drawing, so it names only the residues
  // that carry a contact and keeps their tags to one column on each side of the ligand; height is plentiful there.
  const tallFrame = () => state.orientation === 'portrait';
  // How far from the ligand axis that column may reach: one nameplate beside the ligand, or half of what the
  // panel shows at its largest scale (2.6 px per unit inside 14 px margins) when the ligand is slimmer than that.
  const columnReach = (box, B, tag = 0) => Math.max(box.width / 2 + B * 1.75 + Math.max(27, tag + 1.2), (($('canvas')?.clientWidth || 0) - 28) / 2.6 / 2);
  const beyond = (rect, axis, reach) => Math.max(0, Math.max(rect.x1 - axis, axis - rect.x0) - reach);
  // Where the ligand renderer writes implicit hydrogens: on the free side of the atom (right, left, down or up),
  // as the interaction drawer decides it.
  const hydrogenLabels = (point, ligand, bonded, B) => {
    const out = [];
    for (const atom of ligand.atoms) {
      const c = point.get(atom.id);
      if (!c || atom.element === 'C' || !atom.hydrogenCount) continue;
      const near = (bonded.get(atom.id) || []).map(id => point.get(id)).filter(Boolean);
      const free = d => Math.min(360, ...near.map(p => Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(p, c)), d)))) * 180 / Math.PI));
      const sides = near.length === 1 ? [{ x: 1, y: 0 }, { x: -1, y: 0 }] : [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
      let d = sides[0];
      if (near.length === 1) d = Math.round(free(sides[0])) >= 60 ? sides[0] : sides[1];
      else if (near.length) { let most = 0; for (const side of sides) { const f = free(side); if (f > most) { most = f; d = side; } } }
      out.push({ id: atom.id, d, ...at(c, d, B * 0.62) });
    }
    return out;
  };
  // Where a line that leaves a ligand atom along `u` starts: past the element symbol, and past the hydrogens
  // written beside it when the line leaves on their side (`side` is that side, from hydrogenLabels).
  const atomGap = (atom, u, side, B) => B * (atom.label ? 0.6 + (side ? (atom.hydrogenCount > 1 ? 0.65 : 0.45) * Math.max(0, dot(u, side)) : 0) : 0.26);
  // a line from atom `id` runs over the molecule when it cuts a bond or passes close to another atom or hydrogen
  const overMolecule = (point, bonds, a, b, id, B, labels = []) => {
    for (const bond of bonds) {
      const q = point.get(bond.from), r = point.get(bond.to);
      if (q && r && bond.from !== id && bond.to !== id && segSeg(a, b, q, r)) return true;
    }
    for (const [other, q] of point) if (other !== id && pointSeg(q, a, b) < B * 0.4) return true;
    for (const h of labels) if (h.id !== id && pointSeg(h, a, b) < B * 0.4) return true;
    return false;
  };
  // An apolar contact touches a patch of the ligand, not one atom: when the view from its own atom is blocked,
  // the nearest bonded or same-ring carbon with a clear view of the tag takes the line.
  const apolarStart = (point, ligand, bonded, id, target, B, labels) => {
    const p = point.get(id);
    if (!p || !overMolecule(point, ligand.bonds, p, target, id, B, labels)) return id;
    const near = new Set([...(bonded.get(id) || []), ...(ligand.rings || []).filter(r => r.atoms.includes(id)).flatMap(r => r.atoms)]);
    near.delete(id);
    const carbon = new Set(ligand.atoms.filter(a => a.element === 'C').map(a => a.id));
    return [...near].filter(n => point.get(n) && carbon.has(n)).sort((x, y) => len(sub(point.get(x), p)) - len(sub(point.get(y), p)))
      .find(n => !overMolecule(point, ligand.bonds, point.get(n), target, n, B, labels)) ?? id;
  };
  // Growth arrows: the most open hydrogen-bearing atoms, each pointing out of the molecule along its free side
  // with the open area written at the arrow. They depend on the ligand alone, so the layout, the drawing and the
  // legend agree on them and the residue tags are placed around them. `spread` ranks the spots for the value.
  const growthArrows = (ligand, pos, measured, B, widthOf, spread = () => 0) => {
    const points = [...pos.values()];
    const centre = { x: points.reduce((n, p) => n + p.x, 0) / (points.length || 1), y: points.reduce((n, p) => n + p.y, 0) / (points.length || 1) };
    const bonded = neighbours(ligand);
    const bonds = ligand.bonds.map(b => ({ a: pos.get(b.from), b: pos.get(b.to), ends: [b.from, b.to] })).filter(s => s.a && s.b);
    const out = [];
    const shaftClear = (a, b, id) => {
      for (const s of bonds) {
        if (s.ends.includes(id)) continue;
        if (segSeg(a, b, s.a, s.b) || pointSeg(s.a, a, b) < 1.6 || pointSeg(s.b, a, b) < 1.6) return false;
      }
      for (const [other, p] of pos) if (other !== id && pointSeg(p, a, b) < B * 0.78) return false;
      for (const g of out) if (segSeg(a, b, g.start, g.tip) || segHitsRect(a, b, g.rect, 1.6)) return false;
      return true;
    };
    const valueClear = r => {
      for (const p of points) if (pointRect(p, r) < B * 0.95) return false;
      for (const s of bonds) if (segHitsRect(s.a, s.b, r, 1.2)) return false;
      for (const g of out) if (overlap(r, g.rect, 1.4) || segHitsRect(g.start, g.tip, r, 1.8)) return false;
      return true;
    };
    const candidates = ligand.atoms.map(atom => ({ atom, m: measured.get(atom.id) }))
      .filter(x => x.m && x.atom.hydrogenCount > 0 && x.m.sasa >= GROW_MIN)
      .sort((x, y) => y.m.sasa - x.m.sasa || y.m.proximity - x.m.proximity || x.atom.id - y.atom.id);
    for (const { atom, m } of candidates) {
      if (out.length >= GROW_MAX) break;
      const p = pos.get(atom.id);
      if (!p || out.some(g => len(sub(g.p, p)) < B * 1.9)) continue;
      const near = (bonded.get(atom.id) || []).map(id => pos.get(id)).filter(Boolean);
      let open = near.reduce((sum, q) => { const u = unit(sub(p, q)); return { x: sum.x + u.x, y: sum.y + u.y }; }, { x: 0, y: 0 });
      if (len(open) < 0.3) open = sub(p, centre);
      open = unit(open);
      const outward = unit(sub(p, centre));
      const d = unit({ x: open.x * 0.75 + outward.x * 0.25, y: open.y * 0.75 + outward.y * 0.25 });
      const value = `${Math.round(m.sasa)} Å²`;
      const w = widthOf(value) + 1.2, h = VALUE * 1.15;
      const length = B * (1.15 + 0.85 * clamp(m.sasa / 30));
      for (const angle of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
        const u = turn(d, angle), normal = { x: -u.y, y: u.x };
        if (dot(u, open) < 0.25) continue;
        // labelled atoms draw their hydrogens beside the symbol, so sideways arrows start further out
        const start = at(p, u, B * (atom.label ? 0.85 + (atom.hydrogenCount ? 0.55 * Math.abs(u.x) : 0) : 0.5)), tip = at(start, u, length);
        if (!shaftClear(start, at(tip, u, B * 0.7), atom.id)) continue;
        const ahead = at(tip, u, 2.2 + Math.abs(u.x) * w / 2 + Math.abs(u.y) * h / 2);
        const beside = k => at(at(tip, u, -length * 0.45), normal, k * (2.4 + Math.abs(normal.x) * w / 2 + Math.abs(normal.y) * h / 2));
        const spots = [ahead, beside(1), beside(-1)].map(c => ({ c, rect: rectAt(c, w, h) })).filter(s => valueClear(s.rect));
        if (!spots.length) continue;
        const spot = spots.reduce((best, s) => (spread(s.rect) < spread(best.rect) - 0.01 ? s : best));
        out.push({ atom, m, p, u, start, tip, value, c: spot.c, rect: spot.rect });
        break;
      }
    }
    return out;
  };
  // the arrow itself as a box, for tags and lines that have to stay off it
  const shaftBox = g => ({ x0: Math.min(g.start.x, g.tip.x) - 2.2, y0: Math.min(g.start.y, g.tip.y) - 2.2,
    x1: Math.max(g.start.x, g.tip.x) + 2.2, y1: Math.max(g.start.y, g.tip.y) + 2.2 });

  window.LID_STUDIES['style-burial-map'] = {
    hideBase: 'partners',
    hideHydrophobic: true,

    // The pipeline packs neighbours wherever a disc fits, so contact lines would run across the molecule,
    // through other tags and over each other. Every tag with a contact looks for the spot where its lines,
    // and its relay legs through a water or a metal, stay clear of the ligand, the other tags and the other lines.
    prepare(data, H) {
      const scene = data.scene.scene, [ligand, ...partners] = scene.structures;
      const point = new Map(ligand.atoms.map(a => [a.id, a.coordinates]));
      const lengths = ligand.bonds.map(b => len(sub(point.get(b.from), point.get(b.to)))).sort((a, b) => a - b);
      const B = lengths[Math.floor(lengths.length / 2)] || 10.5;
      const byName = new Map(ligand.atoms.map(a => [a.additionalInformation?.atomName, a.id]));
      const bonded = neighbours(ligand);
      const tall = tallFrame();
      const frame = H.box([...point.values()]);
      const reach = columnReach(frame, B);
      // one entry per drawn ligand line: where it leaves the ligand and which atoms it may touch there
      const lines = new Map();
      const polar = new Set();
      const legs = [];
      const anchor = (sid, ids, c) => {
        const list = lines.get(sid) || lines.set(sid, []).get(sid);
        const key = ids.join(',');
        let line = list.find(l => l.key === key);
        if (!line) list.push(line = { key, ids, from: H.mean(ids.map(id => point.get(id))), apolar: true, count: 0, hbonds: 0, dot: false });
        line.count++;
        if (c.kind !== 'hydrophobic') { polar.add(sid); line.apolar = false; }
        if (c.kind === 'hbond') { line.hbonds++; line.dot ||= !!c.backbone; }
      };
      for (const c of data.contacts) {
        if (c.type && c.type !== 'hydrophobicContacts') {
          const edge = (scene[c.type] || []).find(e => e.id === c.id);
          if (!edge) continue;
          if (edge.fromStructure !== 0 && edge.toStructure !== 0) {
            if (!legs.some(l => l.a === edge.fromStructure && l.b === edge.toStructure)) legs.push({ a: edge.fromStructure, b: edge.toStructure });
            continue;
          }
          const fromLigand = edge.fromStructure === 0;
          const id = fromLigand ? edge.from : edge.to;
          const ring = (c.type === 'piStackings' || (c.type === 'cationPiStackings' && fromLigand)) && (ligand.rings || []).find(r => r.id === id);
          anchor(fromLigand ? edge.toStructure : edge.fromStructure, ring ? ring.atoms : [id], c);
        } else if (c.structure && byName.has(c.ligandAtom)) anchor(c.structure, [byName.get(c.ligandAtom)], { kind: 'hydrophobic' });
      }
      const centreOf = s => { const b = H.box(s.atoms.map(a => a.coordinates)); return { x: b.x, y: b.y }; };
      // the room a tag will take once its text is measured
      const sizeOf = s => {
        const info = s.additionalInformation || {};
        if (info.class === 'water') return [8, 8];
        if (info.class === 'metal') return [11, 10.5];
        const width = (`${info.name || ''}${info.number ?? ''}`.length + (info.chainLabel ? 1.3 : 0)) * NAME * 0.56;
        return info.tier === 'context' ? [width + 2, 7.4] : [width + 7, 10];
      };
      const grow = state.layers.exposure ? growthArrows(ligand, point, new Map(data.overlay.ligandAtoms.map(m => [m.atom, m])), B,
        value => value.length * VALUE * 0.55, tall ? rect => beyond(rect, frame.x, reach) : undefined) : [];
      const blocks = grow.flatMap(g => [g.rect, shaftBox(g)]);
      const labels = hydrogenLabels(point, ligand, bonded, B);
      const lettered = new Set(ligand.atoms.filter(a => a.label || a.element !== 'C').map(a => a.id));
      // atoms, hydrogens and bonds a line runs over, not counting the atoms it starts from
      const ligandCrossings = (ids, from, to) => {
        const near = new Set(ids.flatMap(id => [id, ...(bonded.get(id) || [])]));
        let count = 0;
        for (const [id, p] of point) {
          if (near.has(id)) continue;
          const distance = pointSeg(p, from, to);
          // a line over an element symbol hides it and a line over the end of a bond reads as one more bond,
          // which is as bad as a crossing
          if (distance < B * (lettered.has(id) ? 0.6 : 0.32)) count += 4;
          else if (distance < B * 1.3) count += distance < B * 0.55 ? 1 : distance < B * 0.95 ? 0.5 : 0.25;
        }
        for (const h of labels) if (!ids.includes(h.id) && pointSeg(h, from, to) < B * 0.55) count += 4;
        // a line to the middle of a ring crosses the ring between two atoms, not through one of them
        if (ids.length > 1) for (const id of ids) if (pointSeg(point.get(id), from, to) < B * 0.3) count += 2;
        for (const b of ligand.bonds) {
          if (ids.includes(b.from) || ids.includes(b.to)) continue;
          if (segSeg(from, to, point.get(b.from), point.get(b.to))) count += 4;
        }
        return count;
      };
      // An apolar line starts where the drawing will start it. Candidate spots are fixed objects,
      // so each line remembers its start per spot.
      const startOf = (line, to) => {
        const known = (line.seen ||= new Map()).get(to);
        if (known) return known;
        const ids = line.apolar && line.ids.length === 1 ? [apolarStart(point, ligand, bonded, line.ids[0], to, B, labels)] : line.ids;
        const from = ids === line.ids ? line.from : point.get(ids[0]);
        const start = { from, ids, cross: ligandCrossings(ids, from, to) };
        line.seen.set(to, start);
        return start;
      };
      const touches = (a, b) => overlap(a, b, 2.5);
      // A polar line has to stay long enough for what it carries: its dashes, or an arrowhead for every
      // hydrogen bond and the backbone dot. What shows is the stretch between the atom label and the tag.
      const atomOf = new Map(ligand.atoms.map(a => [a.id, a]));
      const need = line => (line.apolar ? 0 : line.hbonds ? 7 + 5.2 * line.hbonds + (line.dot ? 2.5 : 0) : 9);
      const hydrogenSide = new Map(labels.map(h => [h.id, h.d]));
      const hidden = (ids, u) => (ids.length === 1 ? atomGap(atomOf.get(ids[0]), u, hydrogenSide.get(ids[0]), B) : B);
      const edge = (m, u) => 1.1 + (m.round ? m.w / 2 : Math.min(u.x ? m.w / 2 / Math.abs(u.x) : Infinity, u.y ? m.h / 2 / Math.abs(u.y) : Infinity));
      const nodes = new Map();
      for (const s of partners) {
        const list = lines.get(s.id) || [];
        if (!list.length && !legs.some(l => l.a === s.id || l.b === s.id)) continue;
        const home = centreOf(s), [w, h] = sizeOf(s);
        nodes.set(s.id, { s, lines: list, home, w, h, c: home, rect: rectAt(home, w, h), starts: [], round: s.additionalInformation?.class === 'water' });
      }
      const column = columnReach(frame, B, Math.max(0, ...[...nodes.values()].map(m => m.w)));
      const legsOf = new Map([...nodes.keys()].map(id => [id, legs.filter(l => (l.a === id || l.b === id) && nodes.has(l.a) && nodes.has(l.b))]));
      const settleStarts = m => { m.starts = m.lines.map(line => startOf(line, m.c)); };
      nodes.forEach(settleStarts);
      // every drawn segment of the current layout, tagged with the nodes and atoms it ends on
      const segments = (skip, active) => {
        const out = [];
        for (const n of active) {
          if (n === skip) continue;
          n.starts.forEach((st, i) => out.push({ a: st.from, b: n.c, nodes: [n.s.id], ids: st.ids, count: n.lines[i].count, polar: !n.lines[i].apolar }));
        }
        for (const l of legs) {
          if (!active.has(nodes.get(l.a)) || !active.has(nodes.get(l.b)) || l.a === skip.s.id || l.b === skip.s.id) continue;
          out.push({ a: nodes.get(l.a).c, b: nodes.get(l.b).c, nodes: [l.a, l.b], ids: [], count: 1 });
        }
        return out;
      };
      const cost = (m, c, others, active) => {
        const rect = rectAt(c, m.w, m.h), id = m.s.id;
        let score = (polar.has(id) ? 0.5 : 0.35) * len(sub(c, m.home));
        if (tall) score += 16 * beyond(rect, frame.x, column);
        const mine = [];
        for (const line of m.lines) {
          const st = startOf(line, c), span = len(sub(c, st.from)), u = unit(sub(c, st.from));
          score += span / m.lines.length + 100 * st.cross + 30 * Math.max(0, need(line) - (span - edge(m, u) - hidden(st.ids, u)));
          mine.push({ a: st.from, b: c, nodes: [id], ids: st.ids, count: line.count, polar: !line.apolar });
        }
        for (const l of legsOf.get(id)) {
          const other = nodes.get(l.a === id ? l.b : l.a);
          if (!active.has(other)) continue;
          const span = len(sub(c, other.c)), u = unit(sub(other.c, c));
          score += 0.5 * span + 4 * Math.max(0, B * 2.4 - span) + 30 * Math.max(0, 8 - (span - edge(m, u) - edge(other, u))) +
            100 * ligandCrossings([], c, other.c);
          mine.push({ a: c, b: other.c, nodes: [l.a, l.b], ids: [], count: 1 });
        }
        for (const s of mine) for (const o of others) {
          if (o.nodes.some(n => s.nodes.includes(n))) continue;
          // polar lines leaving one atom need some angle between them, or their doubled strokes and marks cross
          if (s.ids.length === 1 && o.ids.length === 1 && s.ids[0] === o.ids[0]) {
            if (s.polar && o.polar && dot(unit(sub(s.b, s.a)), unit(sub(o.b, o.a))) > 0.975) score += 300;
            continue;
          }
          if (segSeg(s.a, s.b, o.a, o.b)) score += 400 * s.count * o.count;
        }
        for (const n of active) {
          if (n === m) continue;
          if (touches(rect, n.rect)) score += 600;
          for (const s of mine) if (!s.nodes.includes(n.s.id) && segHitsRect(s.a, s.b, n.rect, 1.5)) score += 2000;
        }
        for (const o of others) if (!o.nodes.includes(id) && segHitsRect(o.a, o.b, rect, 1.5)) score += 2000;
        // growth arrows and their values are placed first; tags and lines keep off them
        for (const b of blocks) {
          if (touches(rect, b)) score += 600;
          for (const s of mine) if (segHitsRect(s.a, s.b, b, 1.2)) score += 1200;
        }
        return score;
      };
      const reachOf = m => Math.max(0, ...m.lines.map(line => len(sub(m.home, line.from))));
      const clear = (m, c) => {
        const rect = rectAt(c, m.w, m.h);
        for (const p of point.values()) if (pointRect(p, rect) < B * 1.75) return false;
        for (const b of blocks) if (touches(rect, b)) return false;
        return true;
      };
      const ring = (m, centres, reaches, steps = 32) => centres.flatMap(from => reaches.flatMap(reach => Array.from({ length: steps }, (_, k) =>
        ({ x: from.x + Math.cos(k * 2 * Math.PI / steps) * B * reach, y: from.y + Math.sin(k * 2 * Math.PI / steps) * B * reach })))).filter(c => clear(m, c));
      const radii = [2.7, 3.3, 3.9, 4.7, 5.6, 6.6, 7.7, 8.9];
      const originOf = m => H.mean(m.lines.map(line => line.from));
      for (const m of nodes.values()) if (m.lines.length) m.spots = ring(m, [originOf(m)], radii);
      const all = new Set(nodes.values());
      // a tag reached only through a water or a metal looks around that mediator wherever it currently is
      const spotsOf = m => {
        if (m.spots) return m.spots;
        const centres = legsOf.get(m.s.id).map(l => nodes.get(l.a === m.s.id ? l.b : l.a).c);
        const seen = m.around ||= new Map();
        if (centres.length === 1 && seen.has(centres[0])) return seen.get(centres[0]);
        const spots = ring(m, centres, [1.6, 2.2, 2.9, 3.7]);
        if (centres.length === 1) seen.set(centres[0], spots);
        return spots;
      };
      const put = (m, c) => { m.c = c; m.rect = rectAt(c, m.w, m.h); settleStarts(m); };
      const total = () => [...nodes.values()].reduce((sum, m) => sum + cost(m, m.c, segments(m, all), all), 0);
      const sweep = active => {
        let moved = false;
        for (const m of order) {
          active.add(m);
          const others = segments(m, active);
          let best = { c: m.c, score: cost(m, m.c, others, active) - 4 };
          for (const c of [m.home, ...spotsOf(m)]) {
            const score = cost(m, c, others, active);
            if (score < best.score) best = { c, score };
          }
          moved ||= best.c !== m.c;
          put(m, best.c);
        }
        return moved;
      };
      // Greedy start: the most connected tags first, each seeing only the tags placed before it.
      const weight = m => m.lines.length + legsOf.get(m.s.id).length;
      const order = [...nodes.values()].sort((a, b) => polar.has(b.s.id) - polar.has(a.s.id) || weight(b) - weight(a) || reachOf(a) - reachOf(b) || a.s.id - b.s.id);
      sweep(new Set());
      sweep(all);
      // Greedy moves stall where two tags must trade places, so seeded annealing explores the spots:
      // several short runs from the greedy layout find the right basin, one longer cooler run settles it.
      let seed = 7;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const list = [...nodes.values()];
      const start = new Map(list.map(m => [m, m.c]));
      let best = { score: total(), at: start };
      const flock = new Map(list.map(m => [m, legsOf.get(m.s.id).map(l => nodes.get(l.a === m.s.id ? l.b : l.a)).filter(n => !n.lines.length && legsOf.get(n.s.id).length === 1)]));
      const anneal = (from, steps, heat) => {
        for (const [m, c] of from) put(m, c);
        let now = total(), weights = [], sum = 0;
        for (let i = 0; i < steps; i++) {
          const t = heat * Math.pow(2 / heat, i / steps);
          // troubled tags are picked more often
          if (i % 40 === 0) { weights = list.map(n => cost(n, n.c, segments(n, all), all) + 20); sum = weights.reduce((x, y) => x + y, 0); }
          let pick = random() * sum, k = 0;
          while (k < list.length - 1 && (pick -= weights[k]) > 0) k++;
          const m = list[k], spots = spotsOf(m);
          const c = random() < 0.1 ? m.home : spots[Math.floor(random() * spots.length)];
          if (!c) continue;
          const followers = flock.get(m);
          if (followers.length && random() < 0.5) {
            // a water or metal hub carries the residues it alone connects to
            const shift = sub(c, m.c), moved = followers.map(n => ({ n, from: n.c, to: { x: n.c.x + shift.x, y: n.c.y + shift.y } }));
            if (!moved.every(f => clear(f.n, f.to))) continue;
            const was = m.c;
            put(m, c); moved.forEach(f => put(f.n, f.to));
            const after = total();
            if (after > now && random() >= Math.exp((now - after) / 2 / t)) { put(m, was); moved.forEach(f => put(f.n, f.from)); continue; }
            now = after;
            if (now < best.score) best = { score: now, at: new Map(list.map(n => [n, n.c])) };
            continue;
          }
          const others = segments(m, all), before = cost(m, m.c, others, all), after = cost(m, c, others, all);
          if (after > before && random() >= Math.exp((before - after) / t)) continue;
          put(m, c);
          now += 2 * (after - before);
          if (now < best.score - 1) {
            now = total();
            if (now < best.score) best = { score: now, at: new Map(list.map(n => [n, n.c])) };
          }
        }
      };
      for (let run = 0; run < 8; run++) anneal(start, list.length * 150, 500);
      anneal(best.at, list.length * 600, 250);
      for (const [m, c] of best.at) put(m, c);
      // each tag takes its best spot until none of them moves
      const settleAll = () => { for (let pass = 0; pass < 6 && sweep(all); pass++); };
      settleAll();
      // A tag that still pays for a line over the molecule may only need a direction between the usual ones,
      // so it looks again on a six times finer ring.
      let mended = false;
      for (const m of order) {
        if (!m.spots) continue;
        const others = segments(m, all);
        let found = { c: m.c, score: cost(m, m.c, others, all) };
        if (found.score < 300) continue;
        for (const c of ring(m, [originOf(m)], radii, 192)) {
          const score = cost(m, c, others, all);
          if (score < found.score - 4) found = { c, score };
        }
        if (found.c === m.c) continue;
        put(m, found.c);
        m.spots.push(found.c);
        mended = true;
      }
      if (mended) settleAll();
      for (const m of nodes.values()) if (len(sub(m.c, m.home)) > 0.01) H.move(data, m.s.id, m.c.x, m.c.y);
    },

    draw(ctx) {
      const { el, hit, root, under, ligand, contacts, fg, bg, muted, hair, data, H } = ctx;
      const P = PALETTES[ctx.theme] || PALETTES.light;
      const font = styleOf().fontFamily || 'Helvetica, Arial, sans-serif';
      const scene = data.scene.scene;
      const layers = state.layers;
      const tall = tallFrame();
      const text = (x, y, value, attrs = {}, parent = root) => ctx.text(x, y, value, { 'font-family': font, ...attrs }, parent);
      const pos = new Map(ligand.atoms.map(a => [a.id, ctx.liveAtom(0, a.id)]).filter(([, p]) => p));
      const bondLengths = ligand.bonds.map(b => pos.get(b.from) && pos.get(b.to) ? len(sub(pos.get(b.from), pos.get(b.to))) : 0)
        .filter(Boolean).sort((a, b) => a - b);
      const B = bondLengths[Math.floor(bondLengths.length / 2)] || 10.5;
      const centre = H.mean([...pos.values()]);
      const frame = H.box([...pos.values()]);
      const measured = new Map(data.overlay.ligandAtoms.map(m => [m.atom, m]));
      root.setAttribute('data-study', 'style-burial-map');

      // ---- field: one soft disc per ligand atom, coloured by the surface it keeps in the complex
      const blur = 'lid-burial-map-blur';
      let apolarLayer = null;
      if (layers.exposure) {
        overlay.smudges.replaceChildren();
        const area = H.box([...pos.values()], B * 5);
        const group = el('g', { class: 'burial-field', 'pointer-events': 'none' }, under);
        const filter = el('filter', { id: blur, filterUnits: 'userSpaceOnUse', x: area.left, y: area.top,
          width: area.width, height: area.height, 'color-interpolation-filters': 'sRGB' }, group);
        el('feGaussianBlur', { stdDeviation: (B * 0.42).toFixed(2) }, filter);
        const layer = el('g', { filter: `url(#${blur})` }, group);
        for (const atom of ligand.atoms) {
          const p = pos.get(atom.id), m = measured.get(atom.id);
          if (!p || !m) continue;
          const t = clamp(m.sasa / EXPOSED_FULL);
          const buried = 0.35 + 0.65 * clamp((m.free - m.sasa) / BURIED_FULL);
          el('circle', { cx: p.x, cy: p.y, r: (B * (0.8 + 0.25 * t)).toFixed(2), fill: rampColor(P, t),
            'fill-opacity': rampAlpha(P, t, buried).toFixed(3), 'data-atom-id': atom.id, 'data-sasa': m.sasa, 'data-free': m.free }, layer);
        }
        apolarLayer = el('g', { filter: `url(#${blur})`, class: 'burial-apolar' }, group);
      }
      // The pocket contour follows the ligand at a constant distance, so it says nothing the field does not. This
      // design has no contour of its own; when the layer is switched on, the shared dotted one shows through
      // and plain text, which has no backing, stays off it.
      const contourSegs = [];
      if (layers.contour) {
        const tf = ligandTransform();
        for (const points of data.overlay.contour) {
          const live = points.filter((_, i) => i % 3 === 0 || i === points.length - 1).map(p => { const q = tf(p); return { x: q[0], y: q[1] }; });
          for (let i = 1; i < live.length; i++) contourSegs.push({ a: live[i - 1], b: live[i] });
        }
      }
      if (layers.halos) overlay.halos.replaceChildren();

      // ---- occupancy of everything that is drawn, so labels take the nearest free spot
      const rects = [];
      const segs = [];
      for (const atom of ligand.atoms) {
        const p = pos.get(atom.id);
        if (!p) continue;
        const wide = atom.label ? (atom.hydrogenCount || atom.charge ? 0.8 : 0.5) : 0.3;
        rects.push({ ...rectAt(p, B * wide * 2, B * (atom.label ? 0.9 : 0.6)), owner: 'ligand' });
      }
      for (const bond of ligand.bonds) {
        const a = pos.get(bond.from), b = pos.get(bond.to);
        if (a && b) segs.push({ a, b, owner: 'ligand', ends: [bond.from, bond.to] });
      }
      const isFree = (r, o = {}) => {
        const pad = o.pad ?? 1.2;
        for (const q of rects) {
          if (q.owner === o.skip) continue;
          if (overlap(r, q, pad)) return false;
        }
        for (const s of segs) {
          if (s.owner === o.skip || (o.skipNode != null && s.nodes?.includes(o.skipNode))) continue;
          if (segHitsRect(s.a, s.b, r, pad * 0.7)) return false;
        }
        if (o.contour) for (const s of contourSegs) if (segHitsRect(s.a, s.b, r, 0.5)) return false;
        if (o.clear) for (const p of pos.values()) if (pointRect(p, r) < o.clear) return false;
        return true;
      };
      const place = (preferred, w, h, o = {}) => {
        const base = Math.atan2(preferred.y - centre.y, preferred.x - centre.x);
        for (let r = 0; r <= B * (o.reach || 7); r += B * 0.25) {
          const steps = r ? 16 : 1;
          for (let k = 0; k < steps; k++) {
            // alternate around the outward direction so ties resolve away from the ligand
            const angle = base + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI * 2 / steps);
            const c = { x: preferred.x + Math.cos(angle) * r, y: preferred.y + Math.sin(angle) * r };
            if (isFree(rectAt(c, w, h), o)) return c;
          }
        }
        return o.required ? preferred : null;
      };
      const measure = (value, attrs) => {
        const node = text(0, 0, value, attrs);
        const width = node.getComputedTextLength?.() || value.length * (attrs['font-size'] || 6) * 0.56;
        node.remove();
        return width;
      };

      // ---- growth arrows claim their room before any tag does
      const grow = layers.exposure ? growthArrows(ligand, pos, measured, B, value => measure(value, { 'font-size': VALUE }),
        tall ? rect => beyond(rect, frame.x, columnReach(frame, B)) : undefined) : [];
      for (const g of grow) {
        rects.push({ ...g.rect, owner: 'grow' }, { ...shaftBox(g), owner: 'grow' });
        segs.push({ a: g.start, b: g.tip, owner: 'grow' });
      }

      // ---- residue tags
      const barRoom = layers.halos ? 2.6 : 0;
      const nodes = new Map();
      for (const s of ctx.partners) {
        if (!structureVisible(s.id)) continue;
        const info = s.additionalInformation || {};
        const kind = info.class === 'water' ? 'water' : info.class === 'metal' ? 'metal' : info.tier === 'context' ? 'context' : 'strong';
        nodes.set(s.id, { s, info, kind, id: s.id, home: { x: s.box.x, y: s.box.y } });
      }

      // ---- contact topology: the ligand end first when there is one, relays keep mediator -> receptor
      const atomByName = new Map(ligand.atoms.map(a => [a.additionalInformation?.atomName, a]));
      const end = (sid, id, ring) => {
        if (sid === 0) {
          const group = ring && (ligand.rings || []).find(r => r.id === id);
          if (group) {
            const points = group.atoms.map(a => pos.get(a)).filter(Boolean);
            return points.length ? { sid, key: `ring${id}`, ring: true, p: H.mean(points) } : null;
          }
          const atom = ligand.atoms.find(a => a.id === id);
          return atom && pos.get(id) ? { sid, key: `atom${id}`, atom, p: pos.get(id) } : null;
        }
        const node = nodes.get(sid);
        return node ? { sid, key: `node${sid}`, node } : null;
      };
      const plans = [];
      for (const c of contacts) {
        if (!c.visible) continue;
        const record = c.record;
        let a, b;
        if (record.type && record.type !== 'hydrophobicContacts') {
          const edge = (scene[record.type] || []).find(e => e.id === record.id);
          if (!edge) continue;
          a = end(edge.fromStructure, edge.from, record.type === 'piStackings' || record.type === 'cationPiStackings');
          b = end(edge.toStructure, edge.to, record.type === 'piStackings');
        } else {
          const atom = atomByName.get(record.ligandAtom);
          const sid = record.structure || [...nodes.values()].find(n => n.info.chain === record.residueKey?.[0] &&
            n.info.number === record.residueKey?.[1])?.id;
          a = atom && end(0, atom.id, false);
          b = sid ? end(sid) : null;
        }
        if (!a || !b) continue;
        if (b.sid === 0) [a, b] = [b, a];
        if (!b.node) continue;
        plans.push({ c, kind: record.kind, a, b, pair: `${a.key}|${b.key}` });
      }
      const pairs = new Map();
      for (const p of plans) pairs.set(p.pair, [...(pairs.get(p.pair) || []), p]);
      // contacts of one kind between the same atom and the same residue share one line
      const bundles = new Map();
      for (const p of plans) bundles.set(`${p.pair}|${p.kind}`, [...(bundles.get(`${p.pair}|${p.kind}`) || []), p]);
      // on a shared line the backbone contact sits next to the residue, where the backbone dot is drawn
      for (const group of bundles.values()) group.sort((x, y) => !!x.c.record.backbone - !!y.c.record.backbone);
      const linked = new Set(plans.flatMap(p => [p.a.node?.id, p.b.node.id]));
      // The side panel names only what carries a contact. A wide frame has room for the rest of the pocket.
      if (tall) for (const id of [...nodes.keys()]) if (!linked.has(id)) nodes.delete(id);
      for (const n of nodes.values()) {
        if (n.kind === 'water') { n.r = 3.9; n.w = n.h = 7.8; continue; }
        if (n.kind === 'metal') {
          n.name = n.s.atoms[0]?.element || title(n.info.name);
          n.weight = 600;
          n.textWidth = measure(n.name, { 'font-size': NAME, 'font-weight': n.weight });
          n.w = Math.max(10.5, n.textWidth + 4.6);
          n.h = 10.5;
          continue;
        }
        const plate = n.kind === 'strong';
        n.name = `${title(n.info.name)}${n.info.number ?? ''}`;
        // the chain the pipeline asks to print: empty while the whole pocket sits on one chain
        n.chain = n.info.chainLabel || '';
        n.weight = plate ? 500 : 400;
        n.textWidth = measure(n.name, { 'font-size': NAME, 'font-weight': n.weight }) + (n.chain ? 0.9 + measure(n.chain, { 'font-size': NAME }) : 0);
        n.w = n.textWidth + (plate ? 7 : 2);
        n.h = (plate ? 10 : 7.4) + barRoom;
      }
      // A pocket residue without a contact line is tied to the ligand by nothing but its place, so it sits just
      // outside the field, beside the atoms it lines.
      const hug = n => {
        let nearest = null, gap = Infinity;
        for (const p of pos.values()) { const d = len(sub(n.home, p)); if (d < gap) { gap = d; nearest = p; } }
        if (!nearest) return n.home;
        const u = unit(sub(n.home, nearest)), out = B * 1.7 + Math.abs(u.x) * n.w / 2 + Math.abs(u.y) * n.h / 2;
        return gap > out ? at(nearest, u, out) : n.home;
      };
      const settle = (n, o = {}) => {
        // a tag with a contact keeps enough distance for the line to carry its arrow and end mark
        const tied = linked.has(n.id);
        n.c = place(tied ? n.home : hug(n), n.w, n.h, { clear: B * (tied ? 1.75 : 1.5), pad: 1.4, required: true, contour: n.kind === 'context', ...o });
        n.rect = { ...rectAt(n.c, n.w, n.h), owner: `node${n.id}` };
        rects.push(n.rect);
      };
      // tags that carry a contact claim their spot before the plain context tags
      const rank = n => (n.kind === 'context' ? 1 : 0) + (linked.has(n.id) ? 0 : 2);
      const order = [...nodes.values()].sort((a, b) => rank(a) - rank(b) ||
        len(sub(a.home, centre)) - len(sub(b.home, centre)) || a.id - b.id);
      order.forEach(n => settle(n));
      // where a line that aims at `target` inside the tag leaves the tag outline
      const leave = (n, target, u) => {
        if (n.r) return at(n.c, u, n.r + 1.1);
        const tx = u.x > 0 ? (n.rect.x1 - target.x) / u.x : u.x < 0 ? (n.rect.x0 - target.x) / u.x : Infinity;
        const ty = u.y > 0 ? (n.rect.y1 - target.y) / u.y : u.y < 0 ? (n.rect.y0 - target.y) / u.y : Infinity;
        return at(target, u, Math.min(tx, ty) + 1.1);
      };
      // An apolar contact touches a patch of the ligand, not one atom. When the line from the nearest atom
      // would run over the molecule, it starts from a bonded or same-ring atom with a clear view of the tag,
      // and failing that from the point where it leaves the molecule.
      const bondedIds = neighbours(ligand);
      const hydrogens = hydrogenLabels(pos, ligand, bondedIds, B);
      const hydrogenSide = new Map(hydrogens.map(h => [h.id, h.d]));
      const overLigand = (a, b, id) => overMolecule(pos, ligand.bonds, a, b, id, B, hydrogens);
      const apolarEnd = (a, target) => {
        const id = apolarStart(pos, ligand, bondedIds, a.atom.id, target, B, hydrogens);
        return id === a.atom.id ? a : end(0, id, false);
      };
      const leaveLigand = (from, to, id) => {
        let last = 0;
        for (let k = 1; k <= 60; k++) {
          const q = { x: from.x + (to.x - from.x) * k / 60, y: from.y + (to.y - from.y) * k / 60 };
          let inside = false;
          for (const [other, r] of pos) if (other !== id && len(sub(q, r)) < B * 0.5) { inside = true; break; }
          for (const h of hydrogens) if (h.id !== id && len(sub(q, h)) < B * 0.45) inside = true;
          if (!inside) for (const bond of ligand.bonds) {
            const r = pos.get(bond.from), s = pos.get(bond.to);
            if (r && s && bond.from !== id && bond.to !== id && pointSeg(q, r, s) < B * 0.2) { inside = true; break; }
          }
          if (inside) last = k / 60;
        }
        return at(from, unit(sub(to, from)), len(sub(to, from)) * last + B * 0.3);
      };
      const route = () => {
        for (let i = segs.length - 1; i >= 0; i--) if (segs[i].contact) segs.splice(i, 1);
        for (const p of plans) if (p.kind === 'hydrophobic' && !p.a.node) p.a = apolarEnd(p.a0 || (p.a0 = p.a), p.b.node.c);
        // lines arriving at one tag spread along its facing edge instead of stacking on its centre
        for (const p of plans) { p.aim = p.b.node.c; p.aimFrom = p.a.node?.c; }
        for (const n of nodes.values()) {
          if (n.r) continue;
          const arriving = [...bundles.values()].filter(([p]) => p.b.node === n || p.a.node === n).map(group => ({ group, p: group[0],
            far: group[0].b.node === n, other: group[0].b.node === n ? (group[0].a.node ? group[0].a.node.c : group[0].a.p) : group[0].b.node.c }));
          if (arriving.length < 2) continue;
          const mean = arriving.reduce((sum, x) => { const u = unit(sub(x.other, n.c)); return { x: sum.x + u.x, y: sum.y + u.y }; }, { x: 0, y: 0 });
          const tangent = Math.abs(mean.x) > Math.abs(mean.y) ? { x: 0, y: 1 } : { x: 1, y: 0 };
          const gap = Math.min(3.8, ((tangent.x ? n.w : n.h) - 4.4) / (arriving.length - 1));
          // ports follow the directions the lines arrive from, so lines into one tag never cross each other
          arriving.sort((x, y) => dot(unit(sub(x.other, n.c)), tangent) - dot(unit(sub(y.other, n.c)), tangent) || x.p.c.index - y.p.c.index);
          arriving.forEach((x, i) => {
            const port = at(n.c, tangent, (i - (arriving.length - 1) / 2) * gap);
            for (const p of x.group) if (x.far) p.aim = port; else p.aimFrom = port;
          });
        }
        for (const p of plans) {
          const origin = p.a.node ? p.aimFrom : p.a.p;
          const u = unit(sub(p.aim, origin)), normal = { x: -u.y, y: u.x };
          let start = p.a.node ? leave(p.a.node, origin, u) : p.a.ring ? origin
            : at(origin, u, atomGap(p.a.atom, u, hydrogenSide.get(p.a.atom.id), B));
          const stop = leave(p.b.node, p.aim, { x: -u.x, y: -u.y });
          if (p.kind === 'hydrophobic' && !p.a.node && overLigand(start, stop, p.a.atom.id)) start = leaveLigand(origin, stop, p.a.atom.id);
          const group = pairs.get(p.pair);
          const shift = p.b.node.r ? (group.indexOf(p) - (group.length - 1) / 2) * 2.5 : 0;
          Object.assign(p, { origin, u, normal, p0: at(start, normal, shift), p1: at(stop, normal, shift), crowded: group.length > 1 });
          segs.push({ a: p.p0, b: p.p1, owner: `contact${p.c.index}`, contact: true,
            nodes: [p.a.node?.id, p.b.node.id].filter(id => id != null) });
        }
      };
      route();
      // a tag that ended up under somebody else's contact line moves to the nearest spot clear of all lines
      for (let pass = 0, moved = true; moved && pass < 3; pass++) {
        moved = false;
        for (const n of [...order].reverse()) {
          const crossed = segs.some(s => s.contact && !s.nodes.includes(n.id) && segHitsRect(s.a, s.b, n.rect, 0.6));
          if (!crossed) continue;
          rects.splice(rects.indexOf(n.rect), 1);
          settle(n, { skipNode: n.id });
          route();
          moved = true;
        }
      }

      // ---- growth arrows: a blue arrow out of the open atom and the area that is still open there
      for (const g of grow) {
        const normal = { x: -g.u.y, y: g.u.x };
        const group = el('g', { class: 'burial-growth', 'data-atom-id': g.atom.id, 'data-sasa': g.m.sasa, 'pointer-events': 'none' }, under);
        el('path', { d: `M${g.start.x.toFixed(2)},${g.start.y.toFixed(2)}L${g.tip.x.toFixed(2)},${g.tip.y.toFixed(2)}`, fill: 'none', stroke: P.cool,
          'stroke-width': 1.1, 'stroke-linecap': 'round' }, group);
        const back = at(g.tip, g.u, -3.2), left = at(back, normal, 2), right = at(back, normal, -2);
        el('path', { d: `M${left.x.toFixed(2)},${left.y.toFixed(2)}L${g.tip.x.toFixed(2)},${g.tip.y.toFixed(2)}L${right.x.toFixed(2)},${right.y.toFixed(2)}`,
          fill: 'none', stroke: P.cool, 'stroke-width': 1.1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, group);
        text(g.c.x, g.c.y + VALUE * 0.36, g.value, { 'font-size': VALUE, 'text-anchor': 'middle', fill: P.cool }, group);
      }

      // ---- contacts: thin typed lines from the exact ligand atom to the tag
      for (const p of plans) {
        const { c, kind, u, normal, p0, p1 } = p;
        const selected = c.index === ctx.selected;
        const ink = c.color;
        const width = (WIDTH[kind] || LINE) * (selected ? 1.75 : 1);
        const g = hit(el('g', { class: 'burial-contact', 'data-kind': kind, 'data-from-structure': p.a.sid,
          'data-to-structure': p.b.sid }, under), c.index);
        p.g = g;
        const dash = DASH[kind];
        // contacts that share a line sit side by side along it, each with its own stretch to point at
        const bundle = p.b.node.r ? [p] : bundles.get(`${p.pair}|${kind}`), slot = bundle.indexOf(p), span = len(sub(p1, p0));
        const along = k => at(p0, u, Math.max(0, Math.min(span, span / 2 + (k - bundle.length / 2) * 5.2)));
        const stroke = (a, b) => el('path', { d: `M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`, fill: 'none',
          stroke: ink, 'stroke-width': width, 'stroke-linecap': kind === 'metal' ? 'round' : 'butt',
          ...(dash ? { 'stroke-dasharray': dash } : {}), ...(bundle.length > 1 ? { 'pointer-events': 'none' } : {}),
          class: 'burial-contact-line' }, g);
        if (kind === 'ionic') {
          stroke(at(p0, normal, 1.1), at(p1, normal, 1.1));
          stroke(at(p0, normal, -1.1), at(p1, normal, -1.1));
        } else stroke(p0, p1);
        if (kind === 'hydrophobic' && apolarLayer && !p.a.node) {
          const patch = at(p.origin, u, B * 0.95);
          el('circle', { cx: patch.x, cy: patch.y, r: (B * 0.44).toFixed(2), fill: P.apolar, 'fill-opacity': 0.5,
            'data-contact': c.index }, apolarLayer);
        }
        if (p.a.ring) el('circle', { cx: p.origin.x, cy: p.origin.y, r: B * 0.24, fill: 'none', stroke: ink, 'stroke-width': LINE }, g);
        if (kind === 'cationPi') {
          const plus = at(p.a.ring ? p1 : p0, p.a.ring ? { x: -u.x, y: -u.y } : u, 3.4), q = at(plus, normal, 2.9);
          el('path', { d: `M${q.x - 1.5},${q.y}h3M${q.x},${q.y - 1.5}v3`, fill: 'none', stroke: ink, 'stroke-width': 0.7 }, g);
        }
        if (kind === 'hbond') {
          const head = (m, d) => {
            const tip = at(m, d, 2.3), base = at(m, d, -2), l = at(base, normal, 1.75), r = at(base, normal, -1.75);
            el('path', { d: `M${tip.x},${tip.y}L${l.x},${l.y}L${r.x},${r.y}Z`, fill: ink, class: 'burial-donor-arrow' }, g);
          };
          const middle = at(p0, u, span / 2 + (slot - (bundle.length - 1) / 2) * 5.2);
          const direction = c.record.direction;
          if (direction === 'ligand->partner') head(middle, u);
          else if (direction === 'partner->ligand') head(middle, { x: -u.x, y: -u.y });
          else if (direction === 'both') {
            const a = at(middle, u, 2.8), b = at(middle, u, -2.8), l = at(middle, normal, 1.6), r = at(middle, normal, -1.6);
            el('path', { d: `M${a.x},${a.y}L${l.x},${l.y}L${b.x},${b.y}L${r.x},${r.y}Z`, fill: ink, class: 'burial-donor-both' }, g);
          }
          // a dot at the residue end marks a backbone atom; a side-chain atom gets no mark
          if (c.record.backbone) {
            const mark = at(p1, u, -1.5);
            el('circle', { cx: mark.x, cy: mark.y, r: 1.5, fill: ink, class: 'burial-backbone' }, g);
          }
        }
        const h0 = slot ? along(slot) : p0, h1 = slot < bundle.length - 1 ? along(slot + 1) : p1;
        el('path', { d: `M${h0.x},${h0.y}L${h1.x},${h1.y}`, fill: 'none', stroke: 'transparent',
          'stroke-width': p.crowded ? 3 : 6, 'pointer-events': 'stroke' }, g);
      }

      // ---- tags
      const maxLoss = Math.max(1, ...[...nodes.values()].map(n => n.info.sasaLoss || 0));
      for (const n of nodes.values()) {
        const g = el('g', { class: `binding-residue burial-tag burial-${n.kind}`, 'data-structure-id': n.id });
        const { x, y } = n.c;
        if (n.kind === 'water') {
          el('circle', { cx: x, cy: y, r: n.r, fill: P.surface, stroke: P.water, 'stroke-width': 0.8 }, g);
          el('circle', { cx: x, cy: y, r: 1.25, fill: P.water }, g);
          continue;
        }
        if (n.kind === 'metal') {
          el('rect', { x: x - n.w / 2, y: y - n.h / 2, width: n.w, height: n.h, rx: 2.6, fill: P.metal, stroke: muted, 'stroke-width': 0.6 }, g);
          text(x, y + NAME * 0.36, n.name, { 'font-size': NAME, 'font-weight': n.weight, 'text-anchor': 'middle' }, g);
          continue;
        }
        if (n.kind === 'strong') el('rect', { x: x - n.w / 2, y: y - n.h / 2, width: n.w, height: n.h, rx: 2.8,
          fill: P.surface, stroke: P.edge, 'stroke-width': 0.6 }, g);
        const left = x - n.textWidth / 2, baseline = y - barRoom / 2 + NAME * 0.36;
        const label = text(left, baseline, n.name, { 'font-size': NAME, 'font-weight': n.weight,
          fill: n.kind === 'strong' ? fg : muted }, g);
        if (n.chain) el('tspan', { dx: 0.9, 'font-weight': 400, fill: muted }, label).textContent = n.chain;
        if (layers.halos && n.info.sasaLoss > 0) {
          const top = y + n.h / 2 - (n.kind === 'strong' ? 2.6 : 1.2);
          el('path', { d: `M${left},${top}h${n.textWidth}`, fill: 'none', stroke: hair, 'stroke-width': 1.2, 'stroke-linecap': 'round' }, g);
          el('path', { d: `M${left},${top}h${(n.textWidth * clamp(n.info.sasaLoss / maxLoss)).toFixed(2)}`, fill: 'none',
            stroke: rampColor(P, 0), 'stroke-width': 1.2, 'stroke-linecap': 'round', class: 'burial-bar',
            'data-sasa-loss': n.info.sasaLoss }, g);
        }
      }

      // ---- the selected contact carries its distance
      const chosen = plans.find(p => p.c.index === ctx.selected);
      if (chosen) {
        const value = `${chosen.c.distance.toFixed(2)} Å`;
        const width = measure(value, { 'font-size': VALUE, 'font-weight': 600 }) + 2, height = VALUE * 1.2;
        // nearest free spot beside the line itself, trying the middle first and both sides
        const span = len(sub(chosen.p1, chosen.p0));
        const up = chosen.normal.y < 0 ? chosen.normal : { x: -chosen.normal.x, y: -chosen.normal.y };
        const off = 1.8 + Math.abs(up.x) * width / 2 + Math.abs(up.y) * height / 2;
        const options = { pad: 0.6, skip: `contact${chosen.c.index}`, contour: true };
        let c = null;
        for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
          for (const sideways of [off, -off]) {
            const q = at(at(chosen.p0, chosen.u, span * t), up, sideways);
            if (!c && isFree(rectAt(q, width, height), options)) c = q;
          }
        }
        const middle = at(at(chosen.p0, chosen.u, span / 2), up, off);
        c = c || place(middle, width, height, { ...options, reach: 4 }) || middle;
        text(c.x, c.y + VALUE * 0.36, value, { 'font-size': VALUE, 'font-weight': 600, 'text-anchor': 'middle', fill: fg, stroke: bg,
          'stroke-width': 1.8, 'paint-order': 'stroke', 'stroke-linejoin': 'round', class: 'burial-distance' }, root);
      }
    },

    // One or two words per mark, and only the marks this diagram draws.
    legend(info) {
      const P = PALETTES[info.theme] || PALETTES.light;
      const S = info.svgEl;
      const icon = () => S('svg', { class: 'swatch', viewBox: '0 0 22 10' });
      const ink = info.colorOf('hbond'), muted = info.theme === 'dark' ? '#a1a1aa' : '#71717a';
      const scene = info.data.scene.scene, ligand = scene.structures[0];
      const edgeOf = c => (c.type && c.type !== 'hydrophobicContacts' ? (scene[c.type] || []).find(e => e.id === c.id) : null);
      const drawn = info.data.contacts.filter(c => {
        const edge = edgeOf(c);
        return structureVisible(c.structure) && (!edge || (structureVisible(edge.fromStructure) && structureVisible(edge.toStructure)));
      });
      const kinds = new Set(drawn.map(c => c.kind));
      const items = [];
      const add = (key, label, paint) => { const s = icon(); paint(s); items.push({ key, label, icon: s }); };
      const stroke = (s, kind, extra = {}) => S('line', { x1: 1, y1: 5, x2: 21, y2: 5, stroke: ink,
        'stroke-width': 1.4, ...(DASH[kind] ? { 'stroke-dasharray': DASH[kind].split(' ').map(v => Number(v) * 1.7).join(' ') } : {}), ...extra }, s);
      const blob = t => s => S('circle', { cx: 11, cy: 5, r: 4.6, fill: rampColor(P, t), 'fill-opacity': 0.85 }, s);
      if (info.layers.exposure) {
        const open = info.data.overlay.ligandAtoms.map(m => clamp(m.sasa / EXPOSED_FULL));
        if (open.some(t => t < 0.25)) add('buried', 'Buried', blob(0));
        if (open.some(t => t > 0.75)) add('exposed', 'Exposed', blob(1));
      }
      if (info.layers.exposure) {
        const pos = new Map(ligand.atoms.map(a => [a.id, a.coordinates]));
        const lengths = ligand.bonds.map(b => len(sub(pos.get(b.from), pos.get(b.to)))).sort((a, b) => a - b);
        const arrows = growthArrows(ligand, pos, new Map(info.data.overlay.ligandAtoms.map(m => [m.atom, m])),
          lengths[Math.floor(lengths.length / 2)] || 10.5, value => value.length * VALUE * 0.55);
        if (arrows.length) add('growth', 'Growth vector', s => S('path', { d: 'M2,5H19M15,1.8L19.4,5L15,8.2', fill: 'none', stroke: P.cool,
          'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s));
      }
      if (kinds.has('hbond')) {
        add('hbond', 'H-bond', s => { stroke(s, 'hbond'); S('path', { d: 'M15,5L8.5,1.6V8.4Z', fill: ink }, s); });
        if (drawn.some(c => c.kind === 'hbond' && c.backbone)) add('backbone', 'Backbone', s => {
          stroke(s, 'hbond', { x2: 15 });
          S('circle', { cx: 17.6, cy: 5, r: 2.7, fill: ink }, s);
        });
      }
      if (kinds.has('ionic')) add('ionic', 'Salt bridge', s => {
        S('line', { x1: 1, y1: 3.2, x2: 21, y2: 3.2, stroke: ink, 'stroke-width': 1.3 }, s);
        S('line', { x1: 1, y1: 6.8, x2: 21, y2: 6.8, stroke: ink, 'stroke-width': 1.3 }, s);
      });
      // both π contacts share the dashed line from a ring; the plus sign is the cation
      const rings = ['pi', 'cationPi'].filter(kind => kinds.has(kind));
      if (rings.length) add('pi', rings.length > 1 ? 'π contact' : rings[0] === 'pi' ? 'π-stacking' : 'Cation–π', s => {
        stroke(s, 'pi', { x1: 8 });
        S('circle', { cx: 4.5, cy: 5, r: 3.2, fill: 'none', stroke: ink, 'stroke-width': 1.2 }, s);
        if (rings[0] === 'cationPi') S('path', { d: 'M17,0.4v3.6M15.2,2.2h3.6', fill: 'none', stroke: ink, 'stroke-width': 1.1 }, s);
      });
      if (kinds.has('halogen')) add('halogen', 'Halogen bond', s => stroke(s, 'halogen'));
      if (kinds.has('metal')) add('metal', 'Metal', s => {
        S('line', { x1: 1.5, y1: 5, x2: 12, y2: 5, stroke: ink, 'stroke-width': 2.1, 'stroke-dasharray': '0.01 3.5', 'stroke-linecap': 'round' }, s);
        S('rect', { x: 13.5, y: 1, width: 8, height: 8, rx: 2, fill: P.metal, stroke: muted, 'stroke-width': 0.9 }, s);
      });
      if (kinds.has('water')) add('water', 'Water', s => {
        stroke(s, 'water', { x2: 12 });
        S('circle', { cx: 16.5, cy: 5, r: 3.8, fill: P.surface, stroke: P.water, 'stroke-width': 1.2 }, s);
        S('circle', { cx: 16.5, cy: 5, r: 1.3, fill: P.water }, s);
      });
      if (kinds.has('hydrophobic')) add('hydrophobic', 'Hydrophobic', s => {
        if (info.layers.exposure) S('circle', { cx: 6, cy: 5, r: 4.4, fill: P.apolar, 'fill-opacity': 0.45 }, s);
        S('line', { x1: info.layers.exposure ? 6 : 1, y1: 5, x2: 21, y2: 5, stroke: info.colorOf('hydrophobic'), 'stroke-width': 1.3 }, s);
      });
      if (info.layers.contour && info.data.overlay.contour.length) add('pocket', 'Pocket', s => S('line', { x1: 1, y1: 5, x2: 21, y2: 5,
        stroke: muted, 'stroke-width': 1.4, 'stroke-dasharray': '1.5 2', 'stroke-linecap': 'round' }, s));
      if (info.layers.halos) add('area', 'Contact area', s => {
        S('line', { x1: 2, y1: 5, x2: 20, y2: 5, stroke: info.theme === 'dark' ? '#52525b' : '#d4d4d8', 'stroke-width': 2.4, 'stroke-linecap': 'round' }, s);
        S('line', { x1: 2, y1: 5, x2: 13, y2: 5, stroke: rampColor(P, 0), 'stroke-width': 2.4, 'stroke-linecap': 'round' }, s);
      });
      // A crowded diagram folds the two ends of the field into one ramp, then lets go of the smallest marks.
      if (items.length > LEGEND_MAX && items[0]?.key === 'buried' && items[1]?.key === 'exposed') {
        const s = icon();
        for (let i = 0; i < 11; i++) S('rect', { x: i * 2, y: 1.5, width: 2.06, height: 7, fill: rampColor(P, i / 10),
          'fill-opacity': Math.min(1, rampAlpha(P, i / 10) * 1.7).toFixed(3) }, s);
        items.splice(0, 2, { key: 'field', label: 'Exposure', icon: s });
      }
      for (const key of ['area', 'pocket', 'backbone']) {
        if (items.length <= LEGEND_MAX) break;
        const index = items.findIndex(item => item.key === key);
        if (index >= 0) items.splice(index, 1);
      }
      return items.slice(0, LEGEND_MAX).map(item => [item.icon, item.label]);
    },
  };
})();
