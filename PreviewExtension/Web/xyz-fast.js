(() => {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const DEFAULT_WIDTH = 1200;
  const DEFAULT_HEIGHT = 860;
  const MAX_BOND_INFERENCE_ATOMS = 1800;
  const MAX_DRAWN_BONDS = 7000;

  const ELEMENT_COLORS = {
    H: '#f2f2f2', He: '#d9ffff', Li: '#cc80ff', Be: '#c2ff00', B: '#ffb5b5', C: '#6f7680',
    N: '#3050f8', O: '#ff0d0d', F: '#90e050', Ne: '#b3e3f5', Na: '#ab5cf2', Mg: '#8aff00',
    Al: '#bfa6a6', Si: '#f0c8a0', P: '#ff8000', S: '#ffff30', Cl: '#1ff01f', Ar: '#80d1e3',
    K: '#8f40d4', Ca: '#3dff00', Sc: '#e6e6e6', Ti: '#bfc2c7', V: '#a6a6ab', Cr: '#8a99c7',
    Mn: '#9c7ac7', Fe: '#e06633', Co: '#f090a0', Ni: '#50d050', Cu: '#c88033', Zn: '#7d80b0',
    Ga: '#c28f8f', Ge: '#668f8f', As: '#bd80e3', Se: '#ffa100', Br: '#a62929', Kr: '#5cb8d1',
    Rb: '#702eb0', Sr: '#00ff00', Y: '#94ffff', Zr: '#94e0e0', Nb: '#73c2c9', Mo: '#54b5b5',
    Tc: '#3b9e9e', Ru: '#248f8f', Rh: '#0a7d8c', Pd: '#006985', Ag: '#c0c0c0', Cd: '#ffd98f',
    In: '#a67573', Sn: '#668080', Sb: '#9e63b5', Te: '#d47a00', I: '#940094', Xe: '#429eb0',
    Cs: '#57178f', Ba: '#00c900', La: '#70d4ff', Ce: '#ffffc7', Pr: '#d9ffc7', Nd: '#c7ffc7',
    Pm: '#a3ffc7', Sm: '#8fffc7', Eu: '#61ffc7', Gd: '#45ffc7', Tb: '#30ffc7', Dy: '#1fffc7',
    Ho: '#00ff9c', Er: '#00e675', Tm: '#00d452', Yb: '#00bf38', Lu: '#00ab24', Hf: '#4dc2ff',
    Ta: '#4da6ff', W: '#2194d6', Re: '#267dab', Os: '#266696', Ir: '#175487', Pt: '#d0d0e0',
    Au: '#ffd123', Hg: '#b8b8d0', Tl: '#a6544d', Pb: '#575961', Bi: '#9e4fb5'
  };

  const COVALENT_RADII = {
    H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
    Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06,
    K: 2.03, Ca: 1.76, Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26,
    Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.20, As: 1.19, Se: 1.20, Br: 1.20, Kr: 1.16,
    Rb: 2.20, Sr: 1.95, Y: 1.90, Zr: 1.75, Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42,
    Pd: 1.39, Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.40,
    Cs: 2.44, Ba: 2.15, La: 2.07, Ce: 2.04, Pr: 2.03, Nd: 2.01, Pm: 1.99, Sm: 1.98, Eu: 1.98,
    Gd: 1.96, Tb: 1.94, Dy: 1.92, Ho: 1.92, Er: 1.89, Tm: 1.90, Yb: 1.87, Lu: 1.87, Hf: 1.75,
    Ta: 1.70, W: 1.62, Re: 1.51, Os: 1.44, Ir: 1.41, Pt: 1.36, Au: 1.36, Hg: 1.32, Tl: 1.45,
    Pb: 1.46, Bi: 1.48
  };

  function cleanElement(value) {
    const match = String(value || 'X').match(/[A-Za-z]{1,2}/u);
    if (!match) return 'X';
    const raw = match[0];
    return raw.length === 1 ? raw.toUpperCase() : raw[0].toUpperCase() + raw[1].toLowerCase();
  }

  function colorForElement(element) {
    return ELEMENT_COLORS[element] || '#b8bec8';
  }

  function radiusForElement(element) {
    return COVALENT_RADII[element] || 0.82;
  }

  function normalizeText(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function parseIntegerLine(line) {
    const match = String(line || '').trim().match(/^\d+/u);
    return match ? Number(match[0]) : NaN;
  }

  function parseXYZFirstFrame(text) {
    const lines = normalizeText(text).split('\n');
    let start = 0;
    while (start < lines.length && !String(lines[start]).trim()) start++;
    const atomCount = parseIntegerLine(lines[start]);
    if (!Number.isFinite(atomCount) || atomCount <= 0) {
      throw new Error('XYZ fast renderer expected an atom-count line at the start of the file.');
    }
    const comment = lines[start + 1] || '';
    const atoms = [];
    for (let i = 0; i < atomCount; i++) {
      const line = lines[start + 2 + i];
      if (line == null) break;
      const parts = String(line).trim().split(/\s+/u);
      if (parts.length < 4) continue;
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const element = cleanElement(parts[0]);
      atoms.push({ index: atoms.length, element, label: parts[0], x, y, z });
    }
    if (!atoms.length) throw new Error('XYZ fast renderer found no usable atom coordinate lines.');
    return {
      atomCount,
      atoms,
      comment,
      frameCount: countXYZFrames(lines, start),
      cell: parseExtXYZLattice(comment)
    };
  }

  function countXYZFrames(lines, start) {
    let i = start;
    let frames = 0;
    const limit = 100000;
    while (i < lines.length && frames < limit) {
      while (i < lines.length && !String(lines[i]).trim()) i++;
      if (i >= lines.length) break;
      const atomCount = parseIntegerLine(lines[i]);
      if (!Number.isFinite(atomCount) || atomCount <= 0) break;
      if (i + atomCount + 1 >= lines.length) break;
      frames += 1;
      i += atomCount + 2;
    }
    return frames || 1;
  }

  function parseExtXYZLattice(comment) {
    const text = String(comment || '');
    const match = text.match(/\bLattice\s*=\s*"([^"]+)"/iu) || text.match(/\bLattice\s*=\s*'([^']+)'/iu);
    if (!match) return null;
    const values = match[1].trim().split(/\s+/u).map(Number).filter(Number.isFinite);
    if (values.length !== 9) return null;
    return [
      { x: values[0], y: values[1], z: values[2] },
      { x: values[3], y: values[4], z: values[5] },
      { x: values[6], y: values[7], z: values[8] }
    ];
  }

  function inferBonds(atoms, options = {}) {
    if (!Array.isArray(atoms) || atoms.length < 2) return [];
    if (atoms.length > (options.maxAtoms || MAX_BOND_INFERENCE_ATOMS)) return [];
    const bonds = [];
    const scale = Number.isFinite(options.scale) ? options.scale : 1.18;
    const slack = Number.isFinite(options.slack) ? options.slack : 0.08;
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i];
      const ra = radiusForElement(a.element);
      for (let j = i + 1; j < atoms.length; j++) {
        const b = atoms[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) continue;
        const cutoff = (ra + radiusForElement(b.element)) * scale + slack;
        if (d2 <= cutoff * cutoff) {
          bonds.push({ a: i, b: j, z: (a.z + b.z) / 2, length: Math.sqrt(d2) });
          if (bonds.length >= (options.maxBonds || MAX_DRAWN_BONDS)) return bonds;
        }
      }
    }
    return bonds;
  }

  function styleOptions(styleName) {
    const name = String(styleName || 'default').toLowerCase();
    if (name === 'wire') return { atomScale: 0.22, minAtomRadius: 3.4, maxAtomRadius: 8.5, bondWidth: 2.2, showBonds: true };
    if (name === 'tube') return { atomScale: 0.42, minAtomRadius: 6.0, maxAtomRadius: 13.0, bondWidth: 7.5, showBonds: true };
    if (name === 'spacefill' || name === 'vdw') return { atomScale: 1.0, minAtomRadius: 11.0, maxAtomRadius: 28.0, bondWidth: 0, showBonds: false };
    return { atomScale: 0.62, minAtomRadius: 7.5, maxAtomRadius: 18.0, bondWidth: 4.2, showBonds: true };
  }

  function cellCorners(cell) {
    if (!cell) return [];
    const o = { x: 0, y: 0, z: 0 };
    const a = cell[0], b = cell[1], c = cell[2];
    const add = (...vectors) => vectors.reduce((p, v) => ({ x: p.x + v.x, y: p.y + v.y, z: p.z + v.z }), { ...o });
    return [o, a, b, c, add(a, b), add(a, c), add(b, c), add(a, b, c)];
  }

  function cellEdges() {
    return [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 4], [2, 6], [3, 5], [3, 6], [4, 7], [5, 7], [6, 7]];
  }

  function computeCenter(points) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const zs = points.map(p => p.z);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2
    };
  }

  function rotatePoint(point, center) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    const z = point.z - center.z;
    const ax = -0.68;
    const az = -0.55;
    const cosX = Math.cos(ax), sinX = Math.sin(ax);
    const cosZ = Math.cos(az), sinZ = Math.sin(az);
    const y1 = y * cosX - z * sinX;
    const z1 = y * sinX + z * cosX;
    const x2 = x * cosZ - y1 * sinZ;
    const y2 = x * sinZ + y1 * cosZ;
    return { x: x2, y: y2, z: z1 };
  }

  function projectScene(atoms, cell, width, height) {
    const corners = cellCorners(cell);
    const allPoints = atoms.concat(corners);
    const center = computeCenter(allPoints.length ? allPoints : atoms);
    const rotatedAtoms = atoms.map(atom => ({ ...atom, ...rotatePoint(atom, center) }));
    const rotatedCorners = corners.map(corner => rotatePoint(corner, center));
    const projectedPoints = rotatedAtoms.concat(rotatedCorners);
    const minX = Math.min(...projectedPoints.map(p => p.x));
    const maxX = Math.max(...projectedPoints.map(p => p.x));
    const minY = Math.min(...projectedPoints.map(p => p.y));
    const maxY = Math.max(...projectedPoints.map(p => p.y));
    const pad = 88;
    const spanX = Math.max(1e-3, maxX - minX);
    const spanY = Math.max(1e-3, maxY - minY);
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
    const tx = width / 2 - ((minX + maxX) / 2) * scale;
    const ty = height / 2 + ((minY + maxY) / 2) * scale;
    const toScreen = p => ({ ...p, sx: p.x * scale + tx, sy: -p.y * scale + ty, sz: p.z });
    return {
      atoms: rotatedAtoms.map(toScreen),
      corners: rotatedCorners.map(toScreen),
      scale
    };
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;')
      .replace(/'/gu, '&#39;');
  }

  function renderSVG(parsed, bonds, config = {}) {
    const width = Number(config?.xyzFast?.width) || DEFAULT_WIDTH;
    const height = Number(config?.xyzFast?.height) || DEFAULT_HEIGHT;
    const style = styleOptions(config?.xyzFast?.style || config?.xyzStyle || 'default');
    const projected = projectScene(parsed.atoms, parsed.cell, width, height);
    const atoms = projected.atoms;
    const showCell = config?.xyzFast?.showCell !== false;
    const background = config.transparentBackground ? 'transparent' : 'var(--buret-shell-background, #000)';
    const atomScale = Math.max(0.1, Math.min(2.2, style.atomScale)) * Math.max(1.0, Math.min(22.0, projected.scale / 32));
    const bondItems = style.showBonds ? bonds.map(bond => ({ ...bond, z: (atoms[bond.a].sz + atoms[bond.b].sz) / 2 })).sort((a, b) => a.z - b.z) : [];
    const atomItems = atoms.map(atom => ({ ...atom, radius: Math.min(style.maxAtomRadius, Math.max(style.minAtomRadius, radiusForElement(atom.element) * 11.5 * atomScale)) })).sort((a, b) => a.sz - b.sz);

    const parts = [];
    parts.push(`<svg class="buret-xyz-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(config.label || 'XYZ molecule')}">`);
    parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`);
    parts.push('<defs><filter id="buret-xyz-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="0.32"/></filter></defs>');
    if (showCell && parsed.cell && projected.corners.length === 8) {
      for (const [a, b] of cellEdges()) {
        const p = projected.corners[a], q = projected.corners[b];
        parts.push(`<line x1="${p.sx.toFixed(2)}" y1="${p.sy.toFixed(2)}" x2="${q.sx.toFixed(2)}" y2="${q.sy.toFixed(2)}" stroke="rgba(180,205,255,0.58)" stroke-width="2.2" stroke-dasharray="8 7"/>`);
      }
    }
    for (const bond of bondItems) {
      const a = atoms[bond.a], b = atoms[bond.b];
      const widthValue = style.bondWidth;
      parts.push(`<line x1="${a.sx.toFixed(2)}" y1="${a.sy.toFixed(2)}" x2="${b.sx.toFixed(2)}" y2="${b.sy.toFixed(2)}" stroke="rgba(18,22,28,0.78)" stroke-width="${(widthValue + 2.6).toFixed(2)}" stroke-linecap="round"/>`);
      parts.push(`<line x1="${a.sx.toFixed(2)}" y1="${a.sy.toFixed(2)}" x2="${b.sx.toFixed(2)}" y2="${b.sy.toFixed(2)}" stroke="rgba(224,230,238,0.82)" stroke-width="${widthValue.toFixed(2)}" stroke-linecap="round"/>`);
    }
    for (const atom of atomItems) {
      const fill = colorForElement(atom.element);
      const stroke = atom.element === 'H' ? 'rgba(40,45,52,0.42)' : 'rgba(255,255,255,0.36)';
      parts.push(`<circle cx="${atom.sx.toFixed(2)}" cy="${atom.sy.toFixed(2)}" r="${atom.radius.toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="1.1" filter="url(#buret-xyz-shadow)"><title>${escapeHTML(atom.element)}${atom.index + 1}</title></circle>`);
    }
    parts.push('</svg>');
    return parts.join('');
  }

  function renderBadge(parsed, bonds, config) {
    const frameText = parsed.frameCount > 1 ? ` · first frame of ${parsed.frameCount}` : '';
    const cellText = parsed.cell ? ' · extXYZ cell' : '';
    const style = escapeHTML(config?.xyzFast?.style || 'default');
    return `<div class="buret-xyz-badge"><strong>Fast XYZ SVG</strong><span>${parsed.atoms.length} atoms · ${bonds.length} bonds${cellText}${frameText} · ${style}</span></div>`;
  }

  function installStyles() {
    if (root.document?.getElementById('buret-xyz-fast-style')) return;
    const style = root.document.createElement('style');
    style.id = 'buret-xyz-fast-style';
    style.textContent = `
      .buret-xyz-fast-root { position: absolute; inset: 0; overflow: hidden; background: var(--buret-shell-background, #000); }
      body.burette-transparent-background .buret-xyz-fast-root { background: transparent; }
      .buret-xyz-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      .buret-xyz-badge { position: absolute; left: 14px; bottom: 14px; z-index: 30; max-width: calc(100vw - 28px); box-sizing: border-box; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--buret-toolbar-border, rgba(255,255,255,0.12)); color: var(--buret-toolbar-color, rgba(255,255,255,0.92)); background: var(--buret-toolbar-background, rgba(12,13,14,0.9)); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: 0 8px 22px rgba(0,0,0,0.20); font: 11px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; pointer-events: none; }
      .buret-xyz-badge strong { display: block; font-size: 11px; }
      .buret-xyz-badge span { display: block; opacity: 0.76; }
    `;
    root.document.head.appendChild(style);
  }

  function render({ container, text, config }) {
    if (!container) throw new Error('XYZ fast renderer needs a container element.');
    installStyles();
    const parsed = parseXYZFirstFrame(text);
    const bonds = inferBonds(parsed.atoms, config?.xyzFast || {});
    container.innerHTML = `<div class="buret-xyz-fast-root">${renderSVG(parsed, bonds, config)}${renderBadge(parsed, bonds, config)}</div>`;
    return { atoms: parsed.atoms.length, bonds: bonds.length, frames: parsed.frameCount, hasCell: !!parsed.cell };
  }

  root.BurreteXYZFast = {
    parseXYZFirstFrame,
    parseExtXYZLattice,
    inferBonds,
    renderSVG,
    render
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.BurreteXYZFast;
  }
})();
