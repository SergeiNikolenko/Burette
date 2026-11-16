// Pure XYZ <-> numeric Z-matrix geometry shared by the agent CLI and the
// desktop Geometry panel. No file or platform access belongs here.

export const MAX_INTERNAL_COORDINATE_ATOMS = 512;
const EPS = 1e-8;
const DEG = Math.PI / 180;
const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '));
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(...a);
const scale = (a, s) => a.map(v => v * s);
const unit = a => scale(a, 1 / norm(a));
const numberText = v => v.toString();

function invalid(message, code = 'INVALID_COORDINATES') {
  throw Object.assign(new Error(message), { code });
}

function numeric(token) {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token) || !Number.isFinite(Number(token))) {
    invalid('Coordinates must contain finite numeric values; variables are unsupported.');
  }
  return Number(token);
}

function element(token) {
  if (!ELEMENTS.has(token)) invalid('Expected an element symbol; dummy atoms and atom labels are unsupported.');
  return token;
}

function checkAtoms(atoms) {
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i].position.some(v => !Number.isFinite(v) || Math.abs(v) > 1e6)) invalid('Coordinates must be finite and within ±1000000 angstrom.');
    for (let j = 0; j < i; j++) {
      if (norm(sub(atoms[i].position, atoms[j].position)) < EPS) invalid('Coincident atoms are unsupported.');
    }
  }
  return atoms;
}

export function parseXyzAtoms(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!/^\d+$/.test(lines[0]?.trim())) invalid('XYZ must begin with an atom count.');
  const count = Number(lines[0].trim());
  if (count < 1 || count > MAX_INTERNAL_COORDINATE_ATOMS) invalid(`Atom count must be 1–${MAX_INTERNAL_COORDINATE_ATOMS}.`, 'COORDINATE_LIMIT');
  if (lines.length < count + 2 || lines.slice(count + 2).some(line => line.trim())) invalid('Expected one complete XYZ frame; multiple frames are unsupported.');
  return checkAtoms(lines.slice(2, count + 2).map(line => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) invalid('XYZ rows require exactly an element and three Cartesian coordinates.');
    return { element: element(fields[0]), position: fields.slice(1).map(numeric) };
  }));
}

function perpendicular(u) {
  const axis = [0, 0, 0];
  axis[u.reduce((best, v, i) => Math.abs(v) < Math.abs(u[best]) ? i : best, 0)] = 1;
  return unit(sub(axis, scale(u, dot(axis, u))));
}

function referencePlane(u, b, d) {
  const delta = sub(d, b);
  const projection = sub(delta, scale(u, dot(delta, u)));
  return norm(projection) / norm(delta) > EPS ? unit(projection) : null;
}

/** Rows hold 0-based earlier-atom references and their bond/angle/dihedral values. */
export function parseZmatrixRows(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
  if (!lines.length || lines.length > MAX_INTERNAL_COORDINATE_ATOMS) invalid(`Atom count must be 1–${MAX_INTERNAL_COORDINATE_ATOMS}.`, 'COORDINATE_LIMIT');
  return lines.map((line, i) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 1 + 2 * Math.min(i, 3)) invalid('Z-matrix rows require an element and numeric reference/value pairs only.');
    const row = { element: fields[0] === 'X' ? 'X' : element(fields[0]), refs: [], values: [] };
    for (let j = 1; j < fields.length; j += 2) {
      if (!/^\d+$/.test(fields[j])) invalid('Z-matrix references must be positive integer atom indices.');
      const ref = Number(fields[j]) - 1;
      if (ref < 0 || ref >= i || row.refs.includes(ref)) invalid('Z-matrix references must be distinct earlier atom indices.');
      row.refs.push(ref);
      row.values.push(numeric(fields[j + 1]));
    }
    return row;
  });
}

