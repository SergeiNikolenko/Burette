'use strict';

// Contact kinds: MOE convention for H-bonds (green side chain, blue backbone, arrow donor -> acceptor).
const KINDS = {
  hbond:         { label: 'H-bond',            light: '#2563eb', dark: '#60a5fa', arrow: true },
  hbondSide:     { label: 'Side-chain H-bond', light: '#16a34a', dark: '#4ade80', arrow: true },
  hbondBackbone: { label: 'Backbone H-bond',   light: '#2563eb', dark: '#60a5fa', arrow: true },
  ionic:         { label: 'Salt bridge',       light: '#c026d3', dark: '#e879f9' },
  metal:         { label: 'Metal',             light: '#ca8a04', dark: '#facc15' },
  pi:            { label: 'π-stacking',        light: '#0891b2', dark: '#22d3ee' },
  cationPi:      { label: 'Cation–π',          light: '#ea580c', dark: '#fb923c' },
  halogen:       { label: 'Halogen bond',      light: '#0d9488', dark: '#2dd4bf' },
  water:         { label: 'Water bridge',      light: '#64748b', dark: '#94a3b8' },
  hydrophobic:   { label: 'Hydrophobic contact', light: '#65a30d', dark: '#a3e635', solid: true },
};
const KIND_ORDER = Object.keys(KINDS);

// Residue discs: MOE colour scheme (green hydrophobic, purple polar, blue ring basic, red ring acidic).
const DISCS = {
  light: {
    res_hydrophobic: ['#dcfce7', '#65a30d', 1], res_polar: ['#f3e8ff', '#a855f7', 1],
    res_basic: ['#f3e8ff', '#2563eb', 2.4], res_acidic: ['#f3e8ff', '#dc2626', 2.4],
    res_other: ['#f4f4f5', '#a1a1aa', 1], water: ['#ffffff', '#94a3b8', 1], metal: ['#d4d4d8', '#71717a', 1.4],
  },
  dark: {
    res_hydrophobic: ['#1f3a1a', '#84cc16', 1], res_polar: ['#2e1f45', '#c084fc', 1],
    res_basic: ['#2e1f45', '#60a5fa', 2.4], res_acidic: ['#2e1f45', '#f87171', 2.4],
    res_other: ['#27272a', '#71717a', 1], water: ['#171717', '#94a3b8', 1], metal: ['#3f3f46', '#a1a1aa', 1.4],
  },
};
const DISC_LABELS = { res_hydrophobic: 'Hydrophobic', res_polar: 'Polar', res_basic: 'Basic', res_acidic: 'Acidic' };
const ATOMS = {
  light: { BACKGROUND: '#ffffff', DEFAULT: '#171717', C: '#171717', H: '#171717', N: '#2563eb', O: '#dc2626', P: '#ea580c', S: '#a16207',
           HOVER: '#e5e5e5', SELECTION: '#d4d4d4' },
  dark:  { BACKGROUND: '#171717', DEFAULT: '#e5e5e5', C: '#e5e5e5', H: '#d4d4d4', N: '#60a5fa', O: '#f87171', P: '#fb923c', S: '#facc15',
           HOVER: '#333333', SELECTION: '#404040' },
};
const EXPOSURE = { light: ['#3b82f6', '#06b6d4'], dark: ['#60a5fa', '#22d3ee'] };

// Schrodinger LID residue colours: green hydrophobic, cyan polar, blue positive, orange negative.
const SCHRODINGER_DISCS = {
  light: {
    res_hydrophobic: ['#c5e384', '#6b9a1f', 1], res_polar: ['#b6e6f5', '#2f9cc4', 1], res_basic: ['#babaf5', '#5151d0', 1],
    res_acidic: ['#f7b796', '#d2541c', 1], res_other: ['#e4e4e7', '#a1a1aa', 1], water: ['#e5e5e5', '#9ca3af', 1], metal: ['#d4d4d8', '#71717a', 1],
  },
  dark: {
    res_hydrophobic: ['#3a521a', '#9ccc4a', 1], res_polar: ['#134555', '#67c7e6', 1], res_basic: ['#2b2a72', '#8b8bf0', 1],
    res_acidic: ['#6b2a10', '#f08a5d', 1], res_other: ['#27272a', '#71717a', 1], water: ['#262626', '#9ca3af', 1], metal: ['#3f3f46', '#a1a1aa', 1],
  },
};

