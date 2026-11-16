'use strict';

// Pocket wall: a cross-section of the binding site. The ligand keeps its live skeletal drawing in
// the middle of a cavity; every pocket residue is one brick of the wall around it, and the wall is
// left open where the ligand atoms are exposed to solvent.
(() => {
  const ID = 'style-pocket-wall';
  const WALL = 18;     // least wall thickness; a wide brick label makes the wall thicker
  const CAVITY = 37;   // ligand atoms to the inner face
  const STEP = 2;      // sampling of the wall centreline
  const CLOSE = 140;    // rolling radius: the wall follows only concavities wider than this ball
  const GROW = [0, 3, 6, 9, 12, 16, 20, 24, 28, 32]; // how far the wall may move out to seat every brick
  // Type in drawing units. A side panel shows a unit as about two pixels and never as fewer than 1.7,
  // so nothing printed here goes below 9 px.
  const NAME = 5.8;    // residue names, metal symbols
  const NOTE = 5.4;    // residue numbers, atom names, water, distances
  const LEAD = 6.2;    // baseline of the name to the baseline of the number
  const CAP = 0.71;    // cap height of the font, in em
  const AIR = 0.6;     // clear space between a brick label and the brick's outline
  const PORT = 7.2;    // height of an atom port
  const SLACK = 1.08;  // wall length per unit of brick length when the wall is chosen, so bricks can trade places
  const BACKBONE = new Set(['N', 'O', 'C', 'CA', 'OXT']);
  const TINTS = {
    light: {
      res_hydrophobic: { fill: '#e3efdc', edge: '#a2c494', ink: '#2d5829' },
      res_polar: { fill: '#eae5f6', edge: '#b6a8dd', ink: '#493a85' },
      res_basic: { fill: '#dce8f8', edge: '#96b6e1', ink: '#20497f' },
      res_acidic: { fill: '#f8e1de', edge: '#e0a69f', ink: '#8b2f27' },
      res_other: { fill: '#ececef', edge: '#bfbfc6', ink: '#3f3f46' },
      filler: { fill: '#f4f4f5', edge: '#dadade' },
      solvent: '#4f93d1', water: { fill: '#e6f1fb', edge: '#6aa3d8', ink: '#245a8c' },
      metal: { fill: '#e7e7ea', edge: '#8b8b94', ink: '#27272a' },
    },
    dark: {
      res_hydrophobic: { fill: '#22331f', edge: '#4f7a48', ink: '#b9dcb0' },
      res_polar: { fill: '#2b2542', edge: '#6658a2', ink: '#cdc3f3' },
      res_basic: { fill: '#1c2c45', edge: '#4469a0', ink: '#b6cff3' },
      res_acidic: { fill: '#41211f', edge: '#95514b', ink: '#f3beb8' },
      res_other: { fill: '#2a2a2e', edge: '#5b5b63', ink: '#d4d4d8' },
      filler: { fill: '#202023', edge: '#3a3a40' },
      solvent: '#6fb0ea', water: { fill: '#1b2c3d', edge: '#5d95c9', ink: '#b9d8f4' },
      metal: { fill: '#34343a', edge: '#8e8e98', ink: '#f4f4f5' },
    },
  };
  const CLASS_LABELS = { res_hydrophobic: 'Hydrophobic', res_polar: 'Polar', res_basic: 'Basic', res_acidic: 'Acidic', res_other: 'Other' };
  const DASH = { hbond: '3 2', ionic: '4.4 1.5 0.9 1.5', metal: '0.9 2', pi: '5 2.2', cationPi: '5 1.6 1.4 1.6',
    halogen: '2 1.4', water: '1.4 1.7' };

  const sum = values => values.reduce((n, v) => n + v, 0);
  const title = name => name ? name[0] + name.slice(1).toLowerCase() : '';
  const charWidth = ch => /[MW]/.test(ch) ? 0.9 : /[A-Z]/.test(ch) ? (ch === 'I' ? 0.27 : 0.7) : /[0-9]/.test(ch) ? 0.62 : ch === ' ' ? 0.25 :
    /[ilj.,:']/.test(ch) ? 0.26 : /[frt]/.test(ch) ? 0.37 : /[mw]/.test(ch) ? 0.84 : 0.57;
  const pen = typeof document === 'undefined' ? null : document.createElement('canvas').getContext?.('2d');
  const ems = new Map();
  // Width of a label, measured in the font it is drawn with; the table stands in where there is no canvas.
  function textWidth(value, size, weight, font) {
    const key = `${weight} ${font} ${value}`;
    if (!ems.has(key)) {
      let em = 0;
      if (pen) {
        pen.font = `${weight} 100px ${font}`;
        if (pen.font.includes('100px')) em = pen.measureText(value).width / 100;
      }
      ems.set(key, em || [...String(value)].reduce((n, ch) => n + charWidth(ch), 0) * (weight > 500 ? 1.03 : 1));
    }
    return ems.get(key) * size;
  }
  const fmt = p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const polyline = points => points.map((p, i) => `${i ? 'L' : 'M'}${fmt(p)}`).join('');
  const disc = (x, y, r) => `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0Z`;

  function foot(p, bones) {
    let best = null, distance = Infinity;
    for (const [a, b] of bones) {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const x = a.x + dx * t, y = a.y + dy * t, d = Math.hypot(p.x - x, p.y - y);
      if (d < distance) { distance = d; best = { x, y }; }
    }
    return { point: best, distance };
  }

  function reach(px, py, bones) {
    let best = Infinity;
    for (const [a, b] of bones) {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
      const ex = px - a.x - dx * t, ey = py - a.y - dy * t, d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function distanceGrid(bones, box, h) {
    const nx = Math.ceil(box.width / h) + 1, ny = Math.ceil(box.height / h) + 1, v = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = reach(box.left + i * h, box.top + j * h, bones);
    return { nx, ny, v, h, left: box.left, top: box.top };
  }

  // Marching squares; the longest closed loop at this level of the field.
  function levelLoop(grid, level) {
    const { nx, ny, v, h } = grid, points = new Map(), links = new Map();
    const value = (i, j) => v[j * nx + i] - level;
    const cross = (key, i0, j0, i1, j1) => {
      const a = value(i0, j0), b = value(i1, j1);
      if ((a < 0) === (b < 0)) return null;
      if (!points.has(key)) {
        const t = a / (a - b);
        points.set(key, { x: grid.left + (i0 + (i1 - i0) * t) * h, y: grid.top + (j0 + (j1 - j0) * t) * h });
      }
      return key;
    };
    const link = (a, b) => {
      for (const [from, to] of [[a, b], [b, a]]) {
        if (!links.has(from)) links.set(from, []);
        links.get(from).push(to);
      }
    };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const base = j * nx + i;
      const edges = [cross(base * 2, i, j, i + 1, j), cross((base + 1) * 2 + 1, i + 1, j, i + 1, j + 1),
        cross((base + nx) * 2, i, j + 1, i + 1, j + 1), cross(base * 2 + 1, i, j, i, j + 1)].filter(k => k !== null);
      if (edges.length === 2) link(edges[0], edges[1]);
      else if (edges.length === 4) {
        const centre = (value(i, j) + value(i + 1, j) + value(i, j + 1) + value(i + 1, j + 1)) / 4;
        if ((centre < 0) === (value(i, j) < 0)) { link(edges[0], edges[1]); link(edges[2], edges[3]); }
        else { link(edges[0], edges[3]); link(edges[1], edges[2]); }
      }
    }
    const seen = new Set();
    let best = [];
    for (const start of links.keys()) {
      if (seen.has(start)) continue;
      const loop = [];
      let previous = null, current = start;
      while (current !== null && !seen.has(current)) {
        seen.add(current);
        loop.push(points.get(current));
        const next = links.get(current).find(k => k !== previous && !seen.has(k));
        previous = current;
        current = next === undefined ? null : next;
      }
      if (loop.length > best.length) best = loop;
    }
    return best;
  }

  function resample(points, count) {
    const m = points.length, cum = [0];
    for (let i = 0; i < m; i++) {
      const a = points[i], b = points[(i + 1) % m];
      cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const total = cum[m], n = count || Math.max(24, Math.round(total / STEP)), out = [];
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s = total * i / n;
      while (k < m - 1 && cum[k + 1] < s) k++;
      const a = points[k], b = points[(k + 1) % m], t = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
  }

  function smooth(points, radius, passes) {
    const n = points.length;
    for (let pass = 0; pass < passes; pass++) {
      points = points.map((_, i) => {
        let x = 0, y = 0;
        for (let d = -radius; d <= radius; d++) { const p = points[(i + d + n * 8) % n]; x += p.x; y += p.y; }
        return { x: x / (2 * radius + 1), y: y / (2 * radius + 1) };
      });
    }
    return points;
  }

  function buildWall(grid, bones, level) {
    // Morphological closing: grow the ligand outline further than needed, then come back by the
    // same amount, so the wall follows only the concavities a residue could actually fill.
    const far = levelLoop(grid, level + CLOSE);
    if (far.length < 8) return null;
    const rim = resample(far, Math.max(24, far.length >> 1));
    const edges = rim.map((p, i) => [p, rim[(i + 1) % rim.length]]);
    const v = new Float32Array(grid.v.length);
    for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
      const d = grid.v[j * grid.nx + i];
      v[j * grid.nx + i] = d > level + CLOSE ? -1 : d < level - 8 ? 999 : reach(grid.left + i * grid.h, grid.top + j * grid.h, edges);
    }
    const loop = levelLoop({ ...grid, v }, CLOSE);
    if (loop.length < 8) return null;
    const points = resample(smooth(resample(loop), 5, 2));
    const n = points.length;
    let length = 0;
    for (let i = 0; i < n; i++) length += Math.hypot(points[(i + 1) % n].x - points[i].x, points[(i + 1) % n].y - points[i].y);
    let normals = points.map((_, i) => {
      const a = points[(i - 1 + n) % n], b = points[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: (b.y - a.y) / l, y: -(b.x - a.x) / l };
    });
    const probe = { x: points[0].x + normals[0].x * 3, y: points[0].y + normals[0].y * 3 };
    if (foot(probe, bones).distance < foot(points[0], bones).distance) normals = normals.map(v2 => ({ x: -v2.x, y: -v2.y }));
    const step = length / n;
    // Signed curvature, positive where the wall bends around the ligand and its inner face is the shorter one.
    const turn = points.map((_, i) => {
      const a = (i - 1 + n) % n, b = (i + 1) % n, dx = points[b].x - points[a].x, dy = points[b].y - points[a].y;
      return ((normals[b].x - normals[a].x) * dx + (normals[b].y - normals[a].y) * dy) / ((dx * dx + dy * dy) || 1);
    });
    const bend = turn.map((_, i) => { let k = 0; for (let d = -4; d <= 4; d++) k += turn[(i + d + n) % n]; return k / 9; });
    return {
      length, level,
      // Outward normal and curvature of the stretch of wall around arc length s.
      frame(s) {
        const i = Math.round((((s % length) + length) % length) / step) % n;
        return { nx: normals[i].x, ny: normals[i].y, k: bend[i] };
      },
      // A point of the centreline at arc length s, shifted along the outward normal.
      at(s, off = 0) {
        const f = (((s % length) + length) % length) / step, whole = Math.floor(f);
        const i = whole % n, j = (i + 1) % n, t = f - whole;
        let nx = normals[i].x + (normals[j].x - normals[i].x) * t, ny = normals[i].y + (normals[j].y - normals[i].y) * t;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        return { x: points[i].x + (points[j].x - points[i].x) * t + nx * off, y: points[i].y + (points[j].y - points[i].y) * t + ny * off, nx, ny };
      },
      nearest(p) {
        let best = 0, distance = Infinity;
        for (let i = 0; i < n; i++) {
          const d = (points[i].x - p.x) ** 2 + (points[i].y - p.y) ** 2;
          if (d < distance) { distance = d; best = i; }
        }
        return best * step;
      },
    };
  }

  // Ordered items keep their order, do not overlap and stay as close to their wanted centres as they can.
  function place(items, from, to) {
    const slack = Math.max(0, to - from - sum(items.map(item => item.len)));
    let offset = 0;
    const blocks = [];
    for (const item of items) {
      blocks.push({ total: item.want - item.len / 2 - offset - from, count: 1 });
      offset += item.len;
      while (blocks.length > 1 && blocks[blocks.length - 2].total / blocks[blocks.length - 2].count > blocks[blocks.length - 1].total / blocks[blocks.length - 1].count) {
        const last = blocks.pop();
        blocks[blocks.length - 1].total += last.total;
        blocks[blocks.length - 1].count += last.count;
      }
    }
    const shifts = blocks.flatMap(b => Array(b.count).fill(Math.min(slack, Math.max(0, b.total / b.count))));
    offset = 0;
    return items.map((item, i) => { const left = from + shifts[i] + offset; offset += item.len; return left; });
  }

  function shares(group, room, weight) {
    const lens = group.map(r => r.min), total = sum(lens);
    if (total >= room) return lens.map(v => v * room / total);
    const caps = group.map(r => Math.max(r.min * 3, 60));
    let extra = room - total, open = group.map((_, i) => i);
    for (let pass = 0; pass < 5 && extra > 0.01 && open.length; pass++) {
      const weights = open.map(i => weight(group[i])), all = sum(weights), next = [];
      let used = 0;
      open.forEach((i, k) => {
        const add = Math.min(caps[i] - lens[i], extra * weights[k] / all);
        lens[i] += add; used += add;
        if (lens[i] < caps[i] - 0.01) next.push(i);
      });
      extra -= used; open = next;
    }
    return lens;
  }

  // Proper intersection of segments pq and rs, or null.
  function cross(p, q, r, s) {
    const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
    return t > 0 && t < 1 && u > 0 && u < 1 ? { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) } : null;
  }

  // Whether segment pq enters the interior of an axis-aligned box.
  function enters(p, q, b) {
    if (Math.max(p.x, q.x) < b.left || Math.min(p.x, q.x) > b.right || Math.max(p.y, q.y) < b.top || Math.min(p.y, q.y) > b.bottom) return false;
    const inside = v => v.x > b.left && v.x < b.right && v.y > b.top && v.y < b.bottom;
    if (inside(p) || inside(q)) return true;
    const c = [{ x: b.left, y: b.top }, { x: b.right, y: b.top }, { x: b.right, y: b.bottom }, { x: b.left, y: b.bottom }];
    return c.some((v, i) => cross(p, q, v, c[(i + 1) % 4]));
  }

  const rect = (box, pad) => ({ left: box.x - box.w / 2 - pad, right: box.x + box.w / 2 + pad, top: box.y - box.h / 2 - pad, bottom: box.y + box.h / 2 + pad });
  const clearance = (p, b) => Math.hypot(p.x - Math.max(b.left, Math.min(b.right, p.x)), p.y - Math.max(b.top, Math.min(b.bottom, p.y)));

  // Atom labels of the ligand drawing in the coordinates of the study layer, each with the atom it belongs to.
  function ligandTexts(root, atomPoint, bondLen) {
    const host = typeof groups === 'function' ? groups().atomGroupsComponent?.atomToSelMap?.[0]?.structureSel?.node() : null;
    const m = host && root.getScreenCTM?.();
    if (!m) return [];
    const inv = m.inverse(), map = (x, y) => ({ x: inv.a * x + inv.c * y + inv.e, y: inv.b * x + inv.d * y + inv.f });
    const out = [];
    for (const t of host.querySelectorAll('text')) {
      if (!t.textContent.trim() || t.checkVisibility?.() === false) continue;
      const r = t.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) continue;
      const a = map(r.left, r.top + r.height * 0.2), b = map(r.right, r.bottom - r.height * 0.2);
      const box = { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
      const c = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
      let owner = null, distance = bondLen * 0.8;
      for (const [id, p] of atomPoint) {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < distance) { distance = d; owner = id; }
      }
      out.push({ box, owner });
    }
    return out;
  }

  let cache = { key: '' };

  function draw(ctx) {
    const { el, text, line, hit, root, under, ligand, contacts, data, fg, bg, muted, H } = ctx;
    for (const key of ['contour', 'smudges', 'halos', 'chain']) overlay[key]?.replaceChildren();
    const tint = TINTS[ctx.theme === 'dark' ? 'dark' : 'light'];
    const font = styleOf().fontFamily || 'Helvetica, Arial, sans-serif';
    const scene = data.scene.scene, layers = state.layers;
    const width = (value, size, weight) => textWidth(value, size, weight, font);
    // `y` is the middle of the capitals, not the baseline.
    const label = (x, y, value, size, attrs = {}, parent = root) => text(x, y + size * CAP / 2, value,
      { 'font-size': size, 'font-family': font, 'text-anchor': 'middle', 'pointer-events': 'none', ...attrs }, parent);

    const atomPoint = new Map(ligand.atoms.map(a => [a.id, ctx.liveAtom(0, a.id)]).filter(([, p]) => p));
    if (!atomPoint.size) return;
    const bonded = new Set();
    const bones = [];
    for (const bond of ligand.bonds || []) {
      const a = atomPoint.get(bond.from), b = atomPoint.get(bond.to);
      if (a && b) { bones.push([a, b]); bonded.add(bond.from).add(bond.to); }
    }
    for (const [id, p] of atomPoint) if (!bonded.has(id)) bones.push([p, p]);
    const bondList = (ligand.bonds || []).map(b => ({ a: atomPoint.get(b.from), b: atomPoint.get(b.to), from: b.from, to: b.to })).filter(b => b.a && b.b);
    for (const b of bondList) b.box = H.box([b.a, b.b]);
    const bondLen = bondList.length ? sum(bondList.map(b => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y))) / bondList.length : 14;
    const texts = ligandTexts(root, atomPoint, bondLen);
    const key = [...atomPoint.values()].map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    if (cache.key !== key) cache = { key, walls: new Map(), layouts: new Map(),
      grid: distanceGrid(bones, H.box([...atomPoint.values()], CAVITY + 12 + GROW[GROW.length - 1] + CLOSE + 12), 5) };
    const wallAt = level => {
      if (!cache.walls.has(level)) cache.walls.set(level, buildWall(cache.grid, bones, level));
      return cache.walls.get(level);
    };

    // Residues become bricks; waters and metals stay as nodes inside the cavity.
    const bricks = [], nodes = new Map();
    for (const s of ctx.partners) {
      if (!structureVisible(s.id) || !s.points.length) continue;
      const info = s.additionalInformation || {}, at = H.mean(s.points);
      if (info.class === 'water' || info.class === 'metal') nodes.set(s.id, { s, info, at, radius: info.class === 'water' ? 6.5 : 6.6 });
      else bricks.push({ s, info, at, ports: new Map(), touches: [] });
    }
    // A brick reads as the residue name over its number; the chain letter is printed only in a pocket made of
    // several chains. `bw` and `bh` are the half-width and half-height of that block, air included.
    for (const r of bricks) {
      const name = title(r.info.name) || r.s.structureLabel || '';
      r.weight = r.info.tier === 'context' ? 400 : 600;
      r.lines = r.info.number != null ? [name, `${r.info.number}${r.info.chainLabel ? ` ${r.info.chainLabel}` : ''}`] : [name];
      r.bw = Math.max(width(r.lines[0], NAME, r.weight), r.lines[1] ? width(r.lines[1], NOTE, r.weight) : 0) / 2 + AIR;
      r.bh = (CAP * NAME + (r.lines[1] ? LEAD : 0)) / 2 + AIR;
      r.loss = Math.max(0, r.info.sasaLoss || 0);
    }
    // Thick enough for the widest label at any slant of the wall.
    const half = Math.min(12, Math.max(WALL / 2, ...bricks.map(r => Math.hypot(r.bw, r.bh) + 0.8)));
    const brickById = new Map(bricks.map(r => [r.s.id, r]));
    // A node keeps a clear band between the ligand skeleton and the ports on the inner face.
    const settle = node => {
      let p = node.at;
      for (let pass = 0; pass < 4; pass++) {
        const f = foot(p, bones), d = f.distance || 1;
        const dx = f.distance ? (p.x - f.point.x) / d : 0, dy = f.distance ? (p.y - f.point.y) / d : -1;
        const depth = Math.max(node.radius + 10.4, Math.min(CAVITY - 15, d));
        p = { x: f.point.x + dx * depth, y: f.point.y + dy * depth };
        if (Math.abs(depth - d) < 0.05) break;
      }
      node.x = p.x; node.y = p.y;
    };
    const nodeList = [...nodes.values()];
    // Start beside the ligand atoms the node binds, on the side its own position points to.
    for (const node of nodeList) {
      const bound = contacts.filter(c => c.visible && c.record.structure === node.s.id && c.record.ligandAtom && c.a).map(c => c.a);
      if (bound.length) {
        const m = H.mean(bound), d = Math.hypot(node.at.x - m.x, node.at.y - m.y);
        if (d > 1) node.at = { x: m.x + (node.at.x - m.x) / d * 17, y: m.y + (node.at.y - m.y) / d * 17 };
      }
      settle(node);
    }
    const spread = () => {
      let moved = false;
      for (let i = 0; i < nodeList.length; i++) for (let j = i + 1; j < nodeList.length; j++) {
        const a = nodeList[i], b = nodeList[j], d = Math.hypot(b.x - a.x, b.y - a.y), gap = a.radius + b.radius + 4;
        if (d >= gap) continue;
        const ux = d ? (b.x - a.x) / d : 1, uy = d ? (b.y - a.y) / d : 0, push = (gap - d) / 2 + 0.2;
        a.at = { x: a.x - ux * push, y: a.y - uy * push }; b.at = { x: b.x + ux * push, y: b.y + uy * push };
        settle(a); settle(b); moved = true;
      }
      return moved;
    };
    for (let pass = 0; pass < 12 && spread(); pass++);
    // Candidate seats of a node: around the ligand atoms it binds, held at the same clear band.
    for (const node of nodeList) {
      node.start = { x: node.x, y: node.y };
      const bound = contacts.filter(c => c.visible && c.record.structure === node.s.id && c.record.ligandAtom && c.a).map(c => c.a);
      const centres = bound.length ? [H.mean(bound), ...bound] : [node.start];
      node.cands = [node.start];
      for (const base of centres) for (const reachOut of [14, 20, 26]) for (let k = 0; k < 24; k++) {
        const seat = { at: { x: base.x + Math.cos(k * Math.PI / 12) * reachOut, y: base.y + Math.sin(k * Math.PI / 12) * reachOut }, radius: node.radius };
        settle(seat);
        if (node.cands.every(c => Math.hypot(c.x - seat.x, c.y - seat.y) > 2.5)) node.cands.push({ x: seat.x, y: seat.y });
      }
    }

    const ringOf = id => (ligand.rings || []).find(r => r.id === id);
    const ringCentre = id => {
      const ring = ringOf(id);
      const points = ring ? ring.atoms.map(a => atomPoint.get(a)).filter(Boolean) : [];
      return points.length ? H.mean(points) : null;
    };
    const nearestAtom = p => {
      let best = null, distance = Infinity;
      for (const [id, q] of atomPoint) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < distance) { distance = d; best = id; } }
      return best;
    };
    const resolve = (sid, id, ring, c) => {
      if (sid === 0) {
        const centre = ring ? ringCentre(id) : null, point = centre || atomPoint.get(id);
        const atom = ligand.atoms.find(a => a.id === id);
        if (!point) return null;
        // An implicit hydrogen is written on the open side of its atom; lines arriving from there stop short of it.
        let open = null;
        if (!centre && atom && atom.hydrogenCount > 0 && atom.element !== 'C') {
          const around = (ligand.bonds || []).filter(b => b.from === id || b.to === id)
            .map(b => atomPoint.get(b.from === id ? b.to : b.from)).filter(Boolean);
          if (around.length) {
            const m = H.mean(around), d = Math.hypot(point.x - m.x, point.y - m.y);
            if (d > 0.5) open = { x: (point.x - m.x) / d, y: (point.y - m.y) / d };
          }
        }
        return { point, ring: !!centre, open, trim: centre ? 3 : atom && (atom.label || atom.element !== 'C') ? 5.2 : 2.2,
          single: centre ? [] : [id], ringAtoms: centre ? ringOf(id).atoms : [], labels: centre ? [] : texts.filter(t => t.owner === id) };
      }
      if (nodes.has(sid)) return { node: nodes.get(sid) };
      const brick = brickById.get(sid);
      if (!brick) return null;
      const name = (sid === c.record.structure && c.record.residueAtom) || data.atomRefs?.[id]?.atom || '?';
      if (!brick.ports.has(name)) brick.ports.set(name, { name, brick, others: [],
        backbone: sid === c.record.structure && c.record.backbone != null ? c.record.backbone : BACKBONE.has(name) });
      return { port: brick.ports.get(name) };
    };
    const links = [];
    for (const c of contacts) {
      if (!c.visible) continue;
      if (c.record.kind === 'hydrophobic') {
        const brick = brickById.get(c.record.structure);
        if (brick && c.a) brick.touches.push({ c });
        continue;
      }
      const edge = c.record.type ? (scene[c.record.type] || []).find(e => e.id === c.record.id) : null;
      const from = edge ? resolve(edge.fromStructure, edge.from, ['piStackings', 'cationPiStackings'].includes(c.record.type), c) :
        c.a ? { point: c.a, trim: 3.5, single: [nearestAtom(c.a)], ringAtoms: [] } : null;
      const to = edge ? resolve(edge.toStructure, edge.to, c.record.type === 'piStackings', c) : resolve(c.record.structure, null, false, c);
      if (from && to) links.push({ c, ends: [from, to] });
    }
    const anchor = end => end.point || (end.node ? { x: end.node.x, y: end.node.y } : null);
    for (const link of links) {
      const { ends } = link;
      ends.forEach((end, i) => { if (end.port) end.port.others.push(ends[1 - i]); });
      link.single = new Set(ends.flatMap(e => e.single || []));
      link.ring = new Set(ends.flatMap(e => e.ringAtoms || []));
      link.ports = new Set(ends.map(e => e.port).filter(Boolean));
      link.nodes = new Set(ends.map(e => e.node).filter(Boolean));
      link.bricks = new Set([...link.ports].map(p => p.brick));
    }
    // A line may leave through the bonds of its own atom or ring and over that atom's own label.
    const excused = (link, b) => link.single.has(b.from) || link.single.has(b.to) || (link.ring.has(b.from) && link.ring.has(b.to));
    const ownText = (link, t) => link.single.has(t.owner) || link.ring.has(t.owner);

    for (const r of bricks) {
      r.portList = [...r.ports.values()];
      for (const p of r.portList) p.w = p.name === 'ring' ? 9 : Math.max(8.6, width(p.name, NOTE, 500) + 3.6);
      r.portWidth = sum(r.portList.map(p => p.w));
    }
    // Centreline length a brick needs on a stretch of wall with frame `f`. Text stays level, so a label takes
    // its height along an upright stretch and its width along a level one; on a bend the shorter face has to
    // hold it. The ports stand side by side on the inner face.
    const lengthAt = (r, f) => {
      const ax = Math.abs(f.nx), ay = Math.abs(f.ny), count = r.portList.length;
      const text = 2 * ((ay * r.bw + ax * r.bh) / Math.max(0.6, 1 - Math.abs(f.k) * (ax * r.bw + ay * r.bh)) + 1.2);
      const ports = count ? (ay * r.portWidth + (ax * PORT + 2.4) * count) / Math.max(0.5, Math.min(1.5, 1 - f.k * half)) + 3 : 0;
      return Math.max(text, ports) + (r.spare || 0);
    };
    const weight = r => layers.halos ? 5 + r.loss : 1;

    // Solvent openings: exposed ligand atoms cut the stretch of wall that faces them.
    const findOpenings = wall => {
      if (!layers.exposure) return [];
      const spans = [];
      for (const m of data.overlay?.ligandAtoms || []) {
        const p = atomPoint.get(m.atom);
        if (!p || !(m.sasa >= 4)) continue;
        const s = wall.nearest(p), w = (7 + m.sasa) / 2;
        spans.push({ a: s - w, b: s + w, sasa: m.sasa });
      }
      spans.sort((x, y) => x.a - y.a);
      const merged = [];
      for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span.a <= last.b + 9) { last.b = Math.max(last.b, span.b); last.sasa += span.sasa; }
        else merged.push({ ...span });
      }
      if (merged.length > 1 && merged[0].a + wall.length <= merged[merged.length - 1].b + 9) {
        const first = merged.shift(), last = merged[merged.length - 1];
        last.b = Math.max(last.b, first.b + wall.length); last.sasa += first.sasa;
      }
      return merged.filter(v => v.sasa >= 6).map(v => ({ mid: (v.a + v.b) / 2,
        half: Math.max(7, Math.min(wall.length * 0.12, (v.b - v.a) / 2)), sasa: v.sasa }));
    };
    let wall = null, L = 0, origin = 0, gaps = [], arcs = [], need = 0, stretch = 0;
    const wrap = s => ((s % L) + L) % L;
    const u = s => wrap(s - origin);
    const at = (v, off = 0) => wall.at(origin + v, off);
    const frame = v => wall.frame(origin + v);
    // Take a wall and the openings cut into it: the arcs between the openings and where each brick wants to sit.
    const adopt = (candidate, openings) => {
      wall = candidate; L = wall.length;
      for (const r of bricks) r.s0 = wall.nearest(r.at);
      origin = 0;
      if (openings.length) origin = openings[0].mid;
      else if (bricks.length) {
        const sorted = bricks.map(r => r.s0).sort((a, b) => a - b);
        let widest = -1;
        sorted.forEach((s, i) => {
          const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + L;
          if (next - s > widest) { widest = next - s; origin = (s + next) / 2; }
        });
      }
      gaps = openings.map(o => ({ ...o, mid: u(o.mid) })).sort((a, b) => a.mid - b.mid);
      arcs = gaps.length ? gaps.map((gap, k) => ({ from: gap.mid + gap.half,
        to: (k + 1 < gaps.length ? gaps[k + 1].mid : L) - (k + 1 < gaps.length ? gaps[k + 1].half : gaps[0].half) })) : [{ from: 0, to: L }];
      for (const r of bricks) r.u = r.u0 = u(r.s0);
      need = sum(bricks.map(r => lengthAt(r, frame(r.u0))));
      stretch = Math.max(0, sum(arcs.map(arc => Math.max(0, arc.to - arc.from))) - need) / (sum(bricks.map(weight)) || 1);
    };
    const run = (from, to, off) => {
      const count = Math.max(1, Math.ceil(Math.abs(to - from) / STEP)), points = [];
      for (let i = 0; i <= count; i++) points.push(at(from + (to - from) * i / count, off));
      return points;
    };
    const band = (a, b, inset = 0.6) => {
      a += inset; b -= inset;
      const r = Math.max(0.4, Math.min(2.6, (b - a) / 2.4));
      const inner = run(a + r, b - r, -half), outer = run(b - r, a + r, half);
      return `${polyline(inner)}Q${fmt(at(b, -half))} ${fmt(at(b, -half + r))}L${fmt(at(b, half - r))}Q${fmt(at(b, half))} ${fmt(outer[0])}` +
        `${polyline(outer).replace('M', 'L')}Q${fmt(at(a, half))} ${fmt(at(a, half - r))}L${fmt(at(a, -half + r))}Q${fmt(at(a, -half))} ${fmt(inner[0])}Z`;
    };
    // Arc position of the wall point nearest to p, unwrapped around a brick's middle.
    const along = (brick, p) => {
      const mid = (brick.a + brick.b) / 2;
      return mid + wrap(wall.nearest(p) - origin - mid + L / 2) - L / 2;
    };

    // Cut the angular order into the wall arcs between openings; arcs stay evenly loaded so
    // brick lengths remain comparable around the whole wall.
    const n = bricks.length;
    let fillers = [], crowded = [];
    // Lay the bricks out in the order of their wanted positions `u`, then seat their ports.
    const arrange = () => {
      const K = arcs.length;
      for (const r of bricks) {
        r.a = r.b = null;
        r.min = lengthAt(r, frame(r.u));
        r.ideal = r.min + stretch * weight(r);
        for (const p of r.portList) p.box = null;
      }
      bricks.sort((a, b) => a.u - b.u || a.s.id - b.s.id);
      // Prefix sums make the cost of a run of bricks on one arc O(1).
      const total = new Float64Array(n + 1), ideal = new Float64Array(n + 1);
      bricks.forEach((r, q) => { total[q + 1] = total[q] + r.min; ideal[q + 1] = ideal[q] + r.ideal; });
      const shift = arcs.map(arc => {
        const out = new Float64Array(n + 1);
        bricks.forEach((r, q) => { out[q + 1] = out[q] + (Math.max(arc.from + r.min / 2, Math.min(arc.to - r.min / 2, r.u)) - r.u) ** 2; });
        return out;
      });
      const cost = (k, i, j) => {
        const room = arcs[k].to - arcs[k].from, used = total[j] - total[i];
        return shift[k][j] - shift[k][i] + 0.5 * (room - (ideal[j] - ideal[i])) ** 2 + (used > room ? 1e6 + (used - room) * 1e4 : 0) + (i === j && room > 14 ? 2500 : 0);
      };
      const best = Array.from({ length: K + 1 }, () => new Float64Array(n + 1).fill(Infinity));
      const back = Array.from({ length: K + 1 }, () => new Int32Array(n + 1));
      best[0][0] = 0;
      for (let k = 1; k <= K; k++) for (let j = 0; j <= n; j++) for (let i = 0; i <= j; i++) {
        if (best[k - 1][i] === Infinity) continue;
        const value = best[k - 1][i] + cost(k - 1, i, j);
        if (value < best[k][j]) { best[k][j] = value; back[k][j] = i; }
      }
      fillers = [];
      crowded = [];
      for (let k = K, j = n; k >= 1; k--) {
        const i = back[k][j], arc = arcs[k - 1], group = bricks.slice(i, j);
        j = i;
        if (arc.to - arc.from < 1) continue;
        let lens = shares(group, arc.to - arc.from, weight);
        let lefts = place(group.map((r, q) => ({ len: lens[q], want: r.u })), arc.from, arc.to);
        // A brick pushed along the wall can need more length where it lands than where it wanted to be.
        for (let pass = 0; pass < 2; pass++) {
          let short = false;
          group.forEach((r, q) => {
            const min = lengthAt(r, frame(lefts[q] + lens[q] / 2));
            if (min > lens[q] + 0.05) { r.min = Math.max(r.min, min); short = true; }
          });
          if (!short) break;
          lens = shares(group, arc.to - arc.from, weight);
          lefts = place(group.map((r, q) => ({ len: lens[q], want: r.u })), arc.from, arc.to);
        }
        // An arc that cannot give its bricks their length squeezes them all; the search treats it as a conflict.
        const over = sum(group.map(r => r.min)) - (arc.to - arc.from);
        if (over > 0.3 * group.length) crowded.push({ bricks: new Set(group), over });
        let cursor = arc.from;
        group.forEach((r, q) => {
          r.a = lefts[q]; r.b = lefts[q] + lens[q];
          if (r.a - cursor > 8) fillers.push({ a: cursor, b: r.a });
          else r.a = cursor;
          cursor = r.b;
        });
        if (arc.to - cursor > 8 || !group.length) fillers.push({ a: cursor, b: arc.to });
        else if (group.length) group[group.length - 1].b = arc.to;
      }

      // Ports: the residue atoms that take part in a contact, on the inner face of their brick.
      for (const r of bricks) {
        if (r.a == null) continue;
        const c = (r.a + r.b) / 2, mid = at(c), before = at(c - 2, -half), after = at(c + 2, -half);
        // Inner-face length per unit of centreline: below one where the wall bends around the ligand.
        const ratio = Math.max(0.5, Math.hypot(after.x - before.x, after.y - before.y) / 4);
        const ports = r.portList.map(p => {
          const wants = p.others.map(anchor).filter(Boolean).map(q => along(r, q));
          return { p, want: wants.length ? sum(wants) / wants.length : c,
            len: (Math.abs(mid.ny) * p.w + Math.abs(mid.nx) * PORT + 2.4) / ratio,
            out: Math.abs(mid.nx) * p.w + Math.abs(mid.ny) * PORT + (p.backbone ? 0 : 3) };
        });
        // Ports that aim at the same atom: the one standing further into the cavity goes on the far side,
        // so the line of the other does not have to pass it.
        const side = sum(ports.map(v => v.want)) >= c * ports.length ? 1 : -1;
        ports.sort((x, y) => Math.round(x.want) - Math.round(y.want) || (y.out - x.out) * side || x.want - y.want);
        const room = r.b - r.a - 3, wanted = sum(ports.map(v => v.len));
        const scale = wanted * 1.3 <= room ? 1.3 : wanted > room ? room / wanted : 1;
        ports.forEach(v => { v.len *= scale; });
        place(ports, r.a + 1.5, r.b - 1.5).forEach((left, i) => {
          const p = ports[i].p, face = at(left + ports[i].len / 2, -half);
          // A backbone atom sits on the wall itself; a side-chain atom stands off it on a stem.
          const extent = (Math.abs(face.nx) * p.w + Math.abs(face.ny) * PORT) / 2, lift = p.backbone ? 0 : 3;
          p.face = face;
          p.box = { x: face.x - face.nx * (extent + lift), y: face.y - face.ny * (extent + lift), w: p.w, h: PORT };
        });
        const count = Math.max(1, Math.ceil((r.b - r.a) / 4));
        r.face = Array.from({ length: count + 1 }, (_, i) => at(r.a + (r.b - r.a) * i / count, -half));
        r.faceBox = H.box(r.face);
      }
    };

    // The wall moves out until every arc holds its bricks with length to spare, so that bricks can trade
    // places. Up to the fifth step the openings keep their full width; a wall that would have to move
    // further first narrows them, down to the width that still reads as an opening.
    for (const grow of GROW) {
      const candidate = wallAt(CAVITY + half + grow);
      if (!candidate) break;
      const openings = findOpenings(candidate);
      let seated = false;
      for (const keep of grow < 12 || !openings.length ? [1] : [1, 0.5, 0]) {
        adopt(candidate, openings.map(o => ({ ...o, half: Math.min(o.half, 5.5) + Math.max(0, o.half - 5.5) * keep })));
        arrange();
        seated = !crowded.length && sum(arcs.map(arc => Math.max(0, arc.to - arc.from))) >= need * SLACK;
        if (seated) break;
      }
      if (seated) break;
    }
    if (!wall) return;

    // ---------------------------------------------------------------- routing and its conflicts
    // Where the line from outside meets the border of a port, aiming at a point inside it.
    const clip = (from, box, aim) => {
      const dx = from.x - aim.x, dy = from.y - aim.y;
      const tx = dx > 0 ? (box.x + box.w / 2 - aim.x) / dx : dx < 0 ? (box.x - box.w / 2 - aim.x) / dx : Infinity;
      const ty = dy > 0 ? (box.y + box.h / 2 - aim.y) / dy : dy < 0 ? (box.y - box.h / 2 - aim.y) / dy : Infinity;
      const t = Math.min(1, tx, ty);
      return { x: aim.x + dx * t, y: aim.y + dy * t };
    };
    const toward = (p, q, by) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y) || 1, t = Math.min(by, d * 0.45);
      return { x: p.x + (q.x - p.x) / d * t, y: p.y + (q.y - p.y) / d * t };
    };
    const facing = (open, p, q) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return ((q.x - p.x) * open.x + (q.y - p.y) * open.y) / d > 0.82;
    };
    // How far from its atom at p a line towards q has to start to be clear of every piece of that atom's
    // label: the hydrogens, their count and the charge are written beside the symbol.
    const clearOf = (labels, p, q) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y) || 1, ux = (q.x - p.x) / d, uy = (q.y - p.y) / d;
      let far = 0;
      for (const { box } of labels) {
        let enter = 0, leave = Infinity;
        for (const [from, u, low, high] of [[p.x, ux, box.left - 0.8, box.right + 0.8], [p.y, uy, box.top - 0.8, box.bottom + 0.8]]) {
          if (Math.abs(u) < 1e-9) { if (from < low || from > high) leave = -1; continue; }
          enter = Math.max(enter, Math.min((low - from) / u, (high - from) / u));
          leave = Math.min(leave, Math.max((low - from) / u, (high - from) / u));
        }
        if (leave >= enter && leave > far) far = leave;
      }
      return far ? far + 0.4 : 0;
    };
    const centre = end => end.point || (end.node ? { x: end.node.x, y: end.node.y } : end.port.box ? { x: end.port.box.x, y: end.port.box.y } : null);
    const route = () => {
      // Contacts that share a port arrive side by side instead of on top of each other.
      const arrivals = new Map();
      for (const link of links) link.ends.forEach((end, i) => {
        if (!end.port || !end.port.box) return;
        if (!arrivals.has(end.port)) arrivals.set(end.port, []);
        arrivals.get(end.port).push({ end, other: centre(link.ends[1 - i]) });
      });
      for (const [port, list] of arrivals) {
        const box = port.box, axis = Math.abs(port.face.ny) > Math.abs(port.face.nx) ? 'x' : 'y', across = axis === 'x' ? 'y' : 'x';
        // How far from the middle of the box a line may land, along the wall and towards the cavity.
        const reach = { x: box.w / 2 - 1.6, y: box.h / 2 - 1.2 };
        const lean = (q, key) => q ? Math.max(-reach[key], Math.min(reach[key], q[key] - box[key])) : 0;
        const gap = list.length > 1 ? Math.min(2.6, 2 * reach[axis] / (list.length - 1)) : 0, fan = (list.length - 1) / 2 * gap;
        // Ordered by slope as seen from the port, so the lines fan out instead of crossing at the box.
        const slope = q => q ? (q[axis] - box[axis]) / (Math.abs(q[across] - box[across]) || 0.01) : 0;
        list.sort((a, b) => slope(a.other) - slope(b.other));
        // The lines land on the part of the box that faces their far ends: a slanting line then leaves
        // past the corner of the box instead of across the port next to it.
        const middle = Math.max(fan - reach[axis], Math.min(reach[axis] - fan, sum(list.map(item => lean(item.other, axis))) / list.length));
        list.forEach((item, k) => {
          item.end.aim = { x: box.x, y: box.y };
          item.end.aim[axis] += middle + (k - (list.length - 1) / 2) * gap;
          item.end.aim[across] += lean(item.other, across);
        });
      }
      for (const link of links) {
        const raw = link.raw = link.ends.map(centre);
        link.tips = raw[0] && raw[1] ? link.ends.map((end, i) => end.point ? toward(raw[i], raw[1 - i], Math.max(clearOf(end.labels || [], raw[i], raw[1 - i]),
          end.trim + (end.open && facing(end.open, raw[i], raw[1 - i]) ? 5.4 : 0))) :
          end.node ? toward(raw[i], raw[1 - i], end.node.radius + 0.8) : clip(raw[1 - i], end.port.box, end.aim || raw[i])) : null;
      }
    };
    const halfWrap = d => wrap(d + L / 2) - L / 2;
    const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    // Every crossing or overlap costs far more than any amount of moving a brick or lengthening a line.
    // `blame`, when given, collects the links and nodes that take part in each conflict.
    // `nodeBad` counts the conflicts a node takes part in, the ones re-seating nodes could still remove.
    let spent = 0, nodeBad = 0;
    const score = blame => {
      spent++;
      route();
      const live = links.filter(l => l.tips), ports = bricks.flatMap(r => r.portList).filter(p => p.box);
      for (const port of ports) {
        port.rect = rect(port.box, 0.6);
        port.span = { left: Math.min(port.rect.left, port.face.x), right: Math.max(port.rect.right, port.face.x),
          top: Math.min(port.rect.top, port.face.y), bottom: Math.max(port.rect.bottom, port.face.y) };
      }
      let bad = 0, soft = 0;
      nodeBad = 0;
      const flag = (...parts) => {
        bad++;
        if (parts.some(part => part.nodes ? part.nodes.size : part.cands)) nodeBad++;
        if (blame) for (const part of parts) blame.add(part);
      };
      for (const l of live) {
        const [p, q] = l.tips;
        const span = { left: Math.min(p.x, q.x), right: Math.max(p.x, q.x), top: Math.min(p.y, q.y), bottom: Math.max(p.y, q.y) };
        const length = Math.hypot(q.x - p.x, q.y - p.y);
        soft += length * 0.05;
        if (length < 4) flag(l); // too short to read as a line
        for (const b of bondList) if (meet(span, b.box) && !excused(l, b) && cross(p, q, b.a, b.b)) flag(l);
        for (const t of texts) if (meet(span, t.box) && !ownText(l, t) && enters(p, q, t.box)) flag(l);
        for (const port of ports) if (!l.ports.has(port) && meet(span, port.span) && (enters(p, q, port.rect) || (!port.backbone && cross(p, q, port.face, port.box)))) flag(l);
        for (const node of nodeList) {
          if (l.nodes.has(node)) continue;
          if (foot(node, [[p, q]]).distance < node.radius + 1.2 || enters(p, q, rect({ x: node.x, y: node.y, w: node.radius * 2, h: node.radius * 2 }, 0))) flag(l, node);
        }
        for (const r of bricks) {
          if (r.a == null || l.bricks.has(r) || !meet(span, r.faceBox)) continue;
          for (let i = 1; i < r.face.length; i++) if (cross(p, q, r.face[i - 1], r.face[i])) { flag(l); break; }
        }
      }
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const A = live[i].tips, B = live[j].tips;
        if (Math.max(A[0].x, A[1].x) < Math.min(B[0].x, B[1].x) || Math.max(B[0].x, B[1].x) < Math.min(A[0].x, A[1].x) ||
          Math.max(A[0].y, A[1].y) < Math.min(B[0].y, B[1].y) || Math.max(B[0].y, B[1].y) < Math.min(A[0].y, A[1].y)) continue;
        const x = cross(A[0], A[1], B[0], B[1]);
        if (x && ![...A, ...B].some(e => Math.hypot(e.x - x.x, e.y - x.y) < 0.6)) flag(live[i], live[j]);
      }
      for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++)
        if (meet(rect(ports[i].box, 0.4), rect(ports[j].box, 0.4))) flag();
      for (const arc of crowded) { flag(arc); soft += arc.over * 5; }
      nodeList.forEach((node, i) => {
        for (const port of ports) if (clearance(node, rect(port.box, 0)) < node.radius + 1.2) flag(node);
        // Clashes with the ligand drawing change only when the node moves.
        if (node.seat?.x !== node.x || node.seat?.y !== node.y) node.seat = { x: node.x, y: node.y,
          clashes: texts.filter(t => clearance(node, t.box) < node.radius + 0.6).length + (foot(node, bones).distance < node.radius + 2 ? 1 : 0) };
        for (let k = 0; k < node.seat.clashes; k++) flag(node);
        for (const other of nodeList.slice(i + 1)) if (Math.hypot(other.x - node.x, other.y - node.y) < node.radius + other.radius + 3) flag(node, other);
        soft += Math.hypot(node.x - node.start.x, node.y - node.start.y) * 0.05;
      });
      for (const r of bricks) soft += halfWrap(r.u - r.u0) ** 2 / L * 0.5;
      return bad * 1000 + soft;
    };

    // ---------------------------------------------------------------- search for a clean layout
    // Each node in turn takes its best seat; returns the score it ends with.
    const seatNodes = (list, passes, refine) => {
      let value = score();
      for (let pass = 0; pass < passes; pass++) for (const node of list) {
        let best = { x: node.x, y: node.y };
        for (const seat of node.cands) {
          node.x = seat.x; node.y = seat.y;
          const v = score();
          if (v < value - 1e-6) { value = v; best = seat; }
        }
        node.x = best.x; node.y = best.y;
        // Then a short pattern search off the seat grid, for gaps narrower than its spacing.
        if (refine && value >= 1000) for (const stride of [4, 2, 1]) for (let moved = true, guard = 0; moved && guard < 6; guard++) {
          moved = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            node.x = best.x + dx * stride; node.y = best.y + dy * stride;
            const v = score();
            if (v < value - 1e-6) { value = v; best = { x: node.x, y: node.y }; moved = true; }
          }
          node.x = best.x; node.y = best.y;
        }
      }
      return value;
    };
    const placeNodes = () => seatNodes(nodeList, 2, true);
    // The given nodes plus every node that takes part in a conflict of the current layout.
    const involved = list => {
      const blame = new Set(list);
      score(blame);
      return nodeList.filter(node => blame.has(node) || [...blame].some(part => part.nodes?.has(node)));
    };
    const nodesOf = new Map(bricks.map(r => [r, nodeList.filter(node => links.some(l => l.nodes.has(node) && l.bricks.has(r)))]));
    // a brick the user has moved keeps the seat it was dropped on
    const pinned = r => study.moved.has(r.s.id);
    const movable = bricks.filter(r => r.portList.length && !pinned(r));
    const steps = Array.from({ length: 48 }, (_, k) => (k + 0.5) * L / 48);
    // A fixed number of evaluations, not a clock, bounds the search so every render finds the same layout.
    const BUDGET = 80000, spentOut = () => spent > BUDGET;
    // Coordinate descent: each brick with contact lines in turn tries every stretch of the wall.
    const descend = () => {
      arrange();
      let current = score();
      for (let pass = 0; pass < 3 && !spentOut(); pass++) {
        let improved = false;
        for (const r of movable) {
          // A brick moves together with its bridged nodes and any node caught in a conflict; nodes are
          // re-seated on the most promising stretches only.
          const keep = r.u, own = nodesOf.get(r), start = seats();
          let bestU = keep, bestV = current, bestSeats = start;
          const tried = [r.u0, ...steps].map(v => { r.u = v; arrange(); return { v, value: score() }; });
          for (const { v, value } of tried) if (value < bestV - 1e-6) { bestV = value; bestU = v; }
          if (nodeList.length) for (const { v, value } of tried.sort((a, b) => a.value - b.value).slice(0, 3)) {
            if (value < 1000 && !own.length) continue;
            r.u = v;
            put(start);
            arrange();
            const reseated = seatNodes(involved(own), 1);
            if (reseated < bestV - 1e-6) { bestV = reseated; bestU = v; bestSeats = seats(); }
          }
          r.u = bestU; current = bestV;
          put(bestSeats);
          if (bestU !== keep) improved = true;
        }
        if (!improved) break;
      }
      return current;
    };
    const snapshot = value => ({ value, u: new Map(bricks.map(r => [r.s.id, r.u])), nodes: new Map(nodeList.map(node => [node.s.id, { x: node.x, y: node.y }])) });
    const restore = layout => {
      for (const r of bricks) r.u = layout.u.get(r.s.id) ?? r.u0;
      for (const node of nodeList) Object.assign(node, layout.nodes.get(node.s.id));
    };
    const seats = () => nodeList.map(node => ({ x: node.x, y: node.y }));
    const put = list => nodeList.forEach((node, i) => Object.assign(node, list[i]));
    const culprits = blame => movable.filter(r => [...blame].some(part => part.bricks?.has(r)));
    // Conflicts left after the descent usually need two bricks to trade places: move a brick that is
    // in a conflict to one of its better stretches, then let one brick it now collides with move anywhere.
    const repair = () => {
      arrange();
      let current = score();
      for (let round = 0; round < 12 && current >= 1000 && !spentOut(); round++) {
        const blame = new Set();
        score(blame);
        const start = seats();
        let best = { value: current };
        const consider = moves => {
          let value = score();
          if (nodeBad && value - nodeBad * 1000 < best.value - 1e-6) {
            value = seatNodes(involved([]), 1, true);
            put(start);
          }
          if (value < best.value - 1e-6) best = { value, moves: moves.map(([r, v]) => [r, v]) };
        };
        for (const r of culprits(blame)) {
          const keep = r.u;
          // Every stretch of the wall, and the spots just before and after each other brick.
          const spots = [...steps, ...bricks.filter(o => o !== r).flatMap(o => [wrap(o.u - 0.5), wrap(o.u + 0.5)])];
          const tried = spots.map(v => { r.u = v; arrange(); const own = new Set(); return { v, value: score(own), own }; })
            .sort((x, y) => x.value - y.value);
          // First improvement wins: it is applied and the search starts over from the new layout. Only the
          // better stretches are worth a second brick's move; trying them all leaves no evaluations for
          // the other bricks in conflict.
          for (const t of tried.slice(0, 16)) {
            if (spentOut() || best.moves) break;
            r.u = t.v;
            arrange();
            consider([[r, t.v]]);
            for (const o of culprits(t.own)) {
              if (o === r) continue;
              const was = o.u;
              for (const w of [...steps, wrap(t.v - 0.5), wrap(t.v + 0.5)]) { o.u = w; arrange(); consider([[r, t.v], [o, w]]); }
              o.u = was;
            }
          }
          r.u = keep;
          if (best.moves) break;
        }
        put(start);
        if (!best.moves) break;
        for (const [r, v] of best.moves) r.u = v;
        arrange();
        placeNodes();
        current = descend();
      }
      return current;
    };
    const layoutKey = [wall.level, gaps.map(g => `${g.mid.toFixed(1)}:${g.half.toFixed(1)}`).join(','), links.map(l => l.c.index).join(','),
      nodeList.map(node => `${node.s.id}:${node.start.x.toFixed(1)},${node.start.y.toFixed(1)}`).join(','),
      [...bricks].sort((a, b) => a.s.id - b.s.id).map(r => `${r.s.id}:${r.u0.toFixed(1)}`).join(',')].join('|');
    let layout = cache.layouts.get(layoutKey);
    if (!layout) {
      // The first start keeps the pipeline's order; the second moves every brick to where its lines leave the ligand freely.
      const exitOf = (link, T) => {
        let best = null, distance = Infinity;
        for (let k = 0; k < 128; k++) {
          const v = (k + 0.5) * L / 128, W = at(v, -half - 6), d = Math.hypot(W.x - T.x, W.y - T.y);
          if (d >= distance || bondList.some(b => !excused(link, b) && cross(T, W, b.a, b.b)) || texts.some(t => !ownText(link, t) && enters(T, W, t.box))) continue;
          best = v; distance = d;
        }
        return best;
      };
      const exits = new Map();
      for (const link of links) {
        const end = link.ends.find(e => e.point), port = link.ends.find(e => e.port)?.port;
        const v = end && port ? exitOf(link, end.point) : null;
        if (v == null) continue;
        const r = port.brick;
        if (pinned(r)) continue;
        if (!exits.has(r)) exits.set(r, []);
        exits.get(r).push(r.u0 + halfWrap(v - r.u0));
      }
      const starts = [new Map(), new Map([...exits].map(([r, list]) => [r, wrap(sum(list) / list.length)]))];
      for (const start of starts) {
        if (layout && layout.value < 1000) break;
        for (const r of bricks) r.u = start.get(r) ?? r.u0;
        for (const node of nodeList) { node.x = node.start.x; node.y = node.start.y; }
        arrange();
        placeNodes();
        const value = descend();
        if (!layout || value < layout.value) layout = snapshot(value);
      }
      if (layout.value >= 1000 && movable.length) {
        restore(layout);
        const value = repair();
        if (value < layout.value) layout = snapshot(value);
      }
      // A water or metal still in a conflict may have a free spot further from its atoms than its seats
      // reach: it tries a coarse grid over the cavity around it, then a fine one around the best spot.
      if (layout.value >= 1000 && nodeList.length) {
        restore(layout);
        arrange();
        let value = score();
        for (const node of involved([])) {
          for (const [reachOut, stride] of [[36, 3], [3, 1]]) {
            const home = { x: node.x, y: node.y };
            let best = home;
            for (let dx = -reachOut; dx <= reachOut; dx += stride) for (let dy = -reachOut; dy <= reachOut; dy += stride) {
              node.x = home.x + dx; node.y = home.y + dy;
              const v = score();
              if (v < value - 1e-6) { value = v; best = { x: node.x, y: node.y }; }
            }
            node.x = best.x; node.y = best.y;
          }
        }
        if (value < layout.value) layout = snapshot(value);
      }
      cache.layouts.set(layoutKey, layout);
    }
    restore(layout);
    arrange();
    // Whether a brick's label, air included, lies inside the brick as it is drawn.
    const holds = r => {
      const a = r.a + 0.6, b = r.b - 0.6, count = Math.max(2, Math.ceil(b - a)), mid = at((r.a + r.b) / 2);
      const spine = Array.from({ length: count + 1 }, (_, i) => at(a + (b - a) * i / count));
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => {
        const x = mid.x + sx * r.bw, y = mid.y + sy * r.bh;
        let best = Infinity, step = -1;
        spine.forEach((q, i) => { const d = Math.hypot(q.x - x, q.y - y); if (d < best) { best = d; step = i; } });
        return best <= half - 0.35 && step > 0 && step < count;
      });
    };
    // `lengthAt` can come out a little short on an uneven bend; such a brick is lengthened until its label fits.
    for (let round = 0; round < 4; round++) {
      const tight = bricks.filter(r => r.a != null && !holds(r));
      if (!tight.length) break;
      for (const r of tight) r.spare = (r.spare || 0) + 1.5;
      arrange();
    }
    route();

    // ---------------------------------------------------------------- solvent openings and plain wall
    for (const gap of gaps) {
      const a = gap.mid - gap.half, b = gap.mid + gap.half;
      const g = el('g', { class: 'pocket-opening', 'pointer-events': 'none', 'data-sasa': gap.sasa.toFixed(1) }, under);
      el('path', { d: band(a, b, 1.4), fill: tint.solvent, 'fill-opacity': 0.09 }, g);
      const lanes = half / 3 - 0.3;
      for (const off of [-lanes, 0, lanes]) {
        const points = [], from = a + 3, to = b - 3, count = Math.max(4, Math.round((to - from) / 0.6));
        for (let i = 0; i <= count; i++) {
          const v = from + (to - from) * i / count;
          points.push(at(v, off + 1.25 * Math.sin((v - from) / 6.2 * Math.PI * 2)));
        }
        el('path', { d: polyline(points), fill: 'none', stroke: tint.solvent, 'stroke-width': 1, 'stroke-linecap': 'round',
          'stroke-linejoin': 'round', 'stroke-opacity': 0.85 }, g);
      }
    }
    for (const filler of fillers) el('path', { d: band(filler.a, filler.b), fill: layers.contour ? tint.filler.fill : 'none',
      stroke: tint.filler.edge, 'stroke-width': 0.6, 'stroke-linejoin': 'round', class: 'pocket-plain-wall' }, under);

    if (layers.chain) {
      const lanes = [];
      for (const link of data.overlay?.chainLinks || []) {
        const a = brickById.get(link.from), b = brickById.get(link.to);
        if (!a || !b || a.a == null || b.a == null) continue;
        const from = (a.a + a.b) / 2;
        const delta = wrap((b.a + b.b) / 2 - from + L / 2) - L / 2, lo = Math.min(from, from + delta), hi = Math.max(from, from + delta);
        let lane = lanes.findIndex(used => used.every(v => hi < v.lo - 3 || lo > v.hi + 3));
        if (lane < 0) lane = lanes.push([]) - 1;
        lanes[lane].push({ lo, hi });
        const off = half + 3 + lane * 2.6;
        const attrs = { d: polyline([at(lo, half + 0.8), ...run(lo, hi, off), at(hi, half + 0.8)]), fill: 'none', stroke: muted,
          'stroke-width': 0.6, 'stroke-linejoin': 'round', class: 'pocket-chain' };
        if (link.gap) attrs['stroke-dasharray'] = '1.6 1.6';
        el('path', attrs, under);
      }
    }

    // ---------------------------------------------------------------- contacts across the cavity
    const arrow = (tip, from, color, parent) => {
      const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1, ux = (tip.x - from.x) / d, uy = (tip.y - from.y) / d;
      el('path', { d: `M${tip.x},${tip.y}L${tip.x - ux * 4.6 - uy * 1.9},${tip.y - uy * 4.6 + ux * 1.9}L${tip.x - ux * 4.6 + uy * 1.9},${tip.y - uy * 4.6 - ux * 1.9}Z`,
        fill: color }, parent);
    };
    let distanceNote = null;
    for (const { c, ends, raw, tips } of links) {
      if (!tips) continue;
      const selected = c.index === ctx.selected;
      const g = hit(el('g', { class: 'pocket-contact', 'data-kind': c.record.kind }, under), c.index);
      const stroke = { stroke: c.color, 'stroke-width': selected ? 1.6 : c.kind === 'water' ? 0.85 : 0.95, 'stroke-linecap': c.kind === 'metal' ? 'round' : 'butt' };
      line(tips[0], tips[1], { ...stroke, 'stroke-dasharray': DASH[c.kind] || '3 2' }, g);
      line(tips[0], tips[1], { stroke: 'transparent', 'stroke-width': 7, 'pointer-events': 'stroke' }, g);
      ends.forEach((end, i) => {
        if (end.ring) el('path', { d: disc(raw[i].x, raw[i].y, 2.4), fill: 'none', stroke: c.color, 'stroke-width': 0.8 }, g);
      });
      if (c.record.kind === 'hbond') {
        // The arrowhead points from the donor to the acceptor.
        const ligandEnd = ends.findIndex(end => end.point), direction = c.record.direction;
        if (ligandEnd >= 0 && (direction === 'ligand->partner' || direction === 'both')) arrow(tips[1 - ligandEnd], tips[ligandEnd], c.color, g);
        if (ligandEnd >= 0 && (direction === 'partner->ligand' || direction === 'both')) arrow(tips[ligandEnd], tips[1 - ligandEnd], c.color, g);
      }
      if (selected) distanceNote = { c, a: tips[0], b: tips[1] };
    }

    // ---------------------------------------------------------------- the wall
    const placed = bricks.filter(r => r.a != null);
    for (const r of placed) {
      const colors = tint[r.info.class] || tint.res_other;
      const g = el('g', { class: 'binding-residue pocket-brick', 'data-structure-id': r.s.id, 'data-residue-class': r.info.class || '' });
      el('path', { d: band(r.a, r.b), fill: layers.contour ? colors.fill : bg, stroke: colors.edge, 'stroke-width': 0.7,
        'stroke-linejoin': 'round', 'data-sasa-loss': r.loss }, g);
      const mid = at((r.a + r.b) / 2), ink = { fill: colors.ink, 'font-weight': r.weight };
      if (r.lines[1]) {
        label(mid.x, mid.y - LEAD / 2, r.lines[0], NAME, ink, g);
        label(mid.x, mid.y + LEAD / 2 + (NAME - NOTE) * CAP / 2, r.lines[1], NOTE, ink, g);
      } else label(mid.x, mid.y, r.lines[0], NAME, ink, g);
      for (const p of r.portList) {
        if (!p.box) continue;
        const { face, box } = p;
        if (!p.backbone) line(face, box, { stroke: colors.ink, 'stroke-width': 1, class: 'pocket-side-chain' }, g);
        el('path', { d: `M${box.x - box.w / 2 + 1.8},${box.y - box.h / 2}h${box.w - 3.6}a1.8,1.8 0 0 1 1.8,1.8v${box.h - 3.6}a1.8,1.8 0 0 1 -1.8,1.8h${-(box.w - 3.6)}a1.8,1.8 0 0 1 -1.8,-1.8v${-(box.h - 3.6)}a1.8,1.8 0 0 1 1.8,-1.8Z`,
          fill: bg, stroke: colors.ink, 'stroke-width': 0.6, class: 'pocket-port', 'data-atom': p.name }, g);
        if (p.name === 'ring') {
          const hexagon = [0, 1, 2, 3, 4, 5].map(i => ({ x: box.x + 2.6 * Math.cos(Math.PI / 3 * i), y: box.y + 2.6 * Math.sin(Math.PI / 3 * i) }));
          el('path', { d: `${polyline(hexagon)}Z`, fill: 'none', stroke: colors.ink, 'stroke-width': 0.55 }, g);
          el('path', { d: disc(box.x, box.y, 1.25), fill: 'none', stroke: colors.ink, 'stroke-width': 0.45 }, g);
        } else label(box.x, box.y, p.name, NOTE, { fill: colors.ink, 'font-weight': 500 }, g);
      }
    }

    // A hydrophobic contact is a green bar on the inner face of the brick, where it faces the touched atom.
    for (const r of placed) {
      if (!r.touches.length) continue;
      const span = Math.max(3, Math.min(13, (r.b - r.a - 5) / r.touches.length - 1.5));
      const items = r.touches.map(t => ({ t, len: span + 1.5, want: along(r, t.c.a) })).sort((x, y) => x.want - y.want);
      place(items, r.a + 2.5, r.b - 2.5).forEach((left, i) => {
        const c = items[i].t.c, selected = c.index === ctx.selected, from = left + 0.75, to = left + 0.75 + span;
        const g = hit(el('g', { class: 'pocket-lining', 'data-kind': 'hydrophobic' }), c.index);
        const d = polyline(run(from, to, -half - 0.6));
        el('path', { d, fill: 'none', stroke: c.color, 'stroke-width': selected ? 3.6 : 2.8, 'stroke-linecap': 'round' }, g);
        el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 9, 'pointer-events': 'stroke' }, g);
        if (selected) {
          const end = at((from + to) / 2, -half - 2.8), start = toward(c.a, end, 3);
          line(start, end, { stroke: c.color, 'stroke-width': 0.9 }, g);
          distanceNote = { c, a: start, b: end };
        }
      });
    }

    for (const node of nodeList) {
      const water = node.info.class === 'water', colors = water ? tint.water : tint.metal;
      const g = el('g', { class: `binding-residue pocket-${water ? 'water' : 'metal'}`, 'data-structure-id': node.s.id });
      el('path', { d: disc(node.x, node.y, node.radius), fill: colors.fill, stroke: colors.edge, 'stroke-width': 0.8 }, g);
      if (water) {
        // Written as the molecule, so the bubble reads as water without a legend.
        const formula = label(node.x, node.y, '', NOTE, { fill: colors.ink, 'font-weight': 600 }, g);
        el('tspan', {}, formula).textContent = 'H';
        el('tspan', { 'font-size': NOTE * 0.68, dy: NOTE * 0.2 }, formula).textContent = '2';
        el('tspan', { dy: -NOTE * 0.2 }, formula).textContent = 'O';
      } else label(node.x, node.y, node.s.atoms[0]?.element || node.s.structureLabel || '', NAME, { fill: colors.ink, 'font-weight': 600 }, g);
    }

    if (distanceNote) {
      const { c, a, b } = distanceNote, d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mid = { x: (a.x + b.x) / 2 - (b.y - a.y) / d * 5, y: (a.y + b.y) / 2 + (b.x - a.x) / d * 5 };
      label(mid.x, mid.y, `${c.distance.toFixed(2)} Å`, NOTE + 0.2, { fill: fg, 'font-weight': 600, stroke: bg, 'stroke-width': 2.6,
        'paint-order': 'stroke', 'stroke-linejoin': 'round', class: 'pocket-distance' });
    }

    // The legend is built before the diagram and lists only what is drawn, so it is built again once the
    // openings and ports of this diagram are known.
    const ports = placed.flatMap(r => r.portList).filter(p => p.box);
    const marks = { open: gaps.length > 0, backbone: ports.some(p => p.backbone), side: ports.some(p => !p.backbone) };
    const stale = drawn.data !== data || ['open', 'backbone', 'side'].some(k => drawn[k] !== marks[k]);
    drawn = { data, ...marks };
    if (stale && typeof renderLegend === 'function') renderLegend();
  }

  // Marks of the last diagram that the contact list alone does not tell.
  let drawn = { data: null };

  function legend(info) {
    const { svgEl, data, layers, colorOf } = info;
    const tint = TINTS[info.theme === 'dark' ? 'dark' : 'light'];
    const fg = info.atomColors.DEFAULT, bg = info.atomColors.BACKGROUND;
    const icon = () => svgEl('svg', { class: 'swatch', viewBox: '0 0 22 10' });
    const structures = data.scene.scene.structures.filter(s => s.id !== 0 && structureVisible(s.id));
    const classes = new Set(structures.map(s => s.additionalInformation?.class).filter(cls => cls !== 'water' && cls !== 'metal')
      .map(cls => CLASS_LABELS[cls] ? cls : 'res_other'));
    const contacts = data.contacts.filter(c => structureVisible(c.structure) && !state.hiddenKinds.has(c.kind) && (c.kind !== 'water' || layers.waters));
    const kinds = new Set(contacts.map(c => c.kind));
    const polar = contacts.filter(c => c.kind !== 'hydrophobic');
    const marks = drawn.data === data ? drawn : { open: !!layers.exposure, backbone: polar.some(c => c.backbone), side: polar.some(c => c.backbone === false) };
    // `rank` is the order in which entries give way when there are more than nine.
    const entries = [];
    for (const [cls, name] of Object.entries(CLASS_LABELS)) {
      // Green is hydrophobic throughout: the brick of a hydrophobic residue and the bar of a hydrophobic contact share one entry.
      const bar = cls === 'res_hydrophobic' && kinds.has('hydrophobic');
      if (!classes.has(cls) && !bar) continue;
      const s = icon(), colors = classes.has(cls) ? tint[cls] : tint.res_other;
      svgEl('rect', { x: 2, y: bar ? 2.6 : 1, width: 18, height: bar ? 6.6 : 8, rx: 2.2, fill: layers.contour ? colors.fill : bg, stroke: colors.edge, 'stroke-width': 0.9 }, s);
      if (bar) svgEl('line', { x1: 6, y1: 2, x2: 16, y2: 2, stroke: colorOf('hydrophobic'), 'stroke-width': 2.4, 'stroke-linecap': 'round' }, s);
      entries.push({ item: [s, name], rank: cls === 'res_other' ? 2 : 0 });
    }
    if (marks.open) {
      const s = icon();
      for (const y of [2.6, 5, 7.4]) svgEl('path', { d: `M2,${y}q2.25,-2 4.5,0t4.5,0t4.5,0t4.5,0`, fill: 'none', stroke: tint.solvent, 'stroke-width': 1, 'stroke-linecap': 'round' }, s);
      entries.push({ item: [s, 'Solvent'], rank: 1 });
    }
    const stroke = (kind, name, arrow) => {
      if (!kinds.has(kind)) return;
      const s = icon(), color = colorOf(kind);
      svgEl('line', { x1: 1, y1: 5, x2: arrow ? 16 : 21, y2: 5, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': DASH[kind],
        'stroke-linecap': kind === 'metal' ? 'round' : 'butt' }, s);
      if (arrow) svgEl('path', { d: 'M15,1.9L21.5,5L15,8.1Z', fill: color }, s);
      entries.push({ item: [s, name], rank: 0 });
    };
    stroke('hbond', 'H-bond', true);
    stroke('ionic', 'Salt bridge');
    stroke('pi', 'π-stacking');
    stroke('cationPi', 'Cation–π');
    stroke('halogen', 'Halogen bond');
    stroke('metal', 'Metal bond');
    stroke('water', 'Water bridge');
    for (const backbone of [true, false]) {
      if (!marks[backbone ? 'backbone' : 'side']) continue;
      const s = icon();
      svgEl('line', { x1: 1.5, y1: 9.2, x2: 20.5, y2: 9.2, stroke: fg, 'stroke-width': 1, 'stroke-linecap': 'round', 'stroke-opacity': 0.55 }, s);
      if (!backbone) svgEl('line', { x1: 11, y1: 6, x2: 11, y2: 9.2, stroke: fg, 'stroke-width': 1 }, s);
      svgEl('rect', { x: 5, y: backbone ? 3 : 0.5, width: 12, height: backbone ? 6.2 : 5.6, rx: 1.8, fill: bg, stroke: fg, 'stroke-width': 0.8 }, s);
      entries.push({ item: [s, backbone ? 'Backbone' : 'Side chain'], rank: 3 });
    }
    let kept = entries;
    for (let rank = 3; rank > 0 && kept.length > 9; rank--) kept = kept.filter(entry => entry.rank !== rank);
    return kept.slice(0, 9).map(entry => entry.item);
  }

  // The wall is laid out from scratch (about 0.3 s), so a dragged brick follows the pointer on its own and
  // takes its seat on the wall when dropped.
  // `moved` holds the residues placed by hand (binding-edit.js), cleared with each loaded complex.
  const study = { hideBase: 'partners', hideHydrophobic: true, liveDrag: false, moved: new Set(), draw, legend };
  window.LID_STUDIES[ID] = study;
})();