export function atomsFromZmatrixRows(rows) {
  if (!rows.length || rows.length > MAX_INTERNAL_COORDINATE_ATOMS) invalid(`Atom count must be 1–${MAX_INTERNAL_COORDINATE_ATOMS}.`, 'COORDINATE_LIMIT');
  const atoms = [];
  for (const [i, { element: symbol, refs, values }] of rows.entries()) {
    if (symbol !== 'X') element(symbol);
    const arity = Math.min(i, 3);
    if (refs.length !== arity || values.length !== arity || values.some(value => !Number.isFinite(value))) invalid('Z-matrix rows require an element and numeric reference/value pairs only.');
    if (refs.some((ref, j) => !Number.isInteger(ref) || ref < 0 || ref >= i || refs.indexOf(ref) !== j)) invalid('Z-matrix references must be distinct earlier atom indices.');
    let position = [0, 0, 0];
    if (i) {
      const [r, angle = 0, torsion = 0] = values;
      if (r < EPS || r > 2e6 || angle < 0 || angle > 180 || Math.abs(torsion) > 180) invalid('Require positive distance, angle in [0,180], and dihedral in [-180,180].');
      const b = atoms[refs[0]].position;
      const u = i > 1 ? unit(sub(atoms[refs[1]].position, b)) : [0, 0, 1];
      const theta = angle * DEG, phi = torsion * DEG;
      const sine = angle === 0 || angle === 180 ? 0 : Math.sin(theta);
      let v = i > 2 ? referencePlane(u, b, atoms[refs[2]].position) : perpendicular(u);
      if (!v && angle !== 0 && angle !== 180) invalid('Collinear references require dummy atoms for a non-linear placement.');
      v ||= perpendicular(u);
      // The signed torsion is the conventional X–bond–angle–dihedral atom order.
      const w = cross(v, u);
      position = b.map((value, k) => value + r * (Math.cos(theta) * u[k] + sine * (Math.cos(phi) * v[k] + Math.sin(phi) * w[k])));
    }
    atoms.push({ element: symbol, position });
    // Validate before subsequent rows use these coordinates as a reference.
    checkAtoms(atoms.slice(-1));
    if (atoms.slice(0, -1).some(atom => norm(sub(position, atom.position)) < EPS)) invalid('Coincident atoms are unsupported.');
  }
  return atoms;
}

// sin(6°): references closer to collinear than this make angles and torsions ill-defined.
const WELL_CONDITIONED_SINE = 0.1;
const byDistance = (values, distance) => values.map(value => ({ value, distance: distance(value) }))
  .sort((a, b) => a.distance - b.distance || a.value.index - b.value.index).map(({ value }) => value);
const sineAt = (vertex, a, b) => norm(cross(unit(sub(a, vertex)), unit(sub(b, vertex))));

export function zmatrixRowsFromAtoms(atoms) {
  return atoms.map((atom, i) => {
    if (!i) return { element: atom.element, refs: [], values: [] };
    const previous = atoms.slice(0, i).map((value, index) => ({ index, position: value.position, distance: norm(sub(value.position, atom.position)) }));
    const bond = previous.reduce((best, value) => value.distance < best.distance ? value : best);
    const row = { element: atom.element, refs: [bond.index], values: [bond.distance] };
    if (i > 1) {
      const alternatives = previous.filter(value => value !== bond);
      // Prefer the bond reference's nearest well-conditioned neighbour so edited
      // angles and torsions follow chemical bonds; fall back to the distant atom.
      const fromBond = value => norm(sub(value.position, bond.position));
      const angle = byDistance(alternatives, fromBond).find(value => sineAt(bond.position, atom.position, value.position) >= WELL_CONDITIONED_SINE)
        ?? alternatives.reduce((best, value) => fromBond(value) > fromBond(best) ? value : best);
      const angleDelta = sub(angle.position, bond.position);
      const atomDelta = sub(atom.position, bond.position);
      const u = unit(angleDelta), direction = unit(atomDelta);
      // Test raw deltas first: independently normalized collinear vectors can
      // acquire a spurious cross product from floating-point division.
      const transverse = norm(cross(angleDelta, atomDelta));
      const degrees = transverse === 0 ? (dot(angleDelta, atomDelta) < 0 ? 180 : 0) : Math.atan2(norm(cross(u, direction)), dot(u, direction)) / DEG;
      if (transverse > 0 && (degrees === 0 || degrees === 180)) invalid('Geometry is too poorly conditioned to preserve its non-linear angle numerically.', 'ILL_CONDITIONED_ANGLE');
      row.refs.push(angle.index);
      row.values.push(degrees);
      if (i > 2) {
        const candidates = alternatives.filter(value => value !== angle).map(value => ({ ...value, sine: norm(cross(u, unit(sub(value.position, bond.position)))) }));
        const dihedral = byDistance(candidates, value => norm(sub(value.position, angle.position))).find(value => value.sine >= WELL_CONDITIONED_SINE)
          ?? candidates.reduce((best, value) => value.sine > best.sine ? value : best);
        const v = referencePlane(u, bond.position, dihedral.position);
        if (!v && transverse > 0) invalid('Atom order requires dummy atoms: preceding references are collinear.', 'DEGENERATE_REFERENCE_PLANE');
        const phi = v ? Math.atan2(dot(direction, cross(v, u)), dot(direction, v)) : 0;
        row.refs.push(dihedral.index);
        row.values.push(phi / DEG);
      }
    }
    return row;
  });
}