const PALETTES = { moe: DISCS, schrodinger: SCHRODINGER_DISCS };
const ONE_LETTER = { Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I', Leu: 'L', Lys: 'K',
                     Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V', Mse: 'M' };
// Diagram styles come from styles/index.json; filled at startup.
const STYLES = {};
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle('preview', params.get('preview') === '1' || params.get('embed') === '1');

const $ = (id) => document.getElementById(id);
const state = {
  theme: params.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  tool: 'movement', hiddenKinds: new Set(), selected: null,
  style: params.get('style') || 'style-schrodinger',
  layers: null, orientation: null, surface: null,
  data: null, original: null, ligand: params.get('ligand'),
};
let drawer = null;

const styleOf = () => STYLES[state.style].view ?? {};
const kindOf = (c) => (c.kind === 'hbond' ? (styleOf().mergeHbonds ? 'hbond' : c.backbone ? 'hbondBackbone' : 'hbondSide') : c.kind);
const themed = (pair) => pair?.[state.theme === 'dark' ? 1 : 0];
// Contact colours of Mol*'s interaction-type theme, which Burette draws in 3D, so a contact reads the
// same in the diagram and in the structure. Waters are hydrogen-bonded partners there, so they share its blue.
const MOLSTAR_CONTACTS = { hbond: '#2b83ba', hbondSide: '#2b83ba', hbondBackbone: '#2b83ba', water: '#2b83ba', ionic: '#f0c814',
  metal: '#8c4099', pi: '#8cb366', cationPi: '#ff8000', halogen: '#40ffbf', hydrophobic: '#808080' };
const colorOf = (kind) => MOLSTAR_CONTACTS[kind] ?? themed(styleOf().kinds?.[kind]) ?? KINDS[kind][state.theme];
const hasArrow = (kind) => KINDS[kind].arrow && styleOf().arrows !== false;
const discPalette = () => {
  const discs = styleOf().discs ?? 'moe';
  return typeof discs === 'string' ? PALETTES[discs][state.theme] : { ...DISCS[state.theme], ...discs[state.theme] };
};
const exposureColors = () => styleOf().exposure?.[state.theme] ?? EXPOSURE[state.theme];
// An embedded diagram is drawn on its host's surface (state.surface) instead of the design's own background.
const atomColors = () => ({ ...ATOMS[state.theme], ...styleOf().atoms?.[state.theme], ...(state.surface && { BACKGROUND: state.surface }) });

function formatResidue(name, number, chain, icode = '') {
  // a chain letter on every residue is noise while the whole pocket is one chain
  if (state.data && !state.data.severalChains) chain = '';
  switch (styleOf().labelFormat) {
    case 'Arg47': return `${name}${number}${icode}`;
    case 'Arg 47': return `${name} ${number}${icode}`;
    case 'R47': return `${ONE_LETTER[name] ?? name}${number}${icode}`;
    case 'ARG47': return `${name.toUpperCase()}${number}${icode}`;
    case 'ARG 47': return `${name.toUpperCase()} ${number}${icode}`;
    default: return `${name}${number}${icode}${chain}`;
  }
}
const contactKey = (c) => `${c.type || 'none'}:${c.id ?? c.residue}:${c.kind}`;
const prettyResidue = (label) => label.replace(/([A-Z][a-z]{2})(\d+)([A-Z]?)([A-Z])$/, (_, n, num, ins, ch) => `${n} ${num}${ins} ${ch}`);

// ------------------------------------------------------------------ drawer

function drawerOptions() {
  const discs = discPalette();
  const bg = atomColors().BACKGROUND;
  const circleOpts = {};
  for (const [cls, [fill, stroke, width]] of Object.entries(discs)) {
    // labels-only style: residues become coloured text on a background-filled disc that masks lines behind it
    const label = styleOf().labelsOnly && cls.startsWith('res_');
    circleOpts[cls] = {
      circleCss: label ? { stroke: bg, fill: bg, opacity: '1', 'stroke-width': '0px' } : { stroke, fill, opacity: '1', 'stroke-width': `${width}px` },
      rad: cls === 'water' || cls === 'metal' ? 9 : 11,
      textColor: label ? stroke : atomColors().DEFAULT, labelMaxLines: 2, labelSameFontSize: true, labelAutoSplit: true,
      labelAutoSplitMinCharsPerLine: 3, labelManualLineBreakChars: [' '], labelManualIncludeSplitChar: [false],
    };
  }
  circleOpts.default = circleOpts.res_other;
  return {
    fontFamily: styleOf().fontFamily ?? '-apple-system, Helvetica, Arial, sans-serif', textSize: styleOf().textSize ?? 7, lineWidth: styleOf().bondWidth ?? 0.85,
    colors: { ...atomColors(), atomPairInteractions: colorOf('hbondSide'), ionicInteractions: colorOf('ionic'),
              metalInteractions: colorOf('metal'), piStackings: colorOf('pi'), cationPiStackings: colorOf('cationPi'),
              hydrophobicContacts: colorOf('hydrophobic') },
    structureCircleOpts: circleOpts,
  };
}

const groups = () => drawer.svgComponent.transformGroupsComponent;

function setVisible(node, visible, depth = 0) {
  if (!node || depth > 4) return;
  if (Array.isArray(node)) return node.forEach((n) => setVisible(n, visible, depth + 1));
  if (typeof node.style === 'function' && typeof node.node === 'function') return void node.style('display', visible ? null : 'none');
  if (typeof node === 'object') Object.values(node).forEach((n) => setVisible(n, visible, depth + 1));
}

function structureInfo(sid) {
  return state.data.scene.scene.structures.find((s) => s.id === sid)?.additionalInformation || {};
}

// Residues reached only through a metal or a water are part of that contact, not optional pocket context.
const relayCache = new WeakMap();
function relayReceivers() {
  let sets = relayCache.get(state.data);
  if (!sets) {
    sets = { metal: new Set(), water: new Set() };
    const scene = state.data.scene.scene;
    const classOf = (sid) => scene.structures.find((s) => s.id === sid)?.additionalInformation?.class;
    for (const c of state.data.contacts) {
      const edge = c.type !== 'hydrophobicContacts' && scene[c.type]?.find((entry) => entry.id === c.id);
      if (!edge) continue;
      for (const [end, other] of [[edge.fromStructure, edge.toStructure], [edge.toStructure, edge.fromStructure]]) {
        const cls = classOf(other);
        if (end !== 0 && (cls === 'metal' || cls === 'water')) sets[cls].add(end);
      }
    }
    relayCache.set(state.data, sets);
  }
  return sets;
}

function structureVisible(sid) {
  if (sid === 0) return true;
  const info = structureInfo(sid);
  if (info.class === 'water') return state.layers.waters;
  if (info.tier === 'context') {
    const relay = relayReceivers();
    return state.layers.context || relay.metal.has(sid) || (state.layers.waters && relay.water.has(sid));
  }
  return true;
}

function applyVisibility() {
  const g = groups();
  for (const s of state.data.scene.scene.structures) {
    const visible = structureVisible(s.id);
    const circle = drawer.sceneData.structuresData.structures[s.id]?.representationsData.curRepresentation() === 2;
    const parts = (map) => map ? [map.structureSel, map.selectorSel] : [];
    setVisible(parts(g.atomGroupsComponent.atomToSelMap[s.id]), visible && !circle);
    setVisible(parts(g.edgeGroupsComponent.edgeToSelMap[s.id]), visible && !circle);
    setVisible(parts(g.structureCircleGroupsComponent.structureCircleToSelMap[s.id]), visible && circle);
  }
  for (const a of state.data.scene.scene.annotations) {
    if (a.belongsTo?.type === 'structure') setVisible(g.annotationGroupsComponent.labelToSelMap[a.id], structureVisible(a.belongsTo.id));
  }
  const showHydrophobic = !state.hiddenKinds.has('hydrophobic');
  Object.values(g.hydrophobicGroupsComponent?.hydrophobicToSelMap || {}).forEach((entry) => setVisible(entry, showHydrophobic));
  for (const a of state.data.scene.scene.annotations) {
    if (a.belongsTo?.type === 'structureSpline') setVisible(g.annotationGroupsComponent.labelToSelMap[a.id], showHydrophobic);
  }
  const inter = g.intermolecularGroupsComponent.typeSelectorMap;
  for (const c of state.data.contacts) {
    if (!c.type || !inter[c.type]?.[c.id]) continue;
    const entry = inter[c.type][c.id];
    const visible = !styleOf().indexedContacts && !state.hiddenKinds.has(kindOf(c)) && structureVisible(entry.fromStructure) && structureVisible(entry.toStructure);
    setVisible(entry.lineSels, visible);
    setVisible(entry.circleSel, visible);
    setVisible(entry.fromSel, visible);
    setVisible(entry.toSel, visible);
  }
  document.querySelectorAll('.contact-row').forEach((row) => {
    const c = state.data.contacts[Number(row.dataset.index)];
    const edge = c.type !== 'hydrophobicContacts' && state.data.scene.scene[c.type]?.find(entry => entry.id === c.id);
    row.classList.toggle('off', state.hiddenKinds.has(kindOf(c)) || !structureVisible(c.structure) ||
      (edge && (!structureVisible(edge.fromStructure) || !structureVisible(edge.toStructure))));
  });
  drawOverlay(true);
}

function decorate() {
  const inter = groups().intermolecularGroupsComponent.typeSelectorMap;
  for (const c of state.data.contacts) {
    const entry = c.type && inter[c.type]?.[c.id];
    if (!entry) continue;
    const kind = kindOf(c);
    const color = colorOf(kind);
    if (styleOf().indexedContacts) {
      setVisible(entry.lineSels, false);
      for (const key of ['circleSel', 'fromSel', 'toSel', 'mouseSel']) setVisible(entry[key], false);
    }
    const { lineWidth, dash } = styleOf();
    for (const sel of entry.lineSels || []) {
      const line = sel.node();
      line.style.stroke = color;
      line.style.fill = color;
      line.dataset.kind = kind;
      if (lineWidth) line.style.strokeWidth = `${lineWidth}px`;
      if (dash?.[kind] !== undefined) line.style.strokeDasharray = dash[kind];
      if (hasArrow(kind)) {
        const toPartner = c.direction === 'ligand->partner' || c.direction === 'both';
        const toLigand = c.direction === 'partner->ligand' || c.direction === 'both';
        // MOE marks backbone H-bonds with a dot at the residue end
        const dot = kind === 'hbondBackbone' && styleOf().backboneDot ? 'url(#lid-dot)' : '';
        line.setAttribute('marker-end', toPartner ? `url(#lid-arrow-${kind})` : dot);
        line.setAttribute('marker-start', toLigand ? `url(#lid-arrow-${kind})` : '');
      }
    }
    for (const key of ['circleSel', 'fromSel', 'toSel']) if (entry[key]) entry[key].style('fill', color).attr('data-kind', kind);
  }
}

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function installDefs(svg) {
  const defs = svgEl('defs', { id: 'lid-defs' });
  svg.insertBefore(defs, svg.firstChild);
  const dot = svgEl('marker', { id: 'lid-dot', viewBox: '0 0 6 6', refX: '3', refY: '3', markerWidth: '3.4', markerHeight: '3.4', markerUnits: 'userSpaceOnUse' }, defs);
  svgEl('circle', { cx: 3, cy: 3, r: 3, fill: colorOf('hbondBackbone') }, dot);
  for (const kind of KIND_ORDER) {
    if (!hasArrow(kind)) continue;
    const marker = svgEl('marker', { id: `lid-arrow-${kind}`, viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '6', markerHeight: '6',
                                     markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, defs);
    svgEl('path', { d: 'M0,0.8 L8,4 L0,7.2 z', fill: colorOf(kind) }, marker);
  }
  const [lig, rec] = exposureColors();
  for (const [id, color, alpha] of [['lid-smudge', lig, 0.55], ['lid-halo', rec, 0.38]]) {
    const grad = svgEl('radialGradient', { id }, defs);
    svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': String(alpha) }, grad);
    svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }, grad);
  }
}

