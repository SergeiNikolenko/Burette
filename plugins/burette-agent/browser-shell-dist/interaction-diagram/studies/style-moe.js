'use strict';

// MOE ligand interactions: pale discs coloured greasy or polar with the charge in the outline, a blue
// receptor-exposure halo behind each disc, blue smudges on exposed ligand atoms, the grey proximity
// contour, and dashed arrows that are green for side chains and blue for the backbone.
(() => {
  const GREASY = new Set(['ALA', 'VAL', 'LEU', 'ILE', 'MET', 'MSE', 'PHE', 'TRP', 'PRO']);
  const ACIDIC = new Set(['ASP', 'GLU']);
  const BASIC = new Set(['LYS', 'ARG', 'HIS', 'HIP', 'HID', 'HIE']);
  const AMINO = new Set([...GREASY, ...ACIDIC, ...BASIC, 'GLY', 'SER', 'THR', 'CYS', 'ASN', 'GLN', 'TYR', 'SEC']);
  const DISCS = {
    light: {
      greasy: ['#c9f5c4', '#4f9f52', 0.8], polar: ['#ecd0f7', '#a35bbf', 0.8], acidic: ['#ecd0f7', '#d61f26', 1.8],
      basic: ['#ecd0f7', '#2733c8', 1.8], water: ['#ffffff', '#8c8c94', 0.8], metal: ['#dadadd', '#7a7a82', 0.9], other: ['#f1f1f2', '#9a9aa2', 0.8],
    },
    // MOE's own dark canvas keeps the pale discs and dark labels.
    dark: {
      greasy: ['#c9f5c4', '#6fc271', 0.8], polar: ['#ecd0f7', '#c27ddc', 0.8], acidic: ['#ecd0f7', '#ff4b4b', 1.8],
      basic: ['#ecd0f7', '#6170ff', 1.8], water: ['#f4f4f5', '#a1a1aa', 0.8], metal: ['#cfcfd4', '#8a8a92', 0.9], other: ['#e4e4e7', '#a1a1aa', 0.8],
    },
  };
  // MOE's colours: green side-chain and arene contacts (an arene end carries a ring), blue backbone
  // hydrogen bonds, gold solvent contacts, grey dots for the contour.
  const INK = {
    light: { side: '#1f9d3a', backbone: '#3346e4', ionic: '#a63ccc', metal: '#cc4a9c', water: '#a8831f', pi: '#1f9d3a', cationPi: '#1f9d3a',
      halogen: '#0f9b8e', hydrophobic: '#6b9a5c', halo: '#a9d3fb', smudge: '#6262ff', contour: '#8f8f96', text: '#1a1a1a',
      ...MOLSTAR_CONTACTS, side: MOLSTAR_CONTACTS.hbond, backbone: MOLSTAR_CONTACTS.hbond },
    dark: { side: '#3cc95a', backbone: '#6f80ff', ionic: '#d07cf2', metal: '#f07cc2', water: '#d9b352', pi: '#3cc95a', cationPi: '#3cc95a',
      halogen: '#2dd4bf', hydrophobic: '#8cc47b', halo: '#6fb2f2', smudge: '#8c8cff', contour: '#9a9aa2', text: '#1a1a1a',
      ...MOLSTAR_CONTACTS, side: MOLSTAR_CONTACTS.hbond, backbone: MOLSTAR_CONTACTS.hbond },
  };
  const CLASS_LABELS = { polar: 'Polar', acidic: 'Acidic', basic: 'Basic', greasy: 'Hydrophobic' };
  // Label sizes in drawing units. A side panel never draws below 1.7 px per unit, so these stay above 9 px.
  const TEXT = { name: 5.8, number: 5.4, water: 5.6, sub: 3.9 };
  const BLOCK = 0.72 * (TEXT.name + TEXT.number) + 1.8; // name capitals, a gap, digits
  const R = { residue: 9, water: 7.4 };
  // the pipeline's bond is 10 units; at 15 a residue disc spans about 1.2 bonds, as in MOE
  const SPREAD = 1.5;
  const STROKE = { line: 1.05, selected: 1.9, contour: 1.1 };
  const DASH = '1.9 1.5';
  const HEAD = { length: 3.8, half: 1.7 };
  // The shortest contact line that still shows its dashes and arrowheads.
  const REACH = { arrow: 9.5, both: 13.5, plain: 7, relay: 6 };
  const CLEAR = 8;

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const moeClass = info => info.class === 'water' ? 'water' : info.class === 'metal' ? 'metal'
    : ACIDIC.has(info.name) ? 'acidic' : BASIC.has(info.name) ? 'basic' : GREASY.has(info.name) ? 'greasy'
    : AMINO.has(info.name) ? 'polar' : 'other';
  // Helvetica advances in em, erring wide: the discs are sized from them before anything is drawn.
  const ADVANCE = { I: 0.28, J: 0.5, L: 0.56, M: 0.83, W: 0.94, G: 0.78, O: 0.78, Q: 0.78, F: 0.61, T: 0.61, Z: 0.61,
    f: 0.28, i: 0.22, j: 0.22, l: 0.22, r: 0.33, t: 0.28, m: 0.83, w: 0.72, c: 0.5, k: 0.5, s: 0.5, v: 0.5, x: 0.5, y: 0.5, z: 0.5 };
  const textWidth = (text, size) => [...text].reduce((w, ch) => w + (ADVANCE[ch] ?? (ch >= 'A' && ch <= 'Z' ? 0.72 : 0.56)), 0) * size;
  // A disc holds the name over the number, amino acids in title case and other groups by their PDB code,
  // as MOE prints them. The pair slides so that the wider line sits nearer the middle, where a disc is widest.
  const discLabel = (info, cls) => {
    const name = !info.name ? '' : AMINO.has(info.name) ? info.name[0] + info.name.slice(1).toLowerCase() : info.name.toUpperCase();
    const number = `${info.chainLabel || ''}${info.number ?? ''}`;
    const a = textWidth(name, TEXT.name) / 2, b = textWidth(number, TEXT.number) / 2;
    const lift = Math.max(-1.2, Math.min(1.2, (b * b - a * a) / (2 * BLOCK)));
    return { name, number, lift, need: Math.max(Math.hypot(a, BLOCK / 2 + lift), Math.hypot(b, BLOCK / 2 - lift)) + 1.9 };
  };
  // The discs of a drawing share the radius its labels need; only an unusually long label gets a larger one.
  const discsOf = partners => {
    const marks = partners.map(s => {
      const info = s.additionalInformation || {}, cls = moeClass(info);
      return { id: s.id, info, cls, need: 0, ...(cls === 'water' ? null : discLabel(info, cls)) };
    });
    const needs = marks.filter(m => m.cls !== 'water').map(m => m.need).sort((a, b) => a - b);
    const usual = Math.max(R.residue, needs.length ? needs[Math.floor((needs.length - 1) * 0.75)] : 0);
    return new Map(marks.map(m => [m.id, { ...m, r: m.cls === 'water' ? R.water : Math.ceil(Math.max(usual, m.need) * 10) / 10 }]));
  };
  // how far an atom's label reaches on its hydrogen side, where a contact usually leaves it
  const labelGap = atom => !atom || (atom.element === 'C' && !atom.charge) ? 1.6 : atom.hydrogenCount > 1 ? 10 : atom.hydrogenCount ? 7.6 : 4.4;
  // Receptor exposure: a small loss peeks out as a crescent on the solvent side, a large one as a wide disc.
  const haloOf = (n, centre, maxLoss) => {
    if (['water', 'metal'].includes(n.cls) || !(n.info.sasaLoss > 3)) return null;
    const t = Math.min(1, n.info.sasaLoss / maxLoss);
    const l = distance(n, centre) || 1, shift = n.r * (0.14 + 0.3 * t);
    return { x: n.x + (n.x - centre.x) / l * shift, y: n.y + (n.y - centre.y) / l * shift, r: n.r * (0.9 + 0.36 * t) };
  };

  const cross = (p, q, r, s) => {
    const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
    return t > 0 && t < 1 && u > 0 && u < 1;
  };
  const pointSegment = (c, p, q) => {
    const dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / l2));
    return Math.hypot(p.x + dx * t - c.x, p.y + dy * t - c.y);
  };
  // boxes grown by k on every side
  const segmentBox = (p, q, b, k = 0) => {
    const left = b.left - k, right = b.right + k, top = b.top - k, bottom = b.bottom + k;
    if (Math.max(p.x, q.x) < left || Math.min(p.x, q.x) > right || Math.max(p.y, q.y) < top || Math.min(p.y, q.y) > bottom) return false;
    const inside = v => v.x > left && v.x < right && v.y > top && v.y < bottom;
    if (inside(p) || inside(q)) return true;
    const c = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
    return c.some((v, i) => cross(p, q, v, c[(i + 1) % 4]));
  };
  const meet = (a, b, k = 0) => a.left - k < b.right + k && b.left - k < a.right + k && a.top - k < b.bottom + k && b.top - k < a.bottom + k;
  const circleBox = (c, r) => ({ left: c.x - r, right: c.x + r, top: c.y - r, bottom: c.y + r });

  window.LID_STUDIES['style-moe'] = {
    hideBase: 'partners',
    hideHydrophobic: true,

    // The pipeline spaces discs for the stock renderer. Keep them clear of each other and of the ligand, give
    // every contact line room for its dashes and the drawing the proportions of its frame, then nudge or
    // swap discs, as little as possible, until no polar line crosses another line, a ligand bond, a foreign
    // label or disc, and no disc or halo touches another or the ligand.
    prepare(data, H) {
      // MOE's discs are about one bond across; they keep the size their labels need, so the depiction spreads
      H.spread(data, SPREAD);
      const scene = data.scene.scene, structures = scene.structures, lig = structures[0];
      const atoms = new Map(lig.atoms.map(a => [a.id, a]));
      const ligand = lig.atoms.map(a => a.coordinates);
      const centre = H.mean(ligand);
      const bonds = (lig.bonds || []).map(b => ({ from: b.from, to: b.to, p: atoms.get(b.from)?.coordinates, q: atoms.get(b.to)?.coordinates })).filter(b => b.p && b.q);
      const labels = lig.atoms.filter(a => a.element !== 'C' || a.charge)
        .map(a => ({ id: a.id, x: a.coordinates.x, y: a.coordinates.y, r: 3.8 + (a.hydrogenCount ? 2.4 : 0) + (a.charge ? 1 : 0) }));
      const sized = discsOf(structures.slice(1));
      const nodes = structures.slice(1).filter(s => s.atoms.length === 1).map(s => {
        const c = s.atoms[0].coordinates;
        return { ...sized.get(s.id), s, x: c.x, y: c.y, home: { x: c.x, y: c.y } };
      });
      const byId = new Map(nodes.map(n => [n.s.id, n]));
      const maxLoss = Math.max(30, ...nodes.map(n => n.info.sasaLoss || 0));
      const lines = [];
      for (const c of data.contacts) {
        const e = c.kind !== 'hydrophobic' && (scene[c.type] || []).find(e => e.id === c.id);
        if (!e) continue;
        const end = (sid, id) => {
          if (sid !== 0) { const node = byId.get(sid); return node && { node }; }
          const ring = c.ligandAtom === 'ring' && (lig.rings || []).find(r => r.id === id);
          if (ring) return { own: new Set(ring.atoms), gap: 0, ...H.mean(ring.atoms.map(a => atoms.get(a)?.coordinates).filter(Boolean)) };
          const atom = atoms.get(id);
          return atom && { own: new Set([id]), gap: labelGap(atom), x: atom.coordinates.x, y: atom.coordinates.y };
        };
        const a = end(e.fromStructure, e.from), b = end(e.toStructure, e.to);
        if (!a || !b || !(a.node || b.node)) continue;
        const reach = a.node && b.node ? REACH.relay : c.kind !== 'hbond' ? REACH.plain : c.direction === 'both' ? REACH.both : REACH.arrow;
        lines.push({ a, b, reach, nodes: [a.node, b.node].filter(Boolean), own: a.own || b.own || new Set() });
      }
      const tip = (end, other) => {
        const p = end.node || end, q = other.node || other, l = distance(p, q) || 1, g = end.node ? end.node.r + 1 : end.gap;
        return { x: p.x + (q.x - p.x) / l * g, y: p.y + (q.y - p.y) / l * g };
      };
      const extent = (n, k) => {
        const h = haloOf(n, centre, maxLoss);
        return [Math.min(n[k] - n.r, h ? h[k] - h.r : Infinity), Math.max(n[k] + n.r, h ? h[k] + h.r : -Infinity)];
      };
      // how far a disc or its halo sticks out of the span the frame can show, as the shift that brings it back
      let fence = null;
      const outside = n => {
        if (!fence) return 0;
        const [low, high] = extent(n, fence.axis);
        return low < fence.low ? fence.low - low : high > fence.high ? fence.high - high : 0;
      };
      const push = (n, from, gap) => {
        const l = distance(n, from) || 1;
        n.x += (n.x - from.x) / l * gap; n.y += (n.y - from.y) / l * gap;
      };
      const relax = () => {
        for (let pass = 0; pass < 240; pass++) {
          let moved = false;
          for (const n of nodes) {
            for (const q of ligand) {
              const gap = n.r + CLEAR - distance(n, q);
              if (gap > 0) { push(n, q, gap); moved = true; }
            }
            for (const m of nodes) {
              if (m === n) continue;
              const gap = n.r + m.r + 2.2 - distance(n, m);
              if (gap <= 0) continue;
              const l = distance(n, m);
              const ux = l > 0.01 ? (n.x - m.x) / l : 1, uy = l > 0.01 ? (n.y - m.y) / l : 0;
              n.x += ux * gap / 2; n.y += uy * gap / 2; m.x -= ux * gap / 2; m.y -= uy * gap / 2; moved = true;
            }
          }
          for (const L of lines) {
            const [n, m] = L.nodes;
            if (m) {
              const gap = n.r + m.r + 2 + L.reach - distance(n, m);
              if (gap > 0.05) { push(n, m, gap / 2); push(m, n, gap / 2); moved = true; }
            } else {
              const from = L.a.node ? L.b : L.a, gap = n.r + 1 + from.gap + L.reach - distance(n, from);
              if (gap > 0.05) { push(n, from, gap); moved = true; }
            }
          }
          for (const n of nodes) {
            const back = outside(n);
            if (Math.abs(back) > 0.05) { n[fence.axis] += back; moved = true; }
          }
          if (!moved) break;
        }
      };
      relax();
      // The frame the drawing goes into. A side panel is tall and narrow, never draws below 1.7 px per unit
      // and scrolls what does not fit, so the discs gather towards the ligand's axis and spread along it
      // until the drawing has the frame's proportions and shows at a larger scale.
      const canvas = document.getElementById('canvas');
      const frame = canvas?.clientWidth > 160 && canvas.clientHeight > 160 ? { x: canvas.clientWidth - 28, y: canvas.clientHeight - 104 } : null;
      if (frame) {
        const tall = frame.y > frame.x, across = tall ? 'x' : 'y', along = tall ? 'y' : 'x';
        const span = k => {
          const reach = nodes.map(n => extent(n, k));
          return [Math.min(...ligand.map(p => p[k] - 6), ...reach.map(e => e[0])), Math.max(...ligand.map(p => p[k] + 6), ...reach.map(e => e[1]))];
        };
        const size = k => { const [low, high] = span(k); return high - low; };
        const slack = frame[along] / frame[across] / (size(along) / size(across));
        if (slack > 1.06 && Math.min(frame.x / size('x'), frame.y / size('y')) < 2.5) {
          const squeeze = Math.min(1, Math.max(0.9, Math.sqrt(1.117 / slack))), stretch = Math.min(1.25, Math.max(1, 0.94 * slack * squeeze));
          const middle = k => (Math.min(...ligand.map(p => p[k])) + Math.max(...ligand.map(p => p[k]))) / 2;
          const fit = (p, k, by) => { p[k] = middle(k) + (p[k] - middle(k)) * by; };
          for (const n of nodes) for (const p of [n, n.home]) { fit(p, across, squeeze); fit(p, along, stretch); }
          relax();
        }
        // still wider than the frame can show: hold the discs inside it, so they move along the ligand instead
        const [low, high] = span(across), room = frame[across] / 1.7 - 1.5;
        const ligandSpan = Math.max(...ligand.map(p => p[across])) - Math.min(...ligand.map(p => p[across]));
        if (high - low > room && ligandSpan + 4 * (R.residue + CLEAR) < room) {
          fence = { axis: across, low: (low + high - room) / 2, high: (low + high + room) / 2 };
          relax();
        }
      }

      const apart = lines.map(A => lines.map(B => !(A.nodes.some(n => B.nodes.includes(n)) || [...A.own].some(id => B.own.has(id)))));
      // what a disc with its halo covers and where a line runs, worked out again only after a move
      const footOf = n => {
        if (n.footX !== n.x || n.footY !== n.y) {
          const h = haloOf(n, centre, maxLoss);
          n.foot = h ? [circleBox(n, n.r + 0.5), circleBox(h, h.r - 0.3)] : [circleBox(n, n.r + 0.5)];
          n.footX = n.x; n.footY = n.y;
        }
        return n.foot;
      };
      const runOf = L => {
        const [n, m] = L.nodes;
        if (L.x1 !== n.x || L.y1 !== n.y || (m && (L.x2 !== m.x || L.y2 !== m.y))) {
          L.run = [tip(L.a, L.b), tip(L.b, L.a)];
          L.x1 = n.x; L.y1 = n.y;
          if (m) { L.x2 = m.x; L.y2 = m.y; }
        }
        return L.run;
      };
      const W = 100;
      let overlap = W;
      // cost of everything that involves the nodes in S (all of it when S is null)
      const cost = S => {
        const inS = n => !S || S.has(n), lineInS = L => !S || L.nodes.some(n => S.has(n));
        let sum = 0;
        for (let i = 0; i < lines.length; i++) {
          const L = lines[i], [p, q] = runOf(L), mine = lineInS(L);
          for (let j = i + 1; j < lines.length; j++) {
            if (!apart[i][j] || !(mine || lineInS(lines[j]))) continue;
            const [r, s] = runOf(lines[j]);
            if (cross(p, q, r, s)) sum += W;
          }
          for (const n of nodes) {
            if (!(mine || inS(n)) || L.nodes.includes(n)) continue;
            const [disc, halo] = footOf(n);
            // a line under a disc is hidden, which is worse than a plain crossing; one that brushes past
            // a disc looks as if it ended there
            if (segmentBox(p, q, disc, 0.6)) sum += 2.5 * W;
            else if (halo && segmentBox(p, q, halo, 0.6)) sum += W;
            else if (segmentBox(p, q, disc, 2.4)) sum += 0.3 * W;
          }
          if (!mine) continue;
          // a line too short for its dashes and arrowhead says nothing
          const short = L.reach - distance(p, q);
          if (short > 0.3) sum += 0.6 * W + 14 * short;
          for (const b of bonds) if (!(L.own.has(b.from) && L.own.has(b.to)) && cross(p, q, b.p, b.q)) sum += W;
          for (const t of labels) if (!L.own.has(t.id) && pointSegment(t, p, q) < t.r) sum += W;
        }
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i], foot = footOf(n);
          for (let j = i + 1; j < nodes.length; j++) {
            if (!(inS(n) || inS(nodes[j]))) continue;
            const other = footOf(nodes[j]);
            if (foot.some(a => other.some(b => meet(a, b, 0.5)))) sum += overlap;
          }
          if (!inS(n)) continue;
          sum += 0.12 * ((n.x - n.home.x) ** 2 + (n.y - n.home.y) ** 2);
          const out = Math.abs(outside(n));
          if (out > 0.3) sum += 0.6 * W + 20 * out;
          for (const q of ligand) { const gap = n.r + CLEAR - 0.5 - distance(n, q); if (gap > 0) sum += W * 0.5 + 10 * gap; }
          for (const b of bonds) if (foot.some(box => segmentBox(b.p, b.q, box, 0.4))) sum += W;
        }
        return sum;
      };
      const rings = [2.5, 5, 8, 12, 17, 23].flatMap(r => Array.from({ length: 16 }, (_, k) => ({ x: r * Math.cos(k * Math.PI / 8), y: r * Math.sin(k * Math.PI / 8) })));
      const shift = n => 0.12 * ((n.x - n.home.x) ** 2 + (n.y - n.home.y) ** 2);
      // more than a line brushing past a disc: something is crossed, covered, too short or out of the frame
      const TROUBLE = 0.45 * W;
      const polish = () => { for (let pass = 0; pass < 12; pass++) {
        let improved = false;
        for (const n of nodes) {
          const S = new Set([n]);
          const settled = shift(n);
          let best = cost(S);
          if (best < settled + 0.5 && settled < 0.5) continue;
          let pick = null;
          const from = { x: n.x, y: n.y };
          // a disc with nothing wrong only tries to come closer to where the pipeline put it
          const back = [1, 0.75, 0.5, 0.25].map(t => ({ x: (n.home.x - from.x) * t, y: (n.home.y - from.y) * t }));
          for (const d of best < settled + 0.5 ? back : [back[0], ...rings]) {
            n.x = from.x + d.x; n.y = from.y + d.y;
            const value = cost(S);
            if (value < best - 0.01) { best = value; pick = { x: n.x, y: n.y }; }
          }
          Object.assign(n, pick || from);
          if (pick) improved = true;
          if (best - shift(n) < TROUBLE) continue;
          // still in trouble: trade places with a nearby disc
          for (const m of nodes) {
            if (m === n || distance(n, m) > 50) continue;
            const pair = new Set([n, m]), before = cost(pair);
            [n.x, m.x, n.y, m.y] = [m.x, n.x, m.y, n.y];
            if (cost(pair) < before - 0.01) { improved = true; continue; }
            [n.x, m.x, n.y, m.y] = [m.x, n.x, m.y, n.y];
          }
        }
        if (!improved) break;
      } };
      // Dense pockets need bigger moves: try a disc in trouble anywhere nearby, pushing aside the discs it lands on.
      const footprint = n => { const h = haloOf(n, centre, maxLoss); return h ? [circleBox(n, n.r + 1), circleBox(h, h.r)] : [circleBox(n, n.r + 1)]; };
      const touching = (a, b) => footprint(a).some(x => footprint(b).some(y => meet(x, y)));
      const grid = [];
      for (let x = -36; x <= 36; x += 3) for (let y = -36; y <= 36; y += 3) if (x * x + y * y <= 1296) grid.push({ x, y });
      const search = () => {
        polish();
        for (let round = 0; round < 4; round++) {
          const trouble = nodes.filter(n => cost(new Set([n])) - shift(n) > TROUBLE);
          if (!trouble.length) break;
          let improved = false;
          for (const n of trouble) {
            const from = { x: n.x, y: n.y };
            let best = null;
            for (const d of grid) {
              n.x = from.x + d.x; n.y = from.y + d.y;
              // let the push cascade: each displaced disc may push the next, and all stay off the ligand
              const moved = new Map();
              for (let step = 0, active = [n]; step < 6 && active.length; step++) {
                const next = [];
                for (const a of active) for (const m of nodes) {
                  if (m === n || m === a) continue;
                  if (!touching(a, m)) continue;
                  if (!moved.has(m)) moved.set(m, { x: m.x, y: m.y });
                  const l = distance(a, m) || 1;
                  for (let k = 0; k < 16 && touching(a, m); k++) { m.x += (m.x - a.x) / l * 1.5; m.y += (m.y - a.y) / l * 1.5; }
                  for (const q of ligand) {
                    const g = m.r + CLEAR - distance(m, q);
                    if (g > 0) push(m, q, g);
                  }
                  next.push(m);
                }
                active = next;
              }
              const pushed = [...moved].map(([m, o]) => ({ m, x: o.x, y: o.y, to: { x: m.x, y: m.y } }));
              const S = new Set([n, ...pushed.map(q => q.m)]);
              const after = cost(S);
              for (const q of pushed) Object.assign(q.m, { x: q.x, y: q.y });
              const tmp = { x: n.x, y: n.y };
              Object.assign(n, from);
              const delta = after - cost(S);
              Object.assign(n, tmp);
              if (delta < (best?.delta ?? -0.01)) best = { delta, at: tmp, pushed };
            }
            Object.assign(n, best ? best.at : from);
            if (best) { for (const q of best.pushed) Object.assign(q.m, q.to); improved = true; }
          }
          polish();
          if (!improved) break;
        }
      };
      // The search trades one fault for another on its way. Whatever it ends with, no disc is left on another,
      // on the ligand, or too close for its line; and a search that ends in trouble runs once more with
      // overlaps priced higher, which takes it along other paths.
      const start = nodes.map(n => ({ x: n.x, y: n.y }));
      const place = spots => nodes.forEach((n, i) => { n.x = spots[i].x; n.y = spots[i].y; });
      const attempt = price => {
        overlap = price;
        place(start);
        search();
        relax();
        overlap = W;
        return { spots: nodes.map(n => ({ x: n.x, y: n.y })), cost: cost(null), moved: nodes.reduce((sum, n) => sum + shift(n), 0) };
      };
      let best = attempt(W);
      if (best.cost - best.moved > TROUBLE) {
        const other = attempt(3 * W);
        if (other.cost < best.cost) best = other;
      }
      place(best.spots);
      for (const n of nodes) {
        const c = n.s.atoms[0].coordinates;
        if (distance(c, n) > 0.01) H.move(data, n.s.id, n.x, n.y);
      }
    },

    draw(ctx) {
      const { el, hit, root, under, ligand, contacts, data, bg, theme } = ctx;
      const discs = DISCS[theme], ink = INK[theme];
      const font = styleOf().fontFamily || 'Helvetica, Arial, sans-serif';
      const layers = state.layers;
      const scene = data.scene.scene;
      for (const key of ['contour', 'smudges', 'halos', 'chain']) overlay[key]?.replaceChildren();
      const ligandAtoms = ligand.atoms.map(a => ({ atom: a, p: ctx.liveAtom(0, a.id) })).filter(a => a.p);
      const centre = ctx.H.mean(ligandAtoms.map(a => a.p));
      const nearestAtom = p => ligandAtoms.reduce((a, b) => distance(p, a.p) <= distance(p, b.p) ? a : b);
      const visible = contacts.filter(c => c.visible);

      const sized = discsOf(ctx.partners);
      const nodes = new Map();
      for (const s of ctx.partners) {
        if (!structureVisible(s.id)) continue;
        const p = ctx.liveAtoms(s.id)[0];
        if (p) nodes.set(s.id, { ...sized.get(s.id), s, x: p.x, y: p.y });
      }
      const discEdge = (n, toward, gap = 1) => {
        const l = distance(n, toward) || 1;
        return { x: n.x + (toward.x - n.x) / l * (n.r + gap), y: n.y + (toward.y - n.y) / l * (n.r + gap) };
      };
      // Atom labels as drawn (element, H count, charge), in study coordinates.
      const labelBoxes = (() => {
        const node = groups().atomGroupsComponent.atomToSelMap[0]?.structureSel?.node();
        const inverse = under.getCTM()?.inverse();
        if (!node || !inverse) return [];
        return [...node.querySelectorAll('text')].filter(t => t.textContent.trim() && (t.checkVisibility?.() ?? true)).map(t => {
          const b = t.getBBox(), m = inverse.multiply(t.getCTM());
          const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
            .map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
          const xs = corners.map(c => c.x), ys = corners.map(c => c.y), k = (Math.max(...ys) - Math.min(...ys)) * 0.15;
          return { left: Math.min(...xs) - 0.7, right: Math.max(...xs) + 0.7, top: Math.min(...ys) + k - 0.7, bottom: Math.max(...ys) - k + 0.7 };
        });
      })();
      const inLabel = p => labelBoxes.some(b => p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom);
      const atomEdge = (p, toward, ring) => {
        if (ring) return p;
        const near = nearestAtom(p);
        const l = distance(p, toward) || 1, ux = (toward.x - p.x) / l, uy = (toward.y - p.y) / l;
        let gap = labelBoxes.length ? 1.6 : labelGap(distance(near.p, p) < 0.5 ? near.atom : null);
        // The line starts where it leaves the atom's own label, H and charge included.
        while (gap < 14 && inLabel({ x: p.x + ux * gap, y: p.y + uy * gap })) gap += 0.4;
        return { x: p.x + ux * gap, y: p.y + uy * gap };
      };

      const defs = el('defs', {}, under);
      // A line under the pointer or the keyboard focus thickens; a greasy contact, which has no line, shows one.
      el('style', {}, defs).textContent = `.moe-contact:is(:hover,:focus-visible) .moe-contact-line{stroke-width:${STROKE.selected}px}`
        + `.moe-greasy:is(:hover,:focus-visible) .moe-greasy-line{stroke:${ink.hydrophobic}}`;

      // Ligand exposure: a blue smudge on every atom that keeps surface in the complex.
      if (layers.exposure) {
        const gradient = el('radialGradient', { id: 'moe-ligand-exposure' }, defs);
        el('stop', { offset: '0%', 'stop-color': ink.smudge, 'stop-opacity': theme === 'dark' ? 0.8 : 0.68 }, gradient);
        el('stop', { offset: '100%', 'stop-color': ink.smudge, 'stop-opacity': 0 }, gradient);
        for (const m of data.overlay.ligandAtoms) {
          if (!(m.sasa >= 2)) continue;
          const p = ctx.liveAtom(0, m.atom);
          if (p) el('circle', { cx: p.x, cy: p.y, r: 3.8 + Math.sqrt(m.sasa) * 1.6, fill: 'url(#moe-ligand-exposure)', stroke: 'none',
            class: 'moe-ligand-exposure', 'data-sasa': m.sasa }, under);
        }
      }

      // Proximity contour: where the pocket leaves room, as a fine grey line.
      if (layers.contour) {
        const transform = ligandTransform();
        for (const source of data.overlay.contour) {
          const d = source.map((raw, i) => { const q = transform(raw); return `${i ? 'L' : 'M'}${q[0].toFixed(2)},${q[1].toFixed(2)}`; }).join('');
          el('path', { d, fill: 'none', stroke: ink.contour, 'stroke-width': STROKE.contour, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            class: 'moe-contour', 'pointer-events': 'none' }, under);
        }
      }

      // Greasy contacts have no line in MOE; the disc is the target, and a selected one shows its distance line.
      // They lie under the polar lines, so a polar line keeps the pointer where the two overlap.
      for (const c of visible) {
        if (c.record.kind !== 'hydrophobic') continue;
        const n = nodes.get(c.record.structure);
        if (!n || !c.a) continue;
        const from = discEdge(n, c.a, 0.6), to = atomEdge(c.a, n, false);
        const g = hit(el('g', { class: 'moe-greasy', 'data-kind': 'hydrophobic' }, under), c.index);
        const d = `M${from.x},${from.y}L${to.x},${to.y}`;
        el('path', { d, fill: 'none', stroke: c.index === ctx.selected ? ink.hydrophobic : 'transparent', 'stroke-width': STROKE.line,
          'stroke-dasharray': '0.1 2.1', 'stroke-linecap': 'round', 'pointer-events': 'none', class: 'moe-greasy-line' }, g);
        el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 6, 'pointer-events': 'stroke' }, g);
      }

      const arrowHead = (tip, from, color, parent) => {
        const l = distance(tip, from) || 1, ux = (tip.x - from.x) / l, uy = (tip.y - from.y) / l;
        const bx = tip.x - ux * HEAD.length, by = tip.y - uy * HEAD.length;
        el('path', { d: `M${tip.x},${tip.y}L${bx - uy * HEAD.half},${by + ux * HEAD.half}L${bx + uy * HEAD.half},${by - ux * HEAD.half}Z`, fill: color, stroke: 'none' }, parent);
        return { x: tip.x - ux * (HEAD.length - 0.5), y: tip.y - uy * (HEAD.length - 0.5) };
      };

      // Interactions. The arrow runs from donor to acceptor; contacts between the same two ends run side by side.
      const pairKey = c => {
        const edge = (scene[c.record.type] || []).find(e => e.id === c.record.id);
        return edge ? [`${edge.fromStructure}:${edge.from}`, `${edge.toStructure}:${edge.to}`].sort().join('|') : null;
      };
      const siblings = new Map();
      for (const c of visible) {
        if (c.record.kind === 'hydrophobic' || !c.a || !c.b) continue;
        const key = pairKey(c);
        if (key) siblings.set(key, [...siblings.get(key) || [], c.index]);
      }
      for (const c of visible) {
        const kind = c.record.kind;
        if (kind === 'hydrophobic' || !c.a || !c.b) continue;
        const edge = (scene[c.record.type] || []).find(e => e.id === c.record.id);
        const [sa, sb] = !edge ? [0, c.record.structure] : edge.toStructure === 0 ? [0, edge.fromStructure] : [edge.fromStructure, edge.toStructure];
        const nodeA = sa === 0 ? null : nodes.get(sa), nodeB = sb === 0 ? null : nodes.get(sb);
        if ((sa !== 0 && !nodeA) || (sb !== 0 && !nodeB)) continue;
        const ringA = sa === 0 && c.record.ligandAtom === 'ring', ringB = sb === 0 && c.record.ligandAtom === 'ring';
        let a = nodeA ? discEdge(nodeA, c.b) : atomEdge(c.a, c.b, ringA);
        let b = nodeB ? discEdge(nodeB, c.a) : atomEdge(c.b, c.a, ringB);
        const group = siblings.get(pairKey(c)) || [c.index];
        if (group.length > 1) {
          const shift = (group.indexOf(c.index) - (group.length - 1) / 2) * 3.4, l = distance(a, b) || 1;
          const nx = -(b.y - a.y) / l * shift, ny = (b.x - a.x) / l * shift;
          a = { x: a.x + nx, y: a.y + ny }; b = { x: b.x + nx, y: b.y + ny };
        }
        const selected = c.index === ctx.selected;
        const color = kind === 'hbond' ? (c.record.backbone ? ink.backbone : ink.side) : ink[kind] || ctx.fg;
        const g = hit(el('g', { class: 'moe-contact', 'data-kind': kind }, under), c.index);
        if (kind === 'hbond') {
          const toB = c.record.direction === 'ligand->partner' ? sa === 0 : c.record.direction === 'partner->ligand' ? sb === 0 : null;
          const both = c.record.direction === 'both';
          if (toB === true || both) b = arrowHead(b, a, color, g);
          if (toB === false || both) a = arrowHead(a, b, color, g);
        }
        const d = `M${a.x},${a.y}L${b.x},${b.y}`;
        el('path', { d, fill: 'none', stroke: color, 'stroke-width': selected ? STROKE.selected : STROKE.line, 'stroke-dasharray': DASH,
          'stroke-linecap': 'butt', class: 'moe-contact-line' }, g);
        el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 7, 'pointer-events': 'stroke' }, g);
        // Arene contacts end on a small ring at the ring centre.
        for (const [ring, p] of [[ringA, a], [ringB, b]]) {
          if (ring) el('path', { d: `M${p.x - 2.4},${p.y}a2.4,2.4 0 1,0 4.8,0a2.4,2.4 0 1,0 -4.8,0Z`, fill: bg, stroke: color, 'stroke-width': 0.9 }, g);
        }
      }

      // Discs, each over its receptor-exposure halo; the widest halos lie at the back.
      const label = (x, y, value, size, parent) => {
        const node = el('text', { x, y, 'text-anchor': 'middle', 'font-family': font, 'font-size': size, 'pointer-events': 'none', stroke: 'none', fill: ink.text }, parent);
        node.textContent = value;
        return node;
      };
      const maxLoss = Math.max(30, ...[...nodes.values()].map(n => n.info.sasaLoss || 0));
      const drawn = [...nodes.values()].map(n => ({ n, halo: layers.halos && haloOf(n, centre, maxLoss) })).sort((a, b) => (b.halo?.r || 0) - (a.halo?.r || 0));
      for (const { n, halo } of drawn) {
        const g = el('g', { class: `binding-residue moe-residue moe-${n.cls}` }, root);
        g.dataset.structureId = n.s.id;
        if (halo) {
          el('circle', { cx: halo.x, cy: halo.y, r: halo.r,
            fill: ink.halo, 'fill-opacity': 0.9, stroke: 'none', class: 'moe-receptor-exposure', 'data-sasa-loss': n.info.sasaLoss }, g);
        }
        const [fill, stroke, width] = discs[n.cls];
        el('circle', { cx: n.x, cy: n.y, r: n.r, fill, stroke, 'stroke-width': width, class: 'moe-disc' }, g);
        if (n.cls === 'water') {
          const name = label(n.x, n.y + 0.36 * TEXT.water, 'H', TEXT.water, g);
          el('tspan', { 'font-size': TEXT.sub, dy: 1.2 }, name).textContent = '2';
          el('tspan', { dy: -1.2 }, name).textContent = 'O';
        } else {
          const top = n.y - BLOCK / 2 - n.lift;
          label(n.x, top + 0.72 * TEXT.name, n.name, TEXT.name, g);
          label(n.x, top + BLOCK, n.number, TEXT.number, g);
        }
      }
    },

    // At most nine entries, and only for marks in this drawing. Waters and metals name themselves on their
    // discs, so their lines give way first, then the contour and the exposure marks.
    legend({ svgEl, theme, data, layers }) {
      const discs = DISCS[theme], ink = INK[theme];
      const icon = () => svgEl('svg', { class: 'swatch', viewBox: '0 0 22 10' });
      const dashed = (color, end = null) => {
        const svg = icon();
        svgEl('path', { d: end ? 'M1,5H15' : 'M1,5H21', fill: 'none', stroke: color, 'stroke-width': 1.7, 'stroke-dasharray': '3 2' }, svg);
        if (end === 'arrow') svgEl('path', { d: 'M14,1.4L21.5,5L14,8.6Z', fill: color, stroke: 'none' }, svg);
        if (end === 'ring') svgEl('circle', { cx: 18, cy: 5, r: 2.7, fill: 'none', stroke: color, 'stroke-width': 1.3 }, svg);
        return svg;
      };
      const disc = (fill, stroke, width) => {
        const svg = icon();
        svgEl('circle', { cx: 11, cy: 5, r: 4.1, fill, stroke, 'stroke-width': Math.max(1, width) }, svg);
        return svg;
      };
      const scene = data.scene.scene;
      const seen = sid => sid === 0 || structureVisible(sid);
      const kinds = new Set();
      for (const c of data.contacts) {
        const edge = (scene[c.type] || []).find(e => e.id === c.id);
        if (c.kind === 'hydrophobic' || !edge || state.hiddenKinds.has(kindOf(c)) || !seen(c.structure) || !seen(edge.fromStructure) || !seen(edge.toStructure)) continue;
        kinds.add(c.kind);
      }
      const residues = scene.structures.filter(s => s.id && structureVisible(s.id));
      const classes = new Set(residues.map(s => moeClass(s.additionalInformation || {})));
      const items = [];
      if (kinds.has('hbond')) items.push([dashed(ink.hbond, 'arrow'), 'H-bond']);
      if (kinds.has('ionic')) items.push([dashed(ink.ionic), 'Ionic']);
      if (kinds.has('metal')) items.push([dashed(ink.metal), 'Metal', 2]);
      if (kinds.has('water')) items.push([dashed(ink.water), 'Water', 1]);
      if (kinds.has('pi') || kinds.has('cationPi')) {
        items.push([dashed(ink.pi, 'ring'), kinds.has('pi') && kinds.has('cationPi') ? 'Arene' : kinds.has('pi') ? 'π-stacking' : 'Cation–π']);
      }
      if (kinds.has('halogen')) items.push([dashed(ink.halogen), 'Halogen']);
      for (const [cls, text] of Object.entries(CLASS_LABELS)) if (classes.has(cls)) items.push([disc(...discs[cls]), text]);
      if (layers.contour && data.overlay.contour.length) {
        const svg = icon();
        svgEl('path', { d: 'M1.5,5H21', fill: 'none', stroke: ink.contour, 'stroke-width': 1.3, 'stroke-linecap': 'round' }, svg);
        items.push([svg, 'Pocket', 3]);
      }
      const smudges = layers.exposure && data.overlay.ligandAtoms.some(m => m.sasa >= 2);
      const halos = layers.halos && residues.some(s => s.additionalInformation?.sasaLoss > 3 && !['water', 'metal'].includes(moeClass(s.additionalInformation)));
      if (smudges || halos) {
        // both marks are solvent exposure: of a ligand atom, and of the residue surface the ligand covers
        const svg = icon();
        if (smudges) svgEl('circle', { cx: halos ? 5.5 : 11, cy: 5, r: 4.8, fill: ink.smudge, 'fill-opacity': 0.5, stroke: 'none' }, svg);
        if (halos) {
          const x = smudges ? 16 : 11;
          svgEl('circle', { cx: x + 1.4, cy: 4.2, r: 4.2, fill: ink.halo, stroke: 'none' }, svg);
          svgEl('circle', { cx: x - 0.4, cy: 5.6, r: 3.5, fill: discs.greasy[0], stroke: discs.greasy[1], 'stroke-width': 0.8 }, svg);
        }
        items.push([svg, 'Solvent exposed', 4]);
      }
      for (const rank of [1, 2, 3, 4]) {
        const at = items.findIndex(item => item[2] === rank);
        if (items.length > 9 && at >= 0) items.splice(at, 1);
      }
      return items.map(([swatch, text]) => [swatch, text]);
    },
  };
})();
