/** Rotate a saved xyzrender reference about its centroid, preserving atom order. */
export function rotateXyzrenderReference(text: string, angles: unknown): string {
  if (!Array.isArray(angles) || angles.length !== 3 || angles.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 360)) throw new Error('Orientation requires three angles between −360° and 360°');
  const lines = text.trim().split(/\r?\n/);
  const count = Number(lines[0]);
  if (!Number.isInteger(count) || count < 1 || count > 100000 || lines.length < count + 2) throw new Error('Invalid orientation reference');
  const atoms = lines.slice(2, count + 2).map(line => { const [symbol, ...values] = line.trim().split(/\s+/); return { symbol, p: values.slice(0, 3).map(Number) }; });
  if (atoms.some(a => a.p.length !== 3 || a.p.some(n => !Number.isFinite(n)))) throw new Error('Invalid reference coordinates');
  const center = [0, 1, 2].map(i => atoms.reduce((sum, atom) => sum + atom.p[i], 0) / count);
  for (const atom of atoms) {
    let [x, y, z] = atom.p.map((n, i) => n - center[i]);
    for (let axis = 0; axis < 3; axis++) {
      const angle = angles[axis] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      if (axis === 0) [y, z] = [y*c-z*s, y*s+z*c];
      if (axis === 1) [x, z] = [x*c+z*s, -x*s+z*c];
      if (axis === 2) [x, y] = [x*c-y*s, x*s+y*c];
    }
    atom.p = [x, y, z].map((n, i) => n + center[i]);
  }
  return `${count}\nBurette orientation\n${atoms.map(a => `${a.symbol} ${a.p.map(n => n.toFixed(9)).join(' ')}`).join('\n')}\n`;
}