// ------------------------------------------------------------------ overlay (follows the live drawer state)

const overlay = { root: null, halos: null, smudges: null, chain: null, contour: null, distances: null, panels: null, signature: '' };

function installOverlay() {
  const tg = groups().transformGroupDom.node();
  overlay.root = svgEl('g', { class: 'lid-underlay' });
  tg.insertBefore(overlay.root, tg.firstChild);
  for (const key of ['halos', 'smudges', 'chain', 'contour']) overlay[key] = svgEl('g', { class: `lid-${key}` }, overlay.root);
  // distance labels sit above the drawing and carry inline paint so exports need no app CSS
  overlay.distances = svgEl('g', { class: 'lid-distances' }, tg);
  overlay.panels = svgEl('g', { class: 'lid-panels' }, tg);
  overlay.studyUnder = svgEl('g', { class: 'lid-study-under' }, overlay.root);
  overlay.study = svgEl('g', { class: 'lid-study' }, tg);
}

function drawDistances() {
  overlay.distances.replaceChildren();
  const mode = styleOf().distanceLabels;
  if (!mode) return;
  const inter = groups().intermolecularGroupsComponent.typeSelectorMap;
  const toLocal = groups().transformGroupDom.node().getCTM().inverse();
  const bg = atomColors().BACKGROUND;
  const size = styleOf().distanceSize ?? 5;
  // keep numbers off atom labels and off each other: try spots beside the line, nearest the middle first
  const taken = state.data.scene.scene.structures.flatMap((s) => liveAtoms(s.id).map((p) => [p.x, p.y]));
  const clearance = (x, y) => taken.reduce((best, [px, py]) => Math.min(best, Math.hypot((px - x) / 1.6, py - y)), Infinity);
  for (const c of state.data.contacts) {
    const entry = c.type && inter[c.type]?.[c.id];
    const line = entry?.lineSels?.[0]?.node();
    if (!line || line.closest('[style*="display: none"]') || !(c.distance > 0) || !line.getTotalLength) continue;
    const m = toLocal.multiply(line.getCTM()), total = line.getTotalLength();
    let best = null;
    for (const t of [0.5, 0.38, 0.62, 0.28, 0.72]) {
      const [a, b] = [t * total - 1, t * total + 1].map((u) => line.getPointAtLength(u).matrixTransform(m));
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      for (const side of [1, -1]) {
        let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        if (ny > 0) { nx = -nx; ny = -ny; }
        const x = (a.x + b.x) / 2 + side * nx * size * 0.9, y = (a.y + b.y) / 2 + side * ny * size * 0.9;
        const free = clearance(x, y);
        if (!best || free > best.free + 0.5) best = { x, y: y + size * 0.35, free };
      }
      if (best.free >= size * 1.4) break;
    }
    taken.push([best.x, best.y - size * 0.35]);
    const { x, y } = best;
    const text = svgEl('text', { x: x.toFixed(2), y: y.toFixed(2), 'text-anchor': 'middle', 'font-size': size, 'font-family': styleOf().fontFamily ?? 'inherit',
                                 fill: colorOf(kindOf(c)), stroke: bg, 'stroke-width': 2.2, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, overlay.distances);
    text.textContent = mode === 'unit' ? `${c.distance.toFixed(1)} Å` : c.distance.toFixed(1);
  }
}

// A structure being dragged (binding-edit.js) is read where the pointer holds it, so a
// redraw lays out the whole diagram around it; the scene itself changes on release.
let dragPreview = null; // { sid, matrix: DOMMatrix in drawing units }
const previewed = (sid, p) => {
  if (dragPreview?.sid !== sid) return p;
  const { x, y } = dragPreview.matrix.transformPoint(p);
  return { x, y };
};

function liveAtom(sid, atomId) {
  const st = drawer.sceneData.structuresData.structures[sid];
  if (!st) return null;
  const atom = st.atomsData.atomById?.[atomId] || st.atomsData.atoms.find((a) => a.id === atomId);
  return atom ? previewed(sid, atom.coordinates) : null;
}

function liveAtoms(sid) {
  const st = drawer.sceneData.structuresData.structures[sid];
  return st ? st.atomsData.atoms.map((a) => previewed(sid, a.coordinates)) : [];
}

function previewDrag(sid, matrix, redraw = true) {
  dragPreview = matrix ? { sid, matrix } : null;
  if (!redraw) return;
  window.LidMotion?.instant();
  drawOverlay(true);
}

function ligandTransform() {
  // rigid 2D transform (with optional mirror) from the original ligand depiction to its live position
  const lig = state.original.ligand;
  const P = [], Q = [];
  for (const [id, p] of lig) {
    const q = liveAtom(0, id);
    if (q) { P.push(p); Q.push(q); }
  }
  const n = P.length;
  const pc = P.reduce((s, p) => [s[0] + p.x / n, s[1] + p.y / n], [0, 0]);
  const qc = Q.reduce((s, q) => [s[0] + q.x / n, s[1] + q.y / n], [0, 0]);
  let best = null;
  for (const m of [1, -1]) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const px = P[i].x - pc[0], py = (P[i].y - pc[1]) * m, qx = Q[i].x - qc[0], qy = Q[i].y - qc[1];
      a += px * qx + py * qy;
      b += px * qy - py * qx;
    }
    const t = Math.atan2(b, a), cos = Math.cos(t), sin = Math.sin(t);
    let err = 0;
    for (let i = 0; i < n; i++) {
      const px = P[i].x - pc[0], py = (P[i].y - pc[1]) * m;
      err += (px * cos - py * sin + qc[0] - Q[i].x) ** 2 + (px * sin + py * cos + qc[1] - Q[i].y) ** 2;
    }
    if (!best || err < best.err) best = { err, m, cos, sin };
  }
  return (p) => {
    const px = p[0] - pc[0], py = (p[1] - pc[1]) * best.m;
    return [px * best.cos - py * best.sin + qc[0], px * best.sin + py * best.cos + qc[1]];
  };
}