export function formatZmatrix(rows) {
  return rows.map(row => [row.element, ...row.refs.flatMap((ref, j) => [ref + 1, numberText(row.values[j])])].join(' ')).join('\n') + '\n';
}

export function formatXyz(atoms, comment) {
  return `${atoms.length}\n${comment}\n${atoms.map(atom => [atom.element, ...atom.position.map(numberText)].join(' ')).join('\n')}\n`;
}

function frame(atoms, anchor) {
  const origin = atoms[0].position;
  const e1 = atoms.length > 1 ? unit(sub(atoms[1].position, origin)) : [1, 0, 0];
  const plane = (anchor !== undefined && referencePlane(e1, origin, atoms[anchor].position)) || perpendicular(e1);
  const e3 = unit(cross(e1, plane));
  return { origin, axes: [e1, cross(e3, e1), e3] };
}

/**
 * Rigidly moves rebuilt Z-matrix atoms into the orientation of a reference
 * geometry with the same atom order, anchored on the first pair and earliest
 * common well-conditioned atom (which may follow leading linear atoms), so
 * editing one coordinate does not reorient or translate the whole molecule.
 * Optional points receive the same rigid transform, for added/reference rows.
 */
export function placeInReferenceFrame(atoms, reference, points = atoms) {
  if (atoms.length !== reference.length) invalid('Reference geometry must have the same atom count.');
  let anchor = -1;
  if (atoms.length > 2) {
    const axes = [atoms, reference].map(values => unit(sub(values[1].position, values[0].position)));
    let bestReach = 0;
    for (let i = 2; i < atoms.length; i++) {
      const deltas = [atoms, reference].map(values => sub(values[i].position, values[0].position));
      const reaches = deltas.map((delta, k) => norm(cross(axes[k], delta)));
      const sines = reaches.map((reach, k) => reach / norm(deltas[k]));
      if (sines.some(sine => sine <= EPS)) continue;
      // Preserve the earliest stable orientation anchor. Near the axis, use
      // the greatest common transverse reach to avoid amplifying roundoff
      // into motion of distant atoms on a subsequent reconstruction.
      if (sines.every(sine => sine >= WELL_CONDITIONED_SINE)) { anchor = i; break; }
      const reach = Math.min(...reaches);
      if (reach > bestReach) { anchor = i; bestReach = reach; }
    }
  }
  const source = frame(atoms, anchor < 0 ? undefined : anchor), target = frame(reference, anchor < 0 ? undefined : anchor);
  return points.map(atom => {
    const local = source.axes.map(axis => dot(sub(atom.position, source.origin), axis));
    return { ...atom, position: target.axes.reduce((position, axis, k) => add(position, scale(axis, local[k])), target.origin) };
  });
}
