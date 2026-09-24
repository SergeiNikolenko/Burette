function validatedAngles(angles: unknown): number[] {
  if (!Array.isArray(angles) || angles.length !== 3 || angles.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 360)) throw new Error('Orientation requires three angles between −360° and 360°');
  return angles;
}

function rotateVector(position: number[], angles: number[]): number[] {
  let [x, y, z] = position;
  for (let axis = 0; axis < 3; axis++) {
    const angle = angles[axis] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    if (axis === 0) [y, z] = [y*c-z*s, y*s+z*c];
    if (axis === 1) [x, z] = [x*c+z*s, -x*s+z*c];
    if (axis === 2) [x, y] = [x*c-y*s, x*s+y*c];
  }
  return [x, y, z];
}

export function isPeriodicXyz(text: string): boolean {
  return /^\s*\d+\s*\r?\n[^\r\n]*\bLattice="[^"]+"/.test(text);
}

/** Rotate an extended XYZ cell and its atoms together, preserving the lattice metadata. */
export function rotatePeriodicXyz(text: string, value: unknown): string {
  const angles = validatedAngles(value);
  const lines = text.replace(/\r\n?/g, '\n').trimEnd().split('\n');
  const count = Number(lines[0]);
  const match = lines[1]?.match(/\bLattice="([^"]+)"/);
  if (!Number.isInteger(count) || count < 1 || count > 100000 || lines.length < count + 2 || !match) throw new Error('Invalid periodic XYZ structure');
  const lattice = match[1].trim().split(/\s+/).map(Number);
  if (lattice.length !== 9 || lattice.some(n => !Number.isFinite(n))) throw new Error('Invalid periodic XYZ lattice');
  const rotatedLattice = [0, 3, 6].flatMap(i => rotateVector(lattice.slice(i, i + 3), angles));
  const atomLines = lines.slice(2, count + 2).map(line => {
    const tokens = line.trim().split(/\s+/);
    const position = tokens.slice(1, 4).map(Number);
    if (position.length !== 3 || position.some(n => !Number.isFinite(n))) throw new Error('Invalid periodic XYZ coordinates');
    tokens.splice(1, 3, ...rotateVector(position, angles).map(n => n.toFixed(9)));
    return tokens.join(' ');
  });
  lines[1] = lines[1].replace(match[0], `Lattice="${rotatedLattice.map(n => n.toFixed(9)).join(' ')}"`);
  return `${lines[0]}\n${lines[1]}\n${atomLines.join('\n')}\n`;
}

/** Rotate a saved xyzrender reference about its centroid, preserving atom order. */
export function rotateXyzrenderReference(text: string, value: unknown): string {
  const angles = validatedAngles(value);
  const lines = text.trim().split(/\r?\n/);
  const count = Number(lines[0]);
  if (!Number.isInteger(count) || count < 1 || count > 100000 || lines.length < count + 2) throw new Error('Invalid orientation reference');
  const atoms = lines.slice(2, count + 2).map(line => { const [symbol, ...values] = line.trim().split(/\s+/); return { symbol, p: values.slice(0, 3).map(Number) }; });
  if (atoms.some(a => a.p.length !== 3 || a.p.some(n => !Number.isFinite(n)))) throw new Error('Invalid reference coordinates');
  const center = [0, 1, 2].map(i => atoms.reduce((sum, atom) => sum + atom.p[i], 0) / count);
  for (const atom of atoms) {
    atom.p = rotateVector(atom.p.map((n, i) => n - center[i]), angles).map((n, i) => n + center[i]);
  }
  return `${count}\nBurette orientation\n${atoms.map(a => `${a.symbol} ${a.p.map(n => n.toFixed(9)).join(' ')}`).join('\n')}\n`;
}