function drawOverlay(force = false) {
  if (!drawer || !overlay.root) return;
  // while the ligand is dragged the drawing follows it; the layout is recomputed once on release
  if (!force && window.LidMotion?.holding()) { window.LidMotion.track(); return; }
  const lig = liveAtoms(0);
  const signature = [lig.slice(0, 3), ...state.data.scene.scene.structures.map((s) => liveAtoms(s.id)[0])]
    .flat().map((c) => c && `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join('|');
  if (!force && signature === overlay.signature) return;
  overlay.signature = signature;
  const settle = window.LidMotion?.capture();
  decorate();
  const { overlay: data } = state.data;
  for (const key of ['halos', 'smudges', 'chain', 'contour']) overlay[key].replaceChildren();

  if (state.layers.contour) {
    const tf = ligandTransform();
    const toD = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
    // Schrodinger pocket outline: each stretch takes the colour of the nearest residue
    const residues = styleOf().ribbon ? state.data.scene.scene.structures.filter((s) => s.id && structureVisible(s.id) && s.additionalInformation?.class?.startsWith('res_'))
      .map((s) => { const pts = liveAtoms(s.id); return { x: pts.reduce((v, p) => v + p.x, 0) / pts.length, y: pts.reduce((v, p) => v + p.y, 0) / pts.length, color: discPalette()[s.additionalInformation.class][1] }; }) : [];
    for (const path of data.contour) {
      const pts = path.map(tf);
      if (!residues.length) { svgEl('path', { d: toD(pts) }, overlay.contour); continue; }
      const colorAt = ([x, y]) => residues.reduce((best, r) => ((r.x - x) ** 2 + (r.y - y) ** 2 < best.d ? { d: (r.x - x) ** 2 + (r.y - y) ** 2, color: r.color } : best), { d: Infinity, color: null }).color;
      let run = [pts[0]], color = colorAt(pts[0]);
      for (const p of pts.slice(1)) {
        run.push(p);
        const next = colorAt(p);
        if (next !== color || p === pts[pts.length - 1]) {
          svgEl('path', { d: toD(run), class: 'ribbon', style: `stroke:${color}` }, overlay.contour);
          run = [p];
          color = next;
        }
      }
    }
  }
  if (state.layers.exposure) {
    for (const a of data.ligandAtoms) {
      if (a.sasa < 2) continue;
      const c = liveAtom(0, a.atom);
      if (c) svgEl('circle', { cx: c.x, cy: c.y, r: (4 + Math.sqrt(a.sasa) * 1.7).toFixed(2), fill: 'url(#lid-smudge)' }, overlay.smudges);
    }
  }
  if (state.layers.halos) {
    for (const s of state.data.scene.scene.structures) {
      const info = s.additionalInformation;
      if (!info || !(info.sasaLoss > 4) || !structureVisible(s.id) || info.class === 'water') continue;
      const pts = liveAtoms(s.id);
      if (!pts.length) continue;
      const cx = pts.reduce((v, p) => v + p.x, 0) / pts.length, cy = pts.reduce((v, p) => v + p.y, 0) / pts.length;
      const base = s.representation === 2 ? 11 : 9;
      svgEl('circle', { cx, cy, r: (base + Math.sqrt(info.sasaLoss) * 1.5).toFixed(2), fill: 'url(#lid-halo)' }, overlay.halos);
    }
  }
  if (state.layers.chain) {
    for (const link of data.chainLinks) {
      if (!structureVisible(link.from) || !structureVisible(link.to)) continue;
      const a = link.fromAtom ? liveAtom(link.from, link.fromAtom) : liveAtoms(link.from)[0];
      const b = link.toAtom ? liveAtom(link.to, link.toAtom) : liveAtoms(link.to)[0];
      if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) > 75) continue;
      svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, overlay.chain);
      for (let k = 1; k <= link.gap; k++) {
        const t = k / (link.gap + 1);
        svgEl('circle', { cx: a.x + (b.x - a.x) * t, cy: a.y + (b.y - a.y) * t, r: 1.8 }, overlay.chain);
      }
    }
  }
  drawDistances();
  overlay.panels.replaceChildren();
  if (state.data.diagramPanels) {
    drawPanelDiagram({ root: overlay.panels, data: state.data, svgEl, liveAtoms, liveAtom, colorOf, kindOf,
      background: atomColors().BACKGROUND, foreground: atomColors().DEFAULT,
      isContactVisible: (c) => !state.hiddenKinds.has(kindOf(c)) && structureVisible(c.structure),
    });
    paintContactBadges();
  }
  drawStudy();
  settle?.();
}

function paintContactBadges(hovered = null) {
  $('draw-area')?.querySelectorAll('[data-contact-index]').forEach((badge) => {
    const index = Number(badge.dataset.contactIndex);
    const selected = index === state.selected;
    badge.setAttribute('aria-pressed', String(selected));
    badge.style.fontWeight = selected || index === hovered ? '700' : '400';
    badge.style.opacity = state.selected != null && !selected && index !== hovered ? '0.45' : '1';
    badge.querySelectorAll('circle, rect').forEach((shape) => shape.setAttribute('stroke-width', selected || index === hovered ? '1.4' : '0.6'));
  });
}

function relabel(scene) {
  // residue label format is a view choice, so it is applied to the scene here rather than in the pipeline
  if (!styleOf().labelFormat) return;
  const title = (name) => name[0] + name.slice(1).toLowerCase();
  const format = (info) => (info?.name && !['water', 'metal'].includes(info.class) ? formatResidue(title(info.name), info.number, info.chain) : null);
  const byId = new Map(scene.scene.structures.map((s) => [s.id, s]));
  for (const s of scene.scene.structures) {
    const label = s.representation === 2 && format(s.additionalInformation);
    if (label) s.structureLabel = label;
  }
  for (const a of scene.scene.annotations) {
    const info = a.belongsTo?.type === 'structure' ? byId.get(a.belongsTo.id)?.additionalInformation
      : a.additionalInformation?.kind === 'hydrophobic' ? { ...a.additionalInformation, class: 'res_hydrophobic' } : null;
    const label = format(info);
    if (label) a.label = label;
  }
}

async function loadStyleSheet() {
  const style = STYLES[state.style];
  if (style.css && style.cssText == null) {
    const preloaded = window.LID_STYLE_CSS?.[state.style];
    style.cssText = typeof preloaded === 'string'
      ? preloaded
      : await (await fetch(`styles/${state.style}.css`, { cache: 'no-store' })).text();
  }
}

function overlayLoop() {
  if (drawer) drawOverlay();
  requestAnimationFrame(overlayLoop);
}

function mount(json, { keepView = false } = {}) {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.style = state.style;
  $('canvas').style.background = atomColors().BACKGROUND;
  const scene = JSON.parse(json);
  const residueColor = themed(styleOf().residueLabelColor);
  for (const a of scene.scene.annotations) {
    if (a.additionalInformation?.kind === 'hydrophobic') a.color = colorOf('hydrophobic');
    else if (residueColor && a.belongsTo?.type === 'structure') a.color = residueColor;
  }
  relabel(scene);
  json = JSON.stringify(scene);
  const old = $('draw-area');
  const fresh = old.cloneNode(false);
  old.replaceWith(fresh);
  // the theme is also an attribute on the svg itself so style sheets can tell the themes apart in exports
  fresh.dataset.theme = state.theme;
  drawer = new InteractionDrawer('draw-area', drawerOptions());
  installDefs(fresh);
  // the style sheet lives inside the svg so exports carry it; its selectors are scoped to #draw-area
  if (STYLES[state.style].cssText) svgEl('style', {}, fresh.querySelector('#lid-defs')).textContent = STYLES[state.style].cssText;
  drawer.addByJSON(json);
  installOverlay();
  drawer.setCallbacks({
    selectionCallback: ({ type, selectionType, interactionId }) => {
      const index = state.data.contacts.findIndex((c) => c.type === type && c.id === interactionId);
      if (index < 0) return;
      if (selectionType === 'select') selectContact(index, { from2d: true });
      else if (state.selected === index) selectContact(null, { from2d: true });
    },
  });
  // the drawer has no hover callback: resolve hovered elements through its selector maps
  let lastHit = '';
  fresh.addEventListener('pointerover', (e) => {
    const hit = hitFor(e.target);
    const key = JSON.stringify(hit);
    if (key === lastHit) return;
    lastHit = key;
    onDiagramHover(hit);
  });
  fresh.addEventListener('pointerleave', () => { lastHit = ''; onDiagramHover(null); });
  fresh.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-contact-index]')) e.stopPropagation();
  }, true);
  const activateBadge = (e) => {
    const badge = e.target.closest('[data-contact-index]');
    if (!badge) return;
    if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const index = Number(badge.dataset.contactIndex);
    selectContact(state.selected === index ? null : index);
  };
  fresh.addEventListener('click', activateBadge, true);
  fresh.addEventListener('keydown', activateBadge, true);
  applyTool();
  decorate();
  renderInspector();
  renderLegend();
  drawOverlay(true);
  if (styleOf().layout) fitDiagram();
  document.dispatchEvent(new CustomEvent('lid:ready'));
}

function fitDiagram() {
  if (!drawer) return;
  if (!styleOf().layout) return drawer.svgDrawer.viewerDrawer.center();
  const bounds = groups().transformGroupDom.node().getBBox();
  const svg = $('draw-area');
  const height = svg.clientHeight - (state.layers.legend ? $('legend').offsetHeight + 18 : 0);
  const scale = Math.min((svg.clientWidth - 48) / bounds.width, (height - 48) / bounds.height);
  const transform = drawer.interactionState.transformParams;
  transform.scale = scale;
  transform.translate = {
    x: svg.clientWidth / (2 * scale) - bounds.x - bounds.width / 2,
    y: height / (2 * scale) - bounds.y - bounds.height / 2,
  };
  groups().applyTransform(transform);
}

function applyTool() {
  drawer.addMouseInteractions({ movement: [{ key: 2, modifiers: [] }] });
  drawer.addMouseInteractions({ [state.tool]: [{ key: 0, modifiers: [] }] });
  document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool)));
}

// ------------------------------------------------------------------ inspector

function swatch(kind) {
  const s = svgEl('svg', { class: 'swatch', viewBox: '0 0 22 10', 'data-kind': kind });
  const color = colorOf(kind);
  // swatch strokes are about twice the drawn line width, so the style's dash pattern is scaled to match
  const dash = styleOf().dash?.[kind];
  const swatchDash = dash === undefined ? '2.4 2' : dash === 'none' ? 'none' : dash.split(/[\s,]+/).map((v) => Number(v) * 1.8).join(' ');
  if (KINDS[kind].solid && state.data?.scene.scene.hydrophobicContacts.length) {
    svgEl('path', { d: 'M2,8 C7,1 15,1 20,8', fill: 'none', stroke: color, 'stroke-width': 1.6 }, s);
  } else if (KINDS[kind].solid) {
    svgEl('circle', { cx: 11, cy: 5, r: 4.2, fill: discPalette().res_hydrophobic[0], stroke: discPalette().res_hydrophobic[1] }, s);
  } else {
    svgEl('line', { x1: 1, y1: 5, x2: hasArrow(kind) ? 16 : 21, y2: 5, stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': swatchDash }, s);
    if (hasArrow(kind)) svgEl('path', { d: 'M15,1.6 L21.5,5 L15,8.4 z', fill: color }, s);
  }
  return s;
}

function renderInspector() {
  const contacts = state.data.contacts;
  const counts = {};
  contacts.forEach((c) => { const k = kindOf(c); counts[k] = (counts[k] || 0) + 1; });
  $('types').replaceChildren(...KIND_ORDER.filter((k) => counts[k]).map((kind) => {
    const row = document.createElement('label');
    row.className = 'row type-row';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !state.hiddenKinds.has(kind) });
    box.addEventListener('change', () => { box.checked ? state.hiddenKinds.delete(kind) : state.hiddenKinds.add(kind); applyVisibility(); });
    row.append(box, swatch(kind), Object.assign(document.createElement('span'), { textContent: KINDS[kind].label }),
               Object.assign(document.createElement('span'), { className: 'count', textContent: counts[kind] }));
    return row;
  }));

  const order = contacts.map((c, i) => i).sort((a, b) =>
    KIND_ORDER.indexOf(kindOf(contacts[a])) - KIND_ORDER.indexOf(kindOf(contacts[b])) || contacts[a].distance - contacts[b].distance);
  $('contacts').replaceChildren(...order.map((index) => {
    const c = contacts[index];
    const row = document.createElement('div');
    row.className = 'row contact-row';
    row.dataset.index = index;
    row.tabIndex = 0;
    const text = Object.assign(document.createElement('span'), { className: 'text' });
    const name = c.kind === 'water' && c.residue.includes('→') ? c.residue.replace(/→ (.*)$/, (_, r) => `→ ${prettyResidue(r)}`) : prettyResidue(c.residue);
    text.append(Object.assign(document.createElement('span'), { className: 'res', textContent: name }));
    const atoms = [c.residueAtom, c.ligandAtom].filter((x) => x && x !== 'ring').join(' · ');
    if (atoms) text.append(Object.assign(document.createElement('span'), { className: 'atoms', textContent: `  ${atoms}` }));
    row.append(swatch(kindOf(c)), text, Object.assign(document.createElement('span'), { className: 'dist', textContent: `${c.distance.toFixed(2)} Å` }));
    row.addEventListener('mouseenter', () => hoverContact(index, true));
    row.addEventListener('mouseleave', () => hoverContact(index, false));
    row.addEventListener('click', () => selectContact(state.selected === index ? null : index));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
    return row;
  }));
  applyVisibility();
}

function legendItems() {
  // a study with its own symbol vocabulary supplies its own legend rows: [[svgIcon, label], ...]
  const custom = studyOf()?.legend?.({ svgEl, theme: state.theme, data: state.data, layers: state.layers, colorOf, atomColors: atomColors() });
  if (custom) return custom;
  const present = new Set(state.data.contacts.map(kindOf));
  const items = KIND_ORDER.filter((k) => present.has(k) && k !== 'hydrophobic').map((k) => [swatch(k), KINDS[k].label]);
  if (present.has('hydrophobic') && state.data.scene.scene.hydrophobicContacts.length) items.push([swatch('hydrophobic'), KINDS.hydrophobic.label]);
  const classes = new Set(state.data.scene.scene.structures
    .filter((s) => s.representation === 2 && structureVisible(s.id)).map((s) => s.additionalInformation?.class).filter(Boolean));
  for (const [cls, label] of Object.entries(DISC_LABELS)) {
    if (!classes.has(cls)) continue;
    const s = svgEl('svg', { class: 'swatch', viewBox: '0 0 22 10' });
    const [fill, stroke, width] = discPalette()[cls];
    if (styleOf().labelsOnly) svgEl('text', { x: 11, y: 8.5, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 600, fill: stroke }, s).textContent = 'Aa';
    else svgEl('circle', { cx: 11, cy: 5, r: 4.2, fill, stroke, 'stroke-width': Math.min(width, 1.8) }, s);
    items.push([s, label]);
  }
  const [ligColor, recColor] = exposureColors();
  if (state.layers.exposure) {
    const exposure = svgEl('svg', { class: 'swatch', viewBox: '0 0 22 10' });
    svgEl('circle', { cx: 11, cy: 5, r: 5, fill: ligColor, 'fill-opacity': 0.45 }, exposure);
    items.push([exposure, 'Solvent exposure']);
  }
  if (state.layers.halos) {
    const halo = svgEl('svg', { class: 'swatch', viewBox: '0 0 22 10' });
    svgEl('circle', { cx: 11, cy: 5, r: 5, fill: recColor, 'fill-opacity': 0.4 }, halo);
    items.push([halo, 'Buried residue surface']);
  }
  if (state.layers.contour && !styleOf().ribbon) {
    const contour = svgEl('svg', { class: 'swatch', viewBox: '0 0 22 10' });
    svgEl('line', { x1: 1, y1: 5, x2: 21, y2: 5, stroke: getComputedStyle(document.documentElement).getPropertyValue('--contour'), 'stroke-width': 1.4, 'stroke-dasharray': '1.5 2', 'stroke-linecap': 'round' }, contour);
    items.push([contour, 'Room to grow']);
  }
  return items;
}

function renderLegend() {
  const legend = $('legend');
  legend.hidden = !state.layers.legend;
  legend.replaceChildren(...legendItems().map(([icon, label]) => {
    const span = document.createElement('span');
    span.append(icon, label);
    return span;
  }));
}

function rowFor(index) {
  return document.querySelector(`.contact-row[data-index="${index}"]`);
}

function hoverContact(index, on) {
  const c = state.data.contacts[index];
  const comp = groups().intermolecularGroupsComponent;
  // styles that draw their own contacts keep the drawer's hidden lines and selection boxes out of the picture
  if (!styleOf().indexedContacts && c.type && comp.typeSelectorMap[c.type]?.[c.id] && state.selected !== index) {
    on ? comp.hoverIntermolecular(c.id, c.type) : comp.unselectIntermolecular(c.id, c.type);
  }
  rowFor(index)?.classList.toggle('hovered', on);
  paintContactBadges(on ? index : null);
}

function selectContact(index, { from2d = false } = {}) {
  const comp = groups().intermolecularGroupsComponent;
  const prev = state.selected != null ? state.data.contacts[state.selected] : null;
  const native = !styleOf().indexedContacts;
  if (native && prev && !from2d && prev.type && comp.typeSelectorMap[prev.type]?.[prev.id]) comp.unselectIntermolecular(prev.id, prev.type);
  state.selected = index;
  document.dispatchEvent(new CustomEvent('lid:selection', { detail: { index } }));
  if (studyOf()) {
    const focusIndex = document.activeElement?.dataset.contactIndex;
    drawStudy();
    if (focusIndex != null) $('draw-area').querySelector(`[data-contact-index="${focusIndex}"]`)?.focus();
  }
  paintContactBadges();
  document.querySelectorAll('.contact-row').forEach((r) => r.classList.toggle('selected', Number(r.dataset.index) === index));
  if (index == null) return;
  const c = state.data.contacts[index];
  if (native && !from2d && c.type && comp.typeSelectorMap[c.type]?.[c.id]) comp.selectIntermolecular(c.id, c.type);
  rowFor(index)?.scrollIntoView({ block: 'nearest' });
}

function hitFor(target) {
  const badge = target.closest('[data-contact-index]');
  if (badge) return { contactIndex: Number(badge.dataset.contactIndex) };
  const g = groups();
  const owns = (sel) => sel && typeof sel.node === 'function' && sel.node()?.contains(target);
  for (const [type, entries] of Object.entries(g.intermolecularGroupsComponent.typeSelectorMap)) {
    for (const [id, entry] of Object.entries(entries)) {
      if ([entry.mouseSel, ...(entry.lineSels || [])].some(owns)) return { type, id: Number(id) };
    }
  }
  for (const map of [g.atomGroupsComponent.atomToSelMap, g.edgeGroupsComponent?.edgeToSelMap, g.structureCircleGroupsComponent?.structureCircleToSelMap]) {
    for (const [sid, entry] of Object.entries(map || {})) {
      const sels = Object.values(entry).flatMap((v) => (v && typeof v.node !== 'function' && typeof v === 'object' ? Object.values(v) : [v]));
      if (sels.some(owns)) return { structure: Number(sid) };
    }
  }
  for (const [annId, entry] of Object.entries(g.annotationGroupsComponent?.labelToSelMap || {})) {
    if (Object.values(entry).some(owns)) {
      const annotation = drawer.sceneData.annotationsData.annotations[annId];
      const info = annotation?.additionalInformation;
      if (info?.kind === 'hydrophobic') return { residue: [info.chain, info.number] };
      if (annotation?.structureLink != null) return { structure: Number(annotation.structureLink) };
    }
  }
  return null;
}

function onDiagramHover(hit) {
  paintContactBadges(hit?.contactIndex ?? null);
  document.querySelectorAll('.contact-row.hovered').forEach((r) => r.classList.remove('hovered'));
  if (!hit) return;
  const sid = hit.structure;
  let matches = [];
  if (hit.contactIndex != null) matches = [[state.data.contacts[hit.contactIndex], hit.contactIndex]];
  else if (hit.type) matches = state.data.contacts.map((c, i) => [c, i]).filter(([c]) => c.type === hit.type && c.id === hit.id);
  else if (hit.residue) matches = state.data.contacts.map((c, i) => [c, i]).filter(([c]) => c.kind === 'hydrophobic' && c.residueKey[0] === hit.residue[0] && c.residueKey[1] === hit.residue[1]);
  else if (sid != null) matches = state.data.contacts.map((c, i) => [c, i]).filter(([c]) => c.structure === sid);
  matches.forEach(([, i]) => rowFor(i)?.classList.add('hovered'));
}

// ------------------------------------------------------------------ contacts

function contactParts(c) {
  const scene = state.data.scene.scene;
  const edge = c && c.type !== 'hydrophobicContacts' && scene[c.type]?.find(entry => entry.id === c.id);
  if (edge) {
    return [...new Set([edge.fromStructure, edge.toStructure])].map(sid => {
      const info = sid === 0 ? state.data.ligand : scene.structures.find(s => s.id === sid).additionalInformation;
      return [info.chain, info.number];
    });
  }
  const parts = [[state.data.ligand.chain, state.data.ligand.number]];
  if (c?.residueKey) parts.push([c.residueKey[0], c.residueKey[1]]);
  return parts;
}

// ------------------------------------------------------------------ data

function status(text) {
  $('status').hidden = !text;
  $('status').textContent = text || '';
}

// Burette computes the diagram from the structure it has open: the page asks
// its host, which answers with the structure's ligands and the scene of the
// ligand asked for (the largest one when none is).
const hostRequests = new Map();
let hostRequestId = 0;
let loadToken = 0;

function requestDiagram(ligand, rules) {
  const id = ++hostRequestId;
  return new Promise((resolve, reject) => {
    hostRequests.set(id, { resolve, reject });
    window.parent.postMessage({ source: 'burette-lid', type: 'diagram-request', id, ligand, rules }, '*');
  });
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (event.source !== window.parent || message?.source !== 'burette-lid-host' || message.type !== 'diagram') return;
  const pending = hostRequests.get(message.id);
  if (!pending) return;
  hostRequests.delete(message.id);
  if (typeof message.error === 'string') pending.reject(new Error(message.error));
  else pending.resolve(message.result);
});

function showLigands(ligands) {
  const select = $('ligand');
  const labels = ligands.map((l) => [l.id, `${l.name} ${l.chain}:${l.number}`]);
  if (labels.map(String).join('\n') === [...select.options].map((o) => [o.value, o.textContent]).map(String).join('\n')) return;
  select.replaceChildren(...labels.map(([value, textContent]) => Object.assign(document.createElement('option'), { value, textContent })));
}

// Designs print residue labels themselves; `chainLabel` is the chain to print,
// empty while every residue of the pocket sits on one chain.
function markChains(data) {
  const named = data.scene.scene.structures.filter((s) => s.additionalInformation?.chain);
  const residues = named.filter((s) => s.additionalInformation.class?.startsWith('res_'));
  data.severalChains = new Set(residues.map((s) => s.additionalInformation.chain)).size > 1;
  for (const s of named) s.additionalInformation.chainLabel = data.severalChains ? s.additionalInformation.chain : '';
}

// A tall canvas (a side panel) reads better with the ligand's long axis running
// down the page. Between the two thresholds the current choice stays, so a
// resize near square does not flip the drawing back and forth.
function canvasOrientation() {
  const forced = params.get('orientation');
  if (forced) return forced;
  const { clientWidth: width, clientHeight: height } = $('canvas');
  const current = state.orientation ?? 'landscape';
  if (!width || !height) return current;
  const ratio = height / width;
  return ratio > 1.15 ? 'portrait' : ratio < 0.95 ? 'landscape' : current;
}

async function loadComplex(ligand) {
  const token = ++loadToken;
  status('Calculating…');
  try {
    state.orientation = canvasOrientation();
    const rules = { ...STYLES[state.style].pipeline, orientation: state.orientation };
    // a small host (a molecule card) asks for the contacts only, where the design allows it
    if (params.get('detail') === 'compact' && STYLES[state.style].compact) rules.context = STYLES[state.style].compact;
    const [result] = await Promise.all([requestDiagram(ligand ?? null, rules), loadStyleSheet(), loadStudy()]);
    if (token !== loadToken) return;
    const data = result.diagram;
    showLigands(result.ligands);
    state.ligand = data.ligand.id;
    $('ligand').value = state.ligand;
    markChains(data);
    if (styleOf().layout) compactDiagramLabels(data);
    arrangeSpatialDiagram(data, styleOf().layout);
    arrangePanelDiagram(data, styleOf().layout);
    studyOf()?.prepare?.(data, StudyGeometry);
    state.data = data;
    state.selected = null;
    const lig = data.scene.scene.structures[0].atoms.map((a) => [a.id, a.coordinates]);
    state.original = { json: JSON.stringify(data.scene), ligand: lig };
    status('');
    mount(state.original.json);
  } catch (error) {
    if (token === loadToken) status(error.message);
  }
}

// ------------------------------------------------------------------ export

async function exportSvgText() {
  window.LidMotion?.finish();
  // frame the export on the drawn content, in the svg's own units
  const live = $('draw-area');
  const tg = groups().transformGroupDom.node();
  const local = tg.getBBox();
  let m = new DOMMatrix();
  for (let node = tg; node && node !== live; node = node.parentNode) {
    const t = node.transform?.baseVal.consolidate();
    if (t) m = new DOMMatrix([t.matrix.a, t.matrix.b, t.matrix.c, t.matrix.d, t.matrix.e, t.matrix.f]).multiply(m);
  }
  const corners = [[local.x, local.y], [local.x + local.width, local.y], [local.x, local.y + local.height], [local.x + local.width, local.y + local.height]]
    .map(([px, py]) => m.transformPoint(new DOMPoint(px, py)));
  const pad = 16;
  const x = Math.min(...corners.map((p) => p.x)) - pad, y = Math.min(...corners.map((p) => p.y)) - pad;
  const width = Math.max(...corners.map((p) => p.x)) - x + pad, height = Math.max(...corners.map((p) => p.y)) - y + pad;
  // serialise the live element: drawer.getSvgBlob() re-offsets coordinates and mangles paths it did not draw
  const svg = live.cloneNode(true);
  // editor forms live in foreignObject, which also taints the PNG canvas
  svg.querySelectorAll('foreignObject').forEach((node) => node.remove());
  // the underlay is styled by app CSS, which a standalone file does not carry
  const copies = [...svg.querySelector('.lid-underlay').querySelectorAll('*')];
  [...overlay.root.querySelectorAll('*')].forEach((node, i) => {
    const cs = getComputedStyle(node);
    for (const prop of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity']) copies[i].setAttribute(prop, cs.getPropertyValue(prop));
  });
  svg.removeAttribute('style');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('font-family', getComputedStyle(live).fontFamily);
  const rect = svgEl('rect', { x: -10000, y: -10000, width: 20000, height: 20000, fill: atomColors().BACKGROUND });
  svg.insertBefore(rect, svg.querySelector('#lid-defs').nextSibling);
  let frameHeight = height;
  if (state.layers.legend) {
    const g = svgEl('g', { class: 'lid-legend', transform: `translate(${x + 8} ${y + height})` }, svg);
    const fontFamily = styleOf().fontFamily ?? getComputedStyle(live).fontFamily;
    const fontSize = 13 * Math.max(1, (styleOf().textSize ?? 7) / 7);
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `${fontSize}px ${fontFamily}`;
    let cx = 0, cy = 0;
    for (const [icon, label] of legendItems()) {
      const step = 31 + measure.measureText(label).width + 16;
      if (cx && cx + step > width - 16) { cx = 0; cy += fontSize + 9; }
      Object.entries({ x: cx, y: cy + 3, width: 26, height: 12 }).forEach(([k, v]) => icon.setAttribute(k, v));
      g.appendChild(icon);
      svgEl('text', { x: cx + 31, y: cy + 14, 'font-size': fontSize, 'font-family': fontFamily, fill: atomColors().DEFAULT }, g).textContent = label;
      cx += step;
    }
    frameHeight += cy + fontSize + 15;
  }
  svg.setAttribute('viewBox', `${x} ${y} ${width} ${frameHeight}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(frameHeight));
  return new XMLSerializer().serializeToString(svg);
}

function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportAs(kind) {
  const base = `${state.ligand}-interactions`;
  if (kind === 'json') return download(drawer.getJsonBlob(), `${base}.json`);
  if (kind === 'csv') {
    const header = 'type,residue,residue_atom,ligand_atom,distance_A';
    const rows = state.data.contacts.map((c) => [KINDS[kindOf(c)].label, c.residue, c.residueAtom, c.ligandAtom, c.distance].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    return download(new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }), `${base}.csv`);
  }
  const text = await exportSvgText();
  if (kind === 'svg') return download(new Blob([text], { type: 'image/svg+xml' }), `${base}.svg`);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  await img.decode();
  const scale = 3;
  const canvas = Object.assign(document.createElement('canvas'), { width: img.width * scale, height: img.height * scale });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((b) => download(b, `${base}.png`));
}

// ------------------------------------------------------------------ wiring

function wireMenus() {
  for (const [btn, menu] of [['view-btn', 'view-menu'], ['export-btn', 'export-menu']]) {
    $(btn).addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !$(menu).classList.contains('open');
      document.querySelectorAll('.menu-list.open').forEach((m) => m.classList.remove('open'));
      $(menu).classList.toggle('open', open);
      $(btn).setAttribute('aria-expanded', String(open));
    });
    $(menu).addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', () => document.querySelectorAll('.menu-list.open').forEach((m) => m.classList.remove('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.menu-list.open').forEach((m) => m.classList.remove('open')); });
  $('export-menu').addEventListener('click', (e) => {
    const k = e.target.closest('[data-export]')?.dataset.export;
    if (k) { $('export-menu').classList.remove('open'); exportAs(k); }
  });
  $('view-menu').addEventListener('change', (e) => {
    const layer = e.target.dataset.layer;
    if (!layer) return;
    state.layers[layer] = e.target.checked;
    renderLegend();
    applyVisibility();
  });
}

document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { state.tool = b.dataset.tool; applyTool(); }));
$('undo').addEventListener('click', () => drawer.svgDrawer.historyDrawer.revertHistory());
$('redo').addEventListener('click', () => drawer.svgDrawer.historyDrawer.advanceHistory());
$('fit').addEventListener('click', fitDiagram);
$('reset').addEventListener('click', () => mount(state.original.json));
$('theme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  mount(drawer.getJson());
});
$('ligand').addEventListener('change', () => loadComplex($('ligand').value));
// A host may ask for a design it remembers but no longer offers; the diagram
// then opens on the first one.
function fallbackStyle() {
  return Object.entries(STYLES).sort((a, b) => a[1].panel - b[1].panel)[0][0];
}

function useStyle(id) {
  // a host can ask before the styles have loaded; the startup below checks it then
  if (!Object.keys(STYLES).length) { state.style = id; return; }
  state.style = STYLES[id] ? id : fallbackStyle();
  state.layers = { ...STYLES[state.style].layers };
  $('style').value = state.style;
  document.querySelectorAll('[data-layer]').forEach((box) => { box.checked = !!state.layers[box.dataset.layer]; });
}
$('style').addEventListener('change', () => {
  useStyle($('style').value);
  loadComplex(state.ligand);
});
wireMenus();
window.lid = { get drawer() { return drawer; }, state, styles: STYLES, exportSvgText,
  selectContact, fitDiagram, useStyle, loadComplex, kindOf, contactParts, mount, canvasOrientation, previewDrag };

document.documentElement.dataset.theme = state.theme;
requestAnimationFrame(overlayLoop);
const stylesReady = window.LID_STYLES && typeof window.LID_STYLES === 'object'
  ? Promise.resolve(window.LID_STYLES)
  : fetch('styles/index.json').then((response) => response.json());
stylesReady.then((styles) => {
  Object.assign(STYLES, styles);
  const options = Object.entries(styles).map(([id, style]) => Object.assign(document.createElement('option'), { value: id, textContent: style.label }));
  $('style').replaceChildren(...options);
  useStyle(state.style);
  return loadComplex(state.ligand);
}).catch((error) => status(error.message));
